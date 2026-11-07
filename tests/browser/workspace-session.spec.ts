import path from "node:path";
import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { test, expect, type Page } from "./fixtures";

async function flush(page: Page) {
  await page.evaluate(() => window.harborPlayerFlushSession?.());
}
async function saved(page: Page) {
  return (await page.request.get("/api/workspace-session")).json();
}
test("restores search, multi-selection and pre-search context in a fresh browser context", async ({
  page,
  browser,
}, info) => {
  await page.goto("/");
  const name = `Session ${info.project.name}`;
  await page.locator(".add-library").click();
  const source = path.resolve(
    ".test-data/browser",
    info.project.name,
    "session-search",
  );
  await mkdir(source, { recursive: true });
  await Promise.all(
    ["album", "live", "jazz"].map((title) =>
      copyFile(
        path.resolve(".fixtures/sample.flac"),
        path.join(source, `${title}.flac`),
      ),
    ),
  );
  await page.getByLabel("Путь к папке", { exact: true }).fill(source);
  await page.getByLabel("Название библиотеки").fill(name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".libraries-panel .list-tile-main")
    .filter({ hasText: name })
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(3);
  await page
    .getByRole("button", { name: `Развернуть библиотеку «${name}»` })
    .click();
  await page.getByTestId("track-row").nth(0).click();
  await page
    .getByTestId("track-row")
    .nth(1)
    .click({ modifiers: ["Control"] });
  await flush(page);
  const before = (await saved(page)).catalog;
  expect(before.selected).toHaveLength(2);
  await page.getByLabel("Поиск музыки").fill(name);
  await expect(page.getByTestId("track-row")).toHaveCount(3);
  await page.getByTestId("track-row").nth(1).click();
  await page
    .getByTestId("track-row")
    .nth(2)
    .click({ modifiers: ["Control"] });
  await flush(page);
  const searching = (await saved(page)).catalog;
  expect(searching.selected).toHaveLength(2);
  await page.close();

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  try {
    const restored = await context.newPage();
    await restored.goto("http://127.0.0.1:4327");
    await expect(restored.getByLabel("Поиск музыки")).toHaveValue(name);
    await expect(
      restored.locator('[data-testid="track-row"].selected'),
    ).toHaveCount(2);
    await flush(restored);
    expect((await saved(restored)).catalog.selected).toEqual(
      searching.selected,
    );
    await restored
      .getByRole("button", { name: "Очистить поиск", exact: true })
      .click();
    await expect(
      restored
        .locator(".libraries-panel .list-tile.selected")
        .filter({ hasText: name }),
    ).toHaveCount(1);
    await expect(
      restored.getByRole("button", { name: `Свернуть библиотеку «${name}»` }),
    ).toBeVisible();
    await expect(
      restored.locator('[data-testid="track-row"].selected'),
    ).toHaveCount(2);
    await flush(restored);
    expect((await saved(restored)).catalog.savedFilter).toEqual(
      before.savedFilter,
    );
  } finally {
    await context.close();
  }
});

test("restores playback seconds paused and does not reopen settings", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.locator(".add-library").click();
  const source = path.resolve(
    ".test-data/browser",
    info.project.name,
    "session-audio",
  );
  await mkdir(source, { recursive: true });
  await copyFile(
    path.resolve(".fixtures/sample.flac"),
    path.join(source, "sample.flac"),
  );
  await page.getByLabel("Путь к папке", { exact: true }).fill(source);
  await page
    .getByLabel("Название библиотеки")
    .fill(`Session audio ${info.project.name}`);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".libraries-panel .list-tile-main")
    .filter({ hasText: `Session audio ${info.project.name}` })
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  await expect(page.getByTestId("track-row").first()).toBeVisible();
  await page.getByTestId("track-row").first().dblclick();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.playbackRate = 0.1;
    audio.currentTime = 1;
  });
  await page.getByRole("button", { name: "Перемешать", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть настройки", exact: true })
    .click();
  await flush(page);
  const before = await saved(page);
  expect(before.player.seconds).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Открыть настройки", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThanOrEqual(1);
  expect(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
  await flush(page);
  const after = await saved(page);
  expect(after.player.queueId).toBe(before.player.queueId);
  expect(after.player.shuffle).toBe(true);
  expect(after.player.seconds).toBeCloseTo(before.player.seconds, 0);
});

test("restores a virtualized track anchor after slow loading and a window resize", async ({
  page,
}, info) => {
  const source = await mkdtemp(
    path.resolve(".test-data/browser", info.project.name, "session-scroll-"),
  );
  const name = `Session scroll ${info.project.name} ${path.basename(source)}`;
  await Promise.all(
    Array.from({ length: 160 }, (_, index) =>
      copyFile(
        path.resolve(".fixtures/sample.flac"),
        path.join(source, `track-${String(index).padStart(3, "0")}.flac`),
      ),
    ),
  );
  await page.goto("/");
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(source);
  await page.getByLabel("Название библиотеки").fill(name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".libraries-panel .list-tile-main")
    .filter({ hasText: name })
    .click();
  const surface = page.locator(".tracks-panel .selection-surface");
  await expect
    .poll(() => surface.evaluate((node) => node.scrollHeight))
    .toBeGreaterThan(4000);
  await surface.evaluate((node) => {
    node.scrollTop = 1400;
  });
  await expect
    .poll(() => surface.evaluate((node) => node.scrollTop))
    .toBe(1400);
  // scrollTop changes synchronously; the virtualizer mounts the new viewport
  // on a later frame. Do not checkpoint the gap between those two operations.
  await expect
    .poll(() =>
      surface.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return [
          ...node.querySelectorAll<HTMLElement>("[data-selection-key]"),
        ].some((item) => {
          const row = item.getBoundingClientRect();
          return row.bottom > box.top && row.top < box.bottom;
        });
      }),
    )
    .toBe(true);
  await flush(page);
  const position = (await saved(page)).catalog.positions.find(
    (p: { id: string }) => p.id === "tracks",
  );
  expect(position.anchorKey).toBeTruthy();
  await page.route("**/api/tracks?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.reload();
  await expect
    .poll(() => surface.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(1000);
  await expect
    .poll(() =>
      surface.evaluate((node, key) => {
        const anchor = [
          ...node.querySelectorAll<HTMLElement>("[data-selection-key]"),
        ].find((item) => item.dataset.selectionKey === key);
        return anchor
          ? anchor.getBoundingClientRect().top -
              node.getBoundingClientRect().top
          : null;
      }, position.anchorKey),
    )
    .toBeCloseTo(position.anchorY, 0);
  await flush(page);
  expect(
    (await saved(page)).catalog.positions.find(
      (p: { id: string }) => p.id === "tracks",
    ).anchorKey,
  ).toBe(position.anchorKey);
});
