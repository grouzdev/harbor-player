import { fork, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, test } from "vitest";
import { acquireInstanceLock } from "../src/server/instance-lock.js";

const children: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null)
            return resolve();
          child.once("exit", () => resolve());
          child.kill("SIGKILL");
        }),
    ),
  );
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harbor-lock-"));
  dirs.push(dir);
  return dir;
}
function contender(dir: string, gate?: string) {
  const child = fork(
    "scripts/instance-lock-worker.mjs",
    [dir, ...(gate ? [gate] : [])],
    { stdio: ["ignore", "inherit", "inherit", "ipc"] },
  );
  children.push(child);
  const messages: { event: string; message?: string }[] = [];
  child.on("message", (message) =>
    messages.push(message as (typeof messages)[number]),
  );
  return {
    child,
    async next() {
      const until = Date.now() + 10000;
      while (!messages.length) {
        if (Date.now() > until) throw new Error("worker barrier timed out");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return messages.shift()!;
    },
  };
}

test("two stale contenders cannot unlink a newly acquired generation", async () => {
  const dir = directory();
  const legacy = JSON.stringify({ pid: 2147483647, token: "stale" });
  writeFileSync(path.join(dir, "server.lock"), legacy);
  const a = contender(dir, path.join(dir, "a.go"));
  const b = contender(dir, path.join(dir, "b.go"));
  const [firstA, firstB] = await Promise.all([a.next(), b.next()]);
  // On the vulnerable implementation both reach the stale-PID barrier.
  // Release A, then B, so B deterministically deletes A's live lock.
  if (firstA.event === "stale" && firstB.event === "stale") {
    writeFileSync(path.join(dir, "a.go"), "");
    expect((await a.next()).event).toBe("owned");
    writeFileSync(path.join(dir, "b.go"), "");
    expect((await b.next()).event).toBe("denied");
  } else {
    expect(firstA.event).toBe("denied");
    expect(firstB.event).toBe("denied");
    expect(readFileSync(path.join(dir, "server.lock"), "utf8")).toBe(legacy);
  }
});

test("live owner excludes contenders; crash releases ownership; old release is harmless", async () => {
  const dir = directory();
  const a = contender(dir);
  expect((await a.next()).event).toBe("owned");
  const b = contender(dir);
  expect((await b.next()).event).toBe("denied");
  a.child.send("release");
  expect((await a.next()).event).toBe("released");
  const c = contender(dir);
  expect((await c.next()).event).toBe("owned");
  a.child.send("release");
  expect((await a.next()).event).toBe("released");
  const d = contender(dir);
  expect((await d.next()).event).toBe("denied");
  await new Promise<void>((resolve) => {
    c.child.once("exit", () => resolve());
    c.child.kill("SIGKILL");
  });
  const e = contender(dir);
  expect((await e.next()).event).toBe("owned");
});

test("same-process failed acquisition does not release the current owner", async () => {
  const dir = directory();
  const release = acquireInstanceLock(dir);
  try {
    expect(() => acquireInstanceLock(dir)).toThrow("уже запущен");
    const other = contender(dir);
    expect((await other.next()).event).toBe("denied");
  } finally {
    release();
    release();
  }
});

test.each([
  "",
  "{",
  '{"pid":1}',
  '{"pid":2147483647}',
  '{"protocol":"unknown"}',
])("fails closed and preserves ambiguous legacy content %j", (content) => {
  const dir = directory();
  const file = path.join(dir, "server.lock");
  writeFileSync(file, content);
  expect(() => acquireInstanceLock(dir)).toThrow(
    "Автоматический takeover запрещён",
  );
  expect(readFileSync(file, "utf8")).toBe(content);
});

test("persistent guard rejects the legacy PID protocol after release", () => {
  const dir = directory();
  acquireInstanceLock(dir)();
  const guard = JSON.parse(readFileSync(path.join(dir, "server.lock"), "utf8"));
  expect(Number.isSafeInteger(guard.pid) && guard.pid > 0).toBe(false);
  acquireInstanceLock(dir)();
});

test("access and corrupt ownership errors never permit acquisition", () => {
  const dir = directory();
  writeFileSync(path.join(dir, "server-ownership.sqlite"), "not a database");
  expect(() => acquireInstanceLock(dir)).toThrow();
  expect(readFileSync(path.join(dir, "server-ownership.sqlite"), "utf8")).toBe(
    "not a database",
  );
});

test("unreadable marker fails closed without removing it", () => {
  const dir = directory();
  mkdirSync(path.join(dir, "server.lock"));
  expect(() => acquireInstanceLock(dir)).toThrow();
});

test("WAL ownership files are rejected without creating a protocol marker", () => {
  const dir = directory();
  const file = path.join(dir, "server-ownership.sqlite");
  const db = new Database(file);
  db.pragma("journal_mode = wal");
  db.exec("CREATE TABLE probe (id INTEGER)");
  db.close();
  expect(() => acquireInstanceLock(dir)).toThrow("Неожиданный journal_mode");
  expect(() => readFileSync(path.join(dir, "server.lock"))).toThrow();
  const check = new Database(file);
  try {
    expect(check.pragma("journal_mode", { simple: true })).toBe("wal");
  } finally {
    check.close();
  }
});

test("barrier-released simultaneous starts have exactly one owner", async () => {
  const dir = directory();
  const peers = Array.from({ length: 6 }, () => contender(dir, "start"));
  expect(
    await Promise.all(peers.map(async (peer) => (await peer.next()).event)),
  ).toEqual(Array(6).fill("ready"));
  for (const peer of peers) peer.child.send("start");
  const outcomes = await Promise.all(peers.map((peer) => peer.next()));
  expect(
    outcomes.filter(({ event }) => event === "owned"),
    JSON.stringify(outcomes),
  ).toHaveLength(1);
  expect(
    outcomes.filter(({ event }) => event === "denied"),
    JSON.stringify(outcomes),
  ).toHaveLength(5);
});

test("brief initialization readers do not make every contender report a live owner", async () => {
  const dir = directory();
  const reader = new Database(path.join(dir, "server-ownership.sqlite"));
  reader.exec("CREATE TABLE probe (id INTEGER)");
  const peers = Array.from({ length: 6 }, () => contender(dir, "start"));
  let close: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(
      await Promise.all(peers.map(async (peer) => (await peer.next()).event)),
    ).toEqual(Array(6).fill("ready"));
    // SQLite takes short SHARED locks while initializing connections. Model a
    // slower reader without any actual service owner, then release it.
    reader.exec("BEGIN; SELECT * FROM probe");
    for (const peer of peers) peer.child.send("start");
    close = setTimeout(() => reader.close(), 150);
    const outcomes = await Promise.all(peers.map((peer) => peer.next()));
    expect(
      outcomes.filter(({ event }) => event === "owned"),
      JSON.stringify(outcomes),
    ).toHaveLength(1);
    expect(
      outcomes.filter(({ event }) => event === "denied"),
      JSON.stringify(outcomes),
    ).toHaveLength(5);
  } finally {
    clearTimeout(close);
    if (reader.open) reader.close();
  }
});

test.each(["before-marker", "partial-marker"])(
  "crash at %s releases OS ownership without unsafe cleanup",
  async (point) => {
    const dir = directory();
    const a = contender(dir, point);
    expect((await a.next()).event).toBe("marker-barrier");
    const b = contender(dir);
    expect((await b.next()).event).toBe("denied");
    await new Promise<void>((resolve) => {
      a.child.once("exit", () => resolve());
      a.child.kill("SIGKILL");
    });
    const c = contender(dir);
    expect((await c.next()).event).toBe(
      point === "before-marker" ? "owned" : "denied",
    );
    if (point === "partial-marker")
      expect(readFileSync(path.join(dir, "server.lock"), "utf8")).toBe("{");
  },
);
