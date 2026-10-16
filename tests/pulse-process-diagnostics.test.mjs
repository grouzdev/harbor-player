import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  captureCheckpointFailure,
  observeRequests,
  sqliteProbe,
} from "../scripts/pulse-process-diagnostics.mjs";

const never = () => new Promise(() => {});
async function ownedFile() {
  await mkdir(".test-data", { recursive: true });
  const dir = await mkdtemp(path.resolve(".test-data/pulse-diagnostics-"));
  return path.join(dir, "checkpoint-failure.json");
}

test("deadline preserves partial results, original cause, stable IDs and removes listeners", async () => {
  const context = new EventEmitter();
  const observer = observeRequests(context);
  const first = {};
  const second = {};
  assert.equal(observer.windowId(first), "window-1");
  assert.equal(observer.windowId(second), "window-2");
  assert.equal(observer.windowId(second), "window-2");
  const request = {
    frame: () => ({ page: () => second }),
    url: () => "http://localhost/api/listening-events",
    method: () => "POST",
  };
  context.emit("response", {
    request: () => request,
    url: request.url,
    status: () => 200,
    json: never,
  });
  const file = await ownedFile();
  const original = new Error("checkpoint timeout", {
    cause: new Error("original cause"),
  });
  const start = performance.now();
  let signal;
  const artifact = await captureCheckpointFailure({
    file,
    error: original,
    observer,
    budgetMs: 30,
    probes: {
      responses: () => Promise.all(observer.reads),
      media: () => ({ currentTime: 12 }),
      outbox: () => {
        throw new Error("IndexedDB unavailable");
      },
      hung: (value) => {
        signal = value;
        return never();
      },
    },
  });
  assert(performance.now() - start < 1000);
  assert(signal.aborted);
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.originalError.message, original.message);
  assert.equal(artifact.originalError.cause.message, "original cause");
  assert.equal(artifact.probes.media.status, "ok");
  assert.equal(artifact.probes.outbox.status, "error");
  assert.equal(artifact.probes.hung.status, "timeout");
  assert.equal(artifact.requests[0].body.status, "timeout");
  assert.equal(artifact.requests[0].windowId, "window-2");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), artifact);
  for (const name of ["request", "requestfailed", "response"])
    assert.equal(context.listenerCount(name), 0);
});

test("missing SQLite is explicit and cannot suppress another probe", async () => {
  const file = await ownedFile();
  const artifact = await captureCheckpointFailure({
    file,
    error: new Error("assertion"),
    observer: observeRequests(new EventEmitter()),
    budgetMs: 2000,
    probes: {
      sqlite: (signal) =>
        sqliteProbe(
          path.join(path.dirname(file), "absent.sqlite"),
          "SELECT 1",
          signal,
        ),
      other: () => [1, 2],
    },
  });
  assert.equal(artifact.probes.sqlite.status, "error");
  assert.equal(artifact.probes.other.status, "ok");
});

test("an already expired SQLite probe cancels without retaining the process", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    sqliteProbe("unused.sqlite", "SELECT 1", controller.signal),
    /SQLite diagnostic cancelled/,
  );
});

test("late probe completion cannot overwrite persisted timeout evidence", async () => {
  let finish;
  const late = new Promise((resolve) => {
    finish = resolve;
  });
  const file = await ownedFile();
  const artifact = await captureCheckpointFailure({
    file,
    error: new Error("original"),
    observer: observeRequests(new EventEmitter()),
    budgetMs: 10,
    probes: { late: () => late, available: () => [] },
  });
  finish(["too late"]);
  await late;
  await Promise.resolve();
  assert.equal(artifact.probes.late.status, "timeout");
  assert.deepEqual(artifact.probes.available, { status: "ok", value: [] });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), artifact);
});

test("successful and rejected body reads are independent", async () => {
  const context = new EventEmitter();
  const observer = observeRequests(context);
  const page = {};
  for (const json of [
    async () => ({ accepted: true }),
    async () => {
      throw new Error("body unavailable");
    },
  ]) {
    const request = {
      frame: () => ({ page: () => page }),
      url: () => "http://localhost/api/listening-events",
      method: () => "POST",
    };
    context.emit("response", {
      request: () => request,
      url: request.url,
      status: () => 200,
      json,
    });
  }
  const artifact = await captureCheckpointFailure({
    file: await ownedFile(),
    error: new Error("original"),
    observer,
    probes: { responses: () => Promise.all(observer.reads) },
  });
  assert.equal(artifact.probes.responses.status, "ok");
  assert.deepEqual(artifact.requests[0].body, {
    status: "ok",
    value: { accepted: true },
  });
  assert.equal(artifact.requests[1].body.status, "error");
  assert.equal(artifact.requests[1].body.error.message, "body unavailable");
});
