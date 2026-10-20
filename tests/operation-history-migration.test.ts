import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { Catalog } from "../dist/server/database.js";
import {
  catalogSchemaVersion,
  runCatalogMigrations,
} from "../dist/server/catalog-migrations.js";

it("upgrades v13 without changing operations and rolls back a failed history migration", () => {
  mkdirSync(".test-data", { recursive: true });
  const root = mkdtempSync(path.resolve(".test-data", "history-migration-"));
  const catalog = new Catalog(root);
  catalog.close();
  const db = new Database(path.join(root, "catalog.sqlite"));
  try {
    db.exec("DROP TABLE operation_history_hidden");
    db.pragma("user_version = 13");
    db.prepare("INSERT INTO operations VALUES (?,?,?)").run(
      "original",
      "2026-01-01",
      '{"original":true}',
    );
    const baseline = db.prepare("SELECT * FROM operations").all();
    const exec = db.exec.bind(db);
    db.exec = ((sql: string) => {
      const result = exec(sql);
      if (sql.includes("CREATE TABLE IF NOT EXISTS operation_history_hidden"))
        throw new Error("injected history migration failure");
      return result;
    }) as typeof db.exec;
    expect(() => runCatalogMigrations(db)).toThrow(
      "injected history migration failure",
    );
    expect(db.pragma("user_version", { simple: true })).toBe(13);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='operation_history_hidden'",
        )
        .all(),
    ).toEqual([]);
    expect(db.prepare("SELECT * FROM operations").all()).toEqual(baseline);
    db.exec = exec;
    for (let attempt = 0; attempt < 2; attempt++) {
      runCatalogMigrations(db);
      expect(db.pragma("user_version", { simple: true })).toBe(
        catalogSchemaVersion,
      );
      expect(
        db.prepare("SELECT * FROM operation_history_hidden").all(),
      ).toEqual([]);
      expect(db.prepare("SELECT * FROM operations").all()).toEqual(baseline);
      expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
