import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

/** Half-open parent HTTP intervals; worker timestamps are deliberately unused. */
export function batchReadEvidence(batch, requests) {
  const reads = requests.filter(
    (read) =>
      Math.max(read.startMs, batch.startMs) < Math.min(read.endMs, batch.endMs),
  );
  const overlaps = reads.map(
    (read) =>
      Math.min(read.endMs, batch.endMs) - Math.max(read.startMs, batch.startMs),
  );
  return {
    clock: "parent performance.now / HTTP request through parsed response",
    count: reads.length,
    requestIndices: requests.flatMap((read, index) =>
      reads.includes(read) ? [index] : [],
    ),
    latency: reads.length ? summary(reads.map((r) => r.latencyMs)) : null,
    overlapDuration: overlaps.length ? summary(overlaps) : null,
    endpoints: Object.fromEntries(
      [...new Set(reads.map((r) => r.endpoint))].map((endpoint) => [
        endpoint,
        summary(
          reads.filter((r) => r.endpoint === endpoint).map((r) => r.latencyMs),
        ),
      ]),
    ),
  };
}

/** Disjoint generated identities and artwork, reserved outside the overlap pool. */
export function isolatedFirstCopyEvents(repetition, coverIds) {
  assert.equal(coverIds.length, 100);
  assert.equal(new Set(coverIds).size, 100);
  return coverIds.map((coverId, i) => ({
    ...modelTracks(0, coverIds)[0],
    eventId: `isolated-${repetition}-${i}`,
    albumKey: `isolated-${repetition}-${i}`,
    visitId: `isolated-${repetition}-${i}`,
    snapshot: {
      title: `Generated ${i}`,
      artists: ["Benchmark"],
      year: 2025,
      coverId,
    },
    playedMs: 15000,
    endedAtUtc: modelTracks(0, coverIds)[0].startedAtUtc + 15000,
    final: false,
  }));
}

/** Verify publication against generated image bytes, not directory sizes. */
export function verifyArtworkStorage(actual, manifest) {
  assert.equal(
    new Set(manifest.map((image) => image.id)).size,
    manifest.length,
  );
  assert.deepEqual(actual, {
    count: manifest.length,
    bytes: manifest.reduce((sum, image) => sum + image.bytes, 0),
    stagingEntries: 0,
  });
}

export function verifyCohortCoverage(batches, repetitions) {
  const isolated = batches.filter((batch) => batch.cohort === "isolated");
  assert.equal(isolated.length, repetitions, "Isolated sample count");
  assert(isolated.every((batch) => batch.readOverlap.count === 0));
  const loaded = batches.filter(
    (batch) =>
      batch.cohort === "read-load-period" &&
      batch.label === "100/first-copy/new",
  );
  assert.equal(
    loaded.length,
    repetitions,
    "Load-period first-copy sample count",
  );
  assert(
    loaded.every((batch) => batch.readOverlap.count > 0),
    "Every load-period first-copy 100 sample must have observed read overlap",
  );
}

/** Keep legacy scenario keys load-period-only; isolated samples never dilute them. */
export function scenarioEvidence(batches, cohort) {
  const selected = batches.filter((batch) => batch.cohort === cohort);
  return Object.fromEntries(
    [...new Set(selected.map((batch) => batch.label))].map((label) => {
      const samples = selected.filter((batch) => batch.label === label);
      return [
        label,
        {
          http: summary(samples.map((s) => s.httpMs)),
          ingest: summary(samples.map((s) => s.fullIngestMs)),
          transaction: summary(samples.map((s) => s.transactionCommitMs)),
        },
      ];
    }),
  );
}

/** Interval union is elapsed coverage, unlike summed overlapping I/O durations. */
export function phaseEvidence(spans) {
  const tail = spans
    .filter((s) => s.phase === "copySlot")
    .reduce(
      (last, span) => (!last || span.endMs > last.endMs ? span : last),
      null,
    );
  const coverage = (items) => {
    const points = items
      .filter(({ startMs, endMs }) => endMs > startMs)
      .flatMap(({ startMs, endMs }) => [
        [startMs, 1],
        [endMs, -1],
      ])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let active = 0,
      peakConcurrency = 0,
      coveredMs = 0,
      previous = 0;
    for (const [time, delta] of points) {
      if (active) coveredMs += time - previous;
      active += delta;
      peakConcurrency = Math.max(peakConcurrency, active);
      previous = time;
    }
    return { coveredMs, peakConcurrency };
  };
  const publications = spans.filter((s) => s.phase === "publication");
  const errors = spans.filter((s) => s.outcome && s.outcome !== "ok");
  const outcomes = (items) =>
    Object.fromEntries(
      [...new Set(items.map((s) => s.outcome ?? "unknown"))].map((outcome) => [
        outcome,
        items.filter((s) => (s.outcome ?? "unknown") === outcome).length,
      ]),
    );
  return {
    spans,
    publication: {
      attempts: publications.length,
      succeeded: publications.filter((s) => s.outcome === "ok").length,
      failed: publications.filter((s) => s.outcome && s.outcome !== "ok")
        .length,
      outcomes: outcomes(publications),
    },
    errors: { count: errors.length, outcomes: outcomes(errors) },
    observedLastCopySlot: tail
      ? {
          interpretation:
            "Observed final copy-slot tail, not a causal trace or sum of concurrent durations",
          completionMs: tail.endMs,
          slotElapsedMs: tail.endMs - tail.startMs,
          phases: Object.fromEntries(
            [...new Set(spans.map((s) => s.phase))].map((phase) => [
              phase,
              coverage(
                spans.filter(
                  (s) => s.phase === phase && s.path?.includes(tail.path),
                ),
              ).coveredMs,
            ]),
          ),
        }
      : null,
    // Legacy field: the last observed copy slot, not necessarily the artwork
    // barrier. Metadata-only work can finish later; lastCompletion is independent.
    barrierTail: tail
      ? {
          coverId: tail.path,
          completionMs: tail.endMs,
          spans: spans
            .filter((s) => s.path?.includes(tail.path))
            .sort((a, b) => a.startMs - b.startMs),
        }
      : null,
    ...coverage(spans),
    phases: Object.fromEntries(
      [...new Set(spans.map((s) => s.phase))].map((phase) => {
        const items = spans.filter((s) => s.phase === phase);
        return [
          phase,
          {
            calls: items.length,
            summedDurationMs: items.reduce(
              (sum, s) => sum + s.endMs - s.startMs,
              0,
            ),
            ...coverage(items),
          },
        ];
      }),
    ),
    lastCompletion: spans.reduce(
      (last, span) => (!last || span.endMs > last.endMs ? span : last),
      null,
    ),
  };
}

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
