import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { acquireInstanceLock } from "../src/server/instance-lock.js";

// Exercise built production modules in a real process. No forced process.exit:
// leaked workers keep the child alive and fail the bounded execFile check.
const child = String.raw`
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { Catalog } from "./dist/server/database.js";
import { MusicService } from "./dist/server/service.js";
import { Workers } from "./dist/server/workers.js";
import { acquireInstanceLock } from "./dist/server/instance-lock.js";
const [root, fault] = process.argv.slice(1);
// Worker threads must not inherit the eval/input-type arguments of this driver.
process.execArgv = [];
const seed = new Catalog(root);
const job = { id: "job", kind: "scan", label: "preserve", status: "running",
  completed: 1, total: 7, errors: ["existing"], createdAt: "2026-01-01" };
const operation = { id: "operation", kind: "move", status: "running",
  createdAt: "2026-01-01", items: [] };
seed.saveJob(job);
seed.saveOperation(operation);
seed.close();
if (fault === "shutdown") {
  let service = new MusicService(root);
  const pool = service.workers;
  const close = pool.close;
  const failure = new Error("termination unknown on shutdown");
  pool.close = async () => { throw failure; };
  await assert.rejects(service.close(), error => error === failure);
  await assert.rejects(service.close(), error => error === failure);
  service = undefined;
  global.gc();
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => acquireInstanceLock(root), /уже запущен/);
  // Only the driver can prove termination here. The failed owner deliberately
  // has no automatic retry/release; recovery is process shutdown.
  await close.call(pool);
  console.log("retained safely");
} else {
const failure = new Error("injected " + fault);
const originalClose = Catalog.prototype.close;
let closed = 0;
Catalog.prototype.close = function () { closed++; return originalClose.call(this); };
const originalStart = Workers.prototype.start;
let started = 0;
Workers.prototype.start = function (count) {
  started += count;
  return originalStart.call(this, count);
};
let restore = () => {};
let failedCatalog;
if (["jobs", "history", "saveJob", "saveOperation"].includes(fault)) {
  const original = Catalog.prototype[fault];
  Catalog.prototype[fault] = function () { throw failure; };
  restore = () => { Catalog.prototype[fault] = original; };
} else if (fault === "catalog") {
  const original = Catalog.prototype.clearExpiredHttpCache;
  Catalog.prototype.clearExpiredHttpCache = function () {
    failedCatalog = this;
    throw failure;
  };
  restore = () => { Catalog.prototype.clearExpiredHttpCache = original; };
} else if (fault === "options") {
  // A fallible constructor after Catalog but before workers.
} else {
  const workerModule = createRequire(import.meta.url)("node:worker_threads");
  const OriginalWorker = workerModule.Worker;
  let creations = 0;
  workerModule.Worker = class extends OriginalWorker {
    constructor(...args) {
      if (++creations === 2) throw failure;
      super(...args);
    }
  };
  syncBuiltinESMExports();
  restore = () => {
    assert.equal(creations, 2);
    workerModule.Worker = OriginalWorker;
    syncBuiltinESMExports();
  };
}
let finish;
const originalWorkerClose = Workers.prototype.close;
if (fault === "spawn" || fault === "termination") {
  Workers.prototype.close = async function () {
    await new Promise(resolve => { finish = resolve; });
    if (fault === "termination") throw new Error("unknown termination");
    await originalWorkerClose.call(this);
  };
}
let pool;
if (fault === "termination") {
  const start = Workers.prototype.start;
  Workers.prototype.start = function (count) { pool = this; return start.call(this, count); };
}
const options = fault === "options" ? { get fetch() { throw failure; } } : {};
assert.throws(() => new MusicService(root, options), error => error === failure);
restore();
if (fault === "spawn" || fault === "termination") {
  assert.equal(closed, 0);
  assert.throws(() => acquireInstanceLock(root), /уже запущен/);
  finish();
  if (fault === "termination") {
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, 0);
    assert.throws(() => acquireInstanceLock(root), /уже запущен/);
    // Test-only verified termination. Production deliberately retains ownership
    // when termination is unknown; process death then releases the OS lock.
    await originalWorkerClose.call(pool);
    console.log("retained safely");
  } else {
    for (let i = 0; closed === 0 && i < 200; i++)
      await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(closed, 1);
  }
} else {
  assert.equal(closed, fault === "catalog" ? 0 : 1);
  if (fault === "catalog") assert.equal(failedCatalog.db.open, false);
  assert.equal(started, 0);
}
if (fault !== "termination") {
  // Reads/writes may have completed earlier idempotent transitions, but must
  // never reset or lose the source records or append interruption twice.
  const inspect = new Catalog(root);
  const storedJob = inspect.jobs()[0];
  assert.deepEqual(storedJob, ["catalog", "jobs", "history", "saveJob"].includes(fault)
    ? job : { ...job, status: "error",
      errors: [...job.errors, "Работа прервана остановкой сервиса"] });
  assert.deepEqual(inspect.history(), [{
    ...operation, status: ["options", "spawn"].includes(fault) ? "interrupted" : "running"
  }]);
  inspect.close();
  Workers.prototype.start = originalStart;
  Workers.prototype.close = originalWorkerClose;
  const next = new MusicService(root);
  const recoveredJob = next.catalog.jobs()[0];
  assert.deepEqual(recoveredJob, { ...job, status: "error",
    errors: [...job.errors, "Работа прервана остановкой сервиса"] });
  assert.deepEqual(next.catalog.history(), [{ ...operation, status: "interrupted" }]);
  await next.close();
  const release = acquireInstanceLock(root);
  release();
  console.log("restarted safely");
}
}
`;

it.each([
  "jobs",
  "history",
  "saveJob",
  "saveOperation",
  "catalog",
  "options",
  "spawn",
  "termination",
  "shutdown",
])(
  "constructor rollback survives %s failure in a real child",
  async (fault) => {
    await mkdir(".test-data", { recursive: true });
    const root = await mkdtemp(path.resolve(".test-data", "constructor-"));
    try {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        ["--expose-gc", "--input-type=module", "--eval", child, root, fault],
        { timeout: 15000 },
      );
      expect(stdout).toContain(
        ["termination", "shutdown"].includes(fault)
          ? "retained safely"
          : "restarted safely",
      );
      if (fault === "termination")
        expect(stderr).toContain("Startup rollback failed; ownership retained");
      else expect(stderr).toBe("");
      // Even fail-closed owners are recoverable after actual process shutdown.
      const release = acquireInstanceLock(root);
      release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
