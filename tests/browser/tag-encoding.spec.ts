import { test, expect } from "@playwright/test";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import iconv from "iconv-lite";
import { writeTagsIsolated } from "../../dist/server/isolated-tag-writer.js";
import type { EncodingAnalysis } from "../../src/shared/tag-encoding";
import type { PerTrackTagPatch } from "../../src/shared/contracts";

test("encoding screen preserves drafts, individual titles and manual precedence", async ({
  page,
}, info) => {
  const folder = path.resolve(
    ".test-data/browser",
    info.project.name,
    "encoding",
  );
  await mkdir(folder, { recursive: true });
  const corrupt = (value: string) =>
    iconv.decode(iconv.encode(value, "windows-1251"), "latin1");
  const files = [path.join(folder, "one.flac"), path.join(folder, "two.flac")];
  const before: Buffer[] = [];
  for (let index = 0; index < files.length; index++) {
    await copyFile(path.resolve(".fixtures/sample.flac"), files[index]);
    await writeTagsIsolated(files[index], {
      title: corrupt(index === 0 ? "Любимые песни" : "Ночные огни"),
      albumTitle: corrupt("Альбом"),
      artists: [corrupt("Виктор Цой"), "Beyoncé"],
      genres: [corrupt("Рок")],
    });
    before.push(await readFile(files[index]));
  }
  await page.goto("/");
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(folder);
  await page
    .getByLabel("Название библиотеки", { exact: true })
    .fill("Encoding " + info.project.name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const library = page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: "Encoding " + info.project.name });
  await library.locator(".list-tile-main").click();
  const album = page.locator(".albums-panel .album-card").first();
  await expect(album).toBeVisible();
  await album.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await page
    .getByRole("menuitem", { name: "Редактировать теги", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const open = dialog.getByRole("button", { name: "Исправить кодировку…" });
  const next = dialog.getByRole("button", { name: "Далее", exact: true });
  await expect(dialog).toContainText("Выбрано треков: 2");
  await expect(next).toBeDisabled();
  await open.click();
  await expect(dialog).toHaveAccessibleName("Исправление кодировки");
  const rows = dialog.locator("tbody tr");
  await expect(rows).toHaveCount(8);
  await expect(rows.locator('input[type="checkbox"]:checked')).toHaveCount(6);
  await expect(
    dialog.getByRole("button", { name: "Назад", exact: true }),
  ).toBeFocused();
  await rows.first().locator("input").focus();
  await page.keyboard.press("Tab");
  await expect(rows.first().locator("select")).toBeFocused();
  const genre = rows.filter({ hasText: "Рок" }).first();
  await expect(genre.locator("input")).not.toBeChecked();
  await genre.locator("select").selectOption("Рок");
  await expect(genre.locator("input")).toBeChecked();
  await page.setViewportSize({ width: 745, height: 900 });
  await page.screenshot({ path: info.outputPath("encoding-screen.png") });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(next).toBeDisabled();
  await expect(open).toBeFocused();
  await open.click();
  await expect(rows).toHaveCount(8);
  await expect(rows.locator('input[type="checkbox"]:checked')).toHaveCount(6);
  await dialog
    .getByRole("button", { name: "Использовать исправления" })
    .click();
  await expect(dialog).toContainText("Подготовлено исправлений: 6, треков: 2.");
  await expect(
    dialog.getByLabel("Название для поиска MusicBrainz"),
  ).toHaveValue("Альбом");
  await expect(next).toBeEnabled();
  await open.click();
  const first = rows.first().locator("input");
  await expect(first).toBeChecked();
  await first.uncheck();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveAccessibleName("Редактировать теги");
  await expect(dialog).toContainText("Подготовлено исправлений: 6");
  await open.click();
  await expect(rows.first().locator("input")).toBeChecked();
  await dialog.getByRole("button", { name: "Назад", exact: true }).click();
  await dialog.getByLabel("Название для поиска MusicBrainz").fill("Мой запрос");
  await open.click();
  await dialog
    .getByRole("button", { name: "Использовать исправления" })
    .click();
  await expect(
    dialog.getByLabel("Название для поиска MusicBrainz"),
  ).toHaveValue("Мой запрос");
  await dialog.getByLabel("Альбом", { exact: true }).fill("Ручной альбом");
  await expect(dialog).toContainText("Отмеченные ручные поля перекрывают");
  for (let index = 0; index < files.length; index++)
    expect(await readFile(files[index])).toEqual(before[index]);
  const request = page.waitForRequest((request) =>
    request.url().endsWith("/api/operations/preview"),
  );
  await next.click();
  const payload = (await request).postDataJSON();
  expect(payload.patch.albumTitle).toBe("Ручной альбом");
  expect(
    (Object.values(payload.itemPatches) as PerTrackTagPatch[])
      .map((patch) => patch.title)
      .sort(),
  ).toEqual(["Любимые песни", "Ночные огни"].sort());
  for (const patch of Object.values(
    payload.itemPatches,
  ) as PerTrackTagPatch[]) {
    expect(patch.albumTitle).toBeUndefined();
    expect(patch.artists).toEqual(["Виктор Цой", "Beyoncé"]);
  }
  for (let index = 0; index < files.length; index++)
    expect(await readFile(files[index])).toEqual(before[index]);
});

test("encoding screen shows read failures and empty analysis without writes", async ({
  page,
}, info) => {
  const folder = path.resolve(
    ".test-data/browser",
    info.project.name,
    "encoding-empty",
  );
  await mkdir(folder, { recursive: true });
  await copyFile(
    path.resolve(".fixtures/sample.flac"),
    path.join(folder, "empty.flac"),
  );
  await page.goto("/");
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(folder);
  await page
    .getByLabel("Название библиотеки", { exact: true })
    .fill("Encoding empty " + info.project.name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: "Encoding empty " + info.project.name })
    .locator(".list-tile-main")
    .click();
  const album = page.locator(".albums-panel .album-card").first();
  await expect(album).toBeVisible();
  await album.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await page
    .getByRole("menuitem", { name: "Редактировать теги", exact: true })
    .click();
  let fail = true;
  await page.route("**/api/metadata/encoding/analyze", async (route) => {
    if (fail)
      await route.fulfill({
        status: 500,
        json: { error: "Ошибка чтения тегов" },
      });
    else
      await route.fulfill({
        json: {
          tracks: [],
          rows: [],
          errors: [{ path: "missing.mp3", message: "Файл недоступен" }],
        } satisfies EncodingAnalysis,
      });
  });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Исправить кодировку…" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Ошибка чтения тегов");
  fail = false;
  await dialog.getByRole("button", { name: "Повторить анализ" }).click();
  await expect(dialog).toContainText(
    "Предложений по исправлению кодировки нет.",
  );
  await expect(dialog).toContainText("missing.mp3: Файл недоступен");
});
