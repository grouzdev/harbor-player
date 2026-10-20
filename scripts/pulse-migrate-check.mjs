import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { Catalog } from "../dist/server/database.js";
import { catalogSchemaVersion } from "../dist/server/catalog-migrations.js";

// Read the supplied database only. SQLite's backup API includes committed WAL
// data. Migration runs exclusively on a disposable copy, never on the source.
// No library paths, tags, playlist contents or queue data enter the report/Git.
const source = process.argv[2];
assert(
  source,
  "Usage: npm run build:server && node scripts/pulse-migrate-check.mjs <v12 catalog.sqlite>",
);
const testRoot = path.resolve(".test-data");
await mkdir(testRoot, { recursive: true });
const root = await mkdtemp(path.join(testRoot, "pulse-real-v12-"));
const copy = path.join(root, "data");
await mkdir(copy);
const tables = (db) =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'pulse_%' AND name != 'operation_history_hidden' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
const digest = (db) => {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify(
      db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name NOT LIKE 'pulse_%' AND tbl_name != 'operation_history_hidden' ORDER BY type,name",
        )
        .all(),
    ),
  );
  for (const table of tables(db)) {
    hash.update(table);
    const escaped = table.replaceAll('"', '""');
    for (const row of db
      .prepare(`SELECT * FROM "${escaped}" ORDER BY rowid`)
      .iterate())
      hash.update(JSON.stringify(row));
  }
  return hash.digest("hex");
};
const integrity = (db) => {
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
};
let reader;
try {
  reader = new Database(path.resolve(source), {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    reader.pragma("user_version", { simple: true }),
    12,
    "Expected a genuine v12 database; never lower user_version to make this check pass",
  );
  await reader.backup(path.join(copy, "catalog.sqlite"));
  reader.close();
  reader = undefined;
  const baseline = new Database(path.join(copy, "catalog.sqlite"), {
    readonly: true,
  });
  let before;
  try {
    integrity(baseline);
    before = digest(baseline);
    for (const required of ["libraries", "playlists", "queues"]) {
      assert(
        tables(baseline).includes(required),
        `Missing v12 table ${required}`,
      );
      assert(
        baseline.prepare(`SELECT count(*) n FROM "${required}"`).get().n > 0,
        `Expected populated ${required} in the genuine v12 snapshot`,
      );
    }
  } finally {
    baseline.close();
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const catalog = new Catalog(copy);
    try {
      // Independent connection ensures the persisted schema is checked, not
      // a cached in-memory response from the migrating Catalog.
      const db = new Database(path.join(copy, "catalog.sqlite"), {
        readonly: true,
      });
      try {
        assert.equal(
          db.pragma("user_version", { simple: true }),
          catalogSchemaVersion,
        );
        assert.deepEqual(
          db.prepare("SELECT * FROM operation_history_hidden").all(),
          [],
        );
        integrity(db);
        assert.equal(
          digest(db),
          before,
          "Catalog schema/data changed during migration",
        );
        const settings = catalog.pulse.settings();
        assert.equal(settings.historyGeneration, 1);
        assert.equal(settings.enabled, true);
      } finally {
        db.close();
      }
    } finally {
      catalog.close();
    }
  }
  const report = {
    check: "real-v12-copy-migration",
    sourceVersion: 12,
    migratedVersion: catalogSchemaVersion,
    catalogRowsAndSchemaUnchanged: true,
    integrityAndForeignKeys: true,
    repeatedOpen: true,
    originalOpenedReadOnly: true,
    audioPlaybackChecked: false,
  };
  await writeFile(
    path.join(root, "evidence.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  reader?.close();
  // Private database copies are never retained with shareable evidence.
  assert(root.startsWith(`${testRoot}${path.sep}`), "Unsafe cleanup path");
  await rm(copy, { recursive: true, force: true });
}
