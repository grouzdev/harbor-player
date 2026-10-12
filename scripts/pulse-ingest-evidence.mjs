import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

/** Count actual image bytes for both legacy flat files and published archives. */
export async function artworkStorage(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const images = entries.flatMap((entry) => {
    if (entry.isFile() && /^[a-f0-9]{64}\.(jpg|png)$/.test(entry.name))
      return [path.join(directory, entry.name)];
    if (
      entry.isDirectory() &&
      /^[a-f0-9]{64}\.(jpg|png)\.archive$/.test(entry.name)
    )
      return [path.join(directory, entry.name, "image")];
    return [];
  });
  const sizes = await Promise.all(
    images.map(async (file) => (await stat(file).catch(() => null))?.size),
  );
  return {
    count: sizes.filter((bytes) => bytes !== undefined).length,
    bytes: sizes.reduce((sum, bytes) => sum + (bytes ?? 0), 0),
    stagingEntries: entries.filter((entry) => entry.name.startsWith(".pulse-"))
      .length,
  };
}

/** Await preparation as well as commit; never label awaited I/O as blocking. */
export async function measureInvocation(
  run,
  timing,
  now = () => performance.now(),
) {
  const start = now();
  try {
    const result = run();
    timing.syncInvocationMs = now() - start;
    return await result;
  } finally {
    timing.fullIngestMs = now() - start;
    timing.preparationResidualMs = Math.max(
      0,
      timing.fullIngestMs - timing.validationMs - timing.transactionCommitMs,
    );
  }
}

/** Nearest-rank percentiles; durations in milliseconds, not rounded samples. */
export function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  assert(sorted.length > 0);
  assert(sorted.every((n) => Number.isFinite(n) && n >= 0));
  const rank = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    count: sorted.length,
    medianMs: rank(0.5),
    p95Ms: rank(0.95),
    maxMs: sorted.at(-1),
  };
}

export function verifySums(db, expected) {
  const raw = db
    .prepare(
      "SELECT coalesce(sum(json_extract(payload,'$.playedMs')),0) total FROM pulse_intervals",
    )
    .get().total;
  assert.equal(raw, expected, "raw interval ledger");
  const totals = { raw };
  for (const table of ["pulse_days", "pulse_day_albums", "pulse_album_stats"]) {
    totals[table] = db
      .prepare(`SELECT coalesce(sum(playedMs),0) total FROM ${table}`)
      .get().total;
    assert.equal(totals[table], expected, table);
  }
  assert.equal(
    db
      .prepare(
        `SELECT count(*) n FROM pulse_days d WHERE playedMs !=
    (SELECT sum(playedMs) FROM pulse_day_albums a WHERE a.dayKey=d.dayKey)`,
      )
      .get().n,
    0,
  );
  assert.equal(
    db
      .prepare(
        `SELECT count(*) n FROM pulse_album_stats s WHERE playedMs !=
    (SELECT sum(json_extract(payload,'$.playedMs')) FROM pulse_intervals i WHERE i.albumId=s.albumId)`,
      )
      .get().n,
    0,
  );
  assert.equal(
    db
      .prepare(
        `WITH ledger AS (
      SELECT json_extract(c.value,'$.dayKey') dayKey,i.albumId,
        sum(json_extract(c.value,'$.playedMs')) playedMs
      FROM pulse_intervals i,json_each(i.dayContributions) c GROUP BY dayKey,i.albumId
    ), missing AS (
      SELECT * FROM ledger EXCEPT SELECT dayKey,albumId,playedMs FROM pulse_day_albums
    ), extra AS (
      SELECT dayKey,albumId,playedMs FROM pulse_day_albums EXCEPT SELECT * FROM ledger
    ) SELECT (SELECT count(*) FROM missing)+(SELECT count(*) FROM extra) n`,
      )
      .get().n,
    0,
    "Every day/album matches cumulative raw contributions",
  );
  return totals;
}

/** Thirty alternating 3/4/5-minute tracks = exactly two hours per UTC day. */
export function modelTracks(day, coverIds) {
  return Array.from({ length: 30 }, (_, i) => {
    const album = i % 5 === 0 ? `new-${day}-${i}` : `repeat-${i % 12}`;
    const durationMs = [180000, 240000, 300000][i % 3];
    const offset = Array.from(
      { length: i },
      (_, j) => [180000, 240000, 300000][j % 3],
    ).reduce((a, b) => a + b, 0);
    return {
      eventId: `model-${day}-${i}`,
      revision: 1,
      trackId: null,
      albumKey: album,
      snapshot: {
        title: album,
        artists: ["Generated benchmark"],
        year: 2025,
        coverId:
          coverIds[
            (i % 5 === 0 ? 12 + day * 6 + i / 5 : i % 12) % coverIds.length
          ],
      },
      sessionId: `day-${day}`,
      visitId: `visit-${day}-${i}`,
      startedAtUtc: Date.UTC(2025, 0, 1 + day, 12) + offset,
      endedAtUtc: Date.UTC(2025, 0, 1 + day, 12) + offset + durationMs,
      playedMs: durationMs,
      final: true,
    };
  });
}
