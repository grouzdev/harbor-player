// Observes real packaged Electron. NEVER invokes sleep/hibernate or power setters.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import Database from "better-sqlite3";
import ffmpeg from "ffmpeg-static";
import {
  checkPhase,
  checkPowerCycle,
  checkTotals,
} from "./pulse-sleep-evidence.mjs";

const { values } = parseArgs({
  options: {
    smoke: { type: "boolean", default: false },
    "background-only": { type: "boolean", default: false },
    "physical-only": { type: "boolean", default: false },
    "power-mode": {
      type: "string",
      default: "operator-selected Windows Sleep (not hibernate)",
    },
  },
});
assert.equal(process.platform, "win32", "Physical Windows sleep verification");
const mode = values.smoke
  ? "smoke"
  : values["background-only"]
    ? "background-only"
    : values["physical-only"]
      ? "physical-only"
      : "physical";
const executable = path.resolve(
  process.env.HARBOR_PLAYER_DESKTOP_EXECUTABLE ||
    "release/win-unpacked/Harbor Player.exe",
);
const rootBase = path.resolve(".test-data");
await mkdir(rootBase, { recursive: true });
const root = await mkdtemp(path.join(rootBase, "pulse-sleep-"));
const library = path.join(root, "library");
await mkdir(library);
const powerFile = path.join(root, "power.jsonl");
const lifecycleFile = path.join(root, "lifecycle.jsonl");
await writeFile(powerFile, "");
await writeFile(lifecycleFile, "");
const evidence = {
  mode,
  root,
  state: "preparing",
  sleepGatePassed: false,
  environment: {
    windows: os.release(),
    node: process.version,
    powerMode: values["power-mode"],
  },
  samples: [],
  durable: [],
  requests: [],
  responses: [],
  acknowledgements: [],
  errors: [],
  phases: [],
};
evidence.environment.commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
try {
  execFileSync("git", ["diff", "--quiet"]);
  evidence.environment.workingTreeChanged = false;
} catch {
  evidence.environment.workingTreeChanged = true;
}
evidence.environment.appAsarSha256 = createHash("sha256")
  .update(
    await readFile(
      path.join(path.dirname(executable), "resources", "app.asar"),
    ),
  )
  .digest("hex");
try {
  evidence.environment.powerCapabilities = execFileSync("powercfg", ["/a"], {
    encoding: "utf8",
  });
} catch (error) {
  evidence.environment.powerCapabilities = `Unavailable: ${error.message}`;
}
execFileSync(ffmpeg, [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=2700",
  "-c:a",
  "libmp3lame",
  "-b:a",
  "64k",
  "-metadata",
  "title=Pulse sleep fixture",
  "-metadata",
  "album=Isolated sleep proof",
  path.join(library, "fixture.mp3"),
]);
let child,
  page,
  inspector,
  db,
  browser,
  cancelled = false;
const responseTasks = new Set();
process.once("SIGINT", () => {
  cancelled = true;
});
process.once("SIGTERM", () => {
  cancelled = true;
});
async function save(state) {
  evidence.state = state;
  evidence.lifecycle = await lifecycleEvents();
  await writeFile(
    path.join(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await writeFile(
    path.join(root, "status.json"),
    JSON.stringify(
      {
        state,
        mode,
        sleepGatePassed: evidence.sleepGatePassed,
        phases: evidence.phases,
        error: evidence.error,
        pid: child?.pid,
      },
      null,
      2,
    ),
  );
  console.log(`[pulse-sleep] ${state}; evidence: ${root}`);
}
async function until(read, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    assert(!cancelled, "Cancelled; physical sleep is not marked passed");
    assert(
      !child || (child.exitCode === null && child.signalCode === null),
      "Owned Electron exited",
    );
    const value = await read();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timeout: ${label}`);
}
async function lifecycleEvents() {
  return (await readFile(lifecycleFile, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return [4317, 4327].includes(port) ? freePort() : port;
}
async function powerEvents() {
  const text = await readFile(powerFile, "utf8");
  // Ignore a not-yet-terminated append, never invent a power event.
  return text
    .split("\n")
    .slice(0, -1)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
async function connectInspector(port) {
  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Inspector connection timeout")),
      15000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Inspector error"));
      },
      { once: true },
    );
  });
  let sequence = 0;
  return {
    close: () => socket.close(),
    async evaluate(expression) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error("Inspector response timeout")),
          15000,
        );
        const finish = (error, result) => {
          clearTimeout(timer);
          socket.removeEventListener("message", listener);
          if (error) reject(error);
          else resolve(result);
        };
        const listener = (message) => {
          const result = JSON.parse(message.data);
          if (result.id !== id) return;
          if (result.error || result.result.exceptionDetails)
            finish(new Error(JSON.stringify(result)));
          else finish(null, result.result.result.value);
        };
        socket.addEventListener("message", listener);
        socket.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
    },
  };
}
async function api(endpoint, method = "GET", body) {
  const origin = new URL(page.url()).origin;
  const session = await (
    await page.request.get(`${origin}/api/session`)
  ).json();
  const response = await page.request.fetch(`${origin}/api${endpoint}`, {
    method,
    headers: { "X-CSRF-Token": session.csrf },
    data: body,
  });
  assert(
    response.ok(),
    `${endpoint}: ${response.status()} ${await response.text()}`,
  );
  return response.json();
}
function snapshot() {
  return db.transaction(() => {
    const events = db
      .prepare("SELECT payload FROM pulse_intervals")
      .all()
      .map((row) => JSON.parse(row.payload));
    const result = {
      raw: events.reduce((sum, event) => sum + event.playedMs, 0),
      events,
      generation: db
        .prepare("SELECT historyGeneration FROM pulse_settings")
        .get().historyGeneration,
    };
    for (const [field, table] of [
      ["days", "pulse_days"],
      ["dayAlbums", "pulse_day_albums"],
      ["albumStats", "pulse_album_stats"],
    ])
      result[field] = db
        .prepare(`SELECT coalesce(sum(playedMs),0) total FROM ${table}`)
        .get().total;
    checkTotals(result);
    return result;
  })();
}
async function pending() {
  return page.evaluate(async () => {
    const storage = await new Promise((resolve, reject) => {
      const request = indexedDB.open("harbor-player-pulse", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = storage.transaction("events");
        const request = tx.objectStore("events").getAll();
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      storage.close();
    }
  });
}
async function pauseAndDrain() {
  await page.locator("audio").evaluate(async (audio) => {
    if (audio.paused) return;
    await new Promise((resolve) => {
      audio.addEventListener("pause", resolve, { once: true });
      audio.pause();
    });
  });
  const paused = await page.locator("audio").evaluate((audio) => ({
    position: audio.currentTime,
    rate: audio.playbackRate,
    paused: audio.paused,
    ended: audio.ended,
    readyState: audio.readyState,
    mono: performance.now(),
  }));
  assert(paused.paused, "Native audio did not pause");
  evidence.samples.push({ ...paused, name: "pause", wall: Date.now() });
  await until(
    async () =>
      (await pending()).length === 0 &&
      snapshot().events.every((event) => event.final),
    "final and durable drain",
  );
  await Promise.all([...responseTasks]);
  assert.equal(
    evidence.errors.length,
    0,
    "Observation/storage errors: see evidence",
  );
}
async function play() {
  await page.locator("audio").evaluate((audio) => audio.play());
}
async function boundary() {
  const sample = await page.locator("audio").evaluate((audio) => ({
    position: audio.currentTime,
    rate: audio.playbackRate,
    paused: audio.paused,
    ended: audio.ended,
    readyState: audio.readyState,
    mono: performance.now(),
  }));
  evidence.samples.push({ ...sample, name: "boundary", wall: Date.now() });
}
async function waitWithoutRenderer(ms) {
  const started = Date.now();
  await until(
    async () => {
      assert.equal(
        (await powerEvents()).filter((event) => event.name === "suspend")
          .length,
        0,
        "Background-only stage must not include OS sleep",
      );
      return Date.now() - started >= ms;
    },
    "background duration",
    ms + 15000,
  );
}
async function waitPowerCycle(start, label) {
  await save(label);
  console.log(
    "MANUAL ACTION: use Windows Sleep for 1–2 minutes, then wake. Do not use hibernate.",
  );
  const pair = await until(
    async () => {
      const events = (await powerEvents()).slice(start);
      return events.length >= 2 ? events : null;
    },
    "physical suspend/resume (15-minute operator deadline)",
    15 * 60_000,
  );
  checkPowerCycle(pair);
  return pair;
}
function finishPhase(name, before, sampleStart, power = [], paused = false) {
  const after = snapshot();
  const phase = {
    name,
    before,
    after,
    sampleStart,
    sampleEnd: evidence.samples.length,
    power,
  };
  // Preserve comparison inputs even when the acceptance check fails.
  evidence.phases.push(phase);
  phase.result = checkPhase({
    before,
    after,
    samples: evidence.samples.slice(sampleStart),
    power,
    paused,
  });
  return phase.result;
}
try {
  const apiPort = await freePort(),
    cdpPort = await freePort(),
    mainPort = await freePort();
  child = spawn(
    executable,
    [
      `--inspect=${mainPort}`,
      `--remote-debugging-port=${cdpPort}`,
      "--remote-debugging-address=127.0.0.1",
    ],
    {
      env: {
        ...process.env,
        HARBOR_PLAYER_DATA_DIR: path.join(root, "data"),
        HARBOR_PLAYER_PORT: String(apiPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  evidence.process = { pid: child.pid, apiPort, cdpPort, mainPort, output: "" };
  child.once("exit", (code, signal) => {
    evidence.process.exit = { code, signal, wall: Date.now() };
  });
  child.once("error", (error) => {
    evidence.errors.push(error.message);
  });
  child.stdout.on("data", (bytes) => {
    evidence.process.output += bytes;
  });
  child.stderr.on("data", (bytes) => {
    evidence.process.output += bytes;
  });
  await until(async () => {
    assert.equal(evidence.errors.length, 0);
    try {
      return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok;
    } catch {
      return false;
    }
  }, "owned Electron CDP");
  async function reconnectRenderer(label) {
    if (!browser?.isConnected()) {
      browser = await until(async () => {
        try {
          return await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        } catch {
          return null;
        }
      }, `${label} CDP`);
      browser.once("disconnected", () => {
        evidence.browserDisconnectedAt = Date.now();
      });
    }
    page = await until(
      () =>
        browser
          .contexts()[0]
          .pages()
          .find((candidate) =>
            candidate.url().startsWith(`http://127.0.0.1:${apiPort}/`),
          ),
      label,
    );
    await page.locator(".workspace").waitFor();
  }
  await reconnectRenderer("renderer");
  inspector = await connectInspector(mainPort);
  Object.assign(
    evidence.environment,
    await inspector.evaluate(`(() => {
    const require = process.getBuiltinModule("module").createRequire(process.execPath);
    const {app, powerMonitor, BrowserWindow} = require("electron");
    const fs = require("node:fs");
    const record = (name) => fs.appendFileSync(${JSON.stringify(powerFile)},
      JSON.stringify({name, source:"electron.powerMonitor", wall:Date.now(),
        mono:Number(process.hrtime.bigint())/1e6})+"\\n");
    const lifecycle = (name, detail) => fs.appendFileSync(${JSON.stringify(lifecycleFile)},
      JSON.stringify({name, detail, wall:Date.now(),
        mono:Number(process.hrtime.bigint())/1e6})+"\\n");
    powerMonitor.on("suspend", () => record("suspend"));
    powerMonitor.on("resume", () => record("resume"));
    globalThis.__pulseSleepWindow = BrowserWindow.getAllWindows()[0];
    __pulseSleepWindow.setTitle("Pulse sleep check — isolated test data");
    app.on("before-quit", () => lifecycle("app-before-quit"));
    app.on("will-quit", () => lifecycle("app-will-quit"));
    __pulseSleepWindow.on("closed", () => lifecycle("window-closed"));
    __pulseSleepWindow.webContents.on("render-process-gone", (_event, details) =>
      lifecycle("renderer-gone", details));
    __pulseSleepWindow.webContents.on("did-fail-load",
      (_event, code, description, url, isMainFrame) =>
        lifecycle("did-fail-load", {code, description, url, isMainFrame}));
    return {electron:process.versions.electron, chromium:process.versions.chrome,
      appVersion:require("electron").app.getVersion(),
      backgroundThrottling:__pulseSleepWindow.webContents.getLastWebPreferences().backgroundThrottling};
  })()`),
  );
  await page.exposeBinding("__pulseSleepObserve", (_source, observation) => {
    if (observation.kind === "native") evidence.samples.push(observation);
    else if (observation.kind === "durable") evidence.durable.push(observation);
    else evidence.errors.push(observation.message);
  });
  await page.addInitScript(() => {
    const send = (value) =>
      void window.__pulseSleepObserve(value).catch(() => {});
    const observeAudio = (audio) => {
      if (audio.dataset.pulseSleepObserved) return;
      audio.dataset.pulseSleepObserved = "1";
      for (const name of [
        "playing",
        "pause",
        "waiting",
        "timeupdate",
        "seeking",
        "seeked",
        "emptied",
        "error",
        "ended",
        "ratechange",
      ])
        audio.addEventListener(name, () =>
          send({
            kind: "native",
            name,
            wall: Date.now(),
            mono: performance.now(),
            position: audio.currentTime,
            rate: audio.playbackRate,
            paused: audio.paused,
            ended: audio.ended,
            readyState: audio.readyState,
          }),
        );
    };
    new MutationObserver(() =>
      document.querySelectorAll("audio").forEach(observeAudio),
    ).observe(document, { subtree: true, childList: true });
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = original.apply(this, args);
      if (this.name === "harbor-player-pulse" && tx.mode === "readwrite")
        tx.addEventListener("complete", () => {
          try {
            const read = original.call(this, ["events", "meta"]);
            const events = read.objectStore("events").getAll();
            const generation = read.objectStore("meta").get("generation");
            read.addEventListener("complete", () =>
              send({
                kind: "durable",
                wall: Date.now(),
                mono: performance.now(),
                events: events.result,
                generation: generation.result,
              }),
            );
            read.addEventListener("abort", () =>
              send({ kind: "error", message: "Observation IDB read aborted" }),
            );
          } catch (error) {
            send({ kind: "error", message: String(error) });
          }
        });
      return tx;
    };
  });
  page.on("request", (request) => {
    const endpoint = new URL(request.url()).pathname;
    if (["/api/listening-events", "/api/pulse/settings"].includes(endpoint))
      evidence.requests.push({
        wall: Date.now(),
        endpoint,
        body: request.postData() ? request.postDataJSON() : null,
      });
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname !== "/api/listening-events") return;
    const task = response
      .json()
      .then((result) => {
        evidence.responses.push({
          wall: Date.now(),
          status: response.status(),
          result,
        });
        if (response.ok())
          evidence.acknowledgements.push({
            wall: Date.now(),
            body: response.request().postDataJSON(),
            result,
          });
      })
      .catch((error) => evidence.errors.push(error.message));
    responseTasks.add(task);
    void task.finally(() => responseTasks.delete(task));
  });
  await api("/pulse/settings", "PATCH", { enabled: true, timeZone: "UTC" });
  const added = await api("/libraries", "POST", {
    name: "Sleep fixture",
    path: library,
  });
  await until(async () => {
    const job = (await api("/jobs")).find((item) => item.id === added.job.id);
    if (!job || ["queued", "running"].includes(job.status)) return false;
    assert.equal(job.status, "done");
    return true;
  }, "fixture scan");
  await page.reload();
  await page.getByTestId("track-row").first().dblclick();
  await page.locator("audio").evaluate((audio) => {
    audio.volume = 0.03;
  });
  await until(
    () =>
      evidence.acknowledgements.some((batch) =>
        batch.body.events.some((event) => !event.final),
      ),
    "confirmed foreground checkpoint",
  );
  db = new Database(path.join(root, "data", "catalog.sqlite"), {
    readonly: true,
  });
  await pauseAndDrain();

  if (mode !== "physical-only") {
    const backgroundBefore = snapshot(),
      backgroundStart = evidence.samples.length;
    await play();
    await inspector.evaluate("__pulseSleepWindow.minimize()");
    await save("background playback — do NOT sleep the PC yet");
    await waitWithoutRenderer(values.smoke ? 2000 : 10 * 60_000);
    await inspector.evaluate(
      "__pulseSleepWindow.restore(); __pulseSleepWindow.show()",
    );
    await pauseAndDrain();
    finishPhase("background", backgroundBefore, backgroundStart);
    await save(
      values.smoke
        ? "smoke complete — NOT a physical sleep PASS"
        : "10-minute background complete",
    );
  } else {
    await save("physical-only diagnostic — background stage skipped");
  }

  if (mode === "physical" || mode === "physical-only") {
    const before = snapshot(),
      start = evidence.samples.length;
    await play();
    await until(
      () =>
        evidence.durable.some((record) =>
          record.events.some(
            (event) =>
              !event.final &&
              event.playedMs >= 14000 &&
              !before.events.some((old) => old.eventId === event.eventId),
          ),
        ),
      "durable pre-sleep checkpoint",
    );
    const pair = await waitPowerCycle(
      (await powerEvents()).length,
      "READY_SLEEP_PLAYBACK",
    );
    await reconnectRenderer("renderer after playback wake");
    const resumed = await page.locator("audio").evaluate((audio) => ({
      paused: audio.paused,
      position: audio.currentTime,
      rate: audio.playbackRate,
      ended: audio.ended,
      readyState: audio.readyState,
      mono: performance.now(),
    }));
    if (resumed.paused) {
      evidence.samples.push({ ...resumed, name: "pause", wall: Date.now() });
      console.log(
        "MANUAL ACTION: click Play in the isolated Electron window; no automatic resume.",
      );
    } else {
      evidence.samples.push({ ...resumed, name: "playing", wall: Date.now() });
    }
    let postWakePlayingObserved = !resumed.paused;
    await until(
      async () => {
        const sample = await page.locator("audio").evaluate((audio) => ({
          position: audio.currentTime,
          rate: audio.playbackRate,
          paused: audio.paused,
          ended: audio.ended,
          readyState: audio.readyState,
          mono: performance.now(),
        }));
        evidence.samples.push({
          ...sample,
          name:
            !sample.paused && !postWakePlayingObserved
              ? "playing"
              : "post-wake-poll",
          wall: Date.now(),
        });
        if (!sample.paused) postWakePlayingObserved = true;
        return !sample.paused && sample.position >= resumed.position + 20;
      },
      "20s confirmed post-wake playback",
      15 * 60_000,
    );
    await pauseAndDrain();
    finishPhase("sleep-playing", before, start, pair);
    if (mode === "physical") {
      const idleBefore = snapshot(),
        idleStart = evidence.samples.length;
      await boundary();
      const idleRequests = evidence.requests.length;
      const idlePair = await waitPowerCycle(
        (await powerEvents()).length,
        "READY_SLEEP_PAUSED",
      );
      await reconnectRenderer("renderer after paused wake");
      await delay(16000); // Three real idle flush periods after wake.
      await boundary();
      assert(await page.locator("audio").evaluate((audio) => audio.paused));
      assert.equal((await pending()).length, 0);
      assert.equal(
        evidence.requests.length,
        idleRequests,
        "Idle history HTTP after wake",
      );
      finishPhase("sleep-paused", idleBefore, idleStart, idlePair, true);
      const recoveryBefore = snapshot(),
        recoveryStart = evidence.samples.length;
      await play();
      const recovery = await page.locator("audio").evaluate((audio) => ({
        position: audio.currentTime,
        rate: audio.playbackRate,
        paused: audio.paused,
        ended: audio.ended,
        readyState: audio.readyState,
        mono: performance.now(),
      }));
      evidence.samples.push({ ...recovery, name: "playing", wall: Date.now() });
      await until(async () => {
        const sample = await page.locator("audio").evaluate((audio) => ({
          position: audio.currentTime,
          rate: audio.playbackRate,
          paused: audio.paused,
          ended: audio.ended,
          readyState: audio.readyState,
          mono: performance.now(),
        }));
        evidence.samples.push({
          ...sample,
          name: "recovery-poll",
          wall: Date.now(),
        });
        return !sample.paused && sample.position > recovery.position + 2;
      }, "explicit recovery playback");
      await pauseAndDrain();
      finishPhase("recovery", recoveryBefore, recoveryStart);
      evidence.sleepGatePassed = true;
    }
  }
  evidence.power = await powerEvents();
  assert(!cancelled, "Cancelled; verification cannot be marked passed");
  evidence.ok = true;
  await save(
    mode === "physical"
      ? "PASS — physical sleep gate"
      : `PASS ${mode} — physical sleep remains pending`,
  );
} catch (error) {
  evidence.error = error.stack || String(error);
  await save(
    evidence.error.includes("INCONCLUSIVE") ? "INCONCLUSIVE" : "FAILED",
  );
  throw error;
} finally {
  db?.close();
  inspector?.close();
  if (child && child.exitCode === null && child.signalCode === null)
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  await writeFile(
    path.join(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
}
