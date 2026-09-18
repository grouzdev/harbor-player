import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Workers } from "../dist/server/workers.js";

let root: string | undefined;
let workers: Workers | undefined;

afterEach(async () => {
  await workers?.close();
  workers = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("worker protocol", () => {
  it("returns typed hash results through the worker boundary", async () => {
    root = await mkdtemp(path.resolve(".test-data", "workers-"));
    const file = path.join(root, "sample.bin");
    await writeFile(file, "harbor");
    workers = new Workers(1);

    await expect(workers.run("hash", { file })).resolves.toBe(
      "c1d64b2d4cb30f1be788cc4d246ddd9fc1fe85a3eb3a85a3de33829dfaf6ce7d",
    );
  });
});
