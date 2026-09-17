import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dataDirectory,
  migrateLegacyDataDirectory,
} from "../src/shared/app-paths.js";

let root: string | undefined;
const originalDataDirectory = process.env.HARBOR_PLAYER_DATA_DIR;

afterEach(async () => {
  if (originalDataDirectory === undefined) delete process.env.HARBOR_PLAYER_DATA_DIR;
  else process.env.HARBOR_PLAYER_DATA_DIR = originalDataDirectory;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("Harbor Player data directory", () => {
  it("moves the legacy data directory when the new location is empty", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "harbor-player-paths-"));
    const legacy = path.join(root, "MyMusicLib");
    const target = path.join(root, "Harbor Player");
    await mkdir(legacy);
    await writeFile(path.join(legacy, "catalog.db"), "catalog");

    migrateLegacyDataDirectory(target, legacy);

    expect(existsSync(legacy)).toBe(false);
    await expect(readFile(path.join(target, "catalog.db"), "utf8")).resolves.toBe("catalog");
  });

  it("leaves legacy data in place when Harbor Player already has data", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "harbor-player-paths-"));
    const legacy = path.join(root, "MyMusicLib");
    const target = path.join(root, "Harbor Player");
    await Promise.all([mkdir(legacy), mkdir(target)]);

    migrateLegacyDataDirectory(target, legacy);

    expect(existsSync(legacy)).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it("uses an explicit data directory without attempting a migration", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "harbor-player-paths-"));
    const custom = path.join(root, "custom-data");
    process.env.HARBOR_PLAYER_DATA_DIR = custom;

    expect(dataDirectory()).toBe(custom);
  });
});
