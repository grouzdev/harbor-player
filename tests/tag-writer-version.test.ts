import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

async function fixture(version: unknown) {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data", "writer-version-"));
  const dependency = path.join(
    root,
    "node_modules",
    "@digimezzo",
    "node-taglib-sharp",
  );
  const worktree = path.join(root, "worktree", "dist", "server");
  await mkdir(dependency, { recursive: true });
  await mkdir(worktree, { recursive: true });
  await writeFile(
    path.join(dependency, "package.json"),
    JSON.stringify({ version }),
  );
  await writeFile(
    path.join(root, "worktree", "package.json"),
    JSON.stringify({ type: "module" }),
  );
  const module = path.join(worktree, "tag-writer-version.js");
  await copyFile("dist/server/tag-writer-version.js", module);
  return {
    root,
    readVersion: () =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `const { installedTagWriterVersion } = await import(${JSON.stringify(pathToFileURL(module).href)}); console.log(await installedTagWriterVersion());`,
        ],
        { cwd: path.join(root, "worktree"), encoding: "utf8", stdio: "pipe" },
      ).trim(),
  };
}

it("reads the actual ancestor dependency without a worktree-local node_modules", async () => {
  const { root, readVersion } = await fixture("7.8.9");
  try {
    expect(readVersion()).toBe("7.8.9");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects package metadata without a version rather than allowing an unknown writer", async () => {
  const { root, readVersion } = await fixture(undefined);
  try {
    expect(readVersion).toThrow("Не удалось определить версию");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
