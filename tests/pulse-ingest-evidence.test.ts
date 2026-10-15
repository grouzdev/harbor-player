import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import {
  modelTracks,
  summary,
  verifySums,
  measureInvocation,
  artworkStorage,
  phaseEvidence,
} from "../scripts/pulse-ingest-evidence.mjs";

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
  ];
  const result = phaseEvidence(spans);
  assert.equal(result.barrierTail.coverId, "a.png");
  assert.equal(result.barrierTail.completionMs, 8);
  assert.deepEqual(result.barrierTail.spans, spans.slice(0, 3));
  assert.equal(result.phases.copySlot.peakConcurrency, 2);
  assert.equal(result.phases.copySlot.coveredMs, 7);
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
