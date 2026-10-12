// npm run build && node scripts/pulse-ui-benchmark.mjs
// --smoke reduces counts/navigation, never constitutes acceptance.
// --latency-only retains full activation samples, skips navigation profiling.
// --electron uses HARBOR_PLAYER_DESKTOP_EXECUTABLE (Windows packaged artifact).
// --channel=chrome|msedge or HARBOR_PLAYER_CHROMIUM_EXECUTABLE for browser.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile, open } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { seedUiDataset } from "./pulse-ui-dataset.mjs";
import {
  installUiProbe,
  summarize,
  networkSummary,
} from "./pulse-ui-evidence.mjs";

const args = process.argv.slice(2);
assert(
  args.every(
    (a) =>
      a === "--smoke" ||
      a === "--latency-only" ||
      a === "--electron" ||
      /^--channel=(chrome|msedge)$/.test(a),
  ),
  "Unknown argument",
);
const smoke = args.includes("--smoke");
const latencyOnly = args.includes("--latency-only");
assert(!(smoke && latencyOnly), "Choose --smoke or --latency-only, not both");
const electron = args.includes("--electron");
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
const evidence = {
  version: 1,
  productionHtmlSha256: createHash("sha256")
    .update(productionHtml)
    .digest("hex"),
  root,
  target: electron ? "windows-packaged-electron" : "browser",
  smoke,
  latencyOnly,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().map((c) => c.model),
    totalMemory: os.totalmem(),
    otherLoad: "NOT CONTROLLED; record target-PC load separately",
  },
  protocol: {
    cold: "new owned server/Electron process + new browser process/profile per sample; OS filesystem cache not cleared",
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
  },
  limitations: [
    "Installed Windows manual acceptance NOT RUN",
    "Synthetic generated artwork fixture; real artwork/image/GPU memory NOT RUN",
    "Adapter LRU/TTL internal bounds not observable without runtime instrumentation; separate unit coverage required",
    "warm after listening events and clear NOT RUN (aggregate fixture has no raw ingestion history)",
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
    await page.evaluate(installUiProbe);
    run.appInfo = await page.evaluate(() =>
      window.harborPlayerDesktop.getAppInfo(),
    );
    assert.equal(
      run.appInfo.pulseBenchmark,
      true,
      "Packaged main must honor benchmark isolation",
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
    await context.addInitScript(installUiProbe);
    page = await context.newPage();
    await page.goto(origin);
  }
  evidence.environment.browserVersion = browser.version();
  await page.locator(".workspace").waitFor();
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
  return { page, cdp, http, inflight, runRoot, manifest, origin, run };
}
async function activation(session, dataset, kind) {
  const { page, http, inflight } = session;
  const first = http.length;
  if (!(await page.locator(".pulse-mode").count()))
    await page.locator(".workspace").focus();
  await page.evaluate(() => {
    window.__pulseUiProbe.sample = null;
  });
  await page.locator(".pulse-mode-toggle").click();
  try {
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
  }
  const sample = await page.evaluate(() => window.__pulseUiProbe.sample);
  if (!sample.returning) {
    const expected = session.manifest.representatives.at(-1);
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
  }
  sample.dataset = dataset;
  sample.kind = kind;
  sample.http = http.slice(first);
  sample.network = networkSummary(sample.http);
  sample.pendingRequests = inflight.size;
  sample.pendingPulseRequests = [...inflight.values()].filter((r) =>
    r.endpoint.startsWith("/api/pulse/"),
  ).length;
  sample.pendingEventStreams = [...inflight.values()].filter(
    (r) => r.endpoint === "/api/events",
  ).length;
  sample.longtasks = await page.evaluate(
    (start) => window.__pulseUiProbe.tasks.filter((t) => t.startTime >= start),
    sample.start,
  );
  evidence.samples.push(sample);
  await writeFile(
    path.join(root, "samples.json"),
    JSON.stringify(evidence.samples, null, 2),
  );
}
async function memory(cdp, phase) {
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
      rendererProcessMemory: "NOT SUPPORTED by this portable CDP probe",
      imageGpuMemory: "NOT MEASURED",
      gc: "natural; no forced GC in latency run",
    };
  } catch (e) {
    return { phase, unsupported: String(e) };
  }
}
async function navigation(session, dataset) {
  const { page, cdp, http, inflight, runRoot } = session;
  const record = {
    dataset,
    durationMs: smoke ? 2000 : 1800000,
    memory: [await memory(cdp, "before")],
    points: [],
    httpStart: http.length,
    completed: false,
  };
  const taskStart = await page.evaluate(() => performance.now());
  evidence.navigation.push(record);
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,v8,blink.user_timing",
    transferMode: "ReturnAsStream",
  });
  try {
    const start = Date.now();
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
      record.points.push(
        await page.evaluate(() => ({
          time: performance.now(),
          days: document.querySelectorAll(".pulse-day").length,
          cards: document.querySelectorAll(".pulse-album").length,
          images: document.querySelectorAll(".pulse-mode img").length,
          scroll: document.querySelector(".pulse-rail").scrollLeft,
        })),
      );
      if (record.points.length % 100 === 0)
        record.memory.push(await memory(cdp, "plateau"));
    }
    record.memory.push(await memory(cdp, "end"));
    await delay(smoke ? 100 : 10000);
    record.memory.push(await memory(cdp, "idle"));
    record.longtasks = await page.evaluate(
      (start) => ({
        supported: window.__pulseUiProbe.supportedLongtask,
        entries: window.__pulseUiProbe.tasks.filter(
          (t) => t.startTime >= start,
        ),
      }),
      taskStart,
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
    record.completed = true;
  } catch (error) {
    record.error = String(error);
    throw error;
  } finally {
    const completion = new Promise((resolve) =>
      cdp.once("Tracing.tracingComplete", resolve),
    );
    await cdp.send("Tracing.end");
    const { stream } = await completion;
    const file = await open(path.join(runRoot, "navigation-trace.json"), "w");
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
  }
}
try {
  for (const dataset of ["ordinary", "ten-year"]) {
    for (let index = 0; index < (smoke ? 1 : 10); index++) {
      const session = await launch(dataset, index);
      await activation(session, dataset, "cold");
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
