// Real packaged Electron, real audio, disposable data only. No fake clocks.
// Optional readonly dependencies: HARBOR_PLAYER_PLAYWRIGHT_MODULE (file URL),
// HARBOR_PLAYER_FFMPEG. HARBOR_PLAYER_DESKTOP_EXECUTABLE selects the artifact.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as pollDelay } from "node:timers/promises";

const { chromium } = await import(
  process.env.HARBOR_PLAYER_PLAYWRIGHT_MODULE || "playwright"
);
const executable = path.resolve(
  process.env.HARBOR_PLAYER_DESKTOP_EXECUTABLE ||
    "release/win-unpacked/Harbor Player.exe",
);
assert.equal(process.platform, "win32", "Windows packaged harness");
const rootBase = path.resolve(".test-data");
await mkdir(rootBase, { recursive: true });
const root = await mkdtemp(path.join(rootBase, "pulse-desktop-"));
const library = path.join(root, "library");
await mkdir(library);
let child;
let browser;
const evidence = { executable, root, runs: [], accepted: [] };
const ffmpeg =
  process.env.HARBOR_PLAYER_FFMPEG || (await import("ffmpeg-static")).default;
execFileSync(ffmpeg, [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=120",
  "-c:a",
  "libmp3lame",
  "-metadata",
  "title=Pulse desktop fixture",
  "-metadata",
  "album=Disposable desktop album",
  path.join(library, "fixture.mp3"),
]);
async function until(read, label, timeout = 45000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await read();
    if (value) return value;
    await pollDelay(100); // Condition polling, never a simulated listening delay.
  }
  throw new Error(`Timeout: ${label}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert(![4317, 4327].includes(port));
  return port;
}
const apiPort = await freePort(); // Reused after crash: preserve IndexedDB origin.
evidence.apiPort = apiPort;
async function killOwnedTree() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const owned = child;
  // Never image-name/global kills. /T is restricted to this spawned root PID.
  execFileSync("taskkill", ["/PID", String(owned.pid), "/T", "/F"]);
  await until(
    () => owned.exitCode !== null || owned.signalCode !== null,
    "owned process exit",
  );
  child = undefined;
}
async function launch() {
  const port = await freePort();
  const inspectorPort = await freePort();
  child = spawn(
    executable,
    [
      `--inspect=${inspectorPort}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--autoplay-policy=no-user-gesture-required",
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
  const run = { pid: child.pid, cdpPort: port, inspectorPort, output: "" };
  evidence.runs.push(run);
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  child.stdout.on("data", (chunk) => {
    run.output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    run.output += chunk;
  });
  await until(async () => {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Electron exited before CDP: ${run.output}`);
    try {
      return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch {
      return false;
    }
  }, "CDP ready");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await until(
    () =>
      browser
        .contexts()[0]
        .pages()
        .find((candidate) => /^http:\/\/127\.0\.0\.1:/.test(candidate.url())),
    "Electron renderer",
  );
  await page.locator(".workspace").waitFor();
  assert(![4317, 4327].includes(Number(new URL(page.url()).port)));
  run.origin = new URL(page.url()).origin;
  assert.equal(Number(new URL(run.origin).port), apiPort);
  return page;
}
async function api(page, endpoint, method = "GET", body) {
  const session = await (
    await page.request.get(`${new URL(page.url()).origin}/api/session`)
  ).json();
  const response = await page.request.fetch(
    `${new URL(page.url()).origin}/api${endpoint}`,
    {
      method,
      headers: { "X-CSRF-Token": session.csrf },
      data: body,
    },
  );
  assert(
    response.ok(),
    `${endpoint}: ${response.status()} ${await response.text()}`,
  );
  return response.json();
}
function observe(page, label) {
  page.on("response", async (response) => {
    if (!response.url().endsWith("/api/listening-events") || !response.ok())
      return;
    const body = response.request().postDataJSON();
    const result = await response.json();
    evidence.accepted.push({ label, body, result });
  });
}
function latestEvents() {
  const events = new Map();
  for (const batch of evidence.accepted)
    for (const event of batch.body.events)
      if ((events.get(event.eventId)?.revision ?? 0) < event.revision)
        events.set(event.eventId, event);
  return [...events.values()];
}
async function startAudio(page) {
  await page.getByTestId("track-row").first().dblclick();
  await until(
    () =>
      page
        .locator("audio")
        .evaluate((audio) => !audio.paused && audio.currentTime > 0.5),
    "real audio progression",
  );
}
try {
  let page = await launch();
  await api(page, "/pulse/settings", "PATCH", {
    enabled: true,
    timeZone: "UTC",
  });
  const added = await api(page, "/libraries", "POST", {
    name: "Disposable",
    path: library,
  });
  await until(async () => {
    const job = (await api(page, "/jobs")).find(
      (job) => job.id === added.job.id,
    );
    if (!job || ["queued", "running"].includes(job.status)) return false;
    assert.equal(job.status, "done");
    return true;
  }, "scan");
  await page.reload();
  observe(page, "crash");
  await startAudio(page);
  evidence.audioSamples = [];
  await until(async () => {
    evidence.audioSamples.push(
      await page.locator("audio").evaluate((audio) => ({
        time: audio.currentTime,
        paused: audio.paused,
        ended: audio.ended,
        readyState: audio.readyState,
        error: audio.error?.message,
        rate: audio.playbackRate,
        duration: audio.duration,
      })),
    );
    return evidence.accepted.some((batch) =>
      batch.body.events.some((event) => !event.final),
    );
  }, "confirmed checkpoint");
  const checkpoint = latestEvents();
  const albumId = evidence.accepted[0].result.acknowledgements[0].albumId;
  const checkpointMs = checkpoint.reduce(
    (sum, event) => sum + event.playedMs,
    0,
  );
  assert.equal(
    (await api(page, `/pulse/albums/${albumId}/stats`)).playedMs,
    checkpointMs,
  );
  const audioAtCrash = await page
    .locator("audio")
    .evaluate((audio) => audio.currentTime);
  await killOwnedTree();
  page = await launch();
  const restored = await api(page, `/pulse/albums/${albumId}/stats`);
  assert.equal(
    restored.playedMs,
    checkpointMs,
    "confirmed checkpoint survives forced tree termination",
  );
  const tailMs = audioAtCrash * 1000 - checkpointMs;
  assert(tailMs >= -1000 && tailMs < 17000, `lost tail ${tailMs}`);
  evidence.crash = {
    checkpointMs,
    restoredMs: restored.playedMs,
    audioAtCrash,
    tailMs,
    limitMs: 17000,
    note: "media position bounds observed tail; no system clock changes",
  };

  // A second crash leaves a real recorder checkpoint committed in IndexedDB
  // but not acknowledged by the backend. Same port preserves the outbox origin.
  await page.route("**/api/listening-events", (route) => route.abort("failed"));
  await startAudio(page);
  const pending = await until(
    () =>
      page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("harbor-player-pulse", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const events = await new Promise((resolve, reject) => {
          const tx = db.transaction("events");
          const request = tx.objectStore("events").getAll();
          tx.oncomplete = () => resolve(request.result);
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
        db.close();
        return events.find((event) => !event.final && event.playedMs >= 15000);
      }),
    "durable unacknowledged IndexedDB checkpoint",
  );
  assert.equal(
    (await api(page, `/pulse/albums/${albumId}/stats`)).playedMs,
    checkpointMs,
  );
  await killOwnedTree();
  page = await launch();
  observe(page, "pending-restart");
  const pendingMs = Math.floor(pending.playedMs);
  await until(
    async () =>
      (await api(page, `/pulse/albums/${albumId}/stats`)).playedMs ===
      checkpointMs + pendingMs,
    "pending checkpoint delivered after same-origin restart",
  );
  assert(await page.locator("audio").evaluate((audio) => audio.paused));
  // Replay the same cumulative checkpoint: ingestion must not count it twice.
  const replay = {
    historyGeneration: pending.historyGeneration,
    events: [
      {
        eventId: pending.eventId,
        revision: pending.revision,
        trackId: pending.track.id,
        albumKey: pending.track.albumKey,
        snapshot: {
          title: pending.track.albumTitle,
          artists: pending.track.albumArtists.length
            ? pending.track.albumArtists
            : pending.track.artists,
          year: pending.track.year ?? null,
          coverId: pending.track.coverId ?? null,
        },
        sessionId: pending.sessionId,
        visitId: pending.visitId,
        startedAtUtc: Math.floor(pending.startedAt),
        endedAtUtc: Math.floor(pending.endedAt),
        playedMs: pendingMs,
        final: pending.final,
      },
    ],
  };
  const replayResult = await api(page, "/listening-events", "POST", replay);
  evidence.accepted.push({
    label: "pending-replay",
    body: replay,
    result: replayResult,
  });
  assert.equal(
    (await api(page, `/pulse/albums/${albumId}/stats`)).playedMs,
    checkpointMs + pendingMs,
  );
  evidence.pendingRestart = {
    eventId: pending.eventId,
    pendingMs,
    restoredMs: checkpointMs + pendingMs,
    paused: true,
    replayCountedOnce: true,
  };
  checkpoint.push(...replay.events);

  // Electron does not support CDP Target.createTarget. Use its own main
  // inspector to instantiate a real sandboxed BrowserWindow, no app edits.
  const inspectorPort = evidence.runs.at(-1).inspectorPort;
  const targets = await (
    await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)
  ).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.close();
      resolve({ error: "Main inspector response timed out" });
    }, 15000);
    socket.addEventListener("message", (message) => {
      const value = JSON.parse(message.data);
      if (value.id === 1) {
        clearTimeout(timeout);
        resolve(value);
      }
    });
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => {
        const {BrowserWindow} = process.getBuiltinModule("module").createRequire(process.execPath)("electron");
        const window = new BrowserWindow({width:1100,height:800,
          webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        return window.loadURL(${JSON.stringify(page.url())}).then(() => window.id);
      })()`,
          awaitPromise: true,
          returnByValue: true,
        },
      }),
    );
  });
  socket.close();
  assert(
    !result.error && !result.result.exceptionDetails,
    JSON.stringify(result),
  );
  const second = await until(
    () =>
      browser
        .contexts()[0]
        .pages()
        .find(
          (candidate) => candidate !== page && candidate.url() === page.url(),
        ),
    "second Electron target",
  );
  await second.locator(".workspace").waitFor();
  observe(page, "window-one");
  observe(second, "window-two");
  await Promise.all([startAudio(page), startAudio(second)]);
  const newEvents = () =>
    latestEvents().filter(
      (event) => !checkpoint.some((old) => old.eventId === event.eventId),
    );
  // Shared-origin windows share an outbox; either window can deliver both
  // sessions. Request sender is not the recorder identity.
  await until(
    () => new Set(newEvents().map((event) => event.sessionId)).size === 2,
    "both concurrent checkpoints",
  );
  const positions = await Promise.all(
    [page, second].map((target) =>
      target.locator("audio").evaluate((audio) => ({
        paused: audio.paused,
        time: audio.currentTime,
      })),
    ),
  );
  assert(positions.every((position) => !position.paused && position.time > 10));
  await Promise.all(
    [page, second].map((target) =>
      target.locator("audio").evaluate((audio) => audio.pause()),
    ),
  );
  await until(
    () => newEvents().length === 2 && newEvents().every((event) => event.final),
    "both final acknowledgements",
  );
  const latest = latestEvents();
  const concurrent = latest.filter(
    (event) => !checkpoint.some((old) => old.eventId === event.eventId),
  );
  assert.equal(new Set(concurrent.map((event) => event.sessionId)).size, 2);
  assert.equal(
    concurrent.length,
    2,
    "one recorder event per uninterrupted window",
  );
  const exactMs = latest.reduce((sum, event) => sum + event.playedMs, 0);
  assert.equal(
    (await api(page, `/pulse/albums/${albumId}/stats`)).playedMs,
    exactMs,
  );
  evidence.concurrent = {
    positions,
    events: concurrent.length,
    sessions: 2,
    exactMs,
  };
  evidence.ok = true;
  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        crash: evidence.crash,
        pendingRestart: evidence.pendingRestart,
        concurrent: evidence.concurrent,
      },
      null,
      2,
    ),
  );
} catch (error) {
  evidence.error = String(error.stack || error);
  throw error;
} finally {
  try {
    await killOwnedTree();
  } finally {
    await writeFile(
      path.join(root, "evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(`Retained disposable fixtures/evidence: ${root}`);
  }
}
