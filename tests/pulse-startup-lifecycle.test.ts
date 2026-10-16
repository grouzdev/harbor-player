import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import cookie from "@fastify/cookie";
import { createApp } from "../src/server/app.js";
import { MusicService } from "../src/server/service.js";
import { acquireInstanceLock } from "../src/server/instance-lock.js";
import { recoverPulseStaging } from "../src/server/pulse-staging-recovery.js";

vi.mock("../src/server/pulse-staging-recovery.js", () => ({
  recoverPulseStaging: vi.fn(async () => {}),
}));

vi.mock("@fastify/cookie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fastify/cookie")>();
  return { ...actual, default: vi.fn(actual.default) };
});

afterEach(() => {
  vi.mocked(recoverPulseStaging).mockReset();
  vi.mocked(cookie).mockClear();
});

async function fixture() {
  await mkdir(".test-data", { recursive: true });
  return mkdtemp(path.resolve(".test-data", "pulse-startup-"));
}

it("failed API initialization closes the service and releases ownership", async () => {
  const root = await fixture();
  const failure = new Error("recovery disk failure");
  vi.mocked(recoverPulseStaging).mockRejectedValueOnce(failure);
  try {
    await expect(createApp({ dataDir: root })).rejects.toBe(failure);
    const release = acquireInstanceLock(root);
    release();
    const { app } = await createApp({ dataDir: root });
    await app.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("plugin boot failure after initialization releases ownership too", async () => {
  const root = await fixture();
  const failure = new Error("cookie plugin failed");
  vi.mocked(cookie).mockImplementationOnce(async () => {
    throw failure;
  });
  try {
    await expect(createApp({ dataDir: root })).rejects.toBe(failure);
    expect(recoverPulseStaging).toHaveBeenCalledTimes(1);
    const release = acquireInstanceLock(root);
    release();
    const { app } = await createApp({ dataDir: root });
    await app.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("repeated initialization cannot sweep copies created after startup", async () => {
  const root = await fixture();
  const service = new MusicService(root);
  try {
    const initializing = service.initialize();
    expect(service.initialize()).toBe(initializing);
    await initializing;
    const covers = path.join(root, "pulse-covers");
    await mkdir(covers);
    await writeFile(path.join(covers, "live-copy"), "preserve");
    // The recovery promise, not merely a flag after awaiting it, is cached.
    await service.initialize();
    expect(recoverPulseStaging).toHaveBeenCalledTimes(1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("shutdown retains ownership until recovery settles and stops initialization", async () => {
  const root = await fixture();
  let finish!: () => void;
  vi.mocked(recoverPulseStaging).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const service = new MusicService(root);
  const initializing = service.initialize();
  const result = expect(initializing).rejects.toThrow("Сервис останавливается");
  const closing = service.close();
  try {
    expect(() => acquireInstanceLock(root)).toThrow("уже запущен");
    finish();
    await result;
    await closing;
    const release = acquireInstanceLock(root);
    release();
    await expect(service.initialize()).rejects.toThrow(
      "Сервис останавливается",
    );
  } finally {
    finish();
    await closing;
    await rm(root, { recursive: true, force: true });
  }
});
