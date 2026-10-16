import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import {
  captureCheckpointFailure,
  observeRequests,
  sqliteProbe,
} from "../scripts/pulse-process-diagnostics.mjs";

test("controlled actual Chrome failure capture: hanging HTTP body, closed page, denied IDB, absent SQLite", async () => {
  await mkdir(".test-data", { recursive: true });
  const dir = await mkdtemp(
    path.resolve(".test-data/pulse-diagnostics-browser-"),
  );
  const server = createServer((request, response) => {
    if (request.url === "/api/listening-events") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"unfinished":');
    } else response.end("<!doctype html><audio></audio>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let browser;
  let observer;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext();
    observer = observeRequests(context);
    const first = await context.newPage();
    const second = await context.newPage();
    const firstId = observer.windowId(first);
    const secondId = observer.windowId(second);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await Promise.all([first.goto(origin), second.goto(origin)]);
    const response = context.waitForEvent("response", {
      predicate: (value) => value.url().endsWith("/api/listening-events"),
    });
    await second.evaluate(() => {
      void fetch("/api/listening-events");
      Object.defineProperty(globalThis, "indexedDB", {
        get() {
          throw new DOMException("injected IDB denial", "SecurityError");
        },
      });
    });
    await response;
    await first.close();
    const original = new Error("injected checkpoint failure", {
      cause: new Error("controlled test driver"),
    });
    const file = path.join(dir, "checkpoint-failure.json");
    const started = performance.now();
    const artifact = await captureCheckpointFailure({
      file,
      observer,
      error: original,
      provenance: { injected: true, browserVersion: browser.version() },
      budgetMs: 1000,
      probes: {
        responses: () => Promise.all(observer.reads),
        [`${firstId}.media`]: () => first.evaluate(() => document.title),
        [`${secondId}.media`]: () =>
          second.evaluate(() => ({
            audioCount: document.querySelectorAll("audio").length,
          })),
        [`${secondId}.pending`]: () =>
          second.evaluate(() => indexedDB.open("injected")),
        sqlite: (signal) =>
          sqliteProbe(path.join(dir, "absent.sqlite"), "SELECT 1", signal),
      },
    });
    assert(performance.now() - started < 4000);
    assert.equal(artifact.probes.responses.status, "timeout");
    assert.equal(artifact.probes[`${firstId}.media`].status, "error");
    assert.equal(artifact.probes[`${secondId}.media`].status, "ok");
    assert.equal(artifact.probes[`${secondId}.pending`].status, "error");
    assert.equal(artifact.probes.sqlite.status, "error");
    assert.equal(
      artifact.originalError.cause.message,
      "controlled test driver",
    );
    assert.equal(
      artifact.requests.find((value) => value.kind === "response").body.status,
      "timeout",
    );
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), artifact);
    assert.equal(observer.windowId(second), secondId);
    console.log(
      `Injected failure evidence (not historical reproduction): ${file}`,
    );
  } finally {
    observer?.stop();
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
