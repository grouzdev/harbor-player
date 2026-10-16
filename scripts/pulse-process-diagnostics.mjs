import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { writeFile } from "node:fs/promises";

export function errorEvidence(error, seen = new Set()) {
  if (seen.has(error)) return { message: "[circular cause]" };
  seen.add(error);
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    stack: error?.stack,
    ...(error?.cause === undefined
      ? {}
      : { cause: errorEvidence(error.cause, seen) }),
  };
}

// Synchronous SQLite calls must not block the diagnostic deadline.
export function sqliteProbe(file, sql, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { file, sql },
    });
    const abort = () => {
      // Native I/O may delay termination. Diagnostics must not keep the parent
      // alive after its deadline, and termination rejection must be handled.
      worker.unref();
      void worker.terminate().catch(() => {});
      reject(new Error("SQLite diagnostic cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    const cleanup = () => signal.removeEventListener("abort", abort);
    worker.once("message", (message) => {
      cleanup();
      if (message.error) reject(new Error(message.error));
      else resolve(message.value);
    });
    worker.once("error", (error) => {
      cleanup();
      reject(error);
    });
    worker.once("exit", cleanup);
    if (signal.aborted) abort();
  });
}

if (!isMainThread) {
  let db;
  try {
    const { default: Database } = await import("better-sqlite3");
    db = new Database(workerData.file, { readonly: true, timeout: 100 });
    parentPort.postMessage({ value: db.prepare(workerData.sql).all() });
  } catch (error) {
    parentPort.postMessage({ error: String(error) });
  } finally {
    db?.close();
  }
}

export function observeRequests(context) {
  const requests = [];
  const reads = [];
  const ids = new WeakMap();
  let nextId = 0;
  const windowId = (page) => {
    if (!ids.has(page)) ids.set(page, `window-${++nextId}`);
    return ids.get(page);
  };
  const relevant = (url) =>
    ["/api/pulse/settings", "/api/listening-events"].includes(
      new URL(url).pathname,
    );
  const evidence = (request) => {
    let page = null;
    try {
      page = windowId(request.frame().page());
    } catch {
      // Service-worker requests have no frame.
    }
    return {
      at: Date.now(),
      windowId: page,
      url: request.url(),
      method: request.method(),
    };
  };
  const onRequest = (request) => {
    if (relevant(request.url()))
      requests.push({ ...evidence(request), kind: "request" });
  };
  const onFailed = (request) => {
    if (relevant(request.url()))
      requests.push({
        ...evidence(request),
        kind: "requestfailed",
        failure: request.failure(),
      });
  };
  const onResponse = (response) => {
    if (!relevant(response.url())) return;
    const record = {
      ...evidence(response.request()),
      kind: "response",
      status: response.status(),
      body: { status: "pending" },
    };
    requests.push(record);
    reads.push(
      Promise.resolve()
        .then(() => response.json())
        .then(
          (value) => {
            record.body = { status: "ok", value };
          },
          (error) => {
            record.body = { status: "error", error: errorEvidence(error) };
          },
        ),
    );
  };
  context.on("request", onRequest);
  context.on("requestfailed", onFailed);
  context.on("response", onResponse);
  return {
    requests,
    reads,
    windowId,
    stop() {
      context.off("request", onRequest);
      context.off("requestfailed", onFailed);
      context.off("response", onResponse);
    },
  };
}

export async function captureCheckpointFailure({
  file,
  error,
  provenance = null,
  observer,
  probes,
  budgetMs = 3000,
}) {
  observer.stop();
  const controller = new AbortController();
  const results = Object.fromEntries(
    Object.keys(probes).map((key) => [key, { status: "timeout" }]),
  );
  let active = true;
  let timer;
  const work = Object.entries(probes).map(async ([key, probe]) => {
    let result;
    try {
      result = { status: "ok", value: await probe(controller.signal) };
    } catch (error) {
      result = { status: "error", error: errorEvidence(error) };
    }
    if (active) results[key] = result;
  });
  try {
    await Promise.race([
      Promise.all(work),
      new Promise((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } finally {
    active = false;
    clearTimeout(timer);
    controller.abort();
  }
  const artifact = {
    schemaVersion: 1,
    provenance,
    originalError: errorEvidence(error),
    budgetMs,
    probes: results,
    requests: observer.requests.map((request) => ({
      ...request,
      ...(request.body?.status === "pending"
        ? { body: { status: "timeout" } }
        : {}),
    })),
  };
  await writeFile(file, JSON.stringify(artifact, null, 2));
  return artifact;
}
