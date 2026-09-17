import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Album,
  ArtistFolder,
  BookmarkKind,
  CatalogBookmark,
  CatalogFilter,
  FacetRelevance,
  FilterValidity,
  Job,
  Library,
  LibraryFolder,
  OperationPreview,
  Page,
  QuickSearchResults,
  Selection,
  Track,
} from "../shared/contracts.js";
import {
  artistSortKey,
  compareArtistNames,
} from "../shared/artist-grouping.js";

type Row = Record<string, any>;
const checkedFolderPath = (relativePath: string) => {
  if (
    path.isAbsolute(relativePath) ||
    relativePath === "." ||
    path.normalize(relativePath) !== relativePath ||
    relativePath.split(path.sep).includes("..")
  )
    throw new Error("Некорректный путь папки");
  return relativePath;
};
const fromRow = (r: Row): Track =>
  ({
    ...r,
    artists: JSON.parse(r.artists),
    albumArtists: JSON.parse(r.albumArtists),
    genres: JSON.parse(r.genres),
    missingTagFields: r.missingTagFields
      ? JSON.parse(r.missingTagFields)
      : undefined,
    musicBrainzRecordingId: r.musicBrainzRecordingId || null,
    musicBrainzReleaseId: r.musicBrainzReleaseId || null,
    musicBrainzReleaseGroupId: r.musicBrainzReleaseGroupId || null,
    available: Boolean(r.available),
  }) as Track;

export class Catalog {
  readonly db: Database.Database;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "catalog.sqlite"));
    this.db.function(
      "artist_sort_key",
      { deterministic: true },
      (artist: string) => artistSortKey(artist),
    );
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true }) as number;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS libraries (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, available INTEGER NOT NULL DEFAULT 1, lastScan TEXT);
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY, libraryId TEXT NOT NULL REFERENCES libraries(id), relativePath TEXT NOT NULL,
        title TEXT NOT NULL, artists TEXT NOT NULL, albumTitle TEXT NOT NULL, albumArtists TEXT NOT NULL,
        albumKey TEXT NOT NULL, genres TEXT NOT NULL, year INTEGER, trackNumber INTEGER, discNumber INTEGER,
        duration REAL NOT NULL, format TEXT NOT NULL, size INTEGER NOT NULL, mtimeMs REAL NOT NULL,
        coverId TEXT, available INTEGER NOT NULL DEFAULT 1, scanId TEXT, UNIQUE(libraryId, relativePath)
      );
      CREATE INDEX IF NOT EXISTS tracks_album ON tracks(albumKey);
      CREATE INDEX IF NOT EXISTS tracks_order ON tracks(albumTitle COLLATE NOCASE, albumKey, discNumber, trackNumber, relativePath);
      CREATE TABLE IF NOT EXISTS track_genres (trackId TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, genre TEXT NOT NULL, PRIMARY KEY(trackId, genre));
      CREATE INDEX IF NOT EXISTS genres_value ON track_genres(genre, trackId);
      CREATE TABLE IF NOT EXISTS track_artists (trackId TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, artist TEXT NOT NULL, PRIMARY KEY(trackId,artist));
      CREATE INDEX IF NOT EXISTS artists_value ON track_artists(artist,trackId);
      CREATE TABLE IF NOT EXISTS track_album_artists (trackId TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, artist TEXT NOT NULL, PRIMARY KEY(trackId,artist));
      CREATE INDEX IF NOT EXISTS album_artists_value ON track_album_artists(artist,trackId);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queues (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, trackIds TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bookmarks (
        kind TEXT NOT NULL CHECK(kind IN ('artist','album','track')),
        id TEXT NOT NULL,
        PRIMARY KEY(kind,id)
      );
    `);
    if (version < 2)
      this.db.transaction(() => {
        this.db.exec(
          "INSERT OR IGNORE INTO track_artists(trackId,artist) SELECT t.id,j.value FROM tracks t,json_each(t.artists) j",
        );
        this.db.pragma("user_version = 2");
      })();
    if (version < 3)
      this.db.transaction(() => {
        const columns = new Set(
          (this.db.pragma("table_info(tracks)") as { name: string }[]).map(
            (column) => column.name,
          ),
        );
        if (!columns.has("missingTagFields"))
          this.db.exec("ALTER TABLE tracks ADD COLUMN missingTagFields TEXT");
        if (!columns.has("musicBrainzRecordingId"))
          this.db.exec(
            "ALTER TABLE tracks ADD COLUMN musicBrainzRecordingId TEXT",
          );
        if (!columns.has("musicBrainzReleaseId"))
          this.db.exec(
            "ALTER TABLE tracks ADD COLUMN musicBrainzReleaseId TEXT",
          );
        if (!columns.has("musicBrainzReleaseGroupId"))
          this.db.exec(
            "ALTER TABLE tracks ADD COLUMN musicBrainzReleaseGroupId TEXT",
          );
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS http_cache (
            key TEXT PRIMARY KEY,
            status INTEGER NOT NULL,
            payload TEXT NOT NULL,
            expiresAt INTEGER NOT NULL
          )
        `);
        this.db.pragma("user_version = 3");
      })();
    if (version < 4)
      this.db.transaction(() => {
        this.db.exec(
          "INSERT OR IGNORE INTO track_album_artists(trackId,artist) SELECT t.id,j.value FROM tracks t,json_each(t.albumArtists) j",
        );
        this.db.pragma("user_version = 4");
      })();
    if (version < 5) this.db.pragma("user_version = 5");
    if (version < 6)
      this.db.transaction(() => {
        this.db.exec(`
          DELETE FROM track_album_artists;
          INSERT OR IGNORE INTO track_album_artists(trackId,artist)
          SELECT t.id,j.value
          FROM tracks t,
               json_each(
                 CASE WHEN t.albumArtists='[]' THEN t.artists ELSE t.albumArtists END
               ) j
        `);
        this.db.pragma("user_version = 6");
      })();
  }
  libraries(): Library[] {
    return (
      this.db
        .prepare(
          `SELECT l.*, (SELECT count(*) FROM tracks t WHERE t.libraryId=l.id AND t.available=1) AS trackCount FROM libraries l ORDER BY name`,
        )
        .all() as Row[]
    ).map((r) => ({ ...r, available: Boolean(r.available) }) as Library);
  }
  library(id: string): Library {
    const l = this.libraries().find((l) => l.id === id);
    if (!l) throw new Error("Библиотека не найдена");
    return l;
  }
  folders(libraryId: string, parent: string | null): LibraryFolder[] {
    this.library(libraryId);
    const parentPath = parent === null ? null : checkedFolderPath(parent);
    const prefix = parentPath ? `${parentPath}${path.sep}` : "";
    const rows = this.db
      .prepare(
        "SELECT relativePath FROM tracks WHERE libraryId=? AND available=1 ORDER BY relativePath",
      )
      .all(libraryId) as { relativePath: string }[];
    const folders = new Map<string, LibraryFolder>();
    for (const row of rows) {
      if (prefix && !row.relativePath.startsWith(prefix)) continue;
      const remainder = row.relativePath.slice(prefix.length);
      const parts = remainder.split(path.sep);
      if (parts.length < 2) continue;
      const name = parts[0];
      const relativePath = parentPath ? path.join(parentPath, name) : name;
      const existing = folders.get(relativePath);
      if (existing) {
        existing.trackCount++;
        existing.hasChildren ||= parts.length > 2;
      } else {
        folders.set(relativePath, {
          relativePath,
          name,
          trackCount: 1,
          hasChildren: parts.length > 2,
        });
      }
    }
    return [...folders.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name, "ru", {
          numeric: true,
          sensitivity: "base",
        }) || a.relativePath.localeCompare(b.relativePath),
    );
  }
  artistFolders(artists: string[]): ArtistFolder[] {
    const tracks = this.tracks(
      {
        libraryIds: [],
        folders: [],
        genres: [],
        artists,
        albumIds: [],
        search: "",
        bookmarksOnly: false,
      },
      0,
      100000,
    ).items;
    const folders = new Map<string, ArtistFolder>();
    for (const track of tracks) {
      const relativePath = path.dirname(track.relativePath);
      if (relativePath === ".") continue;
      const key = `${track.libraryId}\u0000${relativePath}`;
      const current = folders.get(key);
      if (current) current.trackCount++;
      else
        folders.set(key, {
          libraryId: track.libraryId,
          relativePath,
          trackCount: 1,
        });
    }
    const ordered = [...folders.values()].sort(
      (left, right) =>
        left.libraryId.localeCompare(right.libraryId) ||
        left.relativePath.localeCompare(right.relativePath),
    );
    return ordered.filter(
      (folder) =>
        !ordered.some(
          (parent) =>
            parent !== folder &&
            parent.libraryId === folder.libraryId &&
            folder.relativePath.startsWith(`${parent.relativePath}${path.sep}`),
        ),
    );
  }
  hasFolder(libraryId: string, relativePath: string): boolean {
    const parent = path.dirname(checkedFolderPath(relativePath));
    return this.folders(libraryId, parent === "." ? null : parent).some(
      (folder) => folder.relativePath === relativePath,
    );
  }
  addLibrary(name: string, folder: string): Library {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO libraries (id,name,path) VALUES (?,?,?)")
      .run(id, name, folder);
    return this.library(id);
  }
  renameLibrary(id: string, name: string): Library {
    this.library(id);
    this.db.prepare("UPDATE libraries SET name=? WHERE id=?").run(name, id);
    return this.library(id);
  }
  removeLibrary(id: string): Library {
    const library = this.library(id);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM tracks WHERE libraryId=?").run(id);
      this.db.prepare("DELETE FROM libraries WHERE id=?").run(id);
      // Bookmarks do not use foreign keys. Retain entries still represented by
      // another library and remove only those made orphaned by this deletion.
      this.db.exec(`
        DELETE FROM bookmarks
        WHERE (kind='track' AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.id=bookmarks.id AND t.available=1))
           OR (kind='album' AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.albumKey=bookmarks.id AND t.available=1))
           OR (kind='artist' AND bookmarks.id<>'' AND NOT EXISTS (
             SELECT 1 FROM track_album_artists a JOIN tracks t ON t.id=a.trackId
             WHERE a.artist=bookmarks.id AND t.available=1
           ))
           OR (kind='artist' AND bookmarks.id='' AND NOT EXISTS (
             SELECT 1 FROM tracks t
             WHERE t.albumArtists='[]' AND t.artists='[]' AND t.available=1
           ))
      `);
    })();
    return library;
  }
  track(id: string): Track | undefined {
    const row = this.db.prepare("SELECT * FROM tracks WHERE id=?").get(id) as
      Row | undefined;
    return row ? fromRow(row) : undefined;
  }
  firstAlbumTrack(id: string): Track | undefined {
    const row = this.db
      .prepare(
        `SELECT t.* FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE t.albumKey=? AND t.available=1 AND l.available=1 ORDER BY t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath LIMIT 1`,
      )
      .get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }
  bookmarks(): CatalogBookmark[] {
    return this.db
      .prepare(
        `SELECT kind,id FROM bookmarks
         ORDER BY CASE kind WHEN 'artist' THEN 1 WHEN 'album' THEN 2 ELSE 3 END, id COLLATE NOCASE`,
      )
      .all() as CatalogBookmark[];
  }
  setBookmark(kind: BookmarkKind, id: string, bookmarked: boolean): void {
    if (!bookmarked) {
      this.db
        .prepare("DELETE FROM bookmarks WHERE kind=? AND id=?")
        .run(kind, id);
      return;
    }
    const exists =
      kind === "track"
        ? this.db
            .prepare("SELECT 1 FROM tracks WHERE id=? AND available=1")
            .get(id)
        : kind === "album"
          ? this.db
              .prepare("SELECT 1 FROM tracks WHERE albumKey=? AND available=1")
              .get(id)
          : id
            ? this.db
                .prepare(
                  `SELECT 1 FROM track_album_artists a
                   JOIN tracks t ON t.id=a.trackId
                   WHERE a.artist=? AND t.available=1`,
                )
                .get(id)
            : this.db
                .prepare(
                  "SELECT 1 FROM tracks WHERE albumArtists='[]' AND artists='[]' AND available=1",
                )
                .get();
    if (!exists)
      throw new Error(
        kind === "track"
          ? "Трек не найден"
          : kind === "album"
            ? "Альбом не найден"
            : "Исполнитель не найден",
      );
    this.db
      .prepare("INSERT OR IGNORE INTO bookmarks(kind,id) VALUES (?,?)")
      .run(kind, id);
  }
  where(filter: CatalogFilter): { sql: string; args: any[] } {
    const clauses = ["t.available=1", "l.available=1"];
    const args: any[] = [];
    const list = (values: string[], column: string) => {
      if (values.length) {
        clauses.push(`${column} IN (${values.map(() => "?").join(",")})`);
        args.push(...values);
      }
    };
    const selectedFolders = filter.folders || [];
    if (filter.libraryIds.length || selectedFolders.length) {
      const folders = selectedFolders.map((selection) => {
        const folder = checkedFolderPath(selection.relativePath);
        return {
          libraryId: selection.libraryId,
          prefix: `${folder}${path.sep}`,
        };
      });
      const locationClauses: string[] = [];
      if (filter.libraryIds.length)
        locationClauses.push(
          `t.libraryId IN (${filter.libraryIds.map(() => "?").join(",")})`,
        );
      locationClauses.push(
        ...folders.map(
          () => "(t.libraryId=? AND substr(t.relativePath,1,?)=?)",
        ),
      );
      clauses.push(`(${locationClauses.join(" OR ")})`);
      args.push(...filter.libraryIds);
      for (const folder of folders)
        args.push(folder.libraryId, folder.prefix.length, folder.prefix);
    }
    list(filter.albumIds, "t.albumKey");
    if (filter.artists.length) {
      const values = filter.artists.filter((a) => a !== "");
      const parts: string[] = [];
      if (values.length) {
        parts.push(
          `EXISTS (SELECT 1 FROM track_album_artists a WHERE a.trackId=t.id AND a.artist IN (${values.map(() => "?").join(",")}))`,
        );
        args.push(...values);
      }
      if (filter.artists.includes(""))
        parts.push("t.albumArtists='[]' AND t.artists='[]'");
      clauses.push(`(${parts.join(" OR ")})`);
    }
    if (filter.genres.length) {
      const genres = filter.genres.filter((g) => g !== "");
      const parts: string[] = [];
      if (genres.length) {
        parts.push(
          `EXISTS (SELECT 1 FROM track_genres g WHERE g.trackId=t.id AND g.genre IN (${genres.map(() => "?").join(",")}))`,
        );
        args.push(...genres);
      }
      if (filter.genres.includes("")) parts.push("t.genres='[]'");
      clauses.push(`(${parts.join(" OR ")})`);
    }
    if (filter.search.trim()) {
      clauses.push(
        "(t.title LIKE ? ESCAPE '\\' OR t.albumTitle LIKE ? ESCAPE '\\' OR t.artists LIKE ? ESCAPE '\\')",
      );
      const search = `%${filter.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
      args.push(search, search, search);
    }
    if (filter.bookmarksOnly) {
      clauses.push(`(
        EXISTS (SELECT 1 FROM bookmarks b WHERE b.kind='track' AND b.id=t.id)
        OR EXISTS (SELECT 1 FROM bookmarks b WHERE b.kind='album' AND b.id=t.albumKey)
        OR EXISTS (
          SELECT 1 FROM track_album_artists a
          JOIN bookmarks b ON b.kind='artist' AND b.id=a.artist
          WHERE a.trackId=t.id
        )
        OR (t.albumArtists='[]' AND t.artists='[]' AND EXISTS (
          SELECT 1 FROM bookmarks b WHERE b.kind='artist' AND b.id=''
        ))
      )`);
    }
    return { sql: clauses.join(" AND "), args };
  }
  tracks(filter: CatalogFilter, offset = 0, limit = 200): Page<Track> {
    const { sql, args } = this.where(filter);
    const total = (
      this.db
        .prepare(
          `SELECT count(*) n FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql}`,
        )
        .get(...args) as Row
    ).n;
    const rows = this.db
      .prepare(
          `SELECT t.* FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql} ORDER BY ${this.albumArtistOrder("t")}, t.year IS NOT NULL, t.year DESC, t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as Row[];
    const formats = new Map<string, string[]>();
    for (const row of rows)
      if (!formats.has(row.albumKey))
        formats.set(
          row.albumKey,
          (
            this.db
              .prepare(
                "SELECT DISTINCT format FROM tracks WHERE albumKey=? AND available=1 ORDER BY format",
              )
              .all(row.albumKey) as { format: string }[]
          ).map((r) => r.format),
        );
    const albumIds = [...new Set(rows.map((row) => row.albumKey))];
    const albumGenres = new Map<string, string[]>();
    if (albumIds.length) {
      const placeholders = albumIds.map(() => "?").join(",");
      const genreRows = this.db
        .prepare(
          `SELECT DISTINCT t.albumKey id, g.genre
           FROM track_genres g JOIN tracks t ON t.id=g.trackId
           WHERE t.available=1 AND t.albumKey IN (${placeholders}) AND g.genre<>''`,
        )
        .all(...albumIds) as { id: string; genre: string }[];
      for (const { id, genre } of genreRows)
        albumGenres.set(id, [...(albumGenres.get(id) || []), genre]);
      for (const genres of albumGenres.values())
        genres.sort((left, right) =>
          left.localeCompare(right, "ru", { sensitivity: "base" }),
        );
    }
    return {
      items: rows.map((r) => ({
        ...fromRow(r),
        albumFormats: formats.get(r.albumKey),
        albumGenres: albumGenres.get(r.albumKey) || [],
      })),
      total,
      offset,
    };
  }
  selected(selection: Selection): Track[] {
    if ("trackIds" in selection)
      return [...new Set(selection.trackIds)].map((id) => {
        const t = this.track(id);
        if (!t || !t.available)
          throw new Error("Трек больше недоступен. Обновите выбор.");
        return t;
      });
    const excluded = new Set(selection.excludeTrackIds || []);
    return this.tracks(selection.filter, 0, 100000).items.filter(
      (t) => !excluded.has(t.id),
    );
  }
  trackIds(filter: CatalogFilter): string[] {
    const { sql, args } = this.where(filter);
    return (
      this.db
        .prepare(
          `SELECT t.id FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql} ORDER BY ${this.albumArtistOrder("t")}, t.year IS NOT NULL, t.year DESC, t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath LIMIT 100000`,
        )
        .all(...args) as { id: string }[]
    ).map((r) => r.id);
  }
  validAlbumIds(filter: CatalogFilter): string[] {
    if (!filter.albumIds.length) return [];
    const { sql, args } = this.where(filter);
    return (
      this.db
        .prepare(
          `SELECT DISTINCT t.albumKey id FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql}`,
        )
        .all(...args) as { id: string }[]
    ).map((r) => r.id);
  }
  filterValidity(filter: CatalogFilter): FilterValidity {
    const genreNames = new Set(this.genres(filter).map((genre) => genre.name));
    const genres = filter.genres.filter((genre) => genreNames.has(genre));
    const artistNames = new Set(
      this.artists(
        { ...filter, genres, artists: [], albumIds: [] },
        0,
        100000,
      ).items.map((artist) => artist.name),
    );
    const artists = filter.artists.filter((artist) => artistNames.has(artist));
    return {
      genres,
      artists,
      albumIds: this.validAlbumIds({ ...filter, genres, artists }),
    };
  }
  facetRelevance(filter: CatalogFilter): FacetRelevance {
    const clauses = ["t.available=1", "l.available=1"];
    const args: string[] = [];
    const relations: string[] = [];
    const artists = filter.artists.filter((artist) => artist !== "");
    if (artists.length) {
      relations.push(
        `EXISTS (SELECT 1 FROM track_album_artists a WHERE a.trackId=t.id AND a.artist IN (${artists.map(() => "?").join(",")}))`,
      );
      args.push(...artists);
    }
    if (filter.artists.includes(""))
      relations.push("t.albumArtists='[]' AND t.artists='[]'");
    if (filter.albumIds.length) {
      relations.push(
        `t.albumKey IN (${filter.albumIds.map(() => "?").join(",")})`,
      );
      args.push(...filter.albumIds);
    }
    if (filter.genres.length) {
      const genres = filter.genres.filter((genre) => genre !== "");
      const parts: string[] = [];
      if (genres.length) {
        parts.push(
          `EXISTS (SELECT 1 FROM track_genres g WHERE g.trackId=t.id AND g.genre IN (${genres.map(() => "?").join(",")}))`,
        );
        args.push(...genres);
      }
      if (filter.genres.includes("")) parts.push("t.genres='[]'");
      relations.push(`(${parts.join(" OR ")})`);
    }
    if (!relations.length) return { libraryIds: [], genres: [], folders: [] };
    clauses.push(`(${relations.join(" OR ")})`);
    const sql = clauses.join(" AND ");
    const folderKeys = new Set<string>();
    for (const row of this.db
      .prepare(
        `SELECT t.libraryId, t.relativePath FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql}`,
      )
      .all(...args) as { libraryId: string; relativePath: string }[]) {
      let relativePath = path.dirname(row.relativePath);
      while (relativePath !== "." && relativePath !== path.sep) {
        folderKeys.add(`${row.libraryId}\u0000${relativePath}`);
        const parent = path.dirname(relativePath);
        if (parent === relativePath) break;
        relativePath = parent;
      }
    }
    return {
      libraryIds: (
        this.db
          .prepare(
            `SELECT DISTINCT t.libraryId id FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql} ORDER BY id`,
          )
          .all(...args) as { id: string }[]
      ).map((row) => row.id),
      genres: (
        this.db
          .prepare(
            `SELECT DISTINCT coalesce(g.genre,'') name FROM tracks t JOIN libraries l ON l.id=t.libraryId LEFT JOIN track_genres g ON g.trackId=t.id WHERE ${sql} ORDER BY name COLLATE NOCASE`,
          )
          .all(...args) as { name: string }[]
      ).map((row) => row.name),
      folders: [...folderKeys]
        .map((key) => {
          const [libraryId, relativePath] = key.split("\u0000");
          return { libraryId, relativePath };
        })
        .sort(
          (left, right) =>
            left.libraryId.localeCompare(right.libraryId) ||
            left.relativePath.localeCompare(right.relativePath),
        ),
    };
  }
  genres(filter: CatalogFilter): { name: string; count: number }[] {
    const { sql, args } = this.where({
      ...filter,
      genres: [],
      artists: [],
      albumIds: [],
      search: "",
    });
    return this.db
      .prepare(
        `SELECT coalesce(g.genre,'') name, count(DISTINCT a.artist) count FROM tracks t JOIN libraries l ON l.id=t.libraryId LEFT JOIN track_genres g ON g.trackId=t.id LEFT JOIN track_album_artists a ON a.trackId=t.id WHERE ${sql} GROUP BY coalesce(g.genre,'') ORDER BY name COLLATE NOCASE`,
      )
      .all(...args) as { name: string; count: number }[];
  }
  private fallbackAlbumArtists(ids: string[]): Map<string, string[]> {
    const artists = new Map<string, string[]>();
    if (!ids.length) return artists;
    const placeholders = ids.map(() => "?").join(",");
    const values = this.db
      .prepare(
        `SELECT DISTINCT t.albumKey id, a.artist
         FROM track_album_artists a JOIN tracks t ON t.id=a.trackId
         WHERE t.available=1 AND t.albumKey IN (${placeholders})
         ORDER BY t.albumKey, artist_sort_key(a.artist), a.artist`,
      )
      .all(...ids) as { id: string; artist: string }[];
    for (const { id, artist } of values)
      artists.set(id, [...(artists.get(id) || []), artist]);
    return artists;
  }
  private albumArtistOrder(trackAlias: string): string {
    return `coalesce((
      SELECT group_concat(artist, char(31))
      FROM (
        SELECT DISTINCT a.artist
        FROM track_album_artists a
        JOIN tracks albumTrack ON albumTrack.id=a.trackId
        JOIN libraries albumLibrary ON albumLibrary.id=albumTrack.libraryId
        WHERE albumTrack.albumKey=${trackAlias}.albumKey
          AND albumTrack.available=1
          AND albumLibrary.available=1
        ORDER BY artist_sort_key(a.artist), a.artist
      )
    ), '')`;
  }
  albums(filter: CatalogFilter, offset = 0, limit = 120): Page<Album> {
    const { sql, args } = this.where({ ...filter, albumIds: [] });
    const total = (
      this.db
        .prepare(
          `SELECT count(DISTINCT t.albumKey) n FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql}`,
        )
        .get(...args) as Row
    ).n;
    const rows = this.db
      .prepare(
        `WITH ranked AS (
           SELECT t.albumKey id, t.albumTitle title, t.albumArtists artists, t.year,
                  ${this.albumArtistOrder("t")} artistGroupKey,
                  max(t.coverId) OVER (PARTITION BY t.albumKey) coverId,
                  count(*) OVER (PARTITION BY t.albumKey) trackCount,
                  row_number() OVER (
                    PARTITION BY t.albumKey
                    ORDER BY t.year IS NOT NULL, t.year DESC,
                             t.albumTitle COLLATE NOCASE, t.albumKey,
                             coalesce(t.discNumber,0), coalesce(t.trackNumber,0),
                             t.relativePath
                  ) albumRank
           FROM tracks t JOIN libraries l ON l.id=t.libraryId
           WHERE ${sql}
         )
         SELECT id, title, artists, year, coverId, trackCount
         FROM ranked
         WHERE albumRank=1
         ORDER BY artistGroupKey, year IS NOT NULL, year DESC,
                  title COLLATE NOCASE, id
         LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as Row[];
    const items: Array<Row & { artists: string[] }> = rows.map((row) => ({
      ...row,
      artists: (JSON.parse(row.artists) as string[]).sort(compareArtistNames),
    }));
    const ids = items
      .filter((album) => !album.artists.length)
      .map((album) => album.id);
    const fallbackArtists = this.fallbackAlbumArtists(ids);
    return {
      items: items.map(
        (album) =>
          ({
            ...album,
            artists: album.artists.length
              ? album.artists
              : fallbackArtists.get(album.id) || [],
          }) as Album,
      ),
      total,
      offset,
    };
  }
  artists(
    filter: CatalogFilter,
    offset = 0,
    limit = 200,
  ): Page<{ name: string; count: number }> {
    const { sql, args } = this.where({
      ...filter,
      artists: [],
      albumIds: [],
      search: "",
    });
    const group = `FROM tracks t JOIN libraries l ON l.id=t.libraryId LEFT JOIN track_album_artists a ON a.trackId=t.id WHERE ${sql} GROUP BY coalesce(a.artist,'')`;
    const allItems = this.db
      .prepare(
        `SELECT coalesce(a.artist,'') name,count(DISTINCT t.albumKey) count ${group}`,
      )
      .all(...args) as { name: string; count: number }[];
    allItems.sort((a, b) => compareArtistNames(a.name, b.name));
    return {
      items: allItems.slice(offset, offset + limit),
      total: allItems.length,
      offset,
    };
  }
  quickSearch(query: string, limit = 6): QuickSearchResults {
    const value = query.trim();
    if (!value) return { genres: [], artists: [], albums: [], tracks: [] };
    const escaped = value.replace(/[\\%_]/g, "\\$&");
    const prefix = `${escaped}%`;
    const contains = `%${escaped}%`;
    const available = "t.available=1 AND l.available=1";
    const genres = this.db
      .prepare(
        `SELECT g.genre name, count(DISTINCT t.id) count
         FROM track_genres g JOIN tracks t ON t.id=g.trackId JOIN libraries l ON l.id=t.libraryId
         WHERE ${available} AND g.genre LIKE ? ESCAPE '\\'
         GROUP BY g.genre
         ORDER BY CASE WHEN g.genre=? COLLATE NOCASE THEN 0 WHEN g.genre LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                  g.genre COLLATE NOCASE
         LIMIT ?`,
      )
      .all(contains, value, prefix, limit) as { name: string; count: number }[];
    const artists = this.db
      .prepare(
        `SELECT a.artist name, count(DISTINCT t.albumKey) count
         FROM track_album_artists a JOIN tracks t ON t.id=a.trackId JOIN libraries l ON l.id=t.libraryId
         WHERE ${available} AND a.artist LIKE ? ESCAPE '\\'
         GROUP BY a.artist
         ORDER BY CASE WHEN a.artist=? COLLATE NOCASE THEN 0 WHEN a.artist LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                  a.artist COLLATE NOCASE
         LIMIT ?`,
      )
      .all(contains, value, prefix, limit) as { name: string; count: number }[];
    const albumRows = this.db
      .prepare(
        `SELECT t.albumKey id, t.albumTitle title, t.albumArtists artists, t.year,
                max(t.coverId) coverId, count(*) trackCount
         FROM tracks t JOIN libraries l ON l.id=t.libraryId
         WHERE ${available} AND t.albumTitle LIKE ? ESCAPE '\\'
         GROUP BY t.albumKey
         ORDER BY CASE WHEN t.albumTitle=? COLLATE NOCASE THEN 0 WHEN t.albumTitle LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                  t.albumTitle COLLATE NOCASE, t.albumKey
         LIMIT ?`,
      )
      .all(contains, value, prefix, limit) as Row[];
    const trackRows = this.db
      .prepare(
        `SELECT t.* FROM tracks t JOIN libraries l ON l.id=t.libraryId
         WHERE ${available} AND (
           t.title LIKE ? ESCAPE '\\' OR t.albumTitle LIKE ? ESCAPE '\\' OR t.artists LIKE ? ESCAPE '\\'
         )
         ORDER BY CASE
           WHEN t.title=? COLLATE NOCASE THEN 0
           WHEN t.title LIKE ? ESCAPE '\\' THEN 1
           WHEN t.albumTitle LIKE ? ESCAPE '\\' THEN 2
           ELSE 3
         END,
         t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath
         LIMIT ?`,
      )
      .all(contains, contains, contains, value, prefix, prefix, limit) as Row[];
    const albums: Array<Row & { artists: string[] }> = albumRows.map((row) => ({
      ...row,
      artists: JSON.parse(row.artists) as string[],
    }));
    const fallbackArtists = this.fallbackAlbumArtists(
      albums.filter((album) => !album.artists.length).map((album) => album.id),
    );
    return {
      genres,
      artists,
      albums: albums.map(
        (album) =>
          ({
            ...album,
            artists: album.artists.length
              ? album.artists
              : fallbackArtists.get(album.id) || [],
          }) as Album,
      ),
      tracks: trackRows.map(fromRow),
    };
  }
  upsert(track: Track, scanId: string | null = null): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tracks (id,libraryId,relativePath,title,artists,albumTitle,albumArtists,albumKey,genres,year,trackNumber,discNumber,duration,format,size,mtimeMs,coverId,available,scanId,missingTagFields,musicBrainzRecordingId,musicBrainzReleaseId,musicBrainzReleaseGroupId)
        VALUES (@id,@libraryId,@relativePath,@title,@artists,@albumTitle,@albumArtists,@albumKey,@genres,@year,@trackNumber,@discNumber,@duration,@format,@size,@mtimeMs,@coverId,@available,@scanId,@missingTagFields,@musicBrainzRecordingId,@musicBrainzReleaseId,@musicBrainzReleaseGroupId)
        ON CONFLICT(id) DO UPDATE SET libraryId=excluded.libraryId, relativePath=excluded.relativePath, title=excluded.title,artists=excluded.artists,albumTitle=excluded.albumTitle,albumArtists=excluded.albumArtists,albumKey=excluded.albumKey,genres=excluded.genres,year=excluded.year,trackNumber=excluded.trackNumber,discNumber=excluded.discNumber,duration=excluded.duration,format=excluded.format,size=excluded.size,mtimeMs=excluded.mtimeMs,coverId=excluded.coverId,available=excluded.available,scanId=excluded.scanId,missingTagFields=excluded.missingTagFields,musicBrainzRecordingId=excluded.musicBrainzRecordingId,musicBrainzReleaseId=excluded.musicBrainzReleaseId,musicBrainzReleaseGroupId=excluded.musicBrainzReleaseGroupId`,
        )
        .run({
          ...track,
          artists: JSON.stringify(track.artists),
          albumArtists: JSON.stringify(track.albumArtists),
          genres: JSON.stringify(track.genres),
          missingTagFields: JSON.stringify(track.missingTagFields || []),
          musicBrainzRecordingId: track.musicBrainzRecordingId || null,
          musicBrainzReleaseId: track.musicBrainzReleaseId || null,
          musicBrainzReleaseGroupId: track.musicBrainzReleaseGroupId || null,
          available: Number(track.available),
          scanId,
        });
      this.db.prepare("DELETE FROM track_genres WHERE trackId=?").run(track.id);
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO track_genres(trackId,genre) VALUES (?,?)",
      );
      for (const genre of track.genres) insert.run(track.id, genre);
      this.db
        .prepare("DELETE FROM track_artists WHERE trackId=?")
        .run(track.id);
      const artistInsert = this.db.prepare(
        "INSERT OR IGNORE INTO track_artists VALUES (?,?)",
      );
      for (const artist of track.artists) artistInsert.run(track.id, artist);
      this.db
        .prepare("DELETE FROM track_album_artists WHERE trackId=?")
        .run(track.id);
      const albumArtistInsert = this.db.prepare(
        "INSERT OR IGNORE INTO track_album_artists VALUES (?,?)",
      );
      const catalogArtists = track.albumArtists.length
        ? track.albumArtists
        : track.artists;
      for (const artist of catalogArtists)
        albumArtistInsert.run(track.id, artist);
    })();
  }
  saveOperation(operation: OperationPreview): void {
    this.db
      .prepare(
        "INSERT INTO operations VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(operation.id, operation.createdAt, JSON.stringify(operation));
  }
  operation(id: string): OperationPreview {
    const row = this.db
      .prepare("SELECT payload FROM operations WHERE id=?")
      .get(id) as Row | undefined;
    if (!row) throw new Error("Операция не найдена");
    return JSON.parse(row.payload);
  }
  history(): OperationPreview[] {
    return (
      this.db
        .prepare(
          "SELECT payload FROM operations ORDER BY createdAt DESC LIMIT 100",
        )
        .all() as Row[]
    ).map((r) => JSON.parse(r.payload));
  }
  saveJob(job: Job): void {
    this.db
      .prepare(
        "INSERT INTO jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(job.id, JSON.stringify(job));
  }
  jobs(): Job[] {
    return (
      this.db
        .prepare("SELECT payload FROM jobs ORDER BY rowid DESC LIMIT 30")
        .all() as Row[]
    ).map((r) => JSON.parse(r.payload));
  }
  close(): void {
    this.db.close();
  }
}
