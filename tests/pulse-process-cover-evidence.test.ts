import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { migratePulse } from "../src/server/pulse-migration";
import {
  copyStoppedPulseFixture,
  populatedDayOffset,
  pulseFixtureSnapshot,
} from "../scripts/pulse-process-cover-evidence.mjs";

test("uses the populated historical day, not the range extended to today", () => {
  expect(populatedDayOffset(10, "2026-10-17", "2026-10-16")).toBe(9);
  expect(populatedDayOffset(10, "2026-10-17", "2026-10-17")).toBe(10);
  expect(() => populatedDayOffset(10, "2026-10-17", "2026-10-18")).toThrow();
});

test("rejects live owners, holds stopped sources, and verifies SQLite plus WAL and logical state", async () => {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data/pulse-cover-evidence-"));
  const source = path.join(root, "source");
  const copy = path.join(root, "copy");
  await mkdir(source);
  const db = new Database(path.join(source, "catalog.sqlite"));
  const owner = new Database(path.join(source, "server-ownership.sqlite"), {
    timeout: 0,
  });
  let guard;
  try {
    db.pragma("journal_mode = WAL");
    migratePulse(db);
    db.exec("INSERT INTO pulse_days VALUES ('2026-10-16',1234,1,1234)");
    owner.exec("BEGIN EXCLUSIVE");
    await expect(copyStoppedPulseFixture(source, copy)).rejects.toMatchObject({
      code: "SQLITE_BUSY",
    });
    owner.exec("ROLLBACK");
    guard = await copyStoppedPulseFixture(source, copy);
    expect(guard.snapshot.latestDay).toBe("2026-10-16");
    expect(guard.snapshot.files["catalog.sqlite-wal"]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    assert.deepEqual(await pulseFixtureSnapshot(copy), guard.snapshot);
    expect(() => owner.exec("BEGIN EXCLUSIVE")).toThrow();
    await guard.assertUnchanged();
    // A writer bypassing the ownership protocol must still fail evidence.
    db.exec("UPDATE pulse_days SET playedMs=2345");
    await expect(guard.assertUnchanged()).rejects.toThrow(
      "Source SQLite/WAL/logical state changed",
    );
  } finally {
    guard?.close();
    owner.close();
    db.close();
    await rm(root, { recursive: true });
  }
});
