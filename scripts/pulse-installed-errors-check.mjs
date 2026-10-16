// Installed UI error/fallback diagnostic. Disposable profile and synthetic
// history only; never touches the operator's library or running app instance.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

assert.equal(process.platform, "win32");
assert(process.env.HARBOR_PLAYER_DESKTOP_EXECUTABLE, "Select installed EXE");
const executable = path.resolve(process.env.HARBOR_PLAYER_DESKTOP_EXECUTABLE);
await mkdir(".test-data", { recursive: true });
const root = await mkdtemp(path.resolve(".test-data/pulse-installed-errors-"));
const data = path.join(root, "data");
const evidence = {
  scope: "Installed UI; synthetic history; intercepted responses",
  phases: [],
};
const hash = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
evidence.exeSha256 = await hash(executable);
evidence.asarSha256 = await hash(
  path.join(path.dirname(executable), "resources/app.asar"),
);
const server = net.createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
let browser, child, failure, page;
try {
  child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"],
    {
      env: {
        ...process.env,
        HARBOR_PLAYER_DATA_DIR: data,
        HARBOR_PLAYER_PORT: "0",
        HARBOR_PLAYER_PULSE_BENCHMARK: "1",
      },
      stdio: "ignore",
    },
  );
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  const deadline = Date.now() + 45000;
  while (true) {
    if (spawnError) throw spawnError;
    assert(child.exitCode === null, "Test instance exited before CDP");
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {
      /* Wait for our own test instance, not another browser. */
    }
    assert(Date.now() < deadline, "CDP startup timeout");
    await delay(100);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  await expect
    .poll(() => {
      page = context
        .pages()
        .find((candidate) => /^http:\/\/127\.0\.0\.1:/.test(candidate.url()));
      return Boolean(page);
    })
    .toBe(true);
  evidence.userAgent = await page.evaluate(() => navigator.userAgent);
  evidence.viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  }));
  const base = new URL(page.url()).origin;
  const sessionResponse = await context.request.get(`${base}/api/session`);
  assert(sessionResponse.ok());
  const session = await sessionResponse.json();
  const headers = { "X-CSRF-Token": session.csrf };
  const configured = await context.request.patch(`${base}/api/pulse/settings`, {
    headers,
    data: { enabled: true, timeZone: "UTC" },
  });
  assert(configured.ok(), await configured.text());
  const settings = await configured.json();
  const covers = [1, 2, 3].map((n) => `${String(n).repeat(64)}.png`);
  const titles = [
    "Missing cover fixture",
    "Corrupt cover fixture",
    "Recovered cover fixture",
  ];
  const start = Date.now() - 120000;
  const response = await context.request.post(`${base}/api/listening-events`, {
    headers,
    data: {
      historyGeneration: settings.historyGeneration,
      events: titles.map((title, i) => ({
        eventId: randomUUID(),
        revision: 1,
        trackId: null,
        albumKey: `installed-error-${i}`,
        snapshot: {
          title,
          artists: ["Installed UI fixture"],
          year: 2026,
          coverId: covers[i],
        },
        sessionId: "installed-errors",
        visitId: randomUUID(),
        startedAtUtc: start,
        endedAtUtc: start + 60000,
        playedMs: 60000,
        final: true,
      })),
    },
  });
  assert(response.ok(), await response.text());
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  for (let i = 0; i < covers.length; i++) {
    await page.route(`**/api/covers/${covers[i]}`, (route) =>
      route.fulfill(
        i === 0
          ? { status: 404, body: "" }
          : {
              status: 200,
              contentType: "image/png",
              body:
                i === 1 ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : png,
            },
      ),
    );
  }
  await page.route("**/api/pulse/history-range", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Controlled installed UI error" }),
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-empty[role=alert]")).toBeVisible();
  await page.screenshot({ path: path.join(root, "api-error.png") });
  evidence.phases.push("API 503 visible");
  await page.unroute("**/api/pulse/history-range");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator(".pulse-stat-numbers")).toBeVisible();
  await expect(page.locator(".pulse-empty[role=alert]")).toHaveCount(0);
  evidence.phases.push("Retry recovered");
  await page.screenshot({ path: path.join(root, "retry.png") });
  const stats = await page.locator(".pulse-stat-numbers").innerText();
  for (let i = 0; i < titles.length; i++) {
    await page
      .getByRole("button", { name: titles[i] })
      .locator(".pulse-time")
      .click();
    await expect(page.locator(".pulse-copy h2")).toHaveText(titles[i]);
    await expect(page.locator(".pulse-copy")).toContainText(
      "Installed UI fixture",
    );
    await expect
      .poll(() => page.locator(".pulse-stat-numbers").innerText())
      .toBe(stats);
    const image = page.locator(".pulse-selected img");
    if (i < 2) {
      await expect(image).toHaveCSS("visibility", "hidden");
    } else {
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((img) => img.naturalWidth))
        .toBe(1);
    }
    await page.screenshot({ path: path.join(root, `cover-${i}.png`) });
    evidence.phases.push({ title: titles[i], fallback: i < 2, stats });
  }
  evidence.status = "PASS";
} catch (error) {
  failure = error;
  evidence.status = "FAIL";
  evidence.error = String(error);
  if (page) {
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
    await writeFile(
      path.join(root, "failure.txt"),
      await page.locator("body").innerText(),
    ).catch(() => {});
  }
} finally {
  await browser?.close().catch(() => {});
  if (child?.pid && child.exitCode === null) {
    // Only this disposable test instance, never image-name or global kills.
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  }
  await writeFile(
    path.join(root, "result.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(`${evidence.status}: ${root}`);
}
if (failure) throw failure;
