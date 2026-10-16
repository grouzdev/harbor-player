// Run after: npm run build:server && npx vite build
// No mocked routes: two windows preload their own real WAV before the outage.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { playbackStorage } from "./pulse-playback-storage.mjs";
import {
  captureCheckpointFailure,
  observeRequests,
  sqliteProbe,
} from "./pulse-process-diagnostics.mjs";

await mkdir(path.resolve(".test-data"), { recursive: true });
const root = await mkdtemp(path.resolve(".test-data/pulse-process-"));
async function hashFile(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
async function artifactHashes(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const hashes = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await artifactHashes(file));
    else if (entry.isFile()) hashes[file] = await hashFile(file);
  }
  return hashes;
}
const provenance = {
  gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty: Boolean(
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  ),
  nodeVersion: process.version,
  nodeExecutableSha256: await hashFile(process.execPath),
  sourceHashes: {
    ...(await artifactHashes("src/client")),
    ...(await artifactHashes("src/server")),
    ...(await artifactHashes("src/shared")),
    ...Object.fromEntries(
      await Promise.all(
        [
          "scripts/pulse-process-check.mjs",
          "scripts/pulse-process-diagnostics.mjs",
          "scripts/pulse-playback-storage.mjs",
          "scripts/pulse-ingest-evidence.mjs",
          "package-lock.json",
        ].map(async (file) => [file, await hashFile(file)]),
      ),
    ),
  },
  // Includes generated build info and client/server assets when present.
  distHashes: await artifactHashes("dist"),
};
await writeFile(
  path.join(root, "provenance.json"),
  JSON.stringify(provenance, null, 2),
);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(200);
  }
  throw new Error("Timed out waiting for condition");
}
async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return [4317, 4327].includes(port) ? freePort() : port;
}
function wav(seconds, frequency) {
  const samples = seconds * 8000;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * frequency) / 8000) * 1600),
      44 + i * 2,
    );
  return bytes;
}
async function pending(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("harbor-player-pulse", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const events = await new Promise((resolve, reject) => {
      const tx = db.transaction("events");
      const req = tx.objectStore("events").getAll();
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return events;
  });
}
for (const channel of ["chrome", "msedge"]) {
  const dir = path.join(root, channel);
  const dataDir = path.join(dir, "data");
  const library = path.join(dir, "music");
  await mkdir(library, { recursive: true });
  for (let i = 0; i < 2; i++)
    await writeFile(
      path.join(library, `Track-${i + 1}.wav`),
      wav(60, 220 + i * 110),
    );
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child, exited, browser, observer;
  let serverLog = "";
  const pids = [];
  const storage = [];
  const identity = { ...provenance, channel, browserVersion: null };
  async function snapshot(phase) {
    const db = new Database(path.join(dataDir, "catalog.sqlite"), {
      readonly: true,
    });
    try {
      storage.push(await playbackStorage(db, dataDir, phase));
      await writeFile(
        path.join(dir, "storage.json"),
        JSON.stringify(
          {
            provenance: identity,
            scope:
              "Short genuine generated-WAV playback; not yearly observation. No permitted originals supplied. Sizes are samples, not WAL peaks; no forced SQLite checkpoint.",
            storage,
          },
          null,
          2,
        ),
      );
    } finally {
      db.close();
    }
  }
  async function start() {
    child = spawn(process.execPath, ["dist/server/index.js", "--no-open"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HARBOR_PLAYER_PORT: String(port),
        HARBOR_PLAYER_DATA_DIR: dataDir,
        HARBOR_PLAYER_NO_OPEN: "1",
        HARBOR_PLAYER_DEV: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    pids.push(child.pid);
    exited = once(child, "exit");
    child.stdout.on("data", (bytes) => {
      serverLog += bytes;
    });
    child.stderr.on("data", (bytes) => {
      serverLog += bytes;
    });
    await until(async () => {
      if (child.exitCode !== null) throw new Error(serverLog);
      try {
        return (await fetch(`${origin}/api/session`)).ok;
      } catch {
        return false;
      }
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    // Never look up or terminate an unrelated PID, including the user's API.
    child.kill("SIGKILL");
    await exited;
  }
  try {
    await start();
    browser = await chromium.launchPersistentContext(
      path.join(dir, "profile"),
      {
        channel,
        headless: true,
        viewport: { width: 1600, height: 1000 },
      },
    );
    identity.browserVersion = browser.browser().version();
    observer = observeRequests(browser);
    // Preserve the browser side of a checkpoint timeout before closing the
    // profile. An empty ledger alone cannot distinguish stopped media from
    // recorder/outbox/delivery failures.
    await browser.addInitScript(() => {
      globalThis.pulseProcessTrace = [];
      const record = (kind, detail) => {
        globalThis.pulseProcessTrace.push({
          at: performance.now(),
          kind,
          detail,
        });
      };
      for (const name of [
        "playing",
        "pause",
        "waiting",
        "seeking",
        "seeked",
        "ended",
        "error",
      ])
        document.addEventListener(
          name,
          (event) => {
            if (event.target instanceof HTMLAudioElement)
              record(name, {
                currentTime: event.target.currentTime,
                paused: event.target.paused,
                readyState: event.target.readyState,
                error: event.target.error?.message ?? null,
              });
          },
          true,
        );
      window.addEventListener("harbor-pulse-status", (event) =>
        record("pulse-status", event.detail),
      );
      window.addEventListener("error", (event) =>
        record("window-error", event.message),
      );
      window.addEventListener("unhandledrejection", (event) =>
        record("unhandledrejection", String(event.reason)),
      );
    });
    const page = await browser.newPage();
    const api = browser.request;
    async function get(url) {
      const response = await api.get(origin + url);
      assert(response.ok(), `${url}: ${response.status()}`);
      return response.json();
    }
    async function post(url, body, method = "post") {
      const session = await get("/api/session");
      const response = await api[method](origin + url, {
        headers: { "X-CSRF-Token": session.csrf },
        data: body,
      });
      assert(
        response.ok(),
        `${url}: ${response.status()} ${await response.text()}`,
      );
      return response.json();
    }
    await post(
      "/api/pulse/settings",
      { enabled: false, timeZone: "UTC" },
      "patch",
    );
    await page.goto(origin);
    await expect(page.locator(".workspace")).toBeVisible();
    await page.locator(".add-library").click();
    await page.getByLabel("Путь к папке", { exact: true }).fill(library);
    await page.getByLabel("Название библиотеки", { exact: true }).fill(channel);
    await page.getByRole("button", { name: "Подключить", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .locator(".libraries-panel .list-tile")
      .filter({ hasText: channel })
      .locator(".list-tile-main")
      .click();
    await expect(page.getByTestId("track-row")).toHaveCount(2);
    const other = await browser.newPage();
    await other.goto(origin);
    await expect(other.locator(".workspace")).toBeVisible();
    await other
      .locator(".libraries-panel .list-tile")
      .filter({ hasText: channel })
      .locator(".list-tile-main")
      .click();
    await expect(other.getByTestId("track-row")).toHaveCount(2);
    const windows = [page, other];
    for (let i = 0; i < windows.length; i++) {
      await windows[i].getByTestId("track-row").nth(i).dblclick();
      await until(() =>
        windows[i]
          .locator("audio")
          .evaluate(
            (audio) =>
              audio.currentTime > 0.3 &&
              audio.buffered.length > 0 &&
              audio.buffered.end(audio.buffered.length - 1) >= 59,
          ),
      );
      await windows[i].locator("audio").evaluate((audio) => audio.pause());
    }
    const settings = await post(
      "/api/pulse/settings",
      { enabled: true, timeZone: "UTC" },
      "patch",
    );
    for (const window of windows)
      await window.evaluate(() =>
        globalThis.dispatchEvent(new Event("harbor-pulse-settings-changed")),
      );
    await wait(1200);
    await snapshot("enabled-before-playback");
    for (const window of windows)
      await window.locator("audio").evaluate((audio) => audio.play());
    for (const window of windows)
      await until(() =>
        window.locator("audio").evaluate((audio) => audio.currentTime > 0.8),
      );
    // Observe actual recorder checkpoints in SQLite before the API outage.
    try {
      await until(async () => {
        const db = new Database(path.join(dataDir, "catalog.sqlite"), {
          readonly: true,
        });
        try {
          return (
            db.prepare("SELECT count(*) n FROM pulse_intervals").get().n === 2
          );
        } finally {
          db.close();
        }
      });
    } catch (error) {
      try {
        const probes = {
          responses: () => Promise.all(observer.reads),
        };
        for (const table of ["pulse_settings", "pulse_intervals"])
          probes[table] = (signal) =>
            sqliteProbe(
              path.join(dataDir, "catalog.sqlite"),
              `SELECT * FROM ${table}`,
              signal,
            );
        for (const window of windows) {
          const id = observer.windowId(window);
          probes[`${id}.media`] = () =>
            window.locator("audio").evaluate((audio) => ({
              currentTime: audio.currentTime,
              src: audio.currentSrc,
              paused: audio.paused,
              ended: audio.ended,
              readyState: audio.readyState,
              networkState: audio.networkState,
              playbackRate: audio.playbackRate,
              error: audio.error?.message ?? null,
              buffered: Array.from(
                { length: audio.buffered.length },
                (_, i) => [audio.buffered.start(i), audio.buffered.end(i)],
              ),
              trace: globalThis.pulseProcessTrace,
            }));
          probes[`${id}.pending`] = () => pending(window);
        }
        await captureCheckpointFailure({
          file: path.join(dir, "checkpoint-failure.json"),
          error,
          provenance: identity,
          observer,
          probes,
        });
      } catch (diagnosticError) {
        // Artifact write failures must not replace the acceptance failure.
        console.error("Checkpoint diagnostic failure:", diagnosticError);
      }
      throw new Error(`Recorder checkpoint failed; evidence: ${dir}`, {
        cause: error,
      });
    }
    // SQLite acceptance alone is not an ACK: wait for client outbox removal.
    await until(async () => (await pending(page)).length === 0);
    const onlineDb = new Database(path.join(dataDir, "catalog.sqlite"), {
      readonly: true,
    });
    let online;
    try {
      online = onlineDb
        .prepare("SELECT * FROM pulse_intervals ORDER BY eventId")
        .all()
        .map((row) => ({
          eventId: row.eventId,
          revision: row.revision,
          playedMs: JSON.parse(row.payload).playedMs,
        }));
    } finally {
      onlineDb.close();
    }
    assert.equal(online.length, 2);
    const positions = await Promise.all(
      windows.map((window) =>
        window.locator("audio").evaluate((audio) => ({
          src: audio.currentSrc,
          currentTime: audio.currentTime,
        })),
      ),
    );
    const outageEvidence = {
      online,
      positions,
      onlineOutbox: await pending(page),
    };
    assert.equal(outageEvidence.onlineOutbox.length, 0);
    await writeFile(
      path.join(dir, "outage.json"),
      JSON.stringify(outageEvidence, null, 2),
    );
    await snapshot("acknowledged-playback-checkpoints");
    await stop();
    const outageStarted = performance.now();
    const outagePositions = await Promise.all(
      windows.map((window) =>
        window.locator("audio").evaluate((audio) => ({
          src: audio.currentSrc,
          currentTime: audio.currentTime,
        })),
      ),
    );
    // The server is now stopped: no later commit can invalidate this cutoff.
    const cutoffDb = new Database(path.join(dataDir, "catalog.sqlite"), {
      readonly: true,
    });
    let acceptedAtCutoff;
    try {
      acceptedAtCutoff = cutoffDb
        .prepare(
          "SELECT eventId,revision,payload FROM pulse_intervals ORDER BY eventId",
        )
        .all()
        .map((row) => ({
          eventId: row.eventId,
          revision: row.revision,
          playedMs: JSON.parse(row.payload).playedMs,
        }));
    } finally {
      cutoffDb.close();
    }
    const pendingAtCutoff = await pending(page);
    const cutoff = acceptedAtCutoff.map((accepted) => {
      const queued = pendingAtCutoff.find(
        (event) => event.eventId === accepted.eventId,
      );
      return {
        eventId: accepted.eventId,
        revision: Math.max(accepted.revision, queued?.revision ?? 0),
        playedMs: Math.max(accepted.playedMs, queued?.playedMs ?? 0),
      };
    });
    assert.equal(cutoff.length, 2);
    await assert.rejects(
      fetch(`${origin}/api/session`),
      "Whole API must be absent",
    );
    await until(async () => {
      const events = await pending(page);
      return cutoff.every((baseline) =>
        events.find(
          (event) =>
            event.eventId === baseline.eventId &&
            !event.final &&
            event.revision > baseline.revision &&
            event.playedMs - baseline.playedMs > 15000,
        ),
      );
    }, 45000);
    const offlineCheckpoints = await pending(page);
    const checkpoint = offlineCheckpoints.find((event) => !event.final);
    assert(checkpoint);
    await snapshot("offline-checkpoint-outbox-not-ingested");
    for (const [index, window] of windows.entries())
      await until(() =>
        window
          .locator("audio")
          .evaluate(
            (audio, baseline) =>
              audio.currentSrc === baseline.src &&
              audio.currentTime - baseline.currentTime > 15,
            outagePositions[index],
          ),
      );
    await until(() => performance.now() - outageStarted > 15000);
    const outageMs = performance.now() - outageStarted;
    assert(outageMs > 15000, "Actual API outage must exceed 15 seconds");
    const offlinePositions = await Promise.all(
      windows.map((window) =>
        window.locator("audio").evaluate((audio) => ({
          src: audio.currentSrc,
          currentTime: audio.currentTime,
        })),
      ),
    );
    await writeFile(
      path.join(dir, "outage.json"),
      JSON.stringify(
        {
          ...outageEvidence,
          acceptedAtCutoff,
          pendingAtCutoff,
          cutoff,
          outagePositions,
          offlinePositions,
          offlineCheckpoints,
          outageMs,
        },
        null,
        2,
      ),
    );
    for (const window of windows)
      await window.locator("audio").evaluate((audio) => audio.pause());
    await until(
      async () =>
        (await pending(page)).filter((event) => event.final).length === 2,
    );
    const durable = await pending(page);
    await writeFile(
      path.join(dir, "outbox.json"),
      JSON.stringify({ checkpoint, durable }, null, 2),
    );
    await snapshot("offline-final-outbox-not-ingested");
    assert.equal(new Set(durable.map((event) => event.track.id)).size, 2);
    assert.equal(new Set(durable.map((event) => event.sessionId)).size, 2);
    assert.equal(new Set(durable.map((event) => event.visitId)).size, 2);
    const final = durable.find((event) => event.eventId === checkpoint.eventId);
    assert(
      final.final &&
        final.revision > checkpoint.revision &&
        final.playedMs >= checkpoint.playedMs,
    );
    await assert.rejects(fetch(`${origin}/api/pulse/settings`));
    // Same on-disk browser profile and IndexedDB, same port and SQLite.
    await browser.close();
    browser = null;
    await start();
    browser = await chromium.launchPersistentContext(
      path.join(dir, "profile"),
      { channel, headless: true },
    );
    const reopened = await browser.newPage();
    const batches = [];
    reopened.on("request", (request) => {
      if (request.url() === `${origin}/api/listening-events`)
        batches.push(request.postDataJSON());
    });
    await reopened.goto(origin);
    await until(async () => (await pending(reopened)).length === 0, 90000);
    const expected = durable.reduce(
      (sum, event) => sum + Math.floor(event.playedMs),
      0,
    );
    const db = new Database(path.join(dataDir, "catalog.sqlite"), {
      readonly: true,
    });
    try {
      const rows = db.prepare("SELECT * FROM pulse_intervals").all();
      assert.equal(rows.length, durable.length);
      for (const event of durable) {
        const row = rows.find((row) => row.eventId === event.eventId);
        const stored = JSON.parse(row.payload);
        assert.equal(row.revision, event.revision);
        assert.equal(stored.playedMs, Math.floor(event.playedMs));
        assert.equal(stored.sessionId, event.sessionId);
        assert.equal(stored.visitId, event.visitId);
      }
      async function verify() {
        assert.equal(
          db.prepare("SELECT count(*) n FROM pulse_intervals").get().n,
          durable.length,
        );
        for (const table of [
          "pulse_days",
          "pulse_day_albums",
          "pulse_album_stats",
        ]) {
          assert.equal(
            db.prepare(`SELECT sum(playedMs) total FROM ${table}`).get().total,
            expected,
            table,
          );
        }
        for (const album of db
          .prepare("SELECT * FROM pulse_album_stats")
          .all()) {
          const stats = await (
            await browser.request.get(
              `${origin}/api/pulse/albums/${album.albumId}/stats`,
            )
          ).json();
          assert.equal(stats.playedMs, album.playedMs);
          const visits = new Set(
            rows
              .filter((row) => row.albumId === album.albumId)
              .map((row) => JSON.parse(row.payload).visitId),
          );
          assert.equal(
            db
              .prepare(
                "SELECT count(*) n FROM pulse_day_visits WHERE albumId=?",
              )
              .get(album.albumId).n,
            visits.size,
          );
        }
        for (const dayAlbum of db
          .prepare("SELECT * FROM pulse_day_albums")
          .all()) {
          const response = await browser.request.get(
            `${origin}/api/pulse/albums/${dayAlbum.albumId}/stats?day=${dayAlbum.dayKey}`,
          );
          assert(response.ok());
          const stats = await response.json();
          assert.equal(stats.dayPlayedMs, dayAlbum.playedMs);
          assert.equal(
            stats.dayTotalMs,
            db
              .prepare("SELECT playedMs FROM pulse_days WHERE dayKey=?")
              .get(dayAlbum.dayKey).playedMs,
          );
        }
      }
      await verify();
      await snapshot("acknowledged-finals");
      // Retry actual browser-delivered HTTP batches twice, then an older real
      // checkpoint. Cumulative revisions must not be added as separate listens.
      assert(batches.length > 0);
      const session = await (
        await browser.request.get(`${origin}/api/session`)
      ).json();
      const retry = async (batch) => {
        const response = await browser.request.post(
          `${origin}/api/listening-events`,
          {
            headers: { "X-CSRF-Token": session.csrf },
            data: batch,
          },
        );
        assert(response.ok(), await response.text());
      };
      for (let i = 0; i < 2; i++)
        for (const batch of batches) await retry(batch);
      const wire = batches
        .flatMap((batch) => batch.events)
        .find((event) => event.eventId === checkpoint.eventId);
      await retry({
        historyGeneration: settings.historyGeneration,
        events: [
          {
            ...wire,
            revision: checkpoint.revision,
            playedMs: Math.floor(checkpoint.playedMs),
            endedAtUtc: Math.floor(checkpoint.endedAt),
            final: false,
          },
        ],
      });
      await verify();
      await snapshot("duplicate-finals-and-stale-checkpoint-retried");
      const result = {
        provenance: identity,
        channel,
        origin,
        pids,
        expectedMs: expected,
        intervals: rows.length,
        tracks: 2,
        sessions: 2,
        visits: 2,
        checkpointRevision: checkpoint.revision,
        finalRevision: final.revision,
        retryBatches: batches.length,
        outageMs,
        dataDir,
        limitation:
          "Two genuine playback windows with prebuffered WAV, no route mocks. Sequential offline track switching unsupported. Not OS sleep or Electron crash.",
      };
      await writeFile(
        path.join(dir, "result.json"),
        JSON.stringify(result, null, 2),
      );
      console.log(
        JSON.stringify({
          ...result,
          provenance: {
            gitCommit: identity.gitCommit,
            dirty: identity.dirty,
            nodeVersion: identity.nodeVersion,
            nodeExecutableSha256: identity.nodeExecutableSha256,
            browserVersion: identity.browserVersion,
            fullIdentity: path.join(dir, "result.json"),
          },
        }),
      );
    } finally {
      db.close();
    }
  } finally {
    observer?.stop();
    try {
      await browser?.close();
    } finally {
      await stop();
      await writeFile(path.join(dir, "server.log"), serverLog);
    }
  }
}
console.log(`PASS Chrome + Edge; artifacts: ${root}`);
