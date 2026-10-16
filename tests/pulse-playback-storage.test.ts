import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { migratePulse } from "../src/server/pulse-migration";
import { playbackStorage } from "../scripts/pulse-playback-storage.mjs";

test("storage samples retain exact ledger/aggregates, sizes and staging", async () => {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data/pulse-storage-unit-"));
  const db = new Database(path.join(root, "catalog.sqlite"));
  try {
    db.pragma("journal_mode = WAL");
    migratePulse(db);
    db.exec(`
      INSERT INTO pulse_albums VALUES ('a','{}'),('b','{}');
      INSERT INTO pulse_intervals VALUES ('actual',1,'a','{"playedMs":1234}',0,
        '[{"dayKey":"2025-01-01","playedMs":1234}]');
      INSERT INTO pulse_days VALUES ('2025-01-01',1234,1,1234);
      INSERT INTO pulse_day_albums VALUES ('2025-01-01','a',1234,0,1234,1);
      INSERT INTO pulse_album_stats VALUES ('a',1234,1,0,0,1234);
      INSERT INTO pulse_day_visits VALUES ('2025-01-01','a','visit');
    `);
    const covers = path.join(root, "pulse-covers");
    await mkdir(covers);
    await writeFile(path.join(covers, `${"a".repeat(64)}.png`), "abc");
    await mkdir(path.join(covers, ".pulse-test"));
    const sample = await playbackStorage(db, root, "final");
    assert(
      sample.databaseObjects.some(
        (item) => item.name === "pulse_intervals_start" && item.bytes > 0,
      ),
    );
    const image = Buffer.from("exact original");
    const hash = createHash("sha256").update(image).digest("hex");
    const archive = path.join(covers, `${hash}.png.archive`);
    await mkdir(archive);
    await writeFile(path.join(archive, "image"), image);
    const archived = await playbackStorage(db, root, "archived");
    assert.deepEqual(archived.archiveHashes, [
      { id: `${hash}.png`, bytes: image.length, sha256: hash },
    ]);
    await writeFile(path.join(archive, "image"), "corrupt");
    await assert.rejects(playbackStorage(db, root, "corrupt"), /archive hash/);
    await rm(archive, { recursive: true });
    assert.equal(sample.expectedMs, 1234);
    assert.equal(sample.ledger.length, 1);
    assert.equal(sample.visits.length, 1);
    assert(sample.files["catalog.sqlite"] > 0);
    assert(sample.files["catalog.sqlite-wal"] > 0);
    assert.deepEqual(sample.covers, { count: 1, bytes: 3, stagingEntries: 1 });
    for (const table of [
      "pulse_days",
      "pulse_day_albums",
      "pulse_album_stats",
    ]) {
      assert.equal(sample.aggregates[table].playedMs, 1234);
      db.exec(`UPDATE ${table} SET playedMs=1235`);
      await assert.rejects(playbackStorage(db, root, "bad"), new RegExp(table));
      db.exec(`UPDATE ${table} SET playedMs=1234`);
    }
    // Preserve every global total and day total, but allocate the listen to
    // the wrong album. Only ledger contribution correspondence catches this.
    db.exec("UPDATE pulse_day_albums SET albumId='b'");
    await assert.rejects(
      playbackStorage(db, root, "misallocated"),
      /Every day\/album/,
    );
    db.exec("UPDATE pulse_day_albums SET albumId='a'");
    // Missing required aggregate plus an orphan can preserve the global sum.
    // SQL `playedMs != NULL` does not detect this; compare symmetric key sets.
    for (const [table, key, original, orphan] of [
      ["pulse_days", "dayKey", "2025-01-01", "2099-01-01"],
      ["pulse_album_stats", "albumId", "a", "b"],
    ]) {
      db.prepare(`UPDATE ${table} SET ${key}=?`).run(orphan);
      await assert.rejects(
        playbackStorage(db, root, "orphan"),
        new RegExp(`exact ${table}`),
      );
      db.prepare(`UPDATE ${table} SET ${key}=?`).run(original);
    }
    // The logical database can exist independently of the sampled directory.
    const missing = await playbackStorage(
      db,
      path.join(root, "absent"),
      "missing",
    );
    assert.deepEqual(missing.files, {
      "catalog.sqlite": null,
      "catalog.sqlite-wal": null,
      "catalog.sqlite-shm": null,
    });
    assert.deepEqual(missing.covers, { count: 0, bytes: 0, stagingEntries: 0 });
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
