import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { AutoScanScheduler } from "../dist/server/auto-scan-scheduler.js";
import type { MusicService } from "../src/server/service.js";

let root: string;

beforeEach(async () => {
  vi.useFakeTimers();
  root = await mkdtemp(path.resolve(".test-data", "auto-scan-"));
});

afterEach(async () => {
  vi.useRealTimers();
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});

describe("automatic scan scheduler", () => {
  it("runs immediately, reschedules, and fully disables automatic scans", async () => {
    const scan = vi.fn();
    const service = {
      dataDir: root,
      catalog: { libraries: () => [{ id: "library" }] },
      scan,
    } as unknown as MusicService;
    const scheduler = new AutoScanScheduler(service);

    await scheduler.update({ autoScanIntervalMinutes: 5 });
    expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(scan).toHaveBeenCalledTimes(2);

    await scheduler.update({ autoScanIntervalMinutes: 0 });
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(scan).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
