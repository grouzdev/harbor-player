import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { batchReadEvidence } from "./pulse-ingest-evidence.mjs";

/** Parent-clock HTTP observations, not server transaction timings or ingest UI budgets. */
export function observeStorageLoad(context, origin, dataDir, maxBytes) {
  const batches = [];
  const reads = [];
  const staging = [];
  const pending = new Map();
  let phase = "setup";
  let stopped = false;
  let error;
  const onRequest = (request) => {
    if (request.url() === `${origin}/api/listening-events`) {
      const interval = { phase, startMs: performance.now() };
      batches.push(interval);
      pending.set(request, interval);
    }
  };
  const finish = (request, failed = false) => {
    const interval = pending.get(request);
    if (!interval) return;
    interval.endMs = performance.now();
    interval.latencyMs = interval.endMs - interval.startMs;
    interval.failed = failed;
    pending.delete(request);
  };
  const onFinished = (request) => finish(request);
  const onFailed = (request) => finish(request, true);
  context.on("request", onRequest);
  context.on("requestfinished", onFinished);
  context.on("requestfailed", onFailed);
  const task = (async () => {
    while (!stopped) {
      const sample = { phase, startMs: performance.now() };
      try {
        const response = await context.request.get(`${origin}/api/libraries`, {
          timeout: 2000,
        });
        await response.body();
        sample.status = response.status();
      } catch {
        sample.status = "unavailable";
      }
      sample.endMs = performance.now();
      sample.latencyMs = sample.endMs - sample.startMs;
      sample.endpoint = "/api/libraries";
      reads.push(sample);
      const entries = (
        await readdir(path.join(dataDir, "pulse-covers")).catch(() => [])
      ).filter((name) => name.startsWith(".pulse-"));
      let bytes = 0;
      for (const entry of entries)
        bytes +=
          (
            await stat(
              path.join(dataDir, "pulse-covers", entry, "image"),
            ).catch(() => null)
          )?.size ?? 0;
      staging.push({
        phase,
        atMs: performance.now(),
        entries: entries.length,
        bytes,
      });
      try {
        assert(
          entries.length <= 4,
          "Sampled cover staging exceeds copy concurrency",
        );
        assert(
          bytes <= maxBytes,
          "Sampled cover staging exceeds supplied original byte budget",
        );
      } catch (failure) {
        error ??= failure;
      }
      await setTimeout(25);
    }
  })();
  return {
    phase(value) {
      phase = value;
    },
    async ingest(run) {
      const interval = {
        phase,
        startMs: performance.now(),
        source: "harness-real-batch-retry",
      };
      batches.push(interval);
      try {
        return await run();
      } finally {
        interval.endMs = performance.now();
        interval.latencyMs = interval.endMs - interval.startMs;
      }
    },
    async stop() {
      stopped = true;
      await task;
      context.off("request", onRequest);
      context.off("requestfinished", onFinished);
      context.off("requestfailed", onFailed);
      if (error) throw error;
      const completed = batches.filter((batch) => batch.endMs !== undefined);
      const overlap = completed.map((batch) => ({
        ...batch,
        catalog: batchReadEvidence(
          batch,
          reads.filter((read) => read.status === 200),
        ),
      }));
      return {
        batches: overlap,
        reads,
        staging,
        catalogReadGuidelineMs: 50,
        guideline:
          "Compare overlapping catalog-read p95 only, never ingest ACK. Zero overlap is NOT MEASURED, not PASS.",
        stagingScope:
          "Sequential samples after catalog HTTP reads, not staging/WAL peaks. Quiescent snapshots additionally require zero staging.",
      };
    },
  };
}
