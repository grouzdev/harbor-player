import type Database from "better-sqlite3";

export const catalogSchemaVersion = 7;

export function runCatalogMigrations(db: Database.Database): void {
  db.exec(`
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
    CREATE TABLE IF NOT EXISTS bookmarks (kind TEXT NOT NULL CHECK(kind IN ('artist','album','track')), id TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS catalog_user_state (
      kind TEXT NOT NULL CHECK(kind IN ('album','track')),
      id TEXT NOT NULL,
      rating INTEGER CHECK(rating IS NULL OR rating BETWEEN 1 AND 5),
      viewed INTEGER NOT NULL DEFAULT 0 CHECK(viewed IN (0,1) AND (kind='album' OR viewed=0)),
      PRIMARY KEY(kind,id),
      CHECK(rating IS NOT NULL OR viewed=1)
    );
  `);
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version < 2)
    db.transaction(() => {
      db.exec(
        "INSERT OR IGNORE INTO track_artists(trackId,artist) SELECT t.id,j.value FROM tracks t,json_each(t.artists) j",
      );
      db.pragma("user_version = 2");
    })();
  if (version < 3)
    db.transaction(() => {
      const columns = new Set(
        (db.pragma("table_info(tracks)") as { name: string }[]).map(
          (column) => column.name,
        ),
      );
      if (!columns.has("missingTagFields"))
        db.exec("ALTER TABLE tracks ADD COLUMN missingTagFields TEXT");
      if (!columns.has("musicBrainzRecordingId"))
        db.exec("ALTER TABLE tracks ADD COLUMN musicBrainzRecordingId TEXT");
      if (!columns.has("musicBrainzReleaseId"))
        db.exec("ALTER TABLE tracks ADD COLUMN musicBrainzReleaseId TEXT");
      if (!columns.has("musicBrainzReleaseGroupId"))
        db.exec("ALTER TABLE tracks ADD COLUMN musicBrainzReleaseGroupId TEXT");
      db.exec(
        `CREATE TABLE IF NOT EXISTS http_cache (key TEXT PRIMARY KEY, status INTEGER NOT NULL, payload TEXT NOT NULL, expiresAt INTEGER NOT NULL)`,
      );
      db.pragma("user_version = 3");
    })();
  if (version < 4)
    db.transaction(() => {
      db.exec(
        "INSERT OR IGNORE INTO track_album_artists(trackId,artist) SELECT t.id,j.value FROM tracks t,json_each(t.albumArtists) j",
      );
      db.pragma("user_version = 4");
    })();
  if (version < 5) db.pragma("user_version = 5");
  if (version < 6)
    db.transaction(() => {
      db.exec(`
        DELETE FROM track_album_artists;
        INSERT OR IGNORE INTO track_album_artists(trackId,artist)
        SELECT t.id,j.value FROM tracks t,
             json_each(CASE WHEN t.albumArtists='[]' THEN t.artists ELSE t.albumArtists END) j
      `);
      db.pragma("user_version = 6");
    })();
  if (version < 7)
    db.transaction(() => {
      db.exec(`
        CREATE TEMP TABLE album_key_migration AS
        SELECT DISTINCT albumKey oldKey,
               album_identity_key(libraryId, relativePath, albumTitle, albumArtists, year) newKey
        FROM tracks;

        INSERT OR IGNORE INTO bookmarks(kind,id)
        SELECT 'album', migration.newKey
        FROM bookmarks bookmark
        JOIN album_key_migration migration ON migration.oldKey=bookmark.id
        WHERE bookmark.kind='album';

        INSERT OR IGNORE INTO catalog_user_state(kind,id,rating,viewed)
        SELECT 'album', migration.newKey, state.rating, state.viewed
        FROM catalog_user_state state
        JOIN album_key_migration migration ON migration.oldKey=state.id
        WHERE state.kind='album';

        DELETE FROM bookmarks
        WHERE kind='album'
          AND id IN (SELECT oldKey FROM album_key_migration WHERE oldKey<>newKey);

        UPDATE tracks
        SET albumKey=album_identity_key(libraryId, relativePath, albumTitle, albumArtists, year);

        DROP TABLE album_key_migration;
      `);
      db.pragma("user_version = 7");
    })();
}
