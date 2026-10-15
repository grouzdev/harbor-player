// Run after build:server. Only generated data in a fresh .test-data/pulse-p1-*.
// Default accelerated model: 30 days. PULSE_BENCH_DAYS=365 selects the year model.
// Evidence tests: npx vitest run tests/pulse-ingest-evidence.test.ts
import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import {
  summary,
  verifySums,
  modelTracks,
  measureInvocation,
  artworkStorage,
  phaseEvidence,
} from "./pulse-ingest-evidence.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const size = async (file) => (await stat(file).catch(() => ({ size: 0 }))).size;
const self = fileURLToPath(import.meta.url);
const request = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(30000) });

function nextMessage(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("Worker response timed out")),
      60000,
    );
    const onExit = (code) => finish(new Error(`Worker exited with ${code}`));
    const onError = (error) => finish(error);
    const onMessage = (message) => finish(null, message);
    function finish(error, message) {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      child.off("message", onMessage);
      if (error) reject(error);
      else resolve(message);
    }
    child.once("exit", onExit);
    child.once("error", onError);
    child.once("message", onMessage);
  });
}

/**
 * @typedef {Object} IngestTiming
 * @property {number} validationMs Zod validation only.
 * @property {number} artworkFilesystemSyncMs Synchronous exists/mkdir/copy calls only; zero for asynchronous filesystem APIs.
 * @property {number} transactionCommitMs Actual SQLite transaction callable including commit.
 * @property {number} fullIngestMs Whole awaited PulseStore.ingest, including asynchronous preparation.
 * @property {number} syncInvocationMs Initial synchronous invocation (before a returned Promise).
 * @property {number} preparationResidualMs Elapsed residual including settings, awaited preparation and scheduling.
 */

if (process.argv[2] === "--worker") {
  const root = process.argv[3];
  assert(path.resolve(root).startsWith(path.resolve(".test-data") + path.sep));
  const { createApp } = await import("../dist/server/app.js");
  const { pulseBatchSchema } = await import("../dist/shared/pulse.js");
  const context = await createApp({ dataDir: root, port: 0 });
  const catalog = context.service.catalog;
  const db = catalog.db;
  catalog.pulse.updateSettings({ timeZone: "UTC" });
  const library = catalog.addLibrary(
    "Generated fixed catalog",
    path.join(root, "music"),
  );
  for (let i = 0; i < 500; i++)
    catalog.upsert({
      id: `catalog-${i}`,
      libraryId: library.id,
      relativePath: `track-${i}.wav`,
      title: `Track ${i}`,
      artists: ["Generated"],
      albumTitle: `Album ${i % 50}`,
      albumArtists: ["Generated"],
      albumKey: `catalog-album-${i % 50}`,
      rating: null,
      albumRating: null,
      albumViewed: false,
      genres: ["Benchmark"],
      year: 2025,
      trackNumber: i + 1,
      discNumber: null,
      duration: 240,
      format: "wav",
      size: 1,
      mtimeMs: 1,
      coverId: null,
      available: true,
    });
  let active = null;
  // Diagnostic-only wrappers in this disposable process. Offsets share the
  // worker's clock; never subtract them from the parent's HTTP clock.
  for (const name of ["access", "mkdir", "copyFile", "rename", "rm"]) {
    const original = fs.promises[name];
    fs.promises[name] = async (...args) => {
      const timing = active;
      const startMs = performance.now();
      let outcome = "ok";
      try {
        return await original(...args);
      } catch (error) {
        outcome = error.code ?? "error";
        throw error;
      } finally {
        if (timing)
          timing.spans.push({
            phase: {
              access: "metadata",
              mkdir: "staging",
              copyFile: "copy",
              rename: "publication",
              rm: "cleanup",
            }[name],
            operation: name,
            path: String(args[0]),
            startMs: startMs - timing.originMs,
            endMs: performance.now() - timing.originMs,
            outcome,
          });
      }
    };
  }
  for (const name of ["hasCover", "copyCover"]) {
    const original = catalog.pulse[name].bind(catalog.pulse);
    catalog.pulse[name] = async (id) => {
      const timing = active;
      const startMs = performance.now();
      if (name === "copyCover" && timing) {
        const ready = timing.queueReady.get(id);
        if (ready !== undefined)
          timing.spans.push({
            phase: "queueWait",
            operation: "copySlot",
            path: id,
            startMs: ready - timing.originMs,
            endMs: startMs - timing.originMs,
          });
      }
      try {
        return await original(id);
      } finally {
        if (timing && name === "hasCover" && !timing.queueReady.has(id))
          timing.queueReady.set(id, performance.now());
        if (timing && name === "copyCover")
          timing.spans.push({
            phase: "copySlot",
            operation: name,
            path: id,
            startMs: startMs - timing.originMs,
            endMs: performance.now() - timing.originMs,
          });
      }
    };
  }
  /** @type {IngestTiming[]} */
  const timings = [];
  // Only this disposable process changes builtin bindings; runtime sources stay intact.
  for (const name of ["existsSync", "mkdirSync", "copyFileSync"]) {
    const original = fs[name];
    fs[name] = (...args) => {
      const start = performance.now();
      try {
        return original(...args);
      } finally {
        if (active) active.artworkFilesystemSyncMs += performance.now() - start;
      }
    };
  }
  syncBuiltinESMExports();
  const parse = pulseBatchSchema.parse.bind(pulseBatchSchema);
  pulseBatchSchema.parse = (...args) => {
    const start = performance.now();
    try {
      return parse(...args);
    } finally {
      if (active) active.validationMs += performance.now() - start;
    }
  };
  // Wrap the actual better-sqlite3 transaction callable, including commit.
  const transaction = db.transaction.bind(db);
  db.transaction = (fn) => {
    const run = transaction(fn);
    return (...args) => {
      const start = performance.now();
      try {
        return run(...args);
      } finally {
        if (active) active.transactionCommitMs += performance.now() - start;
      }
    };
  };
  const ingest = catalog.pulse.ingest.bind(catalog.pulse);
  catalog.pulse.ingest = async (input) => {
    assert.equal(
      active,
      null,
      "Harness permits only one in-flight ingest for phase attribution",
    );
    active = {
      originMs: performance.now(),
      spans: [],
      queueReady: new Map(),
      validationMs: 0,
      artworkFilesystemSyncMs: 0,
      transactionCommitMs: 0,
      syncInvocationMs: 0,
    };
    try {
      return await measureInvocation(() => ingest(input), active);
    } finally {
      active.asyncArtwork = phaseEvidence(active.spans);
      delete active.queueReady;
      delete active.spans;
      timings.push(active);
      active = null;
    }
  };
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const port = context.app.server.address().port;
  context.allowLocalPort(port);
  process.send({ url: `http://127.0.0.1:${port}` });
  process.on("message", async ({ command, expected }) => {
    try {
      if (command === "stop") {
        delay.disable();
        await context.app.close();
        process.exit(0);
      }
      if (command === "reset") {
        timings.length = 0;
        delay.reset();
        process.send({ reset: true });
        return;
      }
      const counts = {};
      for (const table of [
        "pulse_intervals",
        "pulse_albums",
        "pulse_days",
        "pulse_day_albums",
      ])
        counts[table] = db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
      let dbstat;
      try {
        dbstat = db
          .prepare(
            "SELECT d.name,s.type,sum(d.pgsize) bytes FROM dbstat d LEFT JOIN sqlite_schema s ON s.name=d.name GROUP BY d.name,s.type",
          )
          .all();
      } catch (error) {
        dbstat = { unavailable: error.message };
      }
      const beforeCheckpoint = {
        sqliteBytes: await size(path.join(root, "catalog.sqlite")),
        walBytes: await size(path.join(root, "catalog.sqlite-wal")),
      };
      const totals = verifySums(db, expected);
      const covers = await artworkStorage(path.join(root, "pulse-covers"));
      if (command === "checkpoint") db.pragma("wal_checkpoint(TRUNCATE)");
      process.send({
        totals,
        counts,
        covers,
        sqlite: {
          version: db.prepare("SELECT sqlite_version() version").get().version,
          journalMode: db.pragma("journal_mode", { simple: true }),
          synchronous: db.pragma("synchronous", { simple: true }),
          walAutoCheckpointPages: db.pragma("wal_autocheckpoint", {
            simple: true,
          }),
        },
        dbstat,
        beforeCheckpoint,
        afterCheckpoint: {
          sqliteBytes: await size(path.join(root, "catalog.sqlite")),
          walBytes: await size(path.join(root, "catalog.sqlite-wal")),
        },
        timings: [...timings],
        eventLoop: {
          resolutionMs: 1,
          meanMs: Number.isFinite(delay.mean) ? delay.mean / 1e6 : null,
          p95Ms: delay.percentile(95) / 1e6,
          maxDelayMs: delay.max / 1e6,
          maxObservedSynchronousSegmentMs: timings.length
            ? Math.max(
                ...timings.map((x) =>
                  Math.max(x.syncInvocationMs, x.transactionCommitMs),
                ),
              )
            : 0,
        },
      });
    } catch (error) {
      process.send({ error: error.stack });
    }
  });
} else {
  const days = Number(process.env.PULSE_BENCH_DAYS ?? 30);
  assert([30, 365].includes(days), "PULSE_BENCH_DAYS must be 30 or 365");
  const repetitions = Number(process.env.PULSE_BENCH_REPETITIONS ?? 3);
  assert(
    Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 20,
  );
  const stressCoverPool = 121 * repetitions;
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data/pulse-p1-ingest-"));
  await mkdir(path.join(root, "covers"));
  const sharp = (await import("sharp")).default;
  const { createHash } = await import("node:crypto");
  const covers = [];
  const artworkManifest = [];
  for (let i = 0; i < stressCoverPool + 12 + days * 6; i++) {
    const bytes = await sharp({
      create: {
        width: i % 2 ? 512 : 1024,
        height: i % 2 ? 512 : 1024,
        channels: 3,
        background: { r: i % 256, g: Math.floor(i / 256), b: 200 },
      },
    })
      .png()
      .toBuffer();
    const id = `${createHash("sha256").update(bytes).digest("hex")}.png`;
    await writeFile(path.join(root, "covers", id), bytes);
    covers.push(id);
    artworkManifest.push({
      id,
      bytes: bytes.length,
      width: i % 2 ? 512 : 1024,
      height: i % 2 ? 512 : 1024,
    });
  }
  const modelCovers = covers.slice(stressCoverPool);
  const child = fork(self, ["--worker", root], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let log = "";
  child.stdout.on("data", (b) => {
    log += b;
  });
  child.stderr.on("data", (b) => {
    log += b;
  });
  const exited = once(child, "exit");
  const exchange = async (message) => {
    const response = nextMessage(child);
    child.send(message);
    const result = await response;
    if (result.error) throw new Error(result.error);
    return result;
  };
  const watchdog = setTimeout(() => child.kill(), 10 * 60 * 1000);
  try {
    const { url } = await nextMessage(child);
    const sessionResponse = await request(`${url}/api/session`);
    const session = await sessionResponse.json();
    const headers = {
      cookie: sessionResponse.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": session.csrf,
      "content-type": "application/json",
    };
    const settings = await (
      await request(`${url}/api/pulse/settings`, { headers })
    ).json();
    const latest = new Map();
    let peakWalBytes = 0;
    const httpSamples = [];
    async function send(events, label) {
      const start = performance.now();
      const response = await request(`${url}/api/listening-events`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          historyGeneration: settings.historyGeneration,
          events,
        }),
      });
      const body = await response.json();
      const httpMs = performance.now() - start;
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.acknowledgements.length, events.length);
      for (const event of events) {
        const ack = body.acknowledgements.find(
          (a) => a.eventId === event.eventId,
        );
        assert(ack && ack.revision >= event.revision);
        if (
          !latest.has(event.eventId) ||
          latest.get(event.eventId).revision < event.revision
        )
          latest.set(event.eventId, event);
      }
      httpSamples.push({
        label,
        batchSize: events.length,
        startMs: start,
        endMs: performance.now(),
        httpMs,
      });
      peakWalBytes = Math.max(
        peakWalBytes,
        await size(path.join(root, "catalog.sqlite-wal")),
      );
    }
    const expected = () =>
      [...latest.values()].reduce((sum, e) => sum + e.playedMs, 0);
    async function catalogReads(count, continueWhile = () => false) {
      const samples = [];
      const requests = [];
      await Promise.all(
        Array.from({ length: 4 }, async (_, worker) => {
          for (let i = worker; i < count || continueWhile(); i += 4) {
            const endpoint = [
              "/api/tracks?limit=100",
              "/api/albums?limit=20",
              "/api/artists",
              "/api/genres",
            ][i % 4];
            const start = performance.now();
            const response = await request(url + endpoint, { headers });
            assert(response.ok, endpoint);
            await response.json();
            const end = performance.now();
            samples.push(end - start);
            requests.push({
              endpoint,
              startMs: start,
              endMs: end,
              latencyMs: end - start,
            });
            await wait(2);
          }
        }),
      );
      return { samplesMs: samples, requests, ...summary(samples) };
    }
    await catalogReads(20);
    await exchange({ command: "reset" });
    const baseline = await catalogReads(240);
    const baselineServer = await exchange({ command: "snapshot", expected: 0 });
    await exchange({ command: "reset" });
    let matrixRunning = true;
    const loadedReads = catalogReads(480, () => matrixRunning);
    let coverOffset = 0;
    for (let repetition = 0; repetition < repetitions; repetition++) {
      for (const n of [1, 20, 100]) {
        for (const artwork of ["first-copy", "existing", "missing"]) {
          const events = Array.from({ length: n }, (_, i) => ({
            ...modelTracks(0, covers)[0],
            eventId: `${repetition}-${n}-${artwork}-${i}`,
            albumKey: `${repetition}-${n}-${artwork}-${i}`,
            visitId: `${repetition}-${n}-${artwork}-${i}`,
            snapshot: {
              title: `Generated ${i}`,
              artists: ["Benchmark"],
              year: 2025,
              coverId:
                artwork === "missing"
                  ? `${(100000 + coverOffset + i).toString(16).padStart(64, "0")}.png`
                  : covers[coverOffset + i],
            },
            playedMs: 15000,
            endedAtUtc: modelTracks(0, covers)[0].startedAtUtc + 15000,
            final: false,
          }));
          await send(events, `${n}/${artwork}/new`);
          const revised = events.map((e) => ({
            ...e,
            revision: 2,
            endedAtUtc: e.startedAtUtc + 30000,
            playedMs: 30000,
          }));
          await send(revised, `${n}/${artwork}/checkpoint`);
          const finals = revised.map((e) => ({
            ...e,
            revision: 3,
            final: true,
          }));
          await send(finals, `${n}/${artwork}/final`);
          await send(finals, `${n}/${artwork}/retry`);
          await send(events, `${n}/${artwork}/old-checkpoint`);
        }
        coverOffset += n;
      }
    }
    matrixRunning = false;
    const loaded = await loadedReads;
    const ingestServer = await exchange({
      command: "snapshot",
      expected: expected(),
    });
    // Real elapsed server-side cadence, not audio/recorder validation.
    const paced = {
      ...modelTracks(0, covers)[0],
      eventId: "paced",
      visitId: "paced",
      albumKey: "paced",
      final: false,
    };
    const wallStart = performance.now();
    await wait(15000);
    await send(
      [{ ...paced, playedMs: 15000, endedAtUtc: paced.startedAtUtc + 15000 }],
      "paced/checkpoint",
    );
    await wait(1000);
    await send(
      [
        {
          ...paced,
          revision: 2,
          playedMs: 16000,
          endedAtUtc: paced.startedAtUtc + 16000,
          final: true,
        },
      ],
      "paced/final",
    );
    const pacedElapsedMs = performance.now() - wallStart;
    const growth = [];
    growth.push({
      simulatedDays: 0,
      ...(await exchange({ command: "checkpoint", expected: expected() })),
    });
    for (let day = 0; day < days; day++) {
      const tracks = modelTracks(day, modelCovers);
      // Cumulative 15s checkpoints retain one eventId per track, not independent rows.
      for (let tick = 15000; tick <= 300000; tick += 15000) {
        const revisions = tracks
          .filter((e) => tick <= e.playedMs)
          .map((e) => ({
            ...e,
            revision: tick / 15000,
            playedMs: tick,
            endedAtUtc: e.startedAtUtc + tick,
            final: tick === e.playedMs,
          }));
        await send(revisions, "accelerated/checkpoint-or-final");
      }
      if (day === 29 || day === days - 1)
        growth.push({
          simulatedDays: day + 1,
          ...(await exchange({ command: "checkpoint", expected: expected() })),
        });
    }
    // A long continuous listen is split into bounded one-hour intervals.
    for (let part = 0; part < 2; part++) {
      const base = {
        ...modelTracks(0, covers)[0],
        eventId: `long-${part}`,
        albumKey: "long",
        visitId: "long",
        startedAtUtc: Date.UTC(2024, 0, 1, 12 + part),
      };
      for (let tick = 15000; tick <= 3600000; tick += 15000)
        await send(
          [
            {
              ...base,
              revision: tick / 15000,
              endedAtUtc: base.startedAtUtc + tick,
              playedMs: tick,
              final: tick === 3600000,
            },
          ],
          "long/checkpoint",
        );
    }
    const final = await exchange({
      command: "checkpoint",
      expected: expected(),
    });
    const coversStorage = await artworkStorage(path.join(root, "pulse-covers"));
    const measuredBatches = httpSamples
      .slice(0, 45 * repetitions)
      .map((sample, index) => ({
        ...sample,
        ...ingestServer.timings[index],
      }));
    assert.equal(ingestServer.timings.length, measuredBatches.length);
    const overlappingReads = loaded.requests
      .map((request) => ({
        ...request,
        overlappingBatches: measuredBatches
          .filter(
            (batch) =>
              request.startMs <= batch.endMs && request.endMs >= batch.startMs,
          )
          .map((batch) => batch.label),
      }))
      .filter((request) => request.overlappingBatches.length);
    assert(
      overlappingReads.length > 0,
      "Catalog requests must actually overlap ingest",
    );
    const report = {
      version: 1,
      environment: {
        gitSha: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        executable: process.execPath,
        executableSha256: createHash("sha256")
          .update(fs.readFileSync(process.execPath))
          .digest("hex"),
        sourceSha256: Object.fromEntries(
          [
            "src/server/pulse.ts",
            "dist/server/pulse.js",
            "scripts/pulse-ingest-benchmark.mjs",
            "scripts/pulse-ingest-evidence.mjs",
          ].map((file) => [
            file,
            createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
          ]),
        ),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? null,
        totalMemoryBytes: os.totalmem(),
        timestampUtc: new Date().toISOString(),
        release: os.release(),
      },
      root,
      model: {
        days,
        accelerated: true,
        hoursPerDay: 2,
        tracksPerDay: 30,
        trackSeconds: [180, 240, 300],
        checkpointSeconds: 15,
        newAlbumFraction: 0.2,
        newUniqueArtworkFraction: 0.2,
        modelCoverPool: modelCovers.length,
        repetitions,
        stressCoverPool,
        artworkManifest,
        generatedArtwork:
          "solid-color PNG, alternating 512/1024 square; no user material",
        longListen: "two one-hour parts with 15-second cumulative revisions",
        pacedElapsedMs,
      },
      limits: {
        readP95Ms: 50,
        transactionBudgetMs: null,
        readConcurrency: 4,
        wallTimeoutMinutes: 10,
      },
      catalog: {
        baseline,
        loaded,
        p95Ratio: loaded.p95Ms / baseline.p95Ms,
        loadedReadBudgetPass: loaded.p95Ms < 50,
      },
      baselineServer,
      ingestServer,
      growth,
      final,
      peakWalBytes,
      covers: coversStorage,
      measuredBatches,
      scenarios: Object.fromEntries(
        [...new Set(measuredBatches.map((s) => s.label))].map((label) => {
          const samples = measuredBatches.filter((s) => s.label === label);
          return [
            label,
            {
              http: summary(samples.map((s) => s.httpMs)),
              ingest: summary(samples.map((s) => s.fullIngestMs)),
              transaction: summary(samples.map((s) => s.transactionCommitMs)),
            },
          ];
        }),
      ),
      overlappingReads: {
        requests: overlappingReads,
        ...summary(overlappingReads.map((r) => r.latencyMs)),
        readBudgetPass:
          summary(overlappingReads.map((r) => r.latencyMs)).p95Ms < 50,
      },
      http: {
        ...summary(httpSamples.map((s) => s.httpMs)),
        samples: httpSamples,
      },
      limitations: [
        "Async diagnostic spans overlap and include OS/threadpool scheduling; summed durations are NOT wall time. copySlot includes nested FS spans; queueWait is first hasCover completion to copyCover entry (including microtask scheduling). lastCompletion identifies the observed tail, not a causal CPU trace. Worker offsets and parent HTTP timestamps are separate clocks.",
        "Local generated workload; not packaged Electron or a year of observation. Solid PNG bytes/resolutions are recorded, but permitted real images and physical FAT/exFAT were not exercised. This diagnostic run includes instrumentation overhead; three samples per scenario do not establish a stable population p95.",
        "Paced segment uses real wall time and HTTP but is not actual audio playback/recorder integration.",
        "Preparation residual includes settings, artwork preparation, scheduling and wrapper overhead; not isolated filesystem-only timing. artworkFilesystemSyncMs instruments only synchronous APIs and is zero when preparation uses asynchronous filesystem APIs.",
        "fullIngestMs is awaited elapsed time, not continuous blocking. Loop delay is a 1ms sampling estimate; maxObservedSynchronousSegmentMs covers initial invocation and transaction callable, not all server work or continuations.",
        "WAL peak sampled after each HTTP ACK; transient internal peaks may be missed. Auto-checkpoint remains production default.",
        "Read workers use separate concurrent fetch requests; baseline precedes ingest, filesystem/OS caches are not flushed.",
        "Other machine workload is uncontrolled. Re-run without concurrent builds/workers before target acceptance. Load aggregate includes requests after ingest; overlappingReads separately reports actual concurrent requests.",
      ],
    };
    await writeFile(
      path.join(root, "result.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          root,
          catalog: {
            baseline: summary(baseline.samplesMs),
            loaded: summary(loaded.samplesMs),
            p95Ratio: report.catalog.p95Ratio,
            loadedReadBudgetPass: report.catalog.loadedReadBudgetPass,
          },
          overlappingReads: {
            ...summary(overlappingReads.map((r) => r.latencyMs)),
            readBudgetPass: report.overlappingReads.readBudgetPass,
          },
          final: final.counts,
          peakWalBytes,
          covers: report.covers,
          limitations: report.limitations,
        },
        null,
        2,
      ),
    );
  } finally {
    clearTimeout(watchdog);
    if (child.connected) child.send({ command: "stop" });
    await exited;
    await writeFile(path.join(root, "server.log"), log);
  }
}
