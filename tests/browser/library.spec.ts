import { test, expect } from "@playwright/test";
import path from "node:path";

test("local library: readable UI, playback, tags, move, delete and restore", async ({
  page,
}, info) => {
  const browser = info.project.name;
  const source = path.resolve(".test-data/browser", browser, "Downloads");
  const target = path.resolve(".test-data/browser", browser, "Collection");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByLabel("Поиск музыки")).toBeVisible();
  await expect(page.locator(".brand, .page-heading")).toHaveCount(0);
  await expect(page.locator(".topbar")).toHaveCSS("height", "65px");
  await page.locator(".add-library").click();
  const addLibraryDialog = page.getByRole("dialog");
  await expect(addLibraryDialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(addLibraryDialog).toBeVisible();
  await addLibraryDialog.getByRole("button", { name: "Закрыть" }).click();
  await expect(addLibraryDialog).not.toBeVisible();
  const fonts = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll("body *")]
        .filter(
          (e) =>
            [...e.childNodes].some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
            ) && e.getBoundingClientRect().height > 0,
        )
        .map((e) => getComputedStyle(e).fontSize),
    ),
  ]);
  expect(
    fonts.every((size) => parseFloat(size) >= 14),
    fonts.join(", "),
  ).toBe(true);
  expect(fonts.length).toBeLessThanOrEqual(3);
  expect(
    await page
      .locator(".albums-panel")
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBeGreaterThan(
    await page
      .locator(".artists-panel")
      .evaluate((e) => e.getBoundingClientRect().width),
  );
  const initialPanelWidths = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().width),
    );
  await page.setViewportSize({ width: 1200, height: 1000 });
  const resizedPanelWidths = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().width),
    );
  expect(
    resizedPanelWidths.every(
      (width, index) => width < initialPanelWidths[index],
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".workspace")
      .evaluate((workspace) => workspace.scrollWidth <= workspace.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: `.test-data/empty-${browser}.png` });
  async function add(name: string, folder: string) {
    await page.locator(".add-library").click();
    await page.getByLabel("Путь к папке", { exact: true }).fill(folder);
    await page.getByLabel("Название библиотеки").fill(name);
    await page.getByRole("button", { name: "Подключить", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await add(`Downloads ${browser}`, source);
  await add(`Collection ${browser}`, target);
  await page
    .getByRole("button", { name: new RegExp(`Downloads ${browser}`) })
    .first()
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(7);

  const genreRow = page
    .locator(".genres-panel .facet-row")
    .filter({ hasText: "Ambient" });
  const genreButton = genreRow.getByRole("button");
  const genreCheckbox = genreRow.getByRole("checkbox");
  await expect(genreCheckbox).not.toBeChecked();
  await expect(genreCheckbox).toHaveCSS("opacity", "0");
  await genreRow.hover();
  await expect(genreCheckbox).toHaveCSS("opacity", "1");
  await genreCheckbox.check();
  await expect(genreCheckbox).toBeChecked();
  await page.mouse.move(0, 0);
  await expect(genreCheckbox).toHaveCSS("opacity", "1");
  await genreButton.dispatchEvent("click", { ctrlKey: true });
  await expect(genreCheckbox).not.toBeChecked();
  await genreCheckbox.focus();
  await expect(genreCheckbox).toHaveCSS("opacity", "1");
  await genreButton.click();
  await expect(genreCheckbox).toBeChecked();
  await genreRow.click({ position: { x: 4, y: 22 } });
  await expect(genreCheckbox).toBeChecked();

  const artistRow = page
    .locator(".artists-panel .facet-row")
    .filter({ hasText: "Исполнитель" });
  const artistButton = artistRow.getByRole("button");
  const artistCheckbox = artistRow.getByRole("checkbox");
  await artistCheckbox.check();
  await expect(artistCheckbox).toBeChecked();

  const firstAlbum = page
    .locator(".album-card")
    .filter({ hasText: "Исполнитель альбома" });
  const firstAlbumButton = firstAlbum.getByRole("button");
  const firstAlbumCheckbox = firstAlbum.getByRole("checkbox");
  await firstAlbum.hover();
  await firstAlbumCheckbox.check();
  await expect(firstAlbumCheckbox).toBeChecked();
  await genreButton.click();
  await expect(genreCheckbox).toBeChecked();
  await expect(artistCheckbox).not.toBeChecked();
  await expect(firstAlbumCheckbox).not.toBeChecked();
  await page
    .locator(".genres-panel")
    .getByRole("button", { name: "Все жанры" })
    .click();

  await artistButton.click();
  await expect(artistCheckbox).toBeChecked();
  await artistButton.dispatchEvent("click", { ctrlKey: true });
  await expect(artistCheckbox).not.toBeChecked();
  await artistCheckbox.check();
  await page
    .locator(".artists-panel")
    .getByRole("button", { name: "Все артисты" })
    .click();
  await expect(artistCheckbox).not.toBeChecked();

  const secondAlbum = page
    .locator(".album-card")
    .filter({ hasText: "Неизвестный исполнитель" });
  const secondAlbumButton = secondAlbum.getByRole("button");
  const secondAlbumCheckbox = secondAlbum.getByRole("checkbox");
  await firstAlbum.hover();
  await firstAlbumCheckbox.check();
  await secondAlbum.hover();
  await secondAlbumCheckbox.check();
  await expect(firstAlbumCheckbox).toBeChecked();
  await expect(secondAlbumCheckbox).toBeChecked();
  await firstAlbumButton.click();
  await expect(firstAlbumCheckbox).toBeChecked();
  await expect(secondAlbumCheckbox).not.toBeChecked();
  await firstAlbumButton.dispatchEvent("click", { ctrlKey: true });
  await expect(firstAlbumCheckbox).not.toBeChecked();

  await expect(firstAlbum.locator(".album-main > small")).toHaveCount(2);
  await expect(firstAlbum.locator(".album-year")).toHaveCount(1);
  await firstAlbum.locator(".album-cover").dblclick();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await firstAlbum.hover();
  await firstAlbumCheckbox.check();
  await secondAlbumButton.dispatchEvent("click", { ctrlKey: true });
  await expect(firstAlbumCheckbox).toBeChecked();
  await expect(secondAlbumCheckbox).toBeChecked();
  await firstAlbumButton.click();
  await expect(firstAlbumCheckbox).toBeChecked();
  await expect(secondAlbumCheckbox).not.toBeChecked();
  await page
    .locator(".albums-panel")
    .getByRole("button", { name: "Все альбомы" })
    .click();
  await expect(firstAlbumCheckbox).not.toBeChecked();
  await expect(secondAlbumCheckbox).not.toBeChecked();

  const explorerRequests: { kind: string; id: string }[] = [];
  await page.route("**/api/explorer", async (route) => {
    explorerRequests.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  expect(
    await firstAlbum.evaluate((element) => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 300,
      });
      return !element.dispatchEvent(event);
    }),
  ).toBe(true);
  await expect(
    page.getByRole("menu", { name: "Контекстное меню" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Открыть в проводнике" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Редактировать теги" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).not.toBeVisible();
  await firstAlbum.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await page.getByRole("menuitem", { name: "Редактировать теги" }).click();
  await expect(page.getByRole("dialog")).toContainText("Редактировать теги");
  const albumTrackCount = Number(
    (await firstAlbum.locator(".album-track-count").textContent())?.match(
      /\d+/,
    )?.[0],
  );
  await expect(page.getByRole("dialog")).toContainText(
    `Выбрано треков: ${albumTrackCount}`,
  );
  await expect(
    page.getByRole("dialog").getByText("MusicBrainz", { exact: true }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Найти" }).click();
  const candidate = page
    .getByRole("dialog")
    .getByRole("listitem")
    .filter({ hasText: "Тестовый альбом MusicBrainz" });
  await expect(candidate).toBeVisible();
  await expect(candidate.locator("img")).toBeVisible();
  const missingCoverCandidate = page
    .getByRole("dialog")
    .getByRole("listitem")
    .filter({ hasText: "Тестовый альбом без обложки" });
  await missingCoverCandidate.scrollIntoViewIfNeeded();
  await expect(missingCoverCandidate.getByText("Нет обложки")).toBeVisible();
  const originalCover = await firstAlbum.locator("img").getAttribute("src");
  await candidate.click();
  await expect(page.getByRole("dialog")).toContainText(
    `Сопоставлено: ${albumTrackCount} из ${albumTrackCount}`,
  );
  await expect(
    page.getByRole("dialog").getByLabel("заменить заполненные").first(),
  ).toBeVisible();
  const coverField = page
    .getByRole("dialog")
    .locator(".musicbrainz-field")
    .filter({ hasText: "Обложка" });
  await coverField.getByRole("checkbox").first().check();
  await coverField.getByRole("checkbox").nth(1).check();
  await page.getByRole("button", { name: "Посмотреть изменения" }).click();
  await page.getByRole("button", { name: /^Применить к/ }).click();
  await expect
    .poll(() => firstAlbum.locator("img").getAttribute("src"))
    .not.toBe(originalCover);
  await firstAlbum.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await page.getByRole("menuitem", { name: "Открыть в проводнике" }).click();
  await expect(page.getByRole("menu")).not.toBeVisible();

  await page.screenshot({ path: `.test-data/library-${browser}.png` });
  const rows = page.getByTestId("track-row");
  await rows
    .first()
    .dispatchEvent("contextmenu", { clientX: 900, clientY: 400 });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Открыть в проводнике" }).click();
  await expect(page.getByRole("menu")).not.toBeVisible();
  expect(explorerRequests.map((request) => request.kind)).toEqual([
    "album",
    "track",
  ]);
  // Exercise every browser decoder, seeking, and range responses with actual audio bytes.
  for (const format of ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"]) {
    const row = page.locator(
      `[data-testid="track-row"][data-format="${format}"]`,
    );
    await row.getByRole("button").click();
    await expect
      .poll(
        () =>
          page.locator("audio").evaluate((a: HTMLAudioElement) => a.readyState),
        { message: `${browser}: decode ${format}` },
      )
      .toBeGreaterThanOrEqual(2);
    await page.locator("audio").evaluate((a: HTMLAudioElement) => {
      a.pause();
      a.currentTime = 1;
    });
    await expect
      .poll(() =>
        page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
      )
      .toBeGreaterThanOrEqual(0.9);
  }
  const flac = () =>
    page.locator('[data-testid="track-row"][data-format="flac"]');
  await expect(page.locator(".track-copy small")).toHaveCount(0);
  await expect(page.locator(".track-format")).toHaveCount(0);
  await expect(page.locator(".album-formats")).toHaveCount(0);
  const taggedAlbumHeader = page
    .locator(".track-album-header")
    .filter({ hasText: "Исполнитель альбома" });
  await expect(taggedAlbumHeader).toContainText("Исполнитель альбома");
  await expect(taggedAlbumHeader).not.toContainText("FLAC");
  await page
    .locator(".artists-panel")
    .getByRole("button", { name: "Исполнитель", exact: false })
    .last()
    .click();
  await expect(rows).toHaveCount(7);
  await flac().getByRole("button").click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => {
    a.loop = true;
    a.currentTime = 0.8;
    return a.play();
  });
  await flac().getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Редактировать теги", exact: true })
    .click();
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue(
    "Первый трек",
  );
  await page.getByLabel("Название", { exact: true }).fill("Обновлённый трек");
  await page.getByLabel("Изменить: Жанры").check();
  await page.getByLabel("Жанры", { exact: true }).fill("E2E Fresh");
  await page.getByRole("button", { name: "Посмотреть изменения" }).click();
  await expect(page.getByText("Первый трек → Обновлённый трек")).toBeVisible();
  await page.getByRole("button", { name: /^Применить к/ }).click();
  await expect(flac()).toContainText("Обновлённый трек");
  await expect(
    page.locator(".genres-panel .facet-row").filter({ hasText: "E2E Fresh" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => !a.paused),
    )
    .toBe(true);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => {
    a.pause();
    a.loop = false;
  });
  await flac().getByRole("checkbox").check();
  await page.getByRole("button", { name: "Перенести треки" }).click();
  await page
    .getByLabel("Куда перенести")
    .selectOption({ label: `Collection ${browser}` });
  await page.getByRole("button", { name: "Посмотреть изменения" }).click();
  await page.getByRole("button", { name: /^Применить к/ }).click();
  await expect(rows).toHaveCount(6);
  await page.getByRole("button", { name: "Вся музыка" }).click();
  await page
    .getByRole("button", { name: new RegExp(`Collection ${browser}`) })
    .first()
    .click();
  await expect(rows).toHaveCount(1);
  await flac().getByRole("checkbox").check();
  await page.getByRole("button", { name: "Удалить треки" }).click();
  await page.getByRole("button", { name: "Посмотреть изменения" }).click();
  await page.getByRole("button", { name: /^Применить к/ }).click();
  await expect(rows).toHaveCount(0);
  await page
    .getByRole("button", { name: "Журнал операций", exact: true })
    .click();
  await page
    .locator(".history-item")
    .filter({ has: page.getByText("Удаление", { exact: true }) })
    .first()
    .getByRole("button", { name: "Восстановить", exact: true })
    .click();
  await page.getByRole("button", { name: /^Применить к/ }).click();
  await expect(rows).toHaveCount(1);
  expect(errors).toEqual([]);
});
