import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";
import { observeStorageLoad } from "../scripts/pulse-process-storage-observer.mjs";

test("storage observer reports real interval overlap, not an ingest latency budget", async () => {
  const context = Object.assign(new EventEmitter(), {
    request: {
      async get() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { status: () => 200, body: async () => Buffer.from("[]") };
      },
    },
  });
  const observer = observeStorageLoad(
    context,
    "http://fixture",
    ".test-data/absent-observer",
    0,
  );
  observer.phase("retry");
  await observer.ingest(
    () => new Promise((resolve) => setTimeout(resolve, 20)),
  );
  const evidence = await observer.stop();
  assert.equal(evidence.batches.length, 1);
  assert.equal(evidence.batches[0].phase, "retry");
  assert(evidence.batches[0].catalog.count > 0);
  assert.equal(evidence.catalogReadGuidelineMs, 50);
  assert(
    evidence.staging.every(
      (sample) => sample.entries === 0 && sample.bytes === 0,
    ),
  );
  assert.equal(context.listenerCount("request"), 0);
  assert.equal(context.listenerCount("requestfinished"), 0);
});
