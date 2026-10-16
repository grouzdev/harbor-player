import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { artworkStorage, verifySums } from "./pulse-ingest-evidence.mjs";

/** Read-only logical transaction; filesystem sizes are sequential samples, not peaks. */
export async function playbackStorage(db, dataDir, phase) {
  const logical = db.transaction(() => {
    const ledger = db
      .prepare("SELECT * FROM pulse_intervals ORDER BY eventId")
      .all();
    const expectedMs = ledger.reduce(
      (sum, row) => sum + JSON.parse(row.payload).playedMs,
      0,
    );
    verifySums(db, expectedMs);
    const expectedDays = new Map();
    const expectedAlbums = new Map();
    for (const row of ledger) {
      expectedAlbums.set(
        row.albumId,
        (expectedAlbums.get(row.albumId) ?? 0) +
          JSON.parse(row.payload).playedMs,
      );
      for (const part of JSON.parse(row.dayContributions))
        expectedDays.set(
          part.dayKey,
          (expectedDays.get(part.dayKey) ?? 0) + part.playedMs,
        );
    }
    const aggregates = {};
    for (const table of [
      "pulse_days",
      "pulse_day_albums",
      "pulse_album_stats",
    ]) {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      const playedMs = rows.reduce((sum, row) => sum + row.playedMs, 0);
      assert.equal(playedMs, expectedMs, `${phase}: ${table}`);
      aggregates[table] = { rows, playedMs };
    }
    for (const [table, key, expected] of [
      ["pulse_days", "dayKey", expectedDays],
      ["pulse_album_stats", "albumId", expectedAlbums],
    ])
      assert.deepEqual(
        aggregates[table].rows.map((row) => [row[key], row.playedMs]).sort(),
        [...expected].sort(),
        `${phase}: exact ${table} key/value allocation`,
      );
    return {
      ledger,
      expectedMs,
      aggregates,
      visits: db.prepare("SELECT * FROM pulse_day_visits ORDER BY rowid").all(),
    };
  })();
  const files = {};
  for (const suffix of ["", "-wal", "-shm"]) {
    const name = `catalog.sqlite${suffix}`;
    try {
      files[name] = (await stat(path.join(dataDir, name))).size;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files[name] = null; // Absent is not a zero-length file.
    }
  }
  return {
    phase,
    ...logical,
    files,
    covers: await artworkStorage(path.join(dataDir, "pulse-covers")),
  };
}
