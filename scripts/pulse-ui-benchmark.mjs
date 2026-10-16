// npm run build && node scripts/pulse-ui-benchmark.mjs
// --smoke reduces counts/navigation, never constitutes acceptance.
// --latency-only retains full activation samples, skips navigation profiling.
// --electron uses HARBOR_PLAYER_DESKTOP_EXECUTABLE (Windows packaged artifact).
// --channel=chrome|msedge or HARBOR_PLAYER_CHROMIUM_EXECUTABLE for browser.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  open,
  rename,
  rm,
  statfs,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { seedUiDataset } from "./pulse-ui-dataset.mjs";
import { inspectPermittedArtwork } from "./pulse-artwork-fixture.mjs";
import { uiBenchmarkOptions } from "./pulse-ui-options.mjs";
import {
  installUiProbe,
  summarize,
  networkSummary,
  tasksOverlappingSample,
} from "./pulse-ui-evidence.mjs";

const args = process.argv.slice(2);
const {
  smoke,
  latencyOnly,
  diagnostic,
  launches,
  retainedCopies,
  coldScenario,
  electron,
} = uiBenchmarkOptions(args);
assert(
  !electron || process.platform === "win32",
  "--electron requires Windows",
);
const { chromium } = await import(
  process.env.HARBOR_PLAYER_PLAYWRIGHT_MODULE || "playwright"
);
const productionHtml = await readFile("dist/client/index.html"); // Fail before launch if production assets absent.
await mkdir(".test-data", { recursive: true });
const root = await mkdtemp(path.resolve(".test-data/pulse-p1-ui-"));
const artworkBudget = await inspectPermittedArtwork(undefined, {
  retainedCopies,
});
const disk = await statfs(root);
const freeBytes = disk.bavail * disk.bsize;
const evidenceReserveBytes = 2 * 1024 * 1024 * 1024;
assert(
  freeBytes >= artworkBudget.projectedRetainedBytes + evidenceReserveBytes,
  "Insufficient disk space for retained fixtures and diagnostic evidence",
);
let gitCommit = null;
let dirty = null;
try {
  gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  dirty = Boolean(
    execFileSync("git", ["--no-optional-locks", "status", "--porcelain"], {
      encoding: "utf8",
    }).trim(),
  );
} catch {
  // Exported sources may not have Git metadata; source hashes remain available.
}
const sourceHashes = Object.fromEntries(
  await Promise.all(
    [
      "scripts/pulse-ui-benchmark.mjs",
      "scripts/pulse-ui-evidence.mjs",
      "scripts/pulse-ui-options.mjs",
      "scripts/pulse-ui-dataset.mjs",
      "scripts/pulse-artwork-fixture.mjs",
      "src/client/App.tsx",
      "src/client/PulseMode.tsx",
      "src/desktop/main.ts",
      "src/server/pulse.ts",
    ].map(async (file) => [
      file,
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    ]),
  ),
);
const evidence = {
  version: 1,
  productionHtmlSha256: createHash("sha256")
    .update(productionHtml)
    .digest("hex"),
  root,
  target: electron ? "windows-packaged-electron" : "browser",
  smoke,
  latencyOnly,
  diagnostic,
  launchesPerDataset: launches,
  coldScenario,
  provenance: { gitCommit, dirty, sourceHashes },
  diskPreflight: { freeBytes, evidenceReserveBytes, artworkBudget },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().map((c) => c.model),
    totalMemory: os.totalmem(),
    otherLoad: "NOT CONTROLLED; record target-PC load separately",
  },
  protocol: {
    cold: "new owned process/profile; startup-overlap is early/pre-show injected input; ready-panels is foreground first entry without Pulse prewarm",
    start: "capturing real click event, performance.now renderer clock",
    paint:
      "double requestAnimationFrame rendering opportunity; not hardware presentation time",
    dataReady:
      "rail/layout present, viewport cards loaded, selected stats rendered",
    coversReady:
      "visible images decode resolved/rejected then double RAF and readiness revalidation; missing covers separately counted",
    return:
      "panels visible, prior scroll restored and attached visible focus target restored; next rendering opportunity",
    profiling: "separate navigation trace, not latency samples",
    memory:
      "Network/Playwright inspector overhead is included; not an uncontaminated native-memory acceptance",
    mutations: latencyOnly
      ? "real HTTP ingest/clear latency cohort before heavy profiling"
      : "NOT RUN: use --latency-only for mutation samples",
  },
  limitations: [
    "Installed Windows manual acceptance NOT RUN",
    "Generated artwork by default; permitted manifest provenance is recorded per fixture. Image/GPU memory is not covered by JS heap.",
    "Adapter LRU/TTL internal bounds not observable without runtime instrumentation; separate unit coverage required",
    "Warm mutation samples use real HTTP ingest/clear over an aggregate-seeded fixture, not actual audio/recorder integration",
    "read p95 budget belongs to server benchmark, not UI readiness",
    ...(latencyOnly
      ? ["Navigation/trace/memory protocol NOT RUN (--latency-only)"]
      : []),
  ],
  manifests: [],
  samples: [],
  navigation: [],
  runs: [],
};
let owned;
let browser;
async function freePort() {
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  assert(![4317, 4327].includes(port));
  return port;
}
async function until(read, label) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (owned?.spawnError) throw owned.spawnError;
    if (owned && (owned.exitCode !== null || owned.signalCode !== null))
      throw new Error(`Owned process exited: ${label}`);
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timeout: ${label}`);
}
async function stop() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
  if (owned && owned.exitCode === null && owned.signalCode === null) {
    const child = owned;
    if (process.platform === "win32")
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    else child.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => child.once("exit", r)),
      delay(5000),
    ]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  owned = undefined;
}
async function verifyFixture(origin, manifest) {
  const sessionResponse = await fetch(`${origin}/api/session`);
  const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "API session cookie");
  const api = async (endpoint) => {
    const response = await fetch(`${origin}${endpoint}`, {
      headers: { cookie },
    });
    assert(response.ok, `${endpoint}: ${response.status}`);
    return response.json();
  };
  const range = await api("/api/pulse/history-range");
  assert.equal(range.firstDay, manifest.from);
  assert.equal(range.lastDay, manifest.to);
  const days = [];
  for (
    let t = Date.parse(manifest.from);
    t <= Date.parse(manifest.to);
    t += 366 * 86400000
  ) {
    const from = new Date(t).toISOString().slice(0, 10);
    const to = new Date(Math.min(Date.parse(manifest.to), t + 365 * 86400000))
      .toISOString()
      .slice(0, 10);
    days.push(...(await api(`/api/pulse/layout?from=${from}&to=${to}`)).days);
  }
  assert.equal(days.length, manifest.historyDays);
  const expectedDays = [];
  for (
    let t = Date.parse(manifest.from);
    t < Date.parse(manifest.to);
    t += 3 * 86400000
  )
    expectedDays.push(new Date(t).toISOString().slice(0, 10));
  expectedDays.push(manifest.to);
  assert.deepEqual(days.map((day) => day.dayKey).sort(), expectedDays);
  for (const day of days) {
    assert.equal(
      day.albumCount,
      day.dayKey === manifest.busyDay ? manifest.busyCount : 1,
    );
    assert.equal(
      day.playedMs,
      day.dayKey === manifest.busyDay ? manifest.busyTotalMs : 180000,
    );
  }
  let sum = 0;
  for (let offset = 0; offset < manifest.busyCount; offset += 100) {
    const result = await api(
      `/api/pulse/days/${manifest.busyDay}/albums?offset=${offset}&limit=100`,
    );
    assert.equal(
      result.items.length,
      Math.min(100, manifest.busyCount - offset),
    );
    result.items.forEach((item, i) => {
      const rank = offset + i;
      assert.equal(item.albumId, `pulse-ui-${rank}`);
      assert.equal(item.title, `Disposable album ${rank} ${manifest.sentinel}`);
      assert.equal(item.playedMs, 60000 + rank);
      sum += item.playedMs;
    });
  }
  assert.equal(sum, manifest.busyTotalMs);
  for (const expected of manifest.representatives) {
    const stats = await api(
      `/api/pulse/albums/${expected.albumId}/stats?day=${manifest.busyDay}`,
    );
    assert.equal(stats.title, expected.title);
    assert.equal(stats.dayPlayedMs, expected.playedMs);
    assert.equal(stats.dayTotalMs, manifest.busyTotalMs);
    assert.equal(stats.albumId, expected.albumId);
    assert.equal(
      stats.dayCount,
      expected.rank === 0 ? manifest.historyDays : 1,
    );
    assert.equal(stats.sameDayReturns, 0);
    assert.equal(
      stats.playedMs,
      expected.playedMs +
        (expected.rank === 0 ? (manifest.historyDays - 1) * 180000 : 0),
    );
  }
  return true;
}
async function launch(dataset, index) {
  const runRoot = await mkdtemp(path.join(root, `${dataset}-${index}-`));
  const data = path.join(runRoot, "data");
  const manifest = await seedUiDataset(data, dataset);
  evidence.manifests.push({ runRoot, ...manifest });
  const port = await freePort();
  const cdpPort = electron ? await freePort() : undefined;
  const executable = electron
    ? path.resolve(
        process.env.HARBOR_PLAYER_DESKTOP_EXECUTABLE ||
          "release/win-unpacked/Harbor Player.exe",
      )
    : process.execPath;
  const launchArgs = electron
    ? [
        `--user-data-dir=${path.join(data, "electron")}`,
        `--remote-debugging-port=${cdpPort}`,
        "--remote-debugging-address=127.0.0.1",
      ]
    : ["dist/server/index.js", "--no-open"];
  const executableSha256 = createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");
  const launchedAt = performance.now();
  owned = spawn(executable, launchArgs, {
    env: {
      ...process.env,
      HARBOR_PLAYER_DEV: "0",
      HARBOR_PLAYER_DATA_DIR: data,
      HARBOR_PLAYER_PORT: String(port),
      HARBOR_PLAYER_NO_OPEN: "1",
      HARBOR_PLAYER_PULSE_BENCHMARK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const run = {
    pid: owned.pid,
    executable,
    executableSha256,
    port,
    cdpPort,
    runRoot,
    output: "",
    lifecycle: { clock: "parent Node elapsed since spawn" },
  };
  evidence.runs.push(run);
  owned.once("error", (e) => {
    owned.spawnError = e;
  });
  for (const stream of [owned.stdout, owned.stderr])
    stream.on("data", (c) => {
      run.output += c;
    });
  const origin = `http://127.0.0.1:${port}`;
  await until(async () => {
    try {
      return (await fetch(`${origin}/api/session`)).ok;
    } catch {
      return false;
    }
  }, "isolated API");
  run.lifecycle.backendReadyMs = performance.now() - launchedAt;
  let page;
  if (electron) {
    await until(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok;
      } catch {
        return false;
      }
    }, "Electron CDP");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    page = await until(
      () =>
        browser
          .contexts()[0]
          .pages()
          .find((p) => p.url().startsWith(origin)),
      "owned renderer",
    );
    await page.evaluate(installUiProbe, { diagnostic });
    run.appInfo = await page.evaluate(() =>
      window.harborPlayerDesktop.getAppInfo(),
    );
    assert.equal(
      run.appInfo.pulseBenchmark,
      true,
      "Packaged main must honor benchmark isolation",
    );
    assert.equal(
      run.appInfo.pulseBenchmarkProtocol,
      2,
      "Rebuild packaged benchmark main",
    );
    assert.equal(path.resolve(run.appInfo.dataRoot), path.resolve(data));
    assert.equal(
      path.resolve(run.appInfo.userData),
      path.join(data, "electron"),
    );
    assert.equal(
      path.resolve(run.appInfo.sessionData),
      path.join(data, "electron", "session"),
    );
    assert(
      run.appInfo.version && run.appInfo.commit && run.appInfo.electronVersion,
    );
  } else {
    browser = await chromium.launch({
      channel: args.find((a) => a.startsWith("--channel="))?.split("=")[1],
      executablePath: process.env.HARBOR_PLAYER_CHROMIUM_EXECUTABLE,
    });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
    });
    await context.addInitScript(installUiProbe, { diagnostic });
    page = await context.newPage();
  }
  evidence.environment.browserVersion = browser.version();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const http = [];
  const inflight = new Map();
  cdp.on("Network.requestWillBeSent", (e) => {
    const url = new URL(e.request.url);
    if (url.origin !== origin) return;
    const row = {
      id: e.requestId,
      endpoint: url.pathname,
      query: url.search,
      start: e.timestamp,
      bytes: null,
      status: null,
    };
    http.push(row);
    inflight.set(e.requestId, row);
  });
  cdp.on("Network.responseReceived", (e) => {
    const row = inflight.get(e.requestId);
    if (row) row.status = e.response.status;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const row = inflight.get(e.requestId);
    if (row) {
      row.bytes = e.encodedDataLength;
      row.durationMs = (e.timestamp - row.start) * 1000;
      inflight.delete(e.requestId);
    }
  });
  cdp.on("Network.loadingFailed", (e) => {
    const row = inflight.get(e.requestId);
    if (row) {
      row.error = e.errorText;
      row.canceled = e.canceled;
      inflight.delete(e.requestId);
    }
  });
  if (!electron) await page.goto(origin);
  await page.locator(".workspace").waitFor();
  run.lifecycle.workspaceDomMs = performance.now() - launchedAt;
  return {
    page,
    cdp,
    http,
    inflight,
    runRoot,
    manifest,
    origin,
    run,
    launchedAt,
  };
}
async function finishTrace(cdp, filename) {
  const completion = new Promise((resolve) =>
    cdp.once("Tracing.tracingComplete", resolve),
  );
  await cdp.send("Tracing.end");
  const { stream, dataLossOccurred } = await completion;
  const file = await open(filename, "w");
  try {
    while (true) {
      const part = await cdp.send("IO.read", { handle: stream });
      await file.write(
        part.base64Encoded ? Buffer.from(part.data, "base64") : part.data,
      );
      if (part.eof) break;
    }
  } finally {
    await file.close();
    await cdp.send("IO.close", { handle: stream });
  }
  assert(!dataLossOccurred, "Trace data was lost; profile is incomplete");
}
async function activation(session, dataset, kind, options = {}) {
  const { page, http, inflight } = session;
  const nativeBefore =
    electron && kind === "cold"
      ? await page.evaluate(() => window.harborPlayerDesktop.getAppInfo())
      : null;
  const tracing = diagnostic && kind === "cold";
  if (tracing)
    await session.cdp.send("Tracing.start", {
      categories: "devtools.timeline,v8,blink.user_timing,cc",
      transferMode: "ReturnAsStream",
    });
  const first = http.length;
  if (!(await page.locator(".pulse-mode").count()))
    await page.locator(".workspace").focus();
  await page.evaluate((empty) => {
    window.__pulseUiProbe.sample = null;
    window.__pulseUiProbe.expected = { empty };
  }, options.empty === true);
  try {
    await page.locator(".pulse-mode-toggle").click();
    await page.waitForFunction(
      () => window.__pulseUiProbe.sample?.coversReady != null,
      null,
      { timeout: 45000 },
    );
  } catch (error) {
    evidence.failedActivation = {
      dataset,
      kind,
      http: http.slice(first),
      renderer: await page.evaluate(() => ({
        probe: window.__pulseUiProbe,
        text: document.querySelector(".pulse-mode")?.textContent,
        html: document.querySelector(".pulse-mode")?.outerHTML,
        focus: document.activeElement?.outerHTML,
      })),
    };
    throw error;
  } finally {
    if (tracing)
      await finishTrace(
        session.cdp,
        path.join(session.runRoot, `cold-${coldScenario}-trace.json`),
      );
  }
  const sample = await page.evaluate(() => window.__pulseUiProbe.sample);
  if (!sample.returning && !options.empty) {
    const expected =
      options.expected ?? session.manifest.representatives.at(-1);
    await page
      .locator(`.pulse-day[data-day="${session.manifest.busyDay}"]`)
      .getByRole("button", { name: expected.title, pressed: true })
      .waitFor();
    assert((await page.locator(".pulse-stat-numbers").innerText()).length > 0);
    assert(
      (await page.locator(".pulse-selected").innerText()).includes(
        expected.title,
      ),
    );
    sample.fixture = {
      albumId: expected.albumId,
      title: expected.title,
      day: session.manifest.busyDay,
    };
  } else if (!sample.returning) {
    assert.equal(await page.locator(".pulse-copy h2").count(), 0);
    assert.equal(await page.locator(".pulse-stat-numbers").count(), 0);
    sample.fixture = { empty: true };
  }
  sample.dataset = dataset;
  sample.kind = kind;
  sample.coldScenario = coldScenario;
  if (nativeBefore) {
    sample.nativeWindowBeforeCommand = nativeBefore.nativeWindow;
    sample.nativeWindowAfterReadiness = (
      await page.evaluate(() => window.harborPlayerDesktop.getAppInfo())
    ).nativeWindow;
  }
  sample.http = http.slice(first);
  sample.network = networkSummary(sample.http);
  sample.pendingRequests = inflight.size;
  sample.pendingPulseRequests = [...inflight.values()].filter((r) =>
    r.endpoint.startsWith("/api/pulse/"),
  ).length;
  sample.pendingEventStreams = [...inflight.values()].filter(
    (r) => r.endpoint === "/api/events",
  ).length;
  sample.longtasks = tasksOverlappingSample(
    await page.evaluate(() => window.__pulseUiProbe.tasks),
    sample,
  );
  evidence.samples.push(sample);
  await writeFile(
    path.join(root, "samples.json"),
    JSON.stringify(evidence.samples, null, 2),
  );
}
async function mutationSamples(session, dataset) {
  const { page, origin, manifest } = session;
  if (await page.locator(".pulse-mode").count()) {
    await page.locator(".pulse-rail").focus();
    await page.keyboard.press("End");
    await activation(session, dataset, "return-before-mutations");
  }
  const response = await fetch(`${origin}/api/session`);
  const sessionInfo = await response.json();
  const headers = {
    cookie: response.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": sessionInfo.csrf,
    "content-type": "application/json",
  };
  const api = async (endpoint, body) => {
    const result = await fetch(`${origin}${endpoint}`, {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await result.json();
    assert.equal(result.status, 200, JSON.stringify(value));
    return value;
  };
  const last = manifest.representatives.at(-1);
  const statsEndpoint = `/api/pulse/albums/${last.albumId}/stats?day=${manifest.busyDay}`;
  const before = await api(statsEndpoint);
  let settings = await api("/api/pulse/settings");
  const snapshot = {
    title: before.title,
    artists: before.artists,
    year: before.year ?? null,
    coverId: before.coverId ?? null,
  };
  const ingest = async (title) => {
    const start = Date.parse(`${manifest.busyDay}T12:00:00Z`);
    return api("/api/listening-events", {
      historyGeneration: settings.historyGeneration,
      events: [
        {
          eventId: randomUUID(),
          revision: 1,
          trackId: null,
          albumKey: last.albumId,
          sessionId: randomUUID(),
          visitId: randomUUID(),
          snapshot: { ...snapshot, title },
          startedAtUtc: start,
          endedAtUtc: start + 90_000,
          playedMs: 90_000,
          final: true,
        },
      ],
    });
  };
  await ingest(snapshot.title);
  const updated = await api(statsEndpoint);
  assert.equal(updated.playedMs, before.playedMs + 90_000);
  assert.equal(updated.dayTotalMs, before.dayTotalMs + 90_000);
  await activation(session, dataset, "warm-after-listening");
  await activation(session, dataset, "return-after-listening");
  settings = await api("/api/pulse/clear", {
    confirm: true,
    historyGeneration: settings.historyGeneration,
  });
  const range = await api("/api/pulse/history-range");
  assert.equal(range.firstDay, null);
  await activation(session, dataset, "warm-after-clear", { empty: true });
  await activation(session, dataset, "return-after-clear");
  const title = `${snapshot.title} recovered`;
  const recovered = await ingest(title);
  const albumId = recovered.acknowledgements[0].albumId;
  assert.notEqual(albumId, last.albumId);
  const stats = await api(
    `/api/pulse/albums/${albumId}/stats?day=${manifest.busyDay}`,
  );
  assert.equal(stats.playedMs, 90_000);
  await activation(session, dataset, "warm-after-clear-recovery", {
    expected: { albumId, title },
  });
  await activation(session, dataset, "return-after-clear-recovery");
  session.run.mutations = {
    addedMs: 90_000,
    clearedGeneration: settings.historyGeneration,
    recoveredAlbumId: albumId,
  };
}
async function memory(session, phase) {
  const { cdp, page } = session;
  try {
    await cdp.send("Performance.enable");
    const result = await cdp.send("Performance.getMetrics");
    return {
      phase,
      metrics: result.metrics.filter((m) =>
        [
          "JSHeapUsedSize",
          "JSHeapTotalSize",
          "Nodes",
          "Documents",
          "LayoutCount",
        ].includes(m.name),
      ),
      rendererProcessMemory: electron
        ? (await page.evaluate(() => window.harborPlayerDesktop.getAppInfo()))
            .rendererMemoryKiB
        : "NOT SUPPORTED by this portable browser probe",
      rendererProcessMemoryUnits: {
        workingSetSize: "KiB",
        peakWorkingSetSize: "KiB",
        privateBytes: "KiB",
      },
      imageGpuMemory: "NOT MEASURED",
      gc: phase.endsWith("-forced-gc")
        ? "forced GC in separate navigation diagnostic only"
        : "natural; no forced GC in latency run",
    };
  } catch (e) {
    return { phase, unsupported: String(e) };
  }
}
async function heapEvidence(session, phase) {
  const { cdp, runRoot } = session;
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const filename = path.join(runRoot, `${phase}.heapsnapshot`);
  const partial = `${filename}.partial`;
  const file = await open(partial, "w");
  let bytes = 0;
  let failure;
  let complete = false;
  let pending = Promise.resolve();
  const append = ({ chunk }) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 256 * 1024 * 1024) {
      failure = new Error("Heap snapshot exceeded the 256 MiB evidence bound");
      return;
    }
    pending = pending
      .then(() => file.write(chunk))
      .catch((error) => {
        failure = error;
      });
  };
  cdp.on("HeapProfiler.addHeapSnapshotChunk", append);
  try {
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    await pending;
    if (failure) throw failure;
    complete = true;
  } finally {
    cdp.off("HeapProfiler.addHeapSnapshotChunk", append);
    await pending;
    await file.close();
    if (!complete) await rm(partial, { force: true }).catch(() => {});
  }
  await rename(partial, filename);
  return {
    filename,
    bytes,
    memory: await memory(session, `${phase}-forced-gc`),
  };
}
async function navigation(session, dataset) {
  const { page, cdp, http, inflight, runRoot } = session;
  const record = {
    dataset,
    durationMs: smoke ? 2000 : 1800000,
    memory: [await memory(session, "before")],
    heaps: [],
    traces: [],
    points: [],
    httpStart: http.length,
    completed: false,
  };
  record.heaps.push(await heapEvidence(session, "before-navigation"));
  const taskStart = await page.evaluate(() => performance.now());
  evidence.navigation.push(record);
  console.error(
    `Navigation ${dataset}: ${record.durationMs / 1000}s; artifacts ${runRoot}`,
  );
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,v8,blink.user_timing",
    transferMode: "ReturnAsStream",
  });
  let tracing = true;
  let traceWindow = { phase: "start", start: Date.now() };
  const endTraceWindow = async () => {
    const filename = path.join(
      runRoot,
      `navigation-${traceWindow.phase}-trace.json`,
    );
    tracing = false;
    await finishTrace(cdp, filename);
    record.traces.push({
      ...traceWindow,
      end: Date.now(),
      filename,
    });
  };
  try {
    const start = Date.now();
    let nextProgress = start + 300_000;
    while (Date.now() - start < record.durationMs) {
      const range = page.locator(".pulse-history-range input");
      await range.focus();
      const m = session.manifest;
      const count = (Date.parse(m.to) - Date.parse(m.from)) / 86400000 + 1;
      const targets = [0];
      for (let offset = 365; offset < count - 1; offset += 365)
        targets.push(offset);
      targets.push(count - 1);
      for (const offset of targets) {
        if (offset === 0) await page.keyboard.press("Home");
        else if (offset === count - 1) await page.keyboard.press("End");
        else {
          await range.evaluate((input, value) => {
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set.call(input, String(value));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }, offset);
          await page.keyboard.press("ArrowRight");
          await page.keyboard.press("ArrowLeft");
        }
        const logicalDate = new Date(Date.parse(m.from) + offset * 86400000)
          .toISOString()
          .slice(0, 10);
        await page.waitForFunction((date) => {
          const input = document.querySelector(".pulse-history-range input");
          const day = document.querySelector(`.pulse-day[data-day="${date}"]`);
          return (
            input?.getAttribute("aria-valuetext") === date &&
            !!day &&
            !day.querySelector(".pulse-card-loading")
          );
        }, logicalDate);
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        assert.equal(await range.getAttribute("aria-valuetext"), logicalDate);
        const titles = await page
          .locator(`.pulse-day[data-day="${logicalDate}"] .pulse-album`)
          .evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute("aria-label") ?? ""),
          );
        assert(
          titles.every((title) => title.includes(m.sentinel)),
          "Navigation fixture sentinel",
        );
        const active =
          ((Date.parse(logicalDate) - Date.parse(m.from)) / 86400000) % 3 ===
            0 || logicalDate === m.to;
        assert.equal(titles.length > 0, active, "Settled target card presence");
        record.points.push({
          logicalDate,
          offset,
          titles,
          representativeRanks: titles.map((title) =>
            Number(/Disposable album (\d+)/.exec(title)?.[1]),
          ),
        });
      }
      const rail = page.locator(".pulse-rail");
      const box = await rail.boundingBox();
      assert(box);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(-720, 0);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 - 200,
        box.y + box.height / 2,
        { steps: 6 },
      );
      await page.mouse.up();
      await delay(100);
      const point = await page.evaluate(() => ({
        time: performance.now(),
        days: document.querySelectorAll(".pulse-day").length,
        cards: document.querySelectorAll(".pulse-album").length,
        images: document.querySelectorAll(".pulse-mode img").length,
        scroll: document.querySelector(".pulse-rail").scrollLeft,
        viewport: document.querySelector(".pulse-rail").clientWidth,
      }));
      // Fixture-specific, viewport-scaled envelope; never proportional to years
      // or the 1000-album count. Exact LRU/overscan behavior has unit coverage.
      const dayBound = Math.ceil(point.viewport / 64) + 8;
      assert(
        point.days <= dayBound,
        "Day DOM grew beyond its viewport envelope",
      );
      assert(point.cards <= dayBound * 4 + 32, "Album DOM is not bounded");
      record.points.push(point);
      if (Date.now() >= nextProgress) {
        console.error(
          `Navigation ${dataset}: ${Math.round((Date.now() - start) / 1000)}s; ` +
            `days=${point.days}, cards=${point.cards}, requests=${http.length}`,
        );
        nextProgress = Date.now() + 300_000;
      }
      if (record.points.length % 100 === 0)
        record.memory.push(await memory(session, "plateau"));
      if (!smoke && tracing && Date.now() - traceWindow.start >= 30_000)
        await endTraceWindow();
      if (
        !smoke &&
        !tracing &&
        traceWindow.phase === "start" &&
        Date.now() - start >= record.durationMs - 30_000
      ) {
        traceWindow = { phase: "end", start: Date.now() };
        await cdp.send("Tracing.start", {
          categories: "devtools.timeline,v8,blink.user_timing",
          transferMode: "ReturnAsStream",
        });
        tracing = true;
      }
    }
    const taskEnd = await page.evaluate(() => performance.now());
    record.taskWindow = {
      clock: "renderer performance.now",
      start: taskStart,
      end: taskEnd,
    };
    if (tracing) await endTraceWindow();
    record.memory.push(await memory(session, "end"));
    await delay(smoke ? 100 : 10000);
    record.memory.push(await memory(session, "idle"));
    record.heaps.push(await heapEvidence(session, "after-navigation"));
    record.longtasks = await page.evaluate(
      ({ start, end }) => ({
        supported: window.__pulseUiProbe.supportedLongtask,
        entries: window.__pulseUiProbe.tasks.filter(
          (t) => t.startTime >= start && t.startTime < end,
        ),
      }),
      { start: taskStart, end: taskEnd },
    );
    record.longtasks.countOver50Ms = record.longtasks.entries.filter(
      (t) => t.duration > 50,
    ).length;
    record.longtasks.maxMs = Math.max(
      0,
      ...record.longtasks.entries.map((t) => t.duration),
    );
    record.http = http.slice(record.httpStart);
    record.network = networkSummary(record.http);
    record.pendingRequests = inflight.size;
    record.pendingPulseRequests = [...inflight.values()].filter((r) =>
      r.endpoint.startsWith("/api/pulse/"),
    ).length;
    record.pageLimits = record.http
      .filter((r) => /\/days\/.*\/albums/.test(r.endpoint))
      .map((r) => ({
        query: r.query,
        within100:
          Number(new URLSearchParams(r.query).get("limit") || 20) <= 100,
      }));
    assert(
      record.pageLimits.every((entry) => entry.within100),
      "Unbounded page request",
    );
    record.completed = true;
  } catch (error) {
    record.error = String(error);
    throw error;
  } finally {
    if (tracing) await endTraceWindow();
  }
}
try {
  for (const dataset of ["ordinary", "ten-year"]) {
    for (let index = 0; index < launches; index++) {
      console.error(
        `Pulse UI ${dataset}: launch ${index + 1}/${launches}, ${coldScenario}`,
      );
      const session = await launch(dataset, index);
      if (coldScenario === "ready-panels") {
        if (electron) {
          await until(async () => {
            const info = await session.page.evaluate(() =>
              window.harborPlayerDesktop.getAppInfo(),
            );
            session.run.preColdAppInfo = info;
            return (
              info.nativeWindow.visible &&
              info.nativeWindow.focused &&
              !info.nativeWindow.minimized
            );
          }, "visible foreground native window");
        }
        await session.page.evaluate(() => document.fonts.ready);
        await until(
          async () =>
            [...session.inflight.values()].every(
              (request) => request.endpoint === "/api/events",
            ) &&
            (await session.page.evaluate(() => {
              const workspace = document.querySelector(".workspace");
              return (
                document.fonts.status === "loaded" &&
                document.visibilityState !== "hidden" &&
                document.hasFocus() &&
                !!workspace &&
                workspace.getAttribute("aria-busy") === "false" &&
                !workspace.querySelector("[role='alert']")
              );
            })),
          "ready panels without Pulse prewarm",
        );
        session.run.panelsReadiness = await session.page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  resolve({
                    clock:
                      "renderer performance.now since navigation time origin",
                    observedAtMs: performance.now(),
                    paints: performance
                      .getEntriesByType("paint")
                      .map((entry) => ({
                        name: entry.name,
                        startTime: entry.startTime,
                      })),
                    navigation: performance
                      .getEntriesByType("navigation")
                      .map((entry) => ({
                        domContentLoadedEventEnd:
                          entry.domContentLoadedEventEnd,
                        loadEventEnd: entry.loadEventEnd,
                      })),
                    visibility: document.visibilityState,
                    focused: document.hasFocus(),
                    fonts: document.fonts.status,
                  }),
                ),
              ),
            ),
        );
        session.run.lifecycle.panelsReadyMs =
          performance.now() - session.launchedAt;
      }
      session.run.lifecycle.coldCommandStartMs =
        performance.now() - session.launchedAt;
      await activation(session, dataset, "cold");
      session.run.lifecycle.coldCommandEndMs =
        performance.now() - session.launchedAt;
      if (electron && diagnostic)
        session.run.postColdAppInfo = await session.page.evaluate(() =>
          window.harborPlayerDesktop.getAppInfo(),
        );
      // Validate after the cold sample so SQLite/statement caches are not warmed
      // by the evidence checks. A wrong fixture still makes the run incomplete.
      session.run.fixtureVerified = await verifyFixture(
        session.origin,
        session.manifest,
      );
      await activation(session, dataset, "return");
      if (index === 0) {
        for (let i = 0; i < (smoke ? 2 : 30); i++) {
          await activation(session, dataset, "warm-immediate");
          await activation(session, dataset, "return");
        }
        if (!smoke) {
          await delay(31000);
          await activation(session, dataset, "warm-after-ttl");
          await activation(session, dataset, "return");
        }
        if (!latencyOnly) {
          await activation(session, dataset, "navigation-setup");
          await navigation(session, dataset);
        }
        if (latencyOnly) await mutationSamples(session, dataset);
      }
      await stop();
    }
  }
  evidence.completed = true;
} catch (error) {
  evidence.completed = false;
  evidence.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  try {
    await stop();
  } finally {
    evidence.summary = summarize(
      evidence.samples.filter((s) => s.kind !== "navigation-setup"),
      electron ? "electron" : "browser",
    );
    await writeFile(
      path.join(root, "summary.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          completed: evidence.completed,
          error: evidence.error,
          root,
          summary: evidence.summary,
        },
        null,
        2,
      ),
    );
  }
}
