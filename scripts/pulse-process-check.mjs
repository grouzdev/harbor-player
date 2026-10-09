// Run after: npm run build:server && npx vite build
// No mocked routes: two windows preload their own real WAV before the outage.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import Database from "better-sqlite3";

await mkdir(path.resolve(".test-data"), { recursive: true });
const root = await mkdtemp(path.resolve(".test-data/pulse-process-"));
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
      wav(40, 220 + i * 110),
    );
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child, exited, browser;
  let serverLog = "";
  const pids = [];
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
              audio.buffered.end(audio.buffered.length - 1) >= 39,
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
    for (const window of windows)
      await window.locator("audio").evaluate((audio) => audio.play());
    for (const window of windows)
      await until(() =>
        window.locator("audio").evaluate((audio) => audio.currentTime > 0.8),
      );
    await stop();
    const outageStarted = performance.now();
    await assert.rejects(
      fetch(`${origin}/api/session`),
      "Whole API must be absent",
    );
    await until(
      async () =>
        (await pending(page)).filter(
          (event) => !event.final && event.playedMs >= 14000,
        ).length === 2,
    );
    const checkpoint = (await pending(page)).find((event) => !event.final);
    assert(checkpoint);
    for (const window of windows)
      await until(() =>
        window.locator("audio").evaluate((audio) => audio.currentTime > 17),
      );
    const outageMs = Math.floor(performance.now() - outageStarted);
    assert(outageMs > 15000, "Actual API outage must exceed 15 seconds");
    for (const window of windows)
      await window.locator("audio").evaluate((audio) => audio.pause());
    await until(
      async () =>
        (await pending(page)).filter((event) => event.final).length === 2,
    );
    const durable = await pending(page);
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
      const result = {
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
      console.log(JSON.stringify(result));
    } finally {
      db.close();
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      await stop();
      await writeFile(path.join(dir, "server.log"), serverLog);
    }
  }
}
console.log(`PASS Chrome + Edge; artifacts: ${root}`);
