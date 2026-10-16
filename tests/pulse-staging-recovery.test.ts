import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { recoverPulseStaging } from "../src/server/pulse-staging-recovery.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

const name = (n: number) =>
  `.pulse-${"a".repeat(64)}.png-00000000-0000-4000-8000-${String(n).padStart(12, "0")}.tmp`;

it("removes only exact owned empty/regular-image staging and preserves ambiguous entries", async () => {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data", "pulse-recovery-"));
  const directory = path.join(root, "pulse-covers");
  await mkdir(directory);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const empty = path.join(directory, name(1));
    const partial = path.join(directory, name(2));
    await mkdir(empty);
    await mkdir(partial);
    await writeFile(path.join(partial, "image"), "partial");
    const foreign = [
      "foreign.tmp",
      ".pulse-ambiguous.tmp",
      name(3).replace("-4000-", "-1000-"),
      "published.png.archive",
      name(4),
      name(5),
      name(6),
      name(7),
    ];
    for (const entry of foreign) await mkdir(path.join(directory, entry));
    await writeFile(path.join(directory, name(4), "unknown"), "preserve");
    await mkdir(path.join(directory, name(5), "image"));
    await writeFile(path.join(root, "target"), "outside");
    await link(
      path.join(root, "target"),
      path.join(directory, name(6), "image"),
    );
    await writeFile(path.join(directory, name(7), "image"), "known");
    await writeFile(path.join(directory, name(7), "extra"), "unknown");
    await writeFile(path.join(directory, name(8)), "flat");
    await writeFile(path.join(directory, "published.png"), "published");
    await recoverPulseStaging(root);
    expect(warn).toHaveBeenCalledWith(
      "Pulse staging recovery preserved 5 ambiguous entries",
      directory,
    );
    expect((await readdir(directory)).sort()).toEqual(
      [...foreign, name(8), "published.png"].sort(),
    );
    expect(await readFile(path.join(root, "target"), "utf8")).toBe("outside");
    await recoverPulseStaging(root);
    expect(await readFile(path.join(directory, name(7), "image"), "utf8")).toBe(
      "known",
    );
  } finally {
    warn.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it("does not follow directory junctions or image symlinks", async () => {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(
    path.resolve(".test-data", "pulse-recovery-links-"),
  );
  const directory = path.join(root, "pulse-covers");
  const outside = path.join(root, "outside");
  await mkdir(directory);
  await mkdir(outside);
  await writeFile(path.join(outside, "image"), "preserve");
  try {
    await symlink(outside, path.join(directory, name(1)), "junction");
    await mkdir(path.join(directory, name(2)));
    // Directory links are also invalid image content, and work without Windows
    // developer-mode privileges required for file symlinks.
    await symlink(outside, path.join(directory, name(2), "image"), "junction");
    await recoverPulseStaging(root);
    expect((await lstat(path.join(directory, name(1)))).isSymbolicLink()).toBe(
      true,
    );
    expect(await readFile(path.join(outside, "image"), "utf8")).toBe(
      "preserve",
    );
    await rm(directory, { recursive: true, force: true });
    await symlink(outside, directory, "junction");
    await recoverPulseStaging(root);
    expect(await readFile(path.join(outside, "image"), "utf8")).toBe(
      "preserve",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("bounds transient retries and reports persistent errors instead of hiding them", async () => {
  const failure = Object.assign(new Error("sharing violation"), {
    code: "EBUSY",
  });
  const spy = vi.mocked(fs.lstat).mockClear().mockRejectedValue(failure);
  try {
    await expect(recoverPulseStaging("unused")).rejects.toThrow(
      "sharing violation",
    );
    expect(spy).toHaveBeenCalledTimes(4);
  } finally {
    spy.mockRestore();
  }
});

it("accepts an absent archive directory", async () => {
  await expect(
    recoverPulseStaging(path.resolve(".test-data", "absent-pulse-recovery")),
  ).resolves.toBeUndefined();
});

it("retries a transient failure but does not retry permanent errors", async () => {
  const spy = vi.mocked(fs.lstat).mockClear();
  spy.mockRejectedValueOnce(
    Object.assign(new Error("busy"), { code: "EPERM" }),
  );
  await expect(
    recoverPulseStaging(path.resolve(".test-data", "absent-pulse-recovery")),
  ).resolves.toBeUndefined();
  expect(spy).toHaveBeenCalledTimes(2);
  spy.mockClear();
  spy.mockRejectedValueOnce(
    Object.assign(new Error("disk I/O"), { code: "EIO" }),
  );
  await expect(recoverPulseStaging("unused")).rejects.toThrow("disk I/O");
  expect(spy).toHaveBeenCalledTimes(1);
});
