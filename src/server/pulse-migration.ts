import type Database from "better-sqlite3";

export function migratePulse(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pulse_settings (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL,
      timeZone TEXT, historyGeneration INTEGER NOT NULL, coverageStartedAtUtc INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pulse_albums (albumId TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pulse_album_aliases (albumKey TEXT PRIMARY KEY, albumId TEXT NOT NULL REFERENCES pulse_albums);
    CREATE TABLE IF NOT EXISTS pulse_track_aliases (trackId TEXT PRIMARY KEY, albumId TEXT NOT NULL REFERENCES pulse_albums);
    CREATE TABLE IF NOT EXISTS pulse_intervals (eventId TEXT PRIMARY KEY, revision INTEGER NOT NULL,
      albumId TEXT NOT NULL REFERENCES pulse_albums, payload TEXT NOT NULL, startedAtUtc INTEGER NOT NULL,
      dayContributions TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS pulse_intervals_start ON pulse_intervals(startedAtUtc);
    CREATE INDEX IF NOT EXISTS pulse_intervals_album_start ON pulse_intervals(albumId,startedAtUtc);
    CREATE TABLE IF NOT EXISTS pulse_days (dayKey TEXT PRIMARY KEY, playedMs INTEGER NOT NULL, albumCount INTEGER NOT NULL, maxAlbumMs INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pulse_day_albums (dayKey TEXT NOT NULL, albumId TEXT NOT NULL REFERENCES pulse_albums,
      playedMs INTEGER NOT NULL, firstPlayedAtUtc INTEGER NOT NULL, lastPlayedAtUtc INTEGER NOT NULL,
      visitCount INTEGER NOT NULL, PRIMARY KEY(dayKey,albumId));
    CREATE INDEX IF NOT EXISTS pulse_day_albums_order ON pulse_day_albums(dayKey,firstPlayedAtUtc,albumId);
    CREATE INDEX IF NOT EXISTS pulse_day_albums_album_day ON pulse_day_albums(albumId,dayKey);
    CREATE TABLE IF NOT EXISTS pulse_day_visits (dayKey TEXT NOT NULL, albumId TEXT NOT NULL, visitId TEXT NOT NULL,
      PRIMARY KEY(dayKey,albumId,visitId));
    CREATE TABLE IF NOT EXISTS pulse_album_stats (albumId TEXT PRIMARY KEY REFERENCES pulse_albums,
      playedMs INTEGER NOT NULL, dayCount INTEGER NOT NULL, sameDayReturns INTEGER NOT NULL,
      firstPlayedAtUtc INTEGER NOT NULL, lastPlayedAtUtc INTEGER NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO pulse_settings VALUES (1,1,NULL,1,?)").run(
    Date.now(),
  );
}
