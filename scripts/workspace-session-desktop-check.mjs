// Real Electron process restart, disposable profile, no user library or network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect } from "playwright/test";

await mkdir(path.resolve(".test-data"), { recursive: true });
const root = await mkdtemp(path.resolve(".test-data", "session-desktop-"));
const data = path.join(root, "data");
const library = path.join(root, "library");
await mkdir(library, { recursive: true });
await mkdir(path.join(data, "electron"), { recursive: true });
await writeFile(
  path.join(data, "electron", "update-preferences.json"),
  JSON.stringify({ automaticChecks: false }),
);
const ffmpeg = (await import("ffmpeg-static")).default;
execFileSync(ffmpeg, [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=120",
  "-c:a",
  "flac",
  "-metadata",
  "title=Session fixture",
  "-metadata",
  "artist=Disposable",
  "-metadata",
  "album=Session album",
  path.join(library, "fixture.flac"),
]);
let application;
const evidence = { root, runs: [] };
async function launch() {
  application = await electron.launch({
    args: [".", "--autoplay-policy=no-user-gesture-required"],
    env: {
      ...process.env,
      HARBOR_PLAYER_DATA_DIR: data,
      HARBOR_PLAYER_PORT: "0",
    },
    timeout: 45000,
  });
  const page = await application.firstWindow();
  await page.locator(".workspace").waitFor({ state: "attached" });
  evidence.runs.push({
    pid: application.process().pid,
    origin: new URL(page.url()).origin,
  });
  return page;
}
async function quit() {
  const exited = new Promise((resolve) =>
    application.process().once("exit", resolve),
  );
  // Exercise the real before-quit handler, not Playwright's forced close.
  await application.evaluate(({ app }) => {
    app.quit();
  });
  const timer = setTimeout(() => application.process().kill(), 15000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
  application = undefined;
}
try {
  let page = await launch();
  await page.locator(".add-library").click();
  await page.getByLabel(/^Путь к папке/).fill(library);
  await page.getByLabel("Название библиотеки").fill("Session desktop fixture");
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  await page.getByTestId("track-row").first().dblclick();
  await expect
    .poll(() => page.locator("audio").evaluate((audio) => audio.currentTime))
    .toBeGreaterThan(0);
  await page.locator("audio").evaluate((audio) => {
    audio.currentTime = 42;
  });
  await page.getByRole("button", { name: "Перемешать", exact: true }).click();
  await page
    .getByRole("button", { name: "Повтор: выключен", exact: true })
    .click();
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setBounds({ x: 40, y: 50, width: 1100, height: 760 });
  });
  await page.getByLabel("Поиск музыки").fill("Session fixture");
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  await page.getByTestId("track-row").first().click();
  await page
    .getByRole("button", { name: "Открыть настройки", exact: true })
    .click();
  // No manual renderer flush: quitting must persist the latest changes.
  await quit();
  const first = JSON.parse(
    await readFile(path.join(data, "workspace-session.json"), "utf8"),
  );
  assert(first.player.seconds >= 42 && first.player.seconds < 50);
  assert.equal(first.player.shuffle, true);
  assert.equal(first.player.repeat, "all");
  assert.equal(first.catalog.search, "Session fixture");
  assert.equal(first.catalog.selected.length, 1);
  page = await launch();
  await expect(page.getByLabel("Поиск музыки")).toHaveValue("Session fixture");
  await expect(page.locator('[data-testid="track-row"].selected')).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("button", { name: "Открыть настройки", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator("audio").evaluate((audio) => audio.currentTime))
    .toBeGreaterThanOrEqual(42);
  assert(await page.locator("audio").evaluate((audio) => audio.paused));
  const restoredBounds = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { ...window.getNormalBounds(), fullscreen: window.isFullScreen() };
  });
  assert.equal(restoredBounds.width, 1100);
  assert.equal(restoredBounds.height, 760);
  assert.equal(restoredBounds.fullscreen, false);
  // Persist cover mode and maximization; fullscreen itself must not be restored.
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Открыть режим обложки", exact: true })
    .click();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].maximize();
  });
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    )
    .toBe(true);
  // Let the event-driven checkpoint complete before entering fullscreen.
  await expect
    .poll(
      async () =>
        JSON.parse(
          await readFile(
            path.join(data, "electron", "window-state.json"),
            "utf8",
          ),
        ).maximized,
    )
    .toBe(true);
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setFullScreen(true);
  });
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFullScreen(),
      ),
    )
    .toBe(true);
  await quit();
  page = await launch();
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: "Вернуться в каталог", exact: true }),
  ).toBeVisible();
  const finalWindow = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return {
      maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(),
    };
  });
  assert.equal(finalWindow.maximized, true);
  assert.equal(finalWindow.fullscreen, false);
  assert(await page.locator("audio").evaluate((audio) => audio.paused));
  await quit();
  evidence.ok = true;
  evidence.seconds = first.player.seconds;
  evidence.restoredBounds = restoredBounds;
  evidence.finalWindow = finalWindow;
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.error = String(error.stack || error);
  throw error;
} finally {
  if (application) await application.close().catch(() => {});
  await writeFile(
    path.join(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(`Retained disposable fixtures/evidence: ${root}`);
}
