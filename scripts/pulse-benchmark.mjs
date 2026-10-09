// Read-path benchmark, not a substitute for recorder/ingestion correctness tests.
// Run after npm run build:server. Uses only a disposable workspace test database.
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Catalog } from "../dist/server/database.js";

const testRoot = path.resolve(".test-data");
await mkdir(testRoot, { recursive: true });
const root = await mkdtemp(path.join(testRoot, "pulse-benchmark-"));
const catalog = new Catalog(root);
const db = catalog.db;
const start = Date.UTC(2015, 0, 1);
try {
  catalog.pulse.updateSettings({ timeZone: "UTC" });
  const seedStart = performance.now();
  db.transaction(() => {
    db.exec(`
      WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<9999)
      INSERT INTO pulse_albums SELECT 'bench-'||i,
        json_object('title','Album '||i,'artists',json_array('Benchmark'),
                    'year',2015,'coverId',NULL) FROM n;
      INSERT INTO pulse_album_aliases SELECT albumId,albumId FROM pulse_albums;

      WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<999999),
      e AS (SELECT i, ${start} + CASE WHEN i<1000 THEN 0
        ELSE (1+CAST((i-1000)/275 AS INTEGER))*86400000 END + (i%275)*180000 t FROM n)
      INSERT INTO pulse_intervals
      SELECT 'event-'||i,1,'bench-'||(i%10000),
        json_object('eventId','event-'||i,'revision',1,'trackId',NULL,
          'albumKey','bench-'||(i%10000),'sessionId','session-'||i,
          'visitId','visit-'||i,'startedAtUtc',t,'endedAtUtc',t+180000,
          'playedMs',180000,'final',json('true'),'snapshotHash','benchmark'),
        t,'[]' FROM e;

      INSERT INTO pulse_day_albums
      SELECT date(startedAtUtc/1000,'unixepoch'),albumId,
        SUM(json_extract(payload,'$.playedMs')),MIN(startedAtUtc),
        MAX(startedAtUtc+180000),COUNT(*)
      FROM pulse_intervals GROUP BY date(startedAtUtc/1000,'unixepoch'),albumId;
      INSERT INTO pulse_days
      SELECT dayKey,SUM(playedMs),COUNT(*),MAX(playedMs)
      FROM pulse_day_albums GROUP BY dayKey;
      INSERT INTO pulse_album_stats
      SELECT albumId,SUM(playedMs),COUNT(*),SUM(visitCount-1),
        MIN(firstPlayedAtUtc),MAX(lastPlayedAtUtc)
      FROM pulse_day_albums GROUP BY albumId;
    `);
  })();
  const seedMs = performance.now() - seedStart;
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.exec("ANALYZE");
  const count = (table) =>
    db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  function measure(operation) {
    const samples = [];
    for (let index = 0; index < 100; index++) {
      const before = performance.now();
      JSON.stringify(operation());
      samples.push(performance.now() - before);
    }
    samples.sort((a, b) => a - b);
    return {
      medianMs: Number(samples[50].toFixed(3)),
      p95Ms: Number(samples[95].toFixed(3)),
    };
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        intervals: count("pulse_intervals"),
        albums: count("pulse_albums"),
        activeDays: count("pulse_days"),
        busyDayAlbums: db
          .prepare(
            "SELECT albumCount FROM pulse_days WHERE dayKey='2015-01-01'",
          )
          .get().albumCount,
        databaseMiB: Number(
          (
            (await stat(path.join(root, "catalog.sqlite"))).size /
            1024 /
            1024
          ).toFixed(1),
        ),
        seedMs: Math.round(seedMs),
        range: measure(() => catalog.pulse.range()),
        yearLayout: measure(() =>
          catalog.pulse.layout("2023-01-01", "2023-12-31"),
        ),
        weekWindow: measure(() =>
          catalog.pulse.window("2023-01-01", "2023-01-07"),
        ),
        busyDayRank900: measure(() =>
          catalog.pulse.dayAlbums("2015-01-01", 20, undefined, 900),
        ),
        albumStats: measure(() =>
          catalog.pulse.albumStats("bench-0", "2015-01-01"),
        ),
        plans: {
          layout: db
            .prepare(
              "EXPLAIN QUERY PLAN SELECT * FROM pulse_days WHERE dayKey BETWEEN ? AND ? ORDER BY dayKey",
            )
            .all("2023-01-01", "2023-12-31"),
          cards: db
            .prepare(
              "EXPLAIN QUERY PLAN SELECT * FROM pulse_day_albums WHERE dayKey=? ORDER BY firstPlayedAtUtc,albumId LIMIT 20 OFFSET 900",
            )
            .all("2015-01-01"),
          stats: db
            .prepare(
              "EXPLAIN QUERY PLAN SELECT * FROM pulse_album_stats WHERE albumId=?",
            )
            .all("bench-0"),
        },
      },
      null,
      2,
    ),
  );
} finally {
  catalog.close();
  await rm(root, { recursive: true, force: true });
}
