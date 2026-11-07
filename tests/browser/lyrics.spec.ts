import { test, expect } from "./fixtures";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeTagsIsolated } from "../../dist/server/isolated-tag-writer.js";
import { readEmbeddedLyrics } from "../../dist/server/lyrics.js";

for (const title of ["Автопесня", "Неоднозначная песня"]) {
  test(`opening lyrics automatically searches and saves: ${title}`, async ({
    page,
  }, info) => {
    const folder = path.resolve(
      ".test-data/browser",
      info.project.name,
      `automatic-${title}`,
    );
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, "song.flac");
    await copyFile(path.resolve(".fixtures/sample.flac"), file);
    await writeTagsIsolated(file, { title, lyrics: "" });
    const before = await readFile(file);
    await page.goto("/");
    await page.locator(".add-library").click();
    await page.getByLabel("Путь к папке", { exact: true }).fill(folder);
    await page
      .getByLabel("Название библиотеки", { exact: true })
      .fill(title + info.project.name);
    await page.getByRole("button", { name: "Подключить", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page
      .locator(".libraries-panel .list-tile")
      .filter({ hasText: title + info.project.name })
      .locator(".list-tile-main")
      .click();
    await expect(page.getByTestId("track-row")).toHaveCount(1);
    await page.getByTestId("track-row").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Текст", exact: true }).click();
    const popup = page.locator(".lyrics-modal");
    if (title === "Неоднозначная песня") {
      await expect(popup.locator(".lyrics-result")).toHaveCount(2);
      expect(await readFile(file)).toEqual(before);
      await popup.locator(".lyrics-result").first().click();
    }
    await expect(
      popup.getByLabel("Записано в файл", { exact: true }),
    ).toBeVisible();
    await expect(popup.locator(".lyrics-text")).toHaveText(
      "Автоматически найденный текст",
    );
    expect(await readEmbeddedLyrics(file)).toBe(
      "Автоматически найденный текст",
    );
    await expect(page.getByRole("dialog")).toHaveCount(1);
    expect(await page.locator("audio").getAttribute("src")).toBeNull();
    await page.keyboard.press("Escape");
    let requested = false;
    await page.route("**/api/tracks/*/lyrics/auto", async (route) => {
      requested = true;
      await route.fulfill({
        status: 500,
        json: { error: "Unexpected automatic search" },
      });
    });
    await page.getByTestId("track-row").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Текст", exact: true }).click();
    await expect(popup.locator(".lyrics-text")).toHaveText(
      "Автоматически найденный текст",
    );
    expect(requested).toBe(false);
  });
}

test("RMB Text opens the clicked track without playback, including a multi-selection", async ({
  page,
}, info) => {
  const folder = path.resolve(
    ".test-data/browser",
    info.project.name,
    "lyrics-menu",
  );
  await mkdir(folder, { recursive: true });
  for (const [name, title, lyrics] of [
    ["one", "Первая песня", "Первый текст"],
    ["two", "Вторая песня", "Второй текст"],
  ]) {
    const file = path.join(folder, `${name}.flac`);
    await copyFile(path.resolve(".fixtures/sample.flac"), file);
    await writeTagsIsolated(file, { title, lyrics });
  }
  await page.goto("/");
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(folder);
  await page
    .getByLabel("Название библиотеки", { exact: true })
    .fill("Lyrics menu " + info.project.name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: "Lyrics menu " + info.project.name })
    .locator(".list-tile-main")
    .click();
  const rows = page.getByTestId("track-row");
  await expect(rows).toHaveCount(2);
  const first = rows.filter({ hasText: "Первая песня" });
  const second = rows.filter({ hasText: "Вторая песня" });
  const popup = page.locator(".lyrics-modal");
  await second.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Текст", exact: true }).click();
  await expect(popup.getByRole("heading")).toHaveText("Вторая песня");
  await expect(popup.locator(".lyrics-text")).toHaveText("Второй текст");
  expect(await page.locator("audio").getAttribute("src")).toBeNull();
  await page.keyboard.press("Escape");
  await first.dblclick();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.1);
  await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.pause());
  const source = await page.locator("audio").getAttribute("src");
  await first.locator(".list-tile-main").click();
  await second.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(first).toHaveClass(/selected/);
  await expect(second).toHaveClass(/selected/);
  await second.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Текст", exact: true }).click();
  await expect(popup.getByRole("heading")).toHaveText("Вторая песня");
  await expect(popup.locator(".lyrics-text")).toHaveText("Второй текст");
  expect(await page.locator("audio").getAttribute("src")).toBe(source);
  expect(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Текст песни", exact: true }).click();
  await expect(popup.getByRole("heading")).toHaveText("Первая песня");
  await expect(popup.locator(".lyrics-text")).toHaveText("Первый текст");
});

test("lyrics popup reads, searches, edits and saves without changing playback", async ({
  page,
}, info) => {
  const folder = path.resolve(
    ".test-data/browser",
    info.project.name,
    "lyrics",
  );
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, "song.flac");
  await copyFile(path.resolve(".fixtures/sample.flac"), file);
  await writeTagsIsolated(file, { lyrics: "Встроенный текст\n\nВторой абзац" });
  const original = await readFile(file);
  let searches = 0;
  await page.route("**/api/lyrics/search", async (route) => {
    searches++;
    await route.fulfill({
      json: [
        {
          id: 1,
          trackName: "Найденная песня",
          artistName: "Исполнитель",
          albumName: "Альбом",
          duration: 3,
          instrumental: false,
          plainLyrics: "Найденный текст\nНовая строка",
        },
        {
          id: 2,
          trackName: "Инструментальная",
          artistName: "Исполнитель",
          albumName: "Альбом",
          duration: 3,
          instrumental: true,
          plainLyrics: null,
        },
      ],
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Текст песни", exact: true }),
  ).toBeDisabled();
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(folder);
  await page
    .getByLabel("Название библиотеки", { exact: true })
    .fill("Lyrics " + info.project.name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: "Lyrics " + info.project.name })
    .locator(".list-tile-main")
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  await page.getByTestId("track-row").dblclick();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.1);
  await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.pause());
  const open = page.getByRole("button", { name: "Текст песни", exact: true });
  await open.click();
  const popup = page.locator(".lyrics-modal");
  await expect(popup.locator(".lyrics-text")).toHaveText(
    "Встроенный текст\n\nВторой абзац",
  );
  expect(searches).toBe(0);
  await popup
    .getByRole("button", { name: "Найти другой текст", exact: true })
    .click();
  await popup
    .getByRole("button", { name: "Найти в LRCLIB", exact: true })
    .click();
  await expect(popup.locator(".lyrics-result")).toHaveCount(2);
  await expect(popup.locator(".lyrics-result").nth(1)).toBeDisabled();
  await popup.locator(".lyrics-result").first().click();
  await expect(popup.locator(".lyrics-text")).toHaveText(
    "Найденный текст\nНовая строка",
  );
  expect(await readFile(file)).toEqual(original);
  await popup
    .getByRole("button", { name: "Редактировать текст", exact: true })
    .click();
  await popup
    .getByRole("textbox", { name: "Текст песни", exact: true })
    .fill("Ручной текст\n\nЕщё абзац");
  await popup.getByRole("button", { name: "Готово", exact: true }).click();
  await popup.getByRole("button", { name: "В Harbor", exact: true }).click();
  await expect(
    popup.getByLabel("Сохранено в Harbor", { exact: true }),
  ).toBeVisible();
  expect(await readFile(file)).toEqual(original);
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await open.click();
  await expect(popup.locator(".lyrics-text")).toHaveText(
    "Ручной текст\n\nЕщё абзац",
  );
  await popup.getByRole("button", { name: "В файл…", exact: true }).click();
  const confirm = page.getByRole("dialog", {
    name: "Заменить текст в файле?",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(await readFile(file)).toEqual(original);
  await popup.getByRole("button", { name: "В файл…", exact: true }).click();
  await confirm.getByRole("button", { name: "Записать", exact: true }).click();
  await expect(
    popup.getByLabel("Записано в файл", { exact: true }),
  ).toBeVisible();
  expect(await readEmbeddedLyrics(file)).toBe("Ручной текст\n\nЕщё абзац");
  expect(searches).toBe(1);
  await page.setViewportSize({ width: 700, height: 850 });
  expect(
    await popup.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("lyrics-popup.png") });
  await page.mouse.click(5, 5);
  await expect(popup).not.toBeVisible();
  expect(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
  // Reopening must not initialize from an older React Query cache entry.
  await page.route("**/api/tracks/*/lyrics", (route) =>
    route.fulfill({
      json: { local: null, embedded: "Актуальный текст", writable: true },
    }),
  );
  await open.click();
  await expect(popup.locator(".lyrics-text")).toHaveText("Актуальный текст");
});

test("lyrics popup surfaces failed and empty searches and allows manual text", async ({
  page,
}, info) => {
  const folder = path.resolve(
    ".test-data/browser",
    info.project.name,
    "lyrics-empty",
  );
  await mkdir(folder, { recursive: true });
  await copyFile(
    path.resolve(".fixtures/sample.mp3"),
    path.join(folder, "song.mp3"),
  );
  await writeTagsIsolated(path.join(folder, "song.mp3"), { lyrics: "" });
  await page.goto("/");
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(folder);
  await page
    .getByLabel("Название библиотеки", { exact: true })
    .fill("Empty lyrics " + info.project.name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: "Empty lyrics " + info.project.name })
    .locator(".list-tile-main")
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  await page.getByTestId("track-row").dblclick();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.1);
  await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.pause());
  await page.getByRole("button", { name: "Текст песни", exact: true }).click();
  const popup = page.locator(".lyrics-modal");
  await expect(popup.getByRole("status")).toHaveText("Ничего не найдено");
  await page.route("**/api/lyrics/search", (route) =>
    route.fulfill({ status: 502, json: { error: "LRCLIB недоступен" } }),
  );
  await popup
    .getByRole("button", { name: "Найти в LRCLIB", exact: true })
    .click();
  await expect(popup.getByRole("alert")).toHaveText("LRCLIB недоступен");
  await page.unroute("**/api/lyrics/search");
  await page.route("**/api/lyrics/search", (route) =>
    route.fulfill({ json: [] }),
  );
  await popup
    .getByRole("button", { name: "Найти в LRCLIB", exact: true })
    .click();
  await expect(popup.getByRole("status")).toHaveText("Ничего не найдено");
  await popup
    .getByRole("button", { name: "Редактировать текст", exact: true })
    .click();
  await popup
    .getByRole("textbox", { name: "Текст песни", exact: true })
    .fill("Свой текст");
  await popup.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(popup.locator(".lyrics-text")).toHaveText("Свой текст");
});
