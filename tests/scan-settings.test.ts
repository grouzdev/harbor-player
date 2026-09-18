import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  readScanSettings,
  writeScanSettings,
} from "../dist/server/scan-settings.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.resolve(".test-data", "scan-settings-"));
});

afterEach(async () => {
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});

describe("scan settings storage", () => {
  it("uses five minutes when settings are absent or malformed", async () => {
    await expect(readScanSettings(root)).resolves.toEqual({
      autoScanIntervalMinutes: 5,
    });
    await writeFile(
      path.join(root, "scan-settings.json"),
      JSON.stringify({ autoScanIntervalMinutes: 1 }),
    );
    await expect(readScanSettings(root)).resolves.toEqual({
      autoScanIntervalMinutes: 5,
    });
  });

  it("persists an explicit disabled auto scan", async () => {
    await expect(
      writeScanSettings(root, { autoScanIntervalMinutes: 0 }),
    ).resolves.toEqual({ autoScanIntervalMinutes: 0 });
    await expect(readScanSettings(root)).resolves.toEqual({
      autoScanIntervalMinutes: 0,
    });
  });
});
