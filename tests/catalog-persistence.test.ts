import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { Catalog } from "../dist/server/database.js";

let root: string | undefined;
let catalog: Catalog | undefined;

afterEach(async () => {
  catalog?.close();
  catalog = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("persisted catalog records", () => {
  it("ignores malformed jobs and refuses a malformed operation", async () => {
    root = await mkdtemp(path.resolve(".test-data", "catalog-"));
    catalog = new Catalog(root);
    const db = (catalog as unknown as { db: Database.Database }).db;
    db.prepare("INSERT INTO jobs VALUES (?,?)").run("broken-job", "{");
    db.prepare("INSERT INTO operations VALUES (?,?,?)").run(
      "broken-operation",
      "2026-09-18T00:00:00.000Z",
      "{}",
    );

    expect(catalog.jobs()).toEqual([]);
    expect(catalog.history()).toEqual([]);
    expect(() => catalog!.operation("broken-operation")).toThrow("повреждена");
  });
});
