import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { jobSchema, operationPreviewSchema } from "../shared/contracts.js";
import type {
  Album,
  AlbumPage,
  AlbumMergeContext,
  ArtistPage,
  ArtistFolder,
  BookmarkKind,
  CatalogBookmark,
  CatalogFilter,
  CatalogUserStatePatch,
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
import { emptyFilter } from "../shared/contracts.js";
import {
  albumArtistGroupStats,
  artistGroupStats,
  artistSortKey,
  compareArtistNames,
} from "../shared/artist-grouping.js";
import { HttpError, badRequest, conflict, notFound } from "./http-error.js";
import { runCatalogMigrations } from "./catalog-migrations.js";
import { albumIdentityKey } from "./album-identity.js";
import { normalizedAlbumFolder } from "./album-identity.js";
import {
  pathTemplateSchema,
  playlistSnapshotSchema,
  type PathTemplate,
  type Playlist,
  type PlaylistDetail,
  type PlaylistEntry,
  type PlaylistEntryKind,
  type PlaylistSnapshot,
  type PlaylistSyncSettings,
  type PlaylistTrackPage,
  type ResolvedPlaylistTrack,
} from "../shared/playlists.js";

type Row = Record<string, any>;
const checkedFolderPath = (relativePath: string) => {
  if (
    path.isAbsolute(relativePath) ||
    (relativePath !== "" &&
      (relativePath === "." || path.normalize(relativePath) !== relativePath)) ||
    relativePath.split(path.sep).includes("..")
  )
    throw badRequest("Некорректный путь папки");
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
    rating: r.rating ?? null,
    albumRating: r.albumRating ?? null,
    albumViewed: Boolean(r.albumViewed),
  }) as Track;
const parseStoredJson = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
};
const parsePlaylistFolderTarget = (targetId: string) => {
  const value = parseStoredJson(targetId);
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "string" ||
    typeof value[1] !== "string"
  )
    return undefined;
  return { libraryId: value[0], relativePath: value[1] };
};
const searchKey = (value: string) => value.normalize("NFC").toLowerCase();

type StoredPlaylistEntry = {
  id: string;
  playlistId: string;
  kind: PlaylistEntryKind;
  targetId: string;
  position: number;
  snapshot: string;
};

const playlistArtist = (track: Track) =>
  (track.albumArtists.length ? track.albumArtists : track.artists).join(", ");

const comparePlaylistTracks = (left: Track, right: Track) => {
  const text = (a: string, b: string) =>
    a.localeCompare(b, "ru", { sensitivity: "base", numeric: true });
  return (
    text(playlistArtist(left), playlistArtist(right)) ||
    text(left.albumTitle, right.albumTitle) ||
    (left.discNumber ?? 1) - (right.discNumber ?? 1) ||
    (left.trackNumber == null ? 1 : 0) - (right.trackNumber == null ? 1 : 0) ||
    (left.trackNumber ?? 0) - (right.trackNumber ?? 0) ||
    text(left.title, right.title) ||
    text(left.relativePath, right.relativePath)
  );
};

export class Catalog {
  private readonly db: Database.Database;
  private hasLegacyPlaylistOrderColumn = false;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "catalog.sqlite"));
    this.db.function(
      "artist_sort_key",
      { deterministic: true },
      (artist: string) => artistSortKey(artist),
    );
    this.db.function("search_key", { deterministic: true }, searchKey);
    this.db.function(
      "folder_parent",
      { deterministic: true },
      (relativePath: string) => {
        const parent = path.dirname(relativePath);
        return parent === "." || parent === path.sep ? null : parent;
      },
    );
    this.db.function(
      "album_identity_key",
      { deterministic: true },
      (
        libraryId: string,
        relativePath: string,
        albumTitle: string,
        albumArtists: string,
        year: number | null,
      ) =>
        albumIdentityKey({
          libraryId,
          relativePath,
          albumTitle,
          albumArtists: JSON.parse(albumArtists) as string[],
          year,
        }),
    );
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    runCatalogMigrations(this.db);
    this.hasLegacyPlaylistOrderColumn = (
      this.db.pragma("table_info(playlists)") as { name: string }[]
    ).some((column) => column.name === "orderMode");
    this.materializeLegacyCatalogPlaylists();
    this.clearExpiredHttpCache();
  }
  libraries(filter: CatalogFilter = emptyFilter): Library[] {
    const { sql, args } = this.where(filter);
    const search = searchKey(filter.search.trim());
    const hasManualFilters =
      filter.libraryIds.length > 0 ||
      filter.folders.length > 0 ||
      filter.genres.length > 0 ||
      filter.artists.length > 0 ||
      filter.albumIds.length > 0 ||
      filter.bookmarksOnly ||
      Boolean(filter.recentlyAddedDays);
    const libraryMatch =
      search && !hasManualFilters
        ? "(search_key(l.name) LIKE ? ESCAPE '\\' OR search_key(l.path) LIKE ? ESCAPE '\\')"
        : "0";
    const searchValue = search ? `%${search.replace(/[\\%_]/g, "\\$&")}%` : "";
    return (
      this.db
        .prepare(
          `SELECT l.*,
             (SELECT count(*) FROM tracks t WHERE t.libraryId=l.id AND ${sql}) AS trackCount
           FROM libraries l
           WHERE ${search || hasManualFilters ? `${libraryMatch} OR EXISTS (SELECT 1 FROM tracks t WHERE t.libraryId=l.id AND ${sql})` : "1"}
           ORDER BY name`,
        )
        .all(
          ...args,
          ...(search && !hasManualFilters ? [searchValue, searchValue] : []),
          ...args,
        ) as Row[]
    ).map((r) => ({ ...r, available: Boolean(r.available) }) as Library);
  }
  library(id: string): Library {
    const l = this.libraries().find((l) => l.id === id);
    if (!l) throw notFound("Библиотека не найдена");
    return l;
  }
  folders(
    libraryId: string,
    parent: string | null,
    filter: CatalogFilter = emptyFilter,
  ): LibraryFolder[] {
    this.library(libraryId);
    const parentPath = parent === null ? null : checkedFolderPath(parent);
    const prefix = parentPath ? `${parentPath}${path.sep}` : "";
    const { sql, args } = this.where(filter);
    const rows = this.db
      .prepare(
        `SELECT t.relativePath FROM tracks t JOIN libraries l ON l.id=t.libraryId
         WHERE t.libraryId=? AND ${sql} ORDER BY t.relativePath`,
      )
      .all(libraryId, ...args) as { relativePath: string }[];
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
        ...emptyFilter,
        libraryIds: [],
        folders: [],
        genres: [],
        artists,
        albumIds: [],
        search: "",
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
    if (relativePath === "") {
      this.library(libraryId);
      return true;
    }
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
  setLibraryAvailability(id: string, available: boolean): void {
    this.db
      .prepare("UPDATE libraries SET available=? WHERE id=?")
      .run(Number(available), id);
  }
  scannedTrack(
    libraryId: string,
    relativePath: string,
  ):
    | {
        id: string;
        size: number;
        mtimeMs: number;
        missingTagFields: string | null;
      }
    | undefined {
    return this.db
      .prepare(
        "SELECT id,size,mtimeMs,missingTagFields FROM tracks WHERE libraryId=? AND relativePath=?",
      )
      .get(libraryId, relativePath) as
      | {
          id: string;
          size: number;
          mtimeMs: number;
          missingTagFields: string | null;
        }
      | undefined;
  }
  markTrackScanned(id: string, scanId: string, available?: boolean): void {
    if (available === undefined) {
      this.db.prepare("UPDATE tracks SET scanId=? WHERE id=?").run(scanId, id);
      return;
    }
    this.db
      .prepare("UPDATE tracks SET scanId=?,available=? WHERE id=?")
      .run(scanId, Number(available), id);
  }
  finishScan(libraryId: string, scanId: string, completedAt: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE tracks SET available=0 WHERE libraryId=? AND (scanId IS NULL OR scanId<>?)",
        )
        .run(libraryId, scanId);
      this.db
        .prepare("UPDATE libraries SET lastScan=? WHERE id=?")
        .run(completedAt, libraryId);
    })();
  }
  markLibraryScanned(libraryId: string, completedAt: string): void {
    this.db
      .prepare("UPDATE libraries SET lastScan=? WHERE id=?")
      .run(completedAt, libraryId);
  }
  availableLibraryTracks(
    libraryId: string,
  ): { id: string; relativePath: string }[] {
    return this.db
      .prepare(
        "SELECT id,relativePath FROM tracks WHERE libraryId=? AND available=1",
      )
      .all(libraryId) as { id: string; relativePath: string }[];
  }
  markTrackUnavailable(id: string): void {
    this.db.prepare("UPDATE tracks SET available=0 WHERE id=?").run(id);
  }
  albumAvailableTrackCount(albumKey: string): number {
    return (
      this.db
        .prepare(
          "SELECT count(*) n FROM tracks WHERE albumKey=? AND available=1",
        )
        .get(albumKey) as { n: number }
    ).n;
  }
  saveQueue(id: string, createdAt: string, trackIds: string[]): void {
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO queues VALUES (?,?,?)")
        .run(id, createdAt, JSON.stringify(trackIds));
      this.db
        .prepare(
          "DELETE FROM queues WHERE id NOT IN (SELECT id FROM queues ORDER BY createdAt DESC LIMIT 20)",
        )
        .run();
    })();
  }
  queueTrackIds(id: string): string[] | undefined {
    const row = this.db
      .prepare("SELECT trackIds FROM queues WHERE id=?")
      .get(id) as { trackIds: string } | undefined;
    return row ? JSON.parse(row.trackIds) : undefined;
  }
  cachedHttpResponse(key: string): { status: number; payload: unknown } | null {
    const row = this.db
      .prepare(
        "SELECT status,payload FROM http_cache WHERE key=? AND expiresAt>?",
      )
      .get(key, Date.now()) as { status: number; payload: string } | undefined;
    return row
      ? { status: row.status, payload: JSON.parse(row.payload) }
      : null;
  }
  saveHttpResponse(
    key: string,
    status: number,
    payload: unknown,
    ttl: number,
  ): void {
    this.db
      .prepare(
        "INSERT INTO http_cache(key,status,payload,expiresAt) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET status=excluded.status,payload=excluded.payload,expiresAt=excluded.expiresAt",
      )
      .run(key, status, JSON.stringify(payload), Date.now() + ttl);
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
      this.db.exec(`
        DELETE FROM catalog_user_state
        WHERE (kind='track' AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.id=catalog_user_state.id AND t.available=1))
           OR (kind='album' AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.albumKey=catalog_user_state.id AND t.available=1))
      `);
    })();
    return library;
  }
  track(id: string): Track | undefined {
    const row = this.db
      .prepare(
        `SELECT t.*, trackState.rating rating, albumState.rating albumRating,
                coalesce(albumState.viewed,0) albumViewed
         FROM tracks t
         LEFT JOIN catalog_user_state trackState ON trackState.kind='track' AND trackState.id=t.id
         LEFT JOIN catalog_user_state albumState ON albumState.kind='album' AND albumState.id=t.albumKey
         WHERE t.id=?`,
      )
      .get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }
  firstAlbumTrack(id: string): Track | undefined {
    const row = this.db
      .prepare(
        `SELECT t.*, trackState.rating rating, albumState.rating albumRating,
                coalesce(albumState.viewed,0) albumViewed
         FROM tracks t JOIN libraries l ON l.id=t.libraryId
         LEFT JOIN catalog_user_state trackState ON trackState.kind='track' AND trackState.id=t.id
         LEFT JOIN catalog_user_state albumState ON albumState.kind='album' AND albumState.id=t.albumKey
         WHERE t.albumKey=? AND t.available=1 AND l.available=1
         ORDER BY t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath LIMIT 1`,
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
  setUserState(
    kind: "album" | "track",
    ids: readonly string[],
    patch: CatalogUserStatePatch,
  ): void {
    if (kind === "track" && patch.viewed !== undefined)
      throw conflict("Статус «Просмотрено» доступен только для альбомов");
    const targets = [...new Set(ids)];
    this.db.transaction(() => {
      const exists = this.db.prepare(
        kind === "track"
          ? "SELECT 1 FROM tracks WHERE id=? AND available=1"
          : "SELECT 1 FROM tracks WHERE albumKey=? AND available=1",
      );
      for (const id of targets)
        if (!exists.get(id))
          throw conflict(
            kind === "track"
              ? "Один из треков не найден"
              : "Один из альбомов не найден",
          );
      const read = this.db.prepare(
        "SELECT rating,viewed FROM catalog_user_state WHERE kind=? AND id=?",
      );
      const remove = this.db.prepare(
        "DELETE FROM catalog_user_state WHERE kind=? AND id=?",
      );
      const write = this.db.prepare(`
        INSERT INTO catalog_user_state(kind,id,rating,viewed) VALUES (?,?,?,?)
        ON CONFLICT(kind,id) DO UPDATE SET rating=excluded.rating,viewed=excluded.viewed
      `);
      for (const id of targets) {
        const current = read.get(kind, id) as
          { rating: number | null; viewed: number } | undefined;
        const rating =
          patch.rating !== undefined ? patch.rating : (current?.rating ?? null);
        const viewed =
          patch.viewed !== undefined ? patch.viewed : Boolean(current?.viewed);
        if (rating === null && !viewed) remove.run(kind, id);
        else write.run(kind, id, rating, Number(viewed));
      }
    })();
  }
  where(
    filter: CatalogFilter,
    personal: "none" | "album" | "track" = "none",
  ): { sql: string; args: any[] } {
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
        `(search_key(t.title) LIKE ? ESCAPE '\\'
          OR search_key(t.albumTitle) LIKE ? ESCAPE '\\'
          OR search_key(l.name) LIKE ? ESCAPE '\\'
          OR search_key(l.path) LIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM track_genres g WHERE g.trackId=t.id AND search_key(g.genre) LIKE ? ESCAPE '\\')
          OR EXISTS (SELECT 1 FROM track_artists a WHERE a.trackId=t.id AND search_key(a.artist) LIKE ? ESCAPE '\\')
          OR EXISTS (SELECT 1 FROM track_album_artists a WHERE a.trackId=t.id AND search_key(a.artist) LIKE ? ESCAPE '\\'))`,
      );
      const search = `%${searchKey(filter.search.trim()).replace(/[\\%_]/g, "\\$&")}%`;
      args.push(search, search, search, search, search, search, search);
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
    if (filter.recentlyAddedDays) {
      const cutoff = new Date(
        Date.now() - filter.recentlyAddedDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      if (personal === "album") {
        clauses.push(`EXISTS (
          SELECT 1 FROM tracks recent
          WHERE recent.albumKey=t.albumKey
            AND recent.available=1
            AND recent.firstIndexedAt>=?
        )`);
      } else clauses.push("t.firstIndexedAt>=?");
      args.push(cutoff);
    }
    if (personal === "album") {
      const min = filter.albumRatingMin ?? null;
      const max = filter.albumRatingMax ?? null;
      const rated = min !== null || max !== null;
      const ratingParts: string[] = [];
      if (rated) {
        const bounds: string[] = [];
        if (min !== null && min !== undefined) {
          bounds.push("state.rating>=?");
          args.push(min);
        }
        if (max !== null && max !== undefined) {
          bounds.push("state.rating<=?");
          args.push(max);
        }
        ratingParts.push(
          `EXISTS (SELECT 1 FROM catalog_user_state state WHERE state.kind='album' AND state.id=t.albumKey AND state.rating IS NOT NULL AND ${bounds.join(" AND ")})`,
        );
      }
      if (filter.albumUnrated)
        ratingParts.push(
          `NOT EXISTS (SELECT 1 FROM catalog_user_state state WHERE state.kind='album' AND state.id=t.albumKey AND state.rating IS NOT NULL)`,
        );
      if (ratingParts.length) clauses.push(`(${ratingParts.join(" OR ")})`);
      if (filter.albumViewed === "viewed")
        clauses.push(
          `EXISTS (SELECT 1 FROM catalog_user_state state WHERE state.kind='album' AND state.id=t.albumKey AND state.viewed=1)`,
        );
      else if (filter.albumViewed === "unviewed")
        clauses.push(
          `NOT EXISTS (SELECT 1 FROM catalog_user_state state WHERE state.kind='album' AND state.id=t.albumKey AND state.viewed=1)`,
        );
    } else if (personal === "track") {
      const min = filter.trackRatingMin ?? null;
      const max = filter.trackRatingMax ?? null;
      const rated = min !== null || max !== null;
      const ratingParts: string[] = [];
      if (rated) {
        const bounds: string[] = [];
        if (min !== null && min !== undefined) {
          bounds.push("state.rating>=?");
          args.push(min);
        }
        if (max !== null && max !== undefined) {
          bounds.push("state.rating<=?");
          args.push(max);
        }
        ratingParts.push(
          `EXISTS (SELECT 1 FROM catalog_user_state state WHERE state.kind='track' AND state.id=t.id AND ${bounds.join(" AND ")})`,
        );
      }
      if (filter.trackUnrated)
        ratingParts.push(
          `NOT EXISTS (SELECT 1 FROM catalog_user_state state WHERE state.kind='track' AND state.id=t.id AND state.rating IS NOT NULL)`,
        );
      if (ratingParts.length) clauses.push(`(${ratingParts.join(" OR ")})`);
    }
    return { sql: clauses.join(" AND "), args };
  }
  tracks(filter: CatalogFilter, offset = 0, limit = 200): Page<Track> {
    const { sql, args } = this.where(filter, "track");
    const total = (
      this.db
        .prepare(
          `SELECT count(*) n FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql}`,
        )
        .get(...args) as Row
    ).n;
    const rows = this.db
      .prepare(
        `SELECT t.*, trackState.rating rating, albumState.rating albumRating,
                coalesce(albumState.viewed,0) albumViewed
         FROM tracks t JOIN libraries l ON l.id=t.libraryId
         LEFT JOIN catalog_user_state trackState ON trackState.kind='track' AND trackState.id=t.id
         LEFT JOIN catalog_user_state albumState ON albumState.kind='album' AND albumState.id=t.albumKey
         WHERE ${sql} ORDER BY ${this.albumArtistOrder("t")}, t.year IS NOT NULL, t.year DESC, t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as Row[];
    const albumIds = [...new Set(rows.map((row) => row.albumKey))];
    const formats = new Map<string, string[]>();
    if (albumIds.length) {
      const placeholders = albumIds.map(() => "?").join(",");
      const formatRows = this.db
        .prepare(
          `SELECT DISTINCT albumKey id, format FROM tracks
           WHERE available=1 AND albumKey IN (${placeholders})
           ORDER BY format`,
        )
        .all(...albumIds) as { id: string; format: string }[];
      for (const { id, format } of formatRows)
        formats.set(id, [...(formats.get(id) || []), format]);
    }
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
          throw conflict("Трек больше недоступен. Обновите выбор.");
        return t;
      });
    const excluded = new Set(selection.excludeTrackIds || []);
    return this.tracks(selection.filter, 0, 100000).items.filter(
      (t) => !excluded.has(t.id),
    );
  }
  trackIdResult(filter: CatalogFilter): {
    trackIds: string[];
    total: number;
    truncated: boolean;
  } {
    const { sql, args } = this.where(filter, "track");
    const total = (
      this.db
        .prepare(
          `SELECT count(*) n FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql}`,
        )
        .get(...args) as Row
    ).n;
    const trackIds = (
      this.db
        .prepare(
          `SELECT t.id FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${sql} ORDER BY ${this.albumArtistOrder("t")}, t.year IS NOT NULL, t.year DESC, t.albumTitle COLLATE NOCASE, t.albumKey, coalesce(t.discNumber,0), coalesce(t.trackNumber,0), t.relativePath LIMIT 100000`,
        )
        .all(...args) as { id: string }[]
    ).map((r) => r.id);
    return { trackIds, total, truncated: total > trackIds.length };
  }
  trackIds(filter: CatalogFilter): string[] {
    return this.trackIdResult(filter).trackIds;
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
    const genreNames = new Set(
      this.genres({ ...filter, genres: [], artists: [], albumIds: [] }).map(
        (genre) => genre.name,
      ),
    );
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
    const relation = ({
      genres,
      artists,
      albumIds,
    }: Pick<CatalogFilter, "genres" | "artists" | "albumIds">) => {
      const args: string[] = [];
      const relations: string[] = [];
      const namedArtists = artists.filter((artist) => artist !== "");
      if (namedArtists.length) {
        relations.push(
          `t.id IN (SELECT trackId FROM track_album_artists WHERE artist IN (${namedArtists.map(() => "?").join(",")}))`,
        );
        args.push(...namedArtists);
      }
      if (artists.includes(""))
        relations.push("t.albumArtists='[]' AND t.artists='[]'");
      if (albumIds.length) {
        relations.push(`t.albumKey IN (${albumIds.map(() => "?").join(",")})`);
        args.push(...albumIds);
      }
      if (genres.length) {
        const namedGenres = genres.filter((genre) => genre !== "");
        const parts: string[] = [];
        if (namedGenres.length) {
          parts.push(
            `t.id IN (SELECT trackId FROM track_genres WHERE genre IN (${namedGenres.map(() => "?").join(",")}))`,
          );
          args.push(...namedGenres);
        }
        if (genres.includes("")) parts.push("t.genres='[]'");
        relations.push(`(${parts.join(" OR ")})`);
      }
      return relations.length
        ? {
            sql: `t.available=1 AND l.available=1 AND (${relations.join(" OR ")})`,
            args,
          }
        : null;
    };
    const libraryRelation = relation(filter);
    const genreRelation = relation({
      genres: [],
      artists: filter.artists,
      albumIds: filter.albumIds,
    });
    const artistRelation = relation({
      genres: [],
      artists: [],
      albumIds: filter.albumIds,
    });
    return {
      libraryIds: libraryRelation
        ? (
            this.db
              .prepare(
                `SELECT DISTINCT t.libraryId id FROM tracks t JOIN libraries l ON l.id=t.libraryId WHERE ${libraryRelation.sql} ORDER BY id`,
              )
              .all(...libraryRelation.args) as { id: string }[]
          ).map((row) => row.id)
        : [],
      genres: genreRelation
        ? (
            this.db
              .prepare(
                `SELECT DISTINCT coalesce(g.genre,'') name FROM tracks t JOIN libraries l ON l.id=t.libraryId LEFT JOIN track_genres g ON g.trackId=t.id WHERE ${genreRelation.sql} ORDER BY name COLLATE NOCASE`,
              )
              .all(...genreRelation.args) as { name: string }[]
          ).map((row) => row.name)
        : [],
      artists: artistRelation
        ? (
            this.db
              .prepare(
                `SELECT DISTINCT a.artist name FROM tracks t JOIN libraries l ON l.id=t.libraryId JOIN track_album_artists a ON a.trackId=t.id WHERE ${artistRelation.sql} ORDER BY name COLLATE NOCASE`,
              )
              .all(...artistRelation.args) as { name: string }[]
          ).map((row) => row.name)
        : [],
      folders: libraryRelation
        ? (this.db
            .prepare(
              `WITH RECURSIVE folders(libraryId, relativePath) AS (
             SELECT t.libraryId, folder_parent(t.relativePath)
             FROM tracks t JOIN libraries l ON l.id=t.libraryId
             WHERE ${libraryRelation.sql}
             UNION
             SELECT libraryId, folder_parent(relativePath)
             FROM folders
             WHERE relativePath IS NOT NULL
           )
           SELECT libraryId, relativePath
           FROM folders
           WHERE relativePath IS NOT NULL
           ORDER BY libraryId, relativePath`,
            )
            .all(...libraryRelation.args) as {
            libraryId: string;
            relativePath: string;
          }[])
        : [],
    };
  }
  genres(filter: CatalogFilter): { name: string; count: number }[] {
    const { sql, args } = this.where(filter);
    return this.db
      .prepare(
        `SELECT coalesce(g.genre,'') name, count(DISTINCT a.artist) count FROM tracks t JOIN libraries l ON l.id=t.libraryId LEFT JOIN track_genres g ON g.trackId=t.id LEFT JOIN track_album_artists a ON a.trackId=t.id WHERE ${sql} GROUP BY coalesce(g.genre,'') ORDER BY name COLLATE NOCASE`,
      )
      .all(...args) as { name: string; count: number }[];
  }
  private fallbackAlbumArtists(ids: string[]): Map<string, string[]> {
    const artists = new Map<string, string[]>();
    if (!ids.length) return artists;
    for (let offset = 0; offset < ids.length; offset += 900) {
      const batch = ids.slice(offset, offset + 900);
      const placeholders = batch.map(() => "?").join(",");
      const values = this.db
        .prepare(
          `SELECT DISTINCT t.albumKey id, a.artist
           FROM track_album_artists a JOIN tracks t ON t.id=a.trackId
           WHERE t.available=1 AND t.albumKey IN (${placeholders})
           ORDER BY t.albumKey, artist_sort_key(a.artist), a.artist`,
        )
        .all(...batch) as { id: string; artist: string }[];
      for (const { id, artist } of values)
        artists.set(id, [...(artists.get(id) || []), artist]);
    }
    return artists;
  }
  private albumArtistOrder(trackAlias: string): string {
    return `coalesce((
      SELECT group_concat(sortKey, char(31))
      FROM (
        SELECT DISTINCT artist_sort_key(a.artist) sortKey, a.artist
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
  albums(filter: CatalogFilter, offset = 0, limit = 120): AlbumPage {
    const { sql, args } = this.where(filter, "album");
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
         SELECT ranked.id, title, artists, year, coverId, trackCount,
                state.rating rating, coalesce(state.viewed,0) viewed
         FROM ranked
         LEFT JOIN catalog_user_state state ON state.kind='album' AND state.id=ranked.id
         WHERE ranked.albumRank=1
         ORDER BY artistGroupKey, year IS NOT NULL, year DESC,
                  title COLLATE NOCASE, ranked.id
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
    const groupRows = this.db
      .prepare(
        `WITH ranked AS (
           SELECT t.albumKey id, t.albumArtists artists,
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
         SELECT id, artists FROM ranked WHERE albumRank=1`,
      )
      .all(...args) as { id: string; artists: string }[];
    const groupFallbackArtists = this.fallbackAlbumArtists(
      groupRows
        .filter((album) => !(JSON.parse(album.artists) as string[]).length)
        .map((album) => album.id),
    );
    const { averageSize: averageGroupSize } = albumArtistGroupStats(
      groupRows.map((album) => {
        const artists = JSON.parse(album.artists) as string[];
        return artists.length
          ? artists
          : groupFallbackArtists.get(album.id) || [];
      }),
    );
    return {
      items: items.map(
        (album) =>
          ({
            ...album,
            artists: album.artists.length
              ? album.artists
              : fallbackArtists.get(album.id) || [],
            rating: album.rating ?? null,
            viewed: Boolean(album.viewed),
          }) as Album,
      ),
      total,
      offset,
      averageGroupSize,
    };
  }
  albumMergeContext(albumIds: string[]): AlbumMergeContext {
    const ids = [...new Set(albumIds)];
    if (ids.length < 2)
      throw conflict("Выберите как минимум два разных альбома");
    const tracks = this.selected({
      filter: { ...emptyFilter, albumIds: ids },
    });
    const byAlbum = new Map<string, Track[]>();
    for (const track of tracks) {
      const group = byAlbum.get(track.albumKey) || [];
      group.push(track);
      byAlbum.set(track.albumKey, group);
    }
    if (ids.some((id) => !byAlbum.has(id)))
      throw conflict(
        "Один из выбранных альбомов больше недоступен. Обновите выбор.",
      );

    const locations = new Map<
      string,
      { libraryId: string; relativeFolder: string }
    >();
    for (const track of tracks) {
      const relativeFolder = normalizedAlbumFolder(track.relativePath);
      locations.set(`${track.libraryId}\u0000${relativeFolder}`, {
        libraryId: track.libraryId,
        relativeFolder,
      });
    }
    const location = locations.size === 1 ? [...locations.values()][0] : null;
    const blockers = location
      ? []
      : [
          "Выбранные альбомы находятся в разных библиотеках или папках. Перемещение файлов в объединение не входит.",
        ];
    return {
      compatible: blockers.length === 0,
      blockers,
      library: location
        ? {
            id: location.libraryId,
            name: this.library(location.libraryId).name,
          }
        : null,
      relativeFolder: location?.relativeFolder ?? null,
      trackCount: tracks.length,
      sources: ids.map((albumId) => {
        const albumTracks = byAlbum.get(albumId)!;
        const first = albumTracks[0];
        return {
          albumId,
          title: first.albumTitle,
          albumArtists: first.albumArtists,
          year: first.year,
          coverId:
            albumTracks
              .map((track) => track.coverId)
              .filter((coverId): coverId is string => !!coverId)
              .sort()
              .at(-1) ?? null,
          trackCount: albumTracks.length,
          formats: [
            ...new Set(albumTracks.map((track) => track.format)),
          ].sort(),
          musicBrainzReleaseIds: [
            ...new Set(
              albumTracks
                .map((track) => track.musicBrainzReleaseId)
                .filter((id): id is string => !!id),
            ),
          ].sort(),
        };
      }),
    };
  }
  artists(filter: CatalogFilter, offset = 0, limit = 200): ArtistPage {
    const { sql, args } = this.where(filter);
    const group = `FROM tracks t JOIN libraries l ON l.id=t.libraryId LEFT JOIN track_album_artists a ON a.trackId=t.id WHERE ${sql} GROUP BY coalesce(a.artist,'')`;
    const allItems = this.db
      .prepare(
        `SELECT coalesce(a.artist,'') name,count(DISTINCT t.albumKey) count ${group}`,
      )
      .all(...args) as { name: string; count: number }[];
    allItems.sort((a, b) => compareArtistNames(a.name, b.name));
    const { averageSize: averageGroupSize } = artistGroupStats(
      allItems.map((item) => item.name),
    );
    return {
      items: allItems.slice(offset, offset + limit),
      total: allItems.length,
      offset,
      averageGroupSize,
    };
  }
  quickSearch(query: string, limit = 6): QuickSearchResults {
    const value = searchKey(query.trim());
    if (!value) return { genres: [], artists: [], albums: [], tracks: [] };
    const escaped = value.replace(/[\\%_]/g, "\\$&");
    const prefix = `${escaped}%`;
    const contains = `%${escaped}%`;
    const available = "t.available=1 AND l.available=1";
    const genres = this.db
      .prepare(
        `SELECT g.genre name, count(DISTINCT t.id) count
         FROM track_genres g JOIN tracks t ON t.id=g.trackId JOIN libraries l ON l.id=t.libraryId
         WHERE ${available} AND search_key(g.genre) LIKE ? ESCAPE '\\'
         GROUP BY g.genre
         ORDER BY CASE WHEN search_key(g.genre)=? THEN 0 WHEN search_key(g.genre) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                  g.genre COLLATE NOCASE
         LIMIT ?`,
      )
      .all(contains, value, prefix, limit) as { name: string; count: number }[];
    const artists = this.db
      .prepare(
        `SELECT a.artist name, count(DISTINCT t.albumKey) count
         FROM track_album_artists a JOIN tracks t ON t.id=a.trackId JOIN libraries l ON l.id=t.libraryId
         WHERE ${available} AND search_key(a.artist) LIKE ? ESCAPE '\\'
         GROUP BY a.artist
         ORDER BY CASE WHEN search_key(a.artist)=? THEN 0 WHEN search_key(a.artist) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                  a.artist COLLATE NOCASE
         LIMIT ?`,
      )
      .all(contains, value, prefix, limit) as { name: string; count: number }[];
    const albumRows = this.db
      .prepare(
        `SELECT t.albumKey id, t.albumTitle title, t.albumArtists artists, t.year,
                max(t.coverId) coverId, count(*) trackCount,
                state.rating rating, coalesce(state.viewed,0) viewed
         FROM tracks t JOIN libraries l ON l.id=t.libraryId
         LEFT JOIN catalog_user_state state ON state.kind='album' AND state.id=t.albumKey
         WHERE ${available} AND search_key(t.albumTitle) LIKE ? ESCAPE '\\'
         GROUP BY t.albumKey
         ORDER BY CASE WHEN search_key(t.albumTitle)=? THEN 0 WHEN search_key(t.albumTitle) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                  t.albumTitle COLLATE NOCASE, t.albumKey
         LIMIT ?`,
      )
      .all(contains, value, prefix, limit) as Row[];
    const trackRows = this.db
      .prepare(
        `SELECT t.*, trackState.rating rating, albumState.rating albumRating,
                coalesce(albumState.viewed,0) albumViewed
         FROM tracks t JOIN libraries l ON l.id=t.libraryId
         LEFT JOIN catalog_user_state trackState ON trackState.kind='track' AND trackState.id=t.id
         LEFT JOIN catalog_user_state albumState ON albumState.kind='album' AND albumState.id=t.albumKey
         WHERE ${available} AND (
           search_key(t.title) LIKE ? ESCAPE '\\' OR search_key(t.albumTitle) LIKE ? ESCAPE '\\' OR search_key(t.artists) LIKE ? ESCAPE '\\'
         )
         ORDER BY CASE
           WHEN search_key(t.title)=? THEN 0
           WHEN search_key(t.title) LIKE ? ESCAPE '\\' THEN 1
           WHEN search_key(t.albumTitle) LIKE ? ESCAPE '\\' THEN 2
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
            rating: album.rating ?? null,
            viewed: Boolean(album.viewed),
          }) as Album,
      ),
      tracks: trackRows.map(fromRow),
    };
  }
  upsert(track: Track, scanId: string | null = null): void {
    this.db.transaction(() => {
      const previous = this.db
        .prepare("SELECT albumKey,firstIndexedAt FROM tracks WHERE id=?")
        .get(track.id) as
        { albumKey: string; firstIndexedAt: string | null } | undefined;
      if (previous && previous.albumKey !== track.albumKey) {
        this.db
          .prepare(
            `
            INSERT OR IGNORE INTO catalog_user_state(kind,id,rating,viewed)
            SELECT 'album',?,rating,viewed FROM catalog_user_state
            WHERE kind='album' AND id=?
          `,
          )
          .run(track.albumKey, previous.albumKey);
        this.db
          .prepare(
            "UPDATE playlist_entries SET targetId=? WHERE kind='album' AND targetId=?",
          )
          .run(track.albumKey, previous.albumKey);
      }
      this.db
        .prepare(
          `INSERT INTO tracks (id,libraryId,relativePath,title,artists,albumTitle,albumArtists,albumKey,genres,year,trackNumber,discNumber,duration,format,size,mtimeMs,coverId,available,scanId,firstIndexedAt,missingTagFields,musicBrainzRecordingId,musicBrainzReleaseId,musicBrainzReleaseGroupId)
        VALUES (@id,@libraryId,@relativePath,@title,@artists,@albumTitle,@albumArtists,@albumKey,@genres,@year,@trackNumber,@discNumber,@duration,@format,@size,@mtimeMs,@coverId,@available,@scanId,@firstIndexedAt,@missingTagFields,@musicBrainzRecordingId,@musicBrainzReleaseId,@musicBrainzReleaseGroupId)
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
          firstIndexedAt: previous
            ? previous.firstIndexedAt
            : new Date().toISOString(),
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
    const parsed = operationPreviewSchema.safeParse(
      parseStoredJson(row.payload),
    );
    if (!parsed.success)
      throw new Error(
        "Сохранённая операция повреждена и не может быть выполнена",
      );
    return parsed.data;
  }
  history(): OperationPreview[] {
    return (
      this.db
        .prepare(
          "SELECT payload FROM operations ORDER BY createdAt DESC LIMIT 100",
        )
        .all() as Row[]
    )
      .map((r) => operationPreviewSchema.safeParse(parseStoredJson(r.payload)))
      .filter((result) => result.success)
      .map((result) => result.data);
  }
  clearHistory(): { operations: number; jobs: number; cache: number } {
    const removable = this.history().filter(
      (operation) =>
        operation.status === "done" &&
        (["move", "restore"].includes(operation.kind) ||
          (operation.kind === "trash" && operation.recoverable === false)) &&
        !operation.items.some((item) => item.error),
    );
    if (!removable.length)
      return { operations: 0, jobs: 0, cache: this.clearExpiredHttpCache() };
    const ids = removable.map((operation) => operation.id);
    const placeholders = ids.map(() => "?").join(",");
    const jobs = this.db.prepare("SELECT payload FROM jobs").all() as Row[];
    const removableJobs = jobs
      .map((row) => jobSchema.safeParse(parseStoredJson(row.payload)))
      .filter((result) => result.success)
      .map((result) => result.data)
      .filter(
        (job) =>
          job.operationId &&
          ids.includes(job.operationId) &&
          (job.status === "done" || job.status === "error"),
      )
      .map((job) => job.id);
    this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM operations WHERE id IN (${placeholders})`)
        .run(...ids);
      if (removableJobs.length) {
        const jobPlaceholders = removableJobs.map(() => "?").join(",");
        this.db
          .prepare(`DELETE FROM jobs WHERE id IN (${jobPlaceholders})`)
          .run(...removableJobs);
      }
    })();
    return {
      operations: ids.length,
      jobs: removableJobs.length,
      cache: this.clearExpiredHttpCache(),
    };
  }
  clearExpiredHttpCache(now = Date.now()): number {
    return this.db.prepare("DELETE FROM http_cache WHERE expiresAt<=?").run(now)
      .changes;
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
    )
      .map((r) => jobSchema.safeParse(parseStoredJson(r.payload)))
      .filter((result) => result.success)
      .map((result) => result.data);
  }
  private storedPlaylist(id: string): Row {
    const row = this.db
      .prepare("SELECT * FROM playlists WHERE id=?")
      .get(id) as Row | undefined;
    if (!row) throw notFound("Плейлист не найден");
    return row;
  }
  private playlistEntryRows(playlistId: string): StoredPlaylistEntry[] {
    return this.db
      .prepare(
        "SELECT * FROM playlist_entries WHERE playlistId=? ORDER BY position,id",
      )
      .all(playlistId) as StoredPlaylistEntry[];
  }
  private tracksForPlaylistEntry(entry: StoredPlaylistEntry): Track[] {
    const dynamic = entry.kind !== "track";
    let condition = "t.id=?";
    let args: any[] = [entry.targetId];
    if (entry.kind === "album") condition = "t.albumKey=?";
    else if (entry.kind === "artist")
      condition = `EXISTS (
        SELECT 1 FROM track_album_artists a
        WHERE a.trackId=t.id AND a.artist=?
      )`;
    else if (entry.kind === "genre")
      condition = `EXISTS (
        SELECT 1 FROM track_genres g
        WHERE g.trackId=t.id AND g.genre=?
      )`;
    else if (entry.kind === "folder") {
      const folder = parsePlaylistFolderTarget(entry.targetId);
      if (!folder) return [];
      const relativePath = checkedFolderPath(folder.relativePath);
      if (!relativePath) {
        condition = "t.libraryId=?";
        args = [folder.libraryId];
      } else {
        const prefix = `${relativePath}${path.sep}`;
        condition = "t.libraryId=? AND substr(t.relativePath,1,?)=?";
        args = [folder.libraryId, prefix.length, prefix];
      }
    }
    const rows = this.db
      .prepare(
        `SELECT t.*, trackState.rating rating, albumState.rating albumRating,
                CASE WHEN t.available=1 AND l.available=1 THEN 1 ELSE 0 END available,
                coalesce(albumState.viewed,0) albumViewed
          FROM tracks t
          JOIN libraries l ON l.id=t.libraryId
          LEFT JOIN catalog_user_state trackState ON trackState.kind='track' AND trackState.id=t.id
          LEFT JOIN catalog_user_state albumState ON albumState.kind='album' AND albumState.id=t.albumKey
          WHERE ${condition}${dynamic ? " AND t.available=1 AND l.available=1" : ""}`,
      )
      .all(...args) as Row[];
    return rows.map(fromRow).sort(comparePlaylistTracks);
  }
  private resolvePlaylistRows(
    playlistId: string,
    catalogOrder = false,
  ): {
    tracks: ResolvedPlaylistTrack[];
    entries: PlaylistEntry[];
    unavailableCount: number;
  } {
    const playlist = this.storedPlaylist(playlistId);
    const tracks: ResolvedPlaylistTrack[] = [];
    const entries: PlaylistEntry[] = [];
    let unavailableCount = 0;
    for (const entry of this.playlistEntryRows(playlistId)) {
      const raw = this.tracksForPlaylistEntry(entry);
      let entryUnavailable = 0;
      for (const track of raw) {
        if (!track.available) {
          entryUnavailable++;
          unavailableCount++;
        }
        tracks.push({ position: tracks.length, entryId: entry.id, track });
      }
      if (entry.kind === "track" && !raw.length) {
        entryUnavailable = 1;
        unavailableCount++;
      }
      const storedSnapshot = playlistSnapshotSchema.parse(
        parseStoredJson(entry.snapshot),
      );
      let snapshot = storedSnapshot;
      try {
        snapshot = this.snapshotForPlaylistEntry(entry.kind, entry.targetId);
      } catch (error) {
        if (!(error instanceof HttpError) || error.statusCode !== 404)
          throw error;
      }
      entries.push({
        ...entry,
        snapshot,
        resolvedCount: raw.length,
        unavailableCount: entryUnavailable,
      });
    }
    if (catalogOrder)
      tracks.sort((left, right) =>
        comparePlaylistTracks(left.track, right.track),
      );
    tracks.forEach((item, position) => (item.position = position));
    return { tracks, entries, unavailableCount };
  }
  private materializeLegacyCatalogPlaylists(): void {
    const columns = new Set(
      (this.db.pragma("table_info(playlists)") as { name: string }[]).map(
        (column) => column.name,
      ),
    );
    if (!columns.has("orderMode")) return;
    const ids = (
      this.db
        .prepare("SELECT id FROM playlists WHERE orderMode='catalog'")
        .all() as Row[]
    ).map((row) => row.id as string);
    for (const id of ids) {
      const tracks = this.resolvePlaylistRows(id, true).tracks;
      this.db.transaction(() => {
        this.db
          .prepare("DELETE FROM playlist_entries WHERE playlistId=?")
          .run(id);
        const insert = this.db.prepare(
          "INSERT INTO playlist_entries VALUES (?,?,?,?,?,?)",
        );
        tracks.forEach((item, position) =>
          insert.run(
            randomUUID(),
            id,
            "track",
            item.track.id,
            position,
            JSON.stringify(
              this.snapshotForPlaylistEntry("track", item.track.id),
            ),
          ),
        );
        this.db
          .prepare(
            "UPDATE playlists SET orderMode='manual',updatedAt=? WHERE id=?",
          )
          .run(new Date().toISOString(), id);
      })();
    }
  }
  private playlistFromRow(row: Row): Playlist {
    const resolved = this.resolvePlaylistRows(row.id);
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      entryCount: resolved.entries.length,
      trackCount: resolved.tracks.length,
      unavailableCount: resolved.unavailableCount,
    };
  }
  playlists(): Playlist[] {
    return (
      this.db
        .prepare("SELECT * FROM playlists ORDER BY name COLLATE NOCASE,id")
        .all() as Row[]
    ).map((row) => this.playlistFromRow(row));
  }
  playlist(id: string): PlaylistDetail {
    const row = this.storedPlaylist(id);
    const resolved = this.resolvePlaylistRows(id);
    return { playlist: this.playlistFromRow(row), entries: resolved.entries };
  }
  createPlaylist(name: string): PlaylistDetail {
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      this.db.transaction(() => {
        const statement = this.hasLegacyPlaylistOrderColumn
          ? "INSERT INTO playlists(id,name,orderMode,createdAt,updatedAt) VALUES (?,?,?,?,?)"
          : "INSERT INTO playlists(id,name,createdAt,updatedAt) VALUES (?,?,?,?)";
        this.db
          .prepare(statement)
          .run(
            ...(this.hasLegacyPlaylistOrderColumn
              ? [id, name, "manual", now, now]
              : [id, name, now, now]),
          );
        this.db
          .prepare(
            `INSERT INTO playlist_sync_settings
             (playlistId,targetPath,templateId,autoSync,state,lastSyncedAt,message)
             VALUES (?,NULL,'default-album-artist',0,'idle',NULL,'')`,
          )
          .run(id);
      })();
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw conflict("Плейлист с таким названием уже существует");
      throw error;
    }
    return this.playlist(id);
  }
  updatePlaylist(id: string, patch: { name?: string }): PlaylistDetail {
    const current = this.storedPlaylist(id);
    const name = patch.name ?? current.name;
    try {
      this.db
        .prepare("UPDATE playlists SET name=?,updatedAt=? WHERE id=?")
        .run(name, new Date().toISOString(), id);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw conflict("Плейлист с таким названием уже существует");
      throw error;
    }
    return this.playlist(id);
  }
  deletePlaylist(id: string): void {
    this.storedPlaylist(id);
    this.db.prepare("DELETE FROM playlists WHERE id=?").run(id);
  }
  private firstPlaylistAlbumCover(filter: CatalogFilter): string | null {
    return this.albums(filter, 0, 1).items[0]?.coverId ?? null;
  }
  private playlistGenres(filter: CatalogFilter): string[] {
    const { sql, args } = this.where(filter);
    return (
      this.db
        .prepare(
          `SELECT DISTINCT g.genre
           FROM track_genres g
           JOIN tracks t ON t.id=g.trackId
           JOIN libraries l ON l.id=t.libraryId
           WHERE ${sql} AND g.genre<>''
           ORDER BY g.genre COLLATE NOCASE`,
        )
        .all(...args) as { genre: string }[]
    ).map((row) => row.genre);
  }
  private playlistFolderPaths(filter: CatalogFilter): string[] {
    const { sql, args } = this.where(filter);
    const libraryPaths = new Map(
      this.libraries().map((library) => [library.id, library.path]),
    );
    const folders = new Set(
      (
        this.db
          .prepare(
            `SELECT DISTINCT t.libraryId, t.relativePath
             FROM tracks t JOIN libraries l ON l.id=t.libraryId
             WHERE ${sql}`,
          )
          .all(...args) as { libraryId: string; relativePath: string }[]
      ).map((track) => {
        const libraryPath = libraryPaths.get(track.libraryId);
        return path.join(libraryPath || "", path.dirname(track.relativePath));
      }),
    );
    return [...folders].sort((left, right) =>
      left.localeCompare(right, "ru", { sensitivity: "base", numeric: true }),
    );
  }
  private snapshotForPlaylistEntry(
    kind: PlaylistEntryKind,
    targetId: string,
  ): PlaylistSnapshot {
    if (kind === "folder") {
      const folder = parsePlaylistFolderTarget(targetId);
      if (!folder) throw notFound("Папка не найдена");
      const relativePath = checkedFolderPath(folder.relativePath);
      if (!this.hasFolder(folder.libraryId, relativePath))
        throw notFound("Папка не найдена");
      const library = this.library(folder.libraryId);
      const filter = {
        ...emptyFilter,
        folders: [{ libraryId: folder.libraryId, relativePath }],
      };
      return {
        title: relativePath ? path.basename(relativePath) : library.name,
        subtitle: path.join(library.path, relativePath),
        coverId: this.firstPlaylistAlbumCover(filter),
      };
    }
    if (kind === "genre") {
      const filter = { ...emptyFilter, genres: [targetId] };
      return {
        title: targetId || "Без жанра",
        subtitle:
          this.playlistFolderPaths(filter).join(" · ") || "Нет доступных папок",
        coverId: this.firstPlaylistAlbumCover(filter),
      };
    }
    if (kind === "artist") {
      const filter = { ...emptyFilter, artists: [targetId] };
      return {
        title: targetId || "Неизвестный исполнитель",
        subtitle: this.playlistGenres(filter).join(" · ") || "Без жанра",
        coverId: this.firstPlaylistAlbumCover(filter),
      };
    }
    const track =
      kind === "track"
        ? this.track(targetId)
        : this.firstAnyAlbumTrack(targetId);
    if (!track)
      throw notFound(kind === "track" ? "Трек не найден" : "Альбом не найден");
    return kind === "track"
      ? {
          title: track.title || "Без названия",
          subtitle: playlistArtist(track),
          coverId: track.coverId,
        }
      : {
          title: track.albumTitle || "Без альбома",
          subtitle: playlistArtist(track),
          coverId: track.coverId,
        };
  }
  private firstAnyAlbumTrack(albumId: string): Track | undefined {
    const row = this.db
      .prepare(
        `SELECT t.*, trackState.rating rating, albumState.rating albumRating,
                coalesce(albumState.viewed,0) albumViewed
         FROM tracks t
         LEFT JOIN catalog_user_state trackState ON trackState.kind='track' AND trackState.id=t.id
         LEFT JOIN catalog_user_state albumState ON albumState.kind='album' AND albumState.id=t.albumKey
         WHERE t.albumKey=? ORDER BY coalesce(t.discNumber,0),coalesce(t.trackNumber,0),t.relativePath LIMIT 1`,
      )
      .get(albumId) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }
  playlistFolderTargetId(libraryId: string, relativePath: string): string {
    const checkedPath = checkedFolderPath(relativePath);
    if (!this.hasFolder(libraryId, checkedPath))
      throw notFound("Папка не найдена");
    return JSON.stringify([libraryId, checkedPath]);
  }
  addPlaylistEntries(
    playlistId: string,
    kind: PlaylistEntryKind,
    targetIds: string[],
    beforeEntryId?: string,
  ): PlaylistDetail {
    this.storedPlaylist(playlistId);
    const snapshots = targetIds.map((id) => ({
      id,
      snapshot: this.snapshotForPlaylistEntry(kind, id),
    }));
    const rows = this.playlistEntryRows(playlistId);
    const start = beforeEntryId
      ? rows.findIndex((entry) => entry.id === beforeEntryId)
      : rows.length;
    if (start < 0)
      throw conflict("Состав плейлиста изменился. Обновите список.");
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE playlist_entries SET position=position+? WHERE playlistId=? AND position>=?",
        )
        .run(snapshots.length, playlistId, start);
      const insert = this.db.prepare(
        "INSERT INTO playlist_entries VALUES (?,?,?,?,?,?)",
      );
      snapshots.forEach((item, index) =>
        insert.run(
          randomUUID(),
          playlistId,
          kind,
          item.id,
          start + index,
          JSON.stringify(item.snapshot),
        ),
      );
      this.db
        .prepare("UPDATE playlists SET updatedAt=? WHERE id=?")
        .run(new Date().toISOString(), playlistId);
    })();
    return this.playlist(playlistId);
  }
  removePlaylistEntry(playlistId: string, entryId: string): PlaylistDetail {
    this.storedPlaylist(playlistId);
    const result = this.db
      .prepare("DELETE FROM playlist_entries WHERE playlistId=? AND id=?")
      .run(playlistId, entryId);
    if (!result.changes) throw notFound("Элемент плейлиста не найден");
    this.normalizePlaylistPositions(playlistId);
    return this.playlist(playlistId);
  }
  reorderPlaylistEntries(
    playlistId: string,
    entryIds: string[],
  ): PlaylistDetail {
    const current = this.playlistEntryRows(playlistId).map((entry) => entry.id);
    if (
      current.length !== entryIds.length ||
      new Set(entryIds).size !== entryIds.length ||
      current.some((id) => !entryIds.includes(id))
    )
      throw conflict("Состав плейлиста изменился. Обновите список.");
    this.db.transaction(() => {
      const update = this.db.prepare(
        "UPDATE playlist_entries SET position=? WHERE playlistId=? AND id=?",
      );
      entryIds.forEach((id, position) => update.run(position, playlistId, id));
      this.db
        .prepare("UPDATE playlists SET updatedAt=? WHERE id=?")
        .run(new Date().toISOString(), playlistId);
    })();
    return this.playlist(playlistId);
  }
  private normalizePlaylistPositions(playlistId: string): void {
    const ids = this.playlistEntryRows(playlistId).map((entry) => entry.id);
    this.db.transaction(() => {
      const update = this.db.prepare(
        "UPDATE playlist_entries SET position=? WHERE id=?",
      );
      ids.forEach((id, index) => update.run(index, id));
      this.db
        .prepare("UPDATE playlists SET updatedAt=? WHERE id=?")
        .run(new Date().toISOString(), playlistId);
    })();
  }
  playlistTracks(
    playlistId: string,
    offset = 0,
    limit = 200,
  ): PlaylistTrackPage {
    const resolved = this.resolvePlaylistRows(playlistId);
    return {
      items: resolved.tracks.slice(offset, offset + limit),
      total: resolved.tracks.length,
      offset,
      unavailableCount: resolved.unavailableCount,
      totalDuration: resolved.tracks.reduce(
        (sum, item) => sum + item.track.duration,
        0,
      ),
    };
  }
  playlistTrackIds(playlistId: string): string[] {
    return this.resolvePlaylistRows(playlistId)
      .tracks.filter((item) => item.track.available)
      .map((item) => item.track.id);
  }
  knownTracks(): Track[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, trackState.rating rating, albumState.rating albumRating,
                coalesce(albumState.viewed,0) albumViewed
         FROM tracks t
         LEFT JOIN catalog_user_state trackState ON trackState.kind='track' AND trackState.id=t.id
         LEFT JOIN catalog_user_state albumState ON albumState.kind='album' AND albumState.id=t.albumKey`,
      )
      .all() as Row[];
    return rows.map(fromRow);
  }
  pathTemplates(): PathTemplate[] {
    return (
      this.db
        .prepare("SELECT * FROM path_templates ORDER BY name COLLATE NOCASE,id")
        .all() as Row[]
    ).map((row) =>
      pathTemplateSchema.parse({
        id: row.id,
        name: row.name,
        ...(parseStoredJson(row.payload) as object),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    );
  }
  pathTemplate(id: string): PathTemplate {
    const template = this.pathTemplates().find((item) => item.id === id);
    if (!template) throw notFound("Шаблон путей не найден");
    return template;
  }
  savePathTemplate(
    value: Omit<PathTemplate, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): PathTemplate {
    const current = value.id
      ? this.pathTemplates().find((item) => item.id === value.id)
      : undefined;
    const id = current?.id || randomUUID();
    const now = new Date().toISOString();
    const payload = JSON.stringify({
      directories: value.directories,
      fileName: value.fileName,
    });
    try {
      this.db
        .prepare(
          `INSERT INTO path_templates(id,name,payload,createdAt,updatedAt) VALUES (?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updatedAt=excluded.updatedAt`,
        )
        .run(id, value.name, payload, current?.createdAt || now, now);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw conflict("Шаблон с таким названием уже существует");
      throw error;
    }
    return this.pathTemplate(id);
  }
  deletePathTemplate(id: string): void {
    if (id === "default-album-artist")
      throw conflict("Шаблон по умолчанию нельзя удалить");
    const used = this.db
      .prepare(
        "SELECT 1 FROM playlist_sync_settings WHERE templateId=? LIMIT 1",
      )
      .get(id);
    if (used) throw conflict("Шаблон используется плейлистом");
    if (
      !this.db.prepare("DELETE FROM path_templates WHERE id=?").run(id).changes
    )
      throw notFound("Шаблон путей не найден");
  }
  playlistSyncSettings(playlistId: string): PlaylistSyncSettings {
    this.storedPlaylist(playlistId);
    const row = this.db
      .prepare("SELECT * FROM playlist_sync_settings WHERE playlistId=?")
      .get(playlistId) as Row;
    return {
      playlistId,
      targetPath: row.targetPath || null,
      templateId: row.templateId,
      autoSync: Boolean(row.autoSync),
      state: row.state,
      lastSyncedAt: row.lastSyncedAt || null,
      message: row.message,
    };
  }
  updatePlaylistSyncSettings(
    playlistId: string,
    patch: Partial<
      Pick<
        PlaylistSyncSettings,
        | "targetPath"
        | "templateId"
        | "autoSync"
        | "state"
        | "lastSyncedAt"
        | "message"
      >
    >,
  ): PlaylistSyncSettings {
    const current = this.playlistSyncSettings(playlistId);
    const next = { ...current, ...patch };
    this.pathTemplate(next.templateId);
    this.db
      .prepare(
        `UPDATE playlist_sync_settings SET targetPath=?,templateId=?,autoSync=?,state=?,lastSyncedAt=?,message=?
         WHERE playlistId=?`,
      )
      .run(
        next.targetPath,
        next.templateId,
        Number(next.autoSync),
        next.state,
        next.lastSyncedAt,
        next.message,
        playlistId,
      );
    return this.playlistSyncSettings(playlistId);
  }
  playlistSyncManifest(playlistId: string, targetPath: string): Row[] {
    return this.db
      .prepare(
        "SELECT * FROM playlist_sync_files WHERE playlistId=? AND targetPath=? ORDER BY relativePath",
      )
      .all(playlistId, targetPath) as Row[];
  }
  playlistSyncManifests(playlistId: string): Row[] {
    return this.db
      .prepare(
        "SELECT * FROM playlist_sync_files WHERE playlistId=? ORDER BY targetPath,relativePath",
      )
      .all(playlistId) as Row[];
  }
  autoSyncPlaylistIds(): string[] {
    return (
      this.db
        .prepare(
          "SELECT playlistId FROM playlist_sync_settings WHERE autoSync=1 AND targetPath IS NOT NULL",
        )
        .all() as { playlistId: string }[]
    ).map((row) => row.playlistId);
  }
  replacePlaylistSyncManifest(
    playlistId: string,
    targetPath: string,
    files: Array<{
      relativePath: string;
      trackId: string;
      sourceSize: number;
      sourceMtimeMs: number;
      sourceHash: string;
    }>,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM playlist_sync_files WHERE playlistId=? AND targetPath=?",
        )
        .run(playlistId, targetPath);
      const insert = this.db.prepare(
        "INSERT INTO playlist_sync_files VALUES (?,?,?,?,?,?,?)",
      );
      for (const file of files)
        insert.run(
          playlistId,
          targetPath,
          file.relativePath,
          file.trackId,
          file.sourceSize,
          file.sourceMtimeMs,
          file.sourceHash,
        );
    })();
  }
  close(): void {
    this.db.close();
  }
}
