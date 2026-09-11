import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Album,
  CatalogFilter,
  Job,
  Library,
  OperationPreview,
  Page,
  Selection,
  Track,
} from "../shared/contracts.js";

type Row = Record<string, any>;
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
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queues (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, trackIds TEXT NOT NULL);
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
  addLibrary(name: string, folder: string): Library {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO libraries (id,name,path) VALUES (?,?,?)")
      .run(id, name, folder);
    return this.library(id);
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
  where(filter: CatalogFilter): { sql: string; args: any[] } {
    const clauses = ["t.available=1", "l.available=1"];
    const args: any[] = [];
    const list = (values: string[], column: string) => {
      if (values.length) {
        clauses.push(`${column} IN (${values.map(() => "?").join(",")})`);
        args.push(...values);
      }
    };
    list(filter.libraryIds, "t.libraryId");
    list(filter.albumIds, "t.albumKey");
    if (filter.artists.length) {
      const values = filter.artists.filter((a) => a !== "");
      const parts: string[] = [];
      if (values.length) {
        parts.push(
          `EXISTS (SELECT 1 FROM track_artists a WHERE a.trackId=t.id AND a.artist IN (${values.map(() => "?").join(",")}))`,
        );
        args.push(...values);
      }
      if (filter.artists.includes("")) parts.push("t.artists='[]'");
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
        `SELECT t.* FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql} ORDER BY t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath LIMIT ? OFFSET ?`,
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
    return {
      items: rows.map((r) => ({
        ...fromRow(r),
        albumFormats: formats.get(r.albumKey),
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
          `SELECT t.id FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql} ORDER BY t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath LIMIT 100000`,
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
        `SELECT coalesce(g.genre,'') name, count(*) count FROM tracks t JOIN libraries l ON l.id=t.libraryId LEFT JOIN track_genres g ON g.trackId=t.id WHERE ${sql} GROUP BY coalesce(g.genre,'') ORDER BY name COLLATE NOCASE`,
      )
      .all(...args) as { name: string; count: number }[];
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
        `SELECT t.albumKey id, t.albumTitle title, t.albumArtists artists, t.year, max(t.coverId) coverId, count(*) trackCount FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql} GROUP BY t.albumKey ORDER BY t.albumTitle COLLATE NOCASE, t.albumKey LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as Row[];
    return {
      items: rows.map(
        (r) => ({ ...r, artists: JSON.parse(r.artists) }) as Album,
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
    const group = `FROM tracks t JOIN libraries l ON l.id=t.libraryId LEFT JOIN track_artists a ON a.trackId=t.id WHERE ${sql} GROUP BY coalesce(a.artist,'')`;
    const total = (
      this.db
        .prepare(`SELECT count(*) n FROM (SELECT 1 ${group})`)
        .get(...args) as { n: number }
    ).n;
    const items = this.db
      .prepare(
        `SELECT coalesce(a.artist,'') name,count(*) count ${group} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as { name: string; count: number }[];
    return { items, total, offset };
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
