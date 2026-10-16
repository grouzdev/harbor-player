import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

export async function pulseFixtureSnapshot(directory) {
  const files = {};
  // SHM is transient coordination, not authoritative catalog content.
  for (const name of ["catalog.sqlite", "catalog.sqlite-wal"]) {
    try {
      files[name] = createHash("sha256")
        .update(await readFile(path.join(directory, name)))
        .digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files[name] = null;
    }
  }
  const db = new Database(path.join(directory, "catalog.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return db.transaction(() => {
      const logical = {};
      for (const table of [
        "pulse_intervals",
        "pulse_albums",
        "pulse_days",
        "pulse_day_albums",
        "pulse_album_stats",
        "pulse_day_visits",
        "pulse_settings",
      ])
        logical[table] = db
          .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
          .all();
      return {
        files,
        logicalSha256: createHash("sha256")
          .update(JSON.stringify(logical))
          .digest("hex"),
        latestDay: db
          .prepare("SELECT max(dayKey) day FROM pulse_days WHERE playedMs > 0")
          .get().day,
      };
    })();
  } finally {
    db.close();
  }
}

/** Hold the existing ownership protocol read-only; never rewrite its marker. */
export async function copyStoppedPulseFixture(source, destination) {
  const owner = new Database(path.join(source, "server-ownership.sqlite"), {
    readonly: true,
    fileMustExist: true,
    timeout: 0,
  });
  try {
    assert.equal(owner.pragma("journal_mode", { simple: true }), "delete");
    owner.exec("BEGIN EXCLUSIVE");
    const before = await pulseFixtureSnapshot(source);
    assert(before.latestDay, "Actual fixture has no listening history");
    await cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    assert.deepEqual(
      await pulseFixtureSnapshot(source),
      before,
      "Source changed during copy",
    );
    assert.deepEqual(
      await pulseFixtureSnapshot(destination),
      before,
      "Copied SQLite/WAL/logical state differs from source",
    );
    return {
      snapshot: before,
      async assertUnchanged() {
        assert.deepEqual(
          await pulseFixtureSnapshot(source),
          before,
          "Source SQLite/WAL/logical state changed",
        );
      },
      close: () => owner.close(),
    };
  } catch (error) {
    owner.close();
    throw error;
  }
}

export function populatedDayOffset(maximum, lastDay, populatedDay) {
  const days = (Date.parse(lastDay) - Date.parse(populatedDay)) / 86400000;
  const offset = maximum - days;
  assert(Number.isSafeInteger(days) && days >= 0);
  assert(Number.isSafeInteger(offset) && offset >= 0 && offset <= maximum);
  return offset;
}
