// Run after npm run build:server:
// node scripts/pulse-publication-crash-check.mjs
// Retains only its own generated fixture/evidence under .test-data.
import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  lstat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(project, ".test-data"), { recursive: true });
const root = await mkdtemp(
  path.join(project, ".test-data", "pulse-publication-crash-"),
);
let coverId = `${"a".repeat(64)}.png`;
const fixture = Buffer.alloc(1024 * 1024, 0x5a);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(path.join(root, "covers"));
await writeFile(path.join(root, "covers", coverId), fixture);
const directory = path.join(root, "pulse-covers");
await mkdir(directory);
// Canaries are intentionally foreign/ambiguous or already published. Nothing
// in this task claims authority to remove them, even after obtaining the lock.
const canaries = ["foreign.tmp", ".pulse-ambiguous.tmp", "published.png"];
for (const name of canaries)
  await writeFile(path.join(directory, name), `preserve:${name}`);
await mkdir(path.join(directory, "published.png.archive"));
await writeFile(
  path.join(directory, "published.png.archive", "image"),
  "preserve:archive",
);
const ambiguous = `.pulse-${"b".repeat(64)}.png-00000000-0000-4000-8000-000000000001.tmp`;
await mkdir(path.join(directory, ambiguous));
await writeFile(path.join(directory, ambiguous, "image"), "preserve:known");
await writeFile(path.join(directory, ambiguous, "unknown"), "preserve:unknown");
const linked = `.pulse-${"c".repeat(64)}.jpg-00000000-0000-4000-8000-000000000002.tmp`;
const outside = path.join(root, "outside");
await mkdir(outside);
await writeFile(path.join(outside, "image"), "preserve:link-target");
await symlink(outside, path.join(directory, linked), "junction");

const children = new Set();
const evidence = {
  status: "RUNNING",
  root,
  node: process.version,
  platform: process.platform,
  gitSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: project,
    encoding: "utf8",
  }).trim(),
  dirty: Boolean(
    execFileSync("git", ["--no-optional-locks", "status", "--porcelain"], {
      cwd: project,
      encoding: "utf8",
    }).trim(),
  ),
  sourceHashes: Object.fromEntries(
    await Promise.all(
      [
        "scripts/pulse-publication-crash-check.mjs",
        "scripts/pulse-publication-crash-worker.mjs",
        "src/server/pulse.ts",
        "src/server/service.ts",
        "src/server/instance-lock.ts",
        "src/server/pulse-staging-recovery.ts",
        "dist/server/pulse.js",
        "dist/server/service.js",
        "dist/server/instance-lock.js",
        "dist/server/pulse-staging-recovery.js",
      ].map(async (file) => [
        file,
        hash(await readFile(path.join(project, file))),
      ]),
    ),
  ),
  executableSha256: hash(await readFile(process.execPath)),
  productionPulseSha256: hash(
    await readFile(path.join(project, "dist/server/pulse.js")),
  ),
  fixtureKind: "synthetic bytes; no image decoding assertion",
  copyAdapter: "real chunked copy paused after fsync of first 65536 bytes",
  recovery: "startup under lifetime ownership, before ingest",
  cycles: [],
};
function start(mode, cycle) {
  const child = fork(
    new URL("./pulse-publication-crash-worker.mjs", import.meta.url),
    [root, mode, coverId, String(cycle)],
    { cwd: project, stdio: ["ignore", "inherit", "inherit", "ipc"] },
  );
  children.add(child);
  const messages = [];
  child.on("message", (message) => messages.push(message));
  const exit = once(child, "exit").then(([code, signal]) => {
    children.delete(child);
    return { code, signal };
  });
  return { child, messages, exit };
}
async function waitFor(worker, type) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const message = worker.messages.find((entry) => entry.type === type);
    if (message) return message;
    assert.equal(worker.child.exitCode, null, `Worker exited before ${type}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${type}`);
}
const timeout = setTimeout(() => {
  for (const child of children) child.kill("SIGKILL");
}, 90000);
try {
  for (let cycle = 0; cycle < 3; cycle++) {
    coverId = `${String(cycle + 1).repeat(64)}.png`;
    await writeFile(path.join(root, "covers", coverId), fixture);
    const interrupted = start("copy", cycle);
    const partial = await waitFor(interrupted, "partial");
    const staging = path.basename(path.dirname(partial.destination));
    assert.match(
      staging,
      /^\.pulse-[a-f0-9]{64}\.(jpg|png)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/,
    );
    assert.equal(
      partial.destination,
      path.join(directory, staging, "image"),
      "Only inspect the generated owned staging path",
    );
    assert.equal((await stat(partial.destination)).size, 65536);
    assert.ok(partial.bytes < fixture.length);
    assert.ok(!(await readdir(directory)).includes(`${coverId}.archive`));
    assert.ok(!interrupted.messages.some((message) => message.type === "ack"));
    assert.ok(interrupted.child.kill("SIGKILL"));
    evidence.killed = await interrupted.exit;
    assert.deepEqual(evidence.killed, { code: null, signal: "SIGKILL" });
    assert.equal((await stat(partial.destination)).size, partial.bytes);

    const restarted = start("restart", cycle);
    const acknowledged = await waitFor(restarted, "ack");
    assert.ok(
      restarted.messages.some((message) => message.type === "before-retry"),
    );
    assert.deepEqual(await restarted.exit, { code: 0, signal: null });
    assert.equal(acknowledged.playedMs, 15000);
    assert.equal(acknowledged.dayPlayedMs, (cycle + 1) * 15000);
    assert.deepEqual(acknowledged.accepted, acknowledged.duplicate);
    assert.equal(hash(await readFile(acknowledged.archive)), hash(fixture));
    await assert.rejects(stat(path.join(directory, staging)), {
      code: "ENOENT",
    });
    assert.deepEqual(
      (await readdir(directory))
        .filter((name) => /^\.pulse-[a-f0-9]{64}\.(jpg|png)-/.test(name))
        .sort(),
      [ambiguous, linked].sort(),
      "No generated owned orphan may accumulate across restart cycles",
    );
    for (const name of canaries)
      assert.equal(
        await readFile(path.join(directory, name), "utf8"),
        `preserve:${name}`,
      );
    assert.equal(
      await readFile(
        path.join(directory, "published.png.archive", "image"),
        "utf8",
      ),
      "preserve:archive",
    );
    assert.equal(
      await readFile(path.join(directory, ambiguous, "image"), "utf8"),
      "preserve:known",
    );
    assert.equal(
      await readFile(path.join(directory, ambiguous, "unknown"), "utf8"),
      "preserve:unknown",
    );
    assert.ok((await lstat(path.join(directory, linked))).isSymbolicLink());
    assert.equal(
      await readFile(path.join(outside, "image"), "utf8"),
      "preserve:link-target",
    );
    evidence.cycles.push({
      cycle,
      killed: evidence.killed,
      partialBytes: partial.bytes,
      sourceBytes: fixture.length,
      sourceSha256: hash(fixture),
      archiveSha256: hash(await readFile(acknowledged.archive)),
      orphanStagingRemoved: staging,
      noAckBeforeKill: true,
      noListeningCommitBeforeRetry: true,
      duplicatePlayedMs: acknowledged.playedMs,
      canariesPreserved: true,
    });
  }
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  evidence.error = String(error.stack ?? error);
  throw error;
} finally {
  clearTimeout(timeout);
  for (const child of children) child.kill("SIGKILL");
  await writeFile(
    path.join(root, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(`Publication crash evidence: ${root}`);
}
