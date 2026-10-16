// Uses accepted actual-process data, never seeds events or writes its database.
// node scripts/pulse-process-cover-ui.mjs --data-dir .test-data/pulse-process-gkeMXQ/chrome/data --channel chrome
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import Database from "better-sqlite3";
import {
  copyStoppedPulseFixture,
  populatedDayOffset,
} from "./pulse-process-cover-evidence.mjs";

const args = process.argv.slice(2);
assert.equal(args.length, 4, "Require --data-dir PATH --channel chrome|msedge");
const options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(
    ["--data-dir", "--channel"].includes(args[i]) && !options[args[i]],
    "Unknown/duplicate option",
  );
  options[args[i]] = args[i + 1];
}
const channel = options["--channel"];
assert(["chrome", "msedge"].includes(channel), "Unsupported channel");
const project = await realpath(".");
const source = path.resolve(options["--data-dir"]);
assert.match(
  path.relative(project, source).split(path.sep).join("/"),
  new RegExp(`^\\.test-data/pulse-process-[^/]+/${channel}/data$`),
);
// Reject symlinks in every path component and throughout the copied tree.
async function noLinks(file, recursive = false) {
  const stat = await lstat(file);
  assert(!stat.isSymbolicLink(), `Symlink rejected: ${file}`);
  assert(stat.isDirectory() || stat.isFile(), `Special file rejected: ${file}`);
  if (recursive && stat.isDirectory())
    for (const entry of await readdir(file))
      await noLinks(path.join(file, entry), true);
}
let component = project;
for (const part of path.relative(project, source).split(path.sep)) {
  component = path.join(component, part);
  await noLinks(component);
}
assert.equal(await realpath(source), source);
await noLinks(source, true);
const root = await mkdtemp(
  path.join(project, ".test-data/pulse-process-cover-ui-"),
);
const data = path.join(root, channel, "data");
await mkdir(path.dirname(data), { recursive: true });
const sourceGuard = await copyStoppedPulseFixture(source, data);
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const provenance = {
  source,
  data,
  channel,
  node: process.version,
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty: Boolean(
    execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim(),
  ),
  scriptSha256: await hash("scripts/pulse-process-cover-ui.mjs"),
  helperSha256: await hash("scripts/pulse-process-cover-evidence.mjs"),
  serverSha256: await hash("dist/server/index.js"),
  sourceSnapshot: sourceGuard.snapshot,
  scope:
    "Copied actual-process ledger; no seed, DB edits, build, native or image-memory measurement.",
};
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child,
  browser,
  log = "",
  failure;
const evidence = { provenance, origin, phases: [] };
const backups = [];
// Hard wall-clock bound includes teardown if browser/server hangs.
const watchdog = setTimeout(() => {
  child?.kill("SIGKILL");
  console.error(`Diagnostic exceeded 120 seconds; artifacts: ${root}`);
  process.exit(1);
}, 120000);
const duration = (ms) => {
  const minutes = Math.round(ms / 60000);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
    : `${minutes} мин`;
};
try {
  child = spawn(process.execPath, ["dist/server/index.js", "--no-open"], {
    env: {
      ...process.env,
      HARBOR_PLAYER_PORT: String(port),
      HARBOR_PLAYER_DATA_DIR: data,
      HARBOR_PLAYER_NO_OPEN: "1",
      HARBOR_PLAYER_DEV: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (bytes) => {
    log += bytes;
  });
  child.stderr.on("data", (bytes) => {
    log += bytes;
  });
  child.on("error", (error) => {
    failure = error;
  });
  const deadline = Date.now() + 30000;
  while (true) {
    if (failure) throw failure;
    assert(child.exitCode === null, log);
    try {
      if (
        (
          await fetch(`${origin}/api/session`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        break;
    } catch {}
    assert(Date.now() < deadline, "Server readiness timeout");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await chromium.launch({ channel, headless: true, timeout: 20000 });
  provenance.browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const get = async (url) => {
    const response = await context.request.get(origin + url, {
      timeout: 10000,
    });
    assert(response.ok(), `${url}: ${response.status()}`);
    return response.json();
  };
  await get("/api/session");
  const range = await get("/api/pulse/history-range");
  assert(range.lastDay, "Actual fixture has no listening history");
  const day = sourceGuard.snapshot.latestDay;
  const albums = await get(`/api/pulse/days/${day}/albums?offset=0&limit=100`);
  const album = albums.items.find((item) => item.coverId);
  assert(album, "Require actual album with archived cover");
  assert.match(album.coverId, /^[a-f0-9]+\.(png|jpe?g)$/);
  const statsUrl = `/api/pulse/albums/${encodeURIComponent(album.albumId)}/stats?day=${day}`;
  const stats = await get(statsUrl);
  const db = new Database(path.join(data, "catalog.sqlite"), {
    readonly: true,
  });
  try {
    const rows = db
      .prepare("SELECT payload FROM pulse_intervals WHERE albumId=?")
      .all(album.albumId);
    assert(rows.length > 0);
    assert.equal(
      rows.reduce((sum, row) => sum + JSON.parse(row.payload).playedMs, 0),
      stats.playedMs,
    );
    evidence.ledger = rows.map((row) => JSON.parse(row.payload));
  } finally {
    db.close();
  }
  evidence.album = album;
  evidence.stats = stats;
  const archive = path.join(data, "pulse-covers", `${album.coverId}.archive`);
  const cache = path.join(data, "covers", album.coverId);
  const originalHash = await hash(path.join(archive, "image"));
  async function inspect(phase, healthy) {
    const coverResponse = await context.request.get(
      `${origin}/api/covers/${encodeURIComponent(album.coverId)}`,
      { timeout: 10000 },
    );
    const coverBytes = await coverResponse.body();
    const coverHttp = {
      status: coverResponse.status(),
      bytes: coverBytes.length,
      sha256: createHash("sha256").update(coverBytes).digest("hex"),
    };
    assert.equal(
      coverHttp.status,
      phase === "missing-archive-and-cache" ? 404 : 200,
    );
    if (healthy) assert.equal(coverHttp.sha256, originalHash);
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (!(await page.locator(".pulse-mode").count()))
      await page.locator(".pulse-mode-toggle").click();
    const slider = page.getByRole("slider", { name: "Дата на таймлайне" });
    await slider.waitFor();
    // The range extends to today; accepted playback may be from an older day.
    const maximum = Number(await slider.getAttribute("max"));
    const offset = populatedDayOffset(maximum, range.lastDay, day);
    await slider.evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    }, offset);
    await expect(slider).toHaveAttribute("aria-valuetext", day);
    const card = page
      .locator(`.pulse-day[data-day="${day}"]`)
      .getByRole("button", {
        name: new RegExp(
          `^${album.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`,
        ),
      });
    await card.click();
    await expect(page.locator(".pulse-copy h2")).toHaveText(album.title);
    await expect(page.locator(".pulse-stat-numbers strong")).toHaveText([
      duration(stats.playedMs),
      String(stats.dayCount),
      String(stats.sameDayReturns),
    ]);
    await expect(page.locator(".pulse-copy small")).toHaveText(
      `${duration(stats.dayPlayedMs)} за этот день`,
    );
    await expect(page.locator(".pulse-share strong")).toHaveText(
      `${Math.round((stats.dayPlayedMs / stats.dayTotalMs) * 100)}%`,
    );
    const image = page.locator(".pulse-selected img");
    await expect(image).toHaveCount(1);
    await expect
      .poll(() =>
        image.evaluate(
          (img, healthy) =>
            img.complete &&
            (healthy
              ? img.naturalWidth > 0
              : img.naturalWidth === 0 &&
                getComputedStyle(img).visibility === "hidden"),
          healthy,
        ),
      )
      .toBe(true);
    assert.deepEqual(
      await get(statsUrl),
      stats,
      "Cover damage changed statistics",
    );
    const result = {
      phase,
      day,
      coverHttp,
      title: await page.locator(".pulse-copy h2").innerText(),
      statistics: await page.locator(".pulse-statistics").innerText(),
      image: await image.evaluate((img) => ({
        src: img.currentSrc,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        visibility: getComputedStyle(img).visibility,
      })),
    };
    evidence.phases.push(result);
    console.log(JSON.stringify(result));
  }
  await inspect("normal", true);
  for (const file of [archive, cache]) {
    try {
      await rename(file, `${file}.cover-ui-backup`);
      backups.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  assert(backups.includes(archive));
  await inspect("missing-archive-and-cache", false);
  await mkdir(archive);
  await writeFile(
    path.join(archive, "image"),
    "deliberately invalid image bytes\n",
  );
  await writeFile(cache, "deliberately invalid image bytes\n");
  await inspect("corrupt-same-cover-id", false);
  evidence.originalCoverSha256 = originalHash;
  evidence.pass = true;
} catch (error) {
  evidence.failure = error.stack || String(error);
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
    }
    for (const file of backups.reverse()) {
      await rm(file, { recursive: true, force: true });
      await rename(`${file}.cover-ui-backup`, file);
    }
    // Cache may originally have been absent.
    if (
      evidence.album &&
      !backups.includes(path.join(data, "covers", evidence.album.coverId))
    )
      await rm(path.join(data, "covers", evidence.album.coverId), {
        force: true,
      });
    try {
      await sourceGuard.assertUnchanged();
      evidence.sourceDatabaseUnchanged = true;
    } catch (error) {
      evidence.sourceDatabaseUnchanged = false;
      evidence.pass = false;
      evidence.failure = error.stack || String(error);
      process.exitCode = 1;
    } finally {
      sourceGuard.close();
    }
    await writeFile(
      path.join(root, "evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
    await writeFile(path.join(root, "server.log"), log);
    clearTimeout(watchdog);
    console.log(
      `${evidence.pass ? "PASS" : "FAIL"} ${channel}; artifacts: ${root}`,
    );
  }
}
