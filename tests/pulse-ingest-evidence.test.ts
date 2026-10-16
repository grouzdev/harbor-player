import { test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import {
  modelTracks,
  summary,
  verifySums,
  measureInvocation,
  artworkStorage,
  phaseEvidence,
  batchReadEvidence,
  isolatedFirstCopyEvents,
  scenarioEvidence,
  verifyArtworkStorage,
  verifyArtworkManifest,
  verifyCohortCoverage,
} from "../scripts/pulse-ingest-evidence.mjs";

test("artwork publication gates check exact manifest count, bytes and no staging", () => {
  const manifest = [
    { id: "a", bytes: 4 },
    { id: "b", bytes: 7 },
  ];
  const storage = { count: 2, bytes: 11, stagingEntries: 0 };
  verifyArtworkStorage(storage, manifest);
  for (const bad of [
    { ...storage, count: 1 },
    { ...storage, bytes: 10 },
    { ...storage, stagingEntries: 1 },
  ])
    assert.throws(() => verifyArtworkStorage(bad, manifest));
  assert.throws(() =>
    verifyArtworkStorage(storage, [manifest[0], manifest[0]]),
  );
});

test("artwork integrity rejects substitutions and corruption with unchanged count/bytes", async () => {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data/artwork-integrity-"));
  const id = (bytes: string) =>
    `${createHash("sha256").update(bytes).digest("hex")}.png`;
  const first = id("first");
  const second = id("other");
  const manifest = [
    { id: first, bytes: 5 },
    { id: second, bytes: 5 },
  ];
  try {
    await writeFile(path.join(root, first), "first");
    await mkdir(path.join(root, `${second}.archive`));
    const archived = path.join(root, `${second}.archive`, "image");
    await writeFile(archived, "other");
    assert.deepEqual(await verifyArtworkManifest(root, manifest), {
      count: 2,
      bytes: 10,
      stagingEntries: 0,
      contentSha256Verified: 2,
    });
    await writeFile(archived, "wrong");
    await assert.rejects(verifyArtworkManifest(root, manifest), /content hash/);
    await writeFile(archived, "other");
    const substituted = id("third");
    await rename(path.join(root, first), path.join(root, substituted));
    await assert.rejects(
      verifyArtworkManifest(root, manifest),
      /IDs match manifest/,
    );
    await rename(path.join(root, substituted), path.join(root, first));
    await symlink(
      path.join(root, `${second}.archive`),
      path.join(root, `${first}.archive`),
      "junction",
    );
    await assert.rejects(
      verifyArtworkManifest(root, manifest),
      /Publication-shaped entry must be a regular/,
    );
    await rm(path.join(root, `${first}.archive`));
    await mkdir(path.join(root, `${first}.archive`));
    await writeFile(path.join(root, `${first}.archive`, "image"), "first");
    await rm(path.join(root, second + ".archive"), { recursive: true });
    await assert.rejects(verifyArtworkManifest(root, manifest), /Duplicate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cohort coverage requires matching counts and actual first-copy read overlap", () => {
  const batches = [
    {
      label: "100/first-copy/new",
      cohort: "read-load-period",
      readOverlap: { count: 2 },
    },
    {
      label: "100/first-copy/new",
      cohort: "isolated",
      readOverlap: { count: 0 },
    },
  ];
  verifyCohortCoverage(batches, 1);
  assert.throws(() => verifyCohortCoverage(batches, 2));
  assert.throws(() => verifyCohortCoverage(batches.slice(0, 1), 1));
  assert.throws(() =>
    verifyCohortCoverage(
      batches.map((b) => ({ ...b, readOverlap: { count: 0 } })),
      1,
    ),
  );
  assert.throws(() =>
    verifyCohortCoverage(
      batches.map((b) => ({ ...b, readOverlap: { count: 1 } })),
      1,
    ),
  );
});

test("report preserves overlap scenario summaries and separates matching isolated samples", () => {
  const batches = [
    "read-load-period",
    "isolated",
    "read-load-period",
    "isolated",
  ].map((cohort, i) => ({
    cohort,
    label: "100/first-copy/new",
    httpMs: i + 1,
    fullIngestMs: i + 2,
    transactionCommitMs: i + 3,
    readOverlap: { count: i === 0 ? 0 : 1 },
  }));
  assert.deepEqual(
    scenarioEvidence(batches, "read-load-period")["100/first-copy/new"],
    {
      http: summary([1, 3]),
      ingest: summary([2, 4]),
      transaction: summary([3, 5]),
    },
  );
  assert.deepEqual(
    scenarioEvidence(batches, "isolated")["100/first-copy/new"].http,
    summary([2, 4]),
  );
  assert.deepEqual(scenarioEvidence([], "isolated"), {});
  assert.deepEqual(
    scenarioEvidence(
      batches.filter((batch) => batch.readOverlap.count > 0),
      "read-load-period",
    )["100/first-copy/new"].http,
    summary([3]),
  );
});

test("per-batch reads use strict interval intersection, not touching endpoints or worker clocks", () => {
  const read = (startMs: number, endMs: number, endpoint = "/tracks") => ({
    startMs,
    endMs,
    endpoint,
    latencyMs: endMs - startMs,
  });
  const result = batchReadEvidence(
    { startMs: 10, endMs: 20, originMs: 999999 },
    [
      read(0, 10),
      read(20, 30),
      read(10, 20),
      read(5, 15),
      read(18, 25, "/albums"),
      read(15, 15),
    ],
  );
  assert.equal(result.count, 3);
  assert.deepEqual(result.requestIndices, [2, 3, 4]);
  assert.deepEqual(result.latency, summary([10, 10, 7]));
  assert.deepEqual(result.overlapDuration, summary([10, 5, 2]));
  assert.equal(result.endpoints["/tracks"].count, 2);
  assert.deepEqual(
    batchReadEvidence({ startMs: 30, endMs: 40 }, []).latency,
    null,
  );
  assert.equal(
    batchReadEvidence({ startMs: 10, endMs: 10 }, [read(0, 30)]).count,
    0,
  );
});

test("isolated first-copy cohort reserves fresh identities and unique artwork per repetition", () => {
  const covers = Array.from({ length: 200 }, (_, i) => `generated-${i}.png`);
  const first = isolatedFirstCopyEvents(0, covers.slice(0, 100));
  const second = isolatedFirstCopyEvents(1, covers.slice(100));
  assert.equal(first.length, 100);
  for (const key of ["eventId", "albumKey", "visitId"] as const)
    assert.equal(new Set([...first, ...second].map((e) => e[key])).size, 200);
  assert.equal(
    new Set([...first, ...second].map((e) => e.snapshot.coverId)).size,
    200,
  );
  assert(
    first.every((e) => e.revision === 1 && !e.final && e.playedMs === 15000),
  );
  assert.throws(() => isolatedFirstCopyEvents(0, ["duplicate"]));
  assert.throws(() => isolatedFirstCopyEvents(0, Array(100).fill("duplicate")));
});

test("publication failures and metadata errors remain visible without adding concurrent durations", () => {
  const result = phaseEvidence([
    { phase: "copySlot", path: "a.png", startMs: 1, endMs: 12 },
    {
      phase: "copy",
      path: "/generated/a.png",
      startMs: 2,
      endMs: 8,
      outcome: "ok",
    },
    {
      phase: "publication",
      path: "/generated/a.png.tmp",
      startMs: 8,
      endMs: 9,
      outcome: "EACCES",
    },
    {
      phase: "publication",
      path: "/generated/b.png.tmp",
      startMs: 8,
      endMs: 10,
      outcome: "ok",
    },
    { phase: "metadata", startMs: 0, endMs: 1, outcome: "ENOENT" },
    { phase: "cleanup", startMs: 12, endMs: 12, outcome: "ok" },
  ]);
  assert.equal(result.publication.attempts, 2);
  assert.equal(result.publication.succeeded, 1);
  assert.equal(result.publication.failed, 1);
  assert.deepEqual(result.errors, {
    count: 2,
    outcomes: { EACCES: 1, ENOENT: 1 },
  });
  assert.equal(result.observedLastCopySlot.slotElapsedMs, 11);
  assert.equal(result.observedLastCopySlot.phases.publication, 1);
  assert.equal(result.coveredMs, 12);
  assert.equal(result.phases.cleanup.peakConcurrency, 0);
});

test("overlapping phase evidence reports union and concurrency, not additive wall time", () => {
  const result = phaseEvidence([
    { phase: "copy", startMs: 1, endMs: 10 },
    { phase: "copy", startMs: 2, endMs: 8 },
    { phase: "cleanup", startMs: 9, endMs: 12 },
  ]);
  assert.equal(result.coveredMs, 11);
  assert.equal(result.peakConcurrency, 2);
  assert.equal(result.phases.copy.summedDurationMs, 15);
  assert.equal(result.phases.copy.coveredMs, 9);
  assert.equal(result.lastCompletion.phase, "cleanup");
});

test("barrier tail retains the last copy job's queue and filesystem intervals", () => {
  const spans = [
    { phase: "queueWait", path: "a.png", startMs: 1, endMs: 3 },
    { phase: "copySlot", path: "a.png", startMs: 3, endMs: 8 },
    { phase: "copy", path: "/covers/a.png", startMs: 4, endMs: 7 },
    { phase: "copySlot", path: "b.png", startMs: 1, endMs: 6 },
    { phase: "metadata", path: "c.png", startMs: 0, endMs: 14 },
  ];
  const result = phaseEvidence(spans);
  assert.equal(result.barrierTail.coverId, "a.png");
  assert.equal(result.barrierTail.completionMs, 8);
  assert.deepEqual(result.barrierTail.spans, spans.slice(0, 3));
  assert.equal(result.phases.copySlot.peakConcurrency, 2);
  assert.equal(result.phases.copySlot.coveredMs, 7);
  assert.equal(result.lastCompletion.phase, "metadata");
  assert.equal(result.observedLastCopySlot.completionMs, 8);
  assert.equal(phaseEvidence([]).coveredMs, 0);
  assert.equal(phaseEvidence([]).barrierTail, null);
});

test("artwork evidence counts image bytes, not archive directory sizes or staging", async () => {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(
    path.resolve(".test-data/pulse-storage-evidence-"),
  );
  try {
    await writeFile(path.join(root, `${"a".repeat(64)}.jpg`), "flat");
    const archive = path.join(root, `${"b".repeat(64)}.png.archive`);
    await mkdir(archive);
    await writeFile(path.join(archive, "image"), "archive");
    const staging = path.join(root, ".pulse-owned.tmp");
    await mkdir(staging);
    await writeFile(path.join(staging, "image"), "not published");
    assert.deepEqual(await artworkStorage(root), {
      count: 2,
      bytes: 11,
      stagingEntries: 1,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("phase wrapper awaits async preparation without calling it continuous blocking", async () => {
  let clock = 0;
  const timing = {
    validationMs: 1,
    transactionCommitMs: 3,
    syncInvocationMs: 0,
    fullIngestMs: 0,
    preparationResidualMs: 0,
  };
  const result = await measureInvocation(
    () => {
      clock = 1;
      return Promise.resolve().then(() => {
        clock = 24;
        return "ACK";
      });
    },
    timing,
    () => clock,
  );
  assert.equal(result, "ACK");
  assert.equal(timing.syncInvocationMs, 1);
  assert.equal(timing.fullIngestMs, 24);
  assert.equal(timing.preparationResidualMs, 20);
});

test("nearest-rank evidence is nonmutating and rejects invalid measurements", () => {
  const samples = [9, 1, 3, 2];
  assert.deepEqual(summary(samples), {
    count: 4,
    medianMs: 2,
    p95Ms: 9,
    maxMs: 9,
  });
  assert.deepEqual(samples, [9, 1, 3, 2]);
  assert.throws(() => summary([]));
  assert.throws(() => summary([NaN]));
});
test("cadence model has exactly two hours, stable identity and 20% new albums", () => {
  const tracks = modelTracks(0, ["cover"]);
  assert.equal(
    tracks.reduce((sum, e) => sum + e.playedMs, 0),
    7200000,
  );
  assert.equal(tracks.filter((e) => e.albumKey.startsWith("new")).length, 6);
  assert.equal(new Set(tracks.map((e) => e.eventId)).size, 30);
  assert.equal(tracks.at(-1)!.endedAtUtc - tracks[0].startedAtUtc, 7200000);
  const covers = Array.from({ length: 24 }, (_, i) => `cover-${i}`);
  assert.equal(
    modelTracks(0, covers)[1].snapshot.coverId,
    modelTracks(1, covers)[1].snapshot.coverId,
  );
  assert.notEqual(
    modelTracks(0, covers)[0].snapshot.coverId,
    modelTracks(1, covers)[0].snapshot.coverId,
  );
});
test("SQL evidence detects corrupted aggregates even when global sums match", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE pulse_intervals(albumId,payload,dayContributions);
      CREATE TABLE pulse_days(dayKey,playedMs);
      CREATE TABLE pulse_day_albums(dayKey,albumId,playedMs);
      CREATE TABLE pulse_album_stats(albumId,playedMs);
      INSERT INTO pulse_intervals VALUES ('a','{"playedMs":20}','[{"dayKey":"d1","playedMs":20}]'),
        ('b','{"playedMs":10}','[{"dayKey":"d2","playedMs":10}]');
      INSERT INTO pulse_days VALUES ('d1',20),('d2',10);
      INSERT INTO pulse_day_albums VALUES ('d1','a',20),('d2','b',10);
      INSERT INTO pulse_album_stats VALUES ('a',20),('b',10);`);
    assert.equal(verifySums(db, 30).raw, 30);
    db.exec(
      "UPDATE pulse_days SET playedMs=CASE dayKey WHEN 'd1' THEN 10 ELSE 20 END",
    );
    assert.throws(() => verifySums(db, 30));
    db.exec(
      "UPDATE pulse_days SET playedMs=CASE dayKey WHEN 'd1' THEN 20 ELSE 10 END",
    );
    db.exec(
      "UPDATE pulse_day_albums SET albumId=CASE albumId WHEN 'a' THEN 'b' ELSE 'a' END",
    );
    assert.throws(() => verifySums(db, 30), /Every day\/album/);
  } finally {
    db.close();
  }
});
