import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
  await expect(page.locator(".player")).toHaveCSS("height", "72px");
  await expect(page.getByLabel("Позиция воспроизведения")).toHaveCSS(
    "width",
    "240px",
  );
  const playerLayout = await page.locator(".player").evaluate((player) => {
    const panel = player.getBoundingClientRect();
    const transport = player.querySelector<HTMLElement>(".transport")!;
    const buttons = player.querySelector<HTMLElement>(".transport-buttons")!;
    const seek = player.querySelector<HTMLElement>(".seek")!;
    const transportRect = transport.getBoundingClientRect();
    const buttonsRect = buttons.getBoundingClientRect();
    const seekRect = seek.getBoundingClientRect();
    return {
      panelCenter: panel.left + panel.width / 2,
      transportCenter: transportRect.left + transportRect.width / 2,
      buttonsCenterY: buttonsRect.top + buttonsRect.height / 2,
      seekCenterY: seekRect.top + seekRect.height / 2,
    };
  });
  expect(playerLayout.transportCenter).toBeCloseTo(playerLayout.panelCenter, 1);
  expect(playerLayout.buttonsCenterY).toBeCloseTo(playerLayout.seekCenterY, 1);
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
  const collection = page
    .getByRole("button", { name: new RegExp(`Collection ${browser}`) })
    .first();
  await collection.click({ button: "right" });
  const libraryMenu = page.getByRole("menu");
  await expect(
    libraryMenu.getByRole("menuitem", { name: "Обновить" }),
  ).toBeVisible();
  await expect(
    libraryMenu.getByRole("menuitem", { name: "Удалить" }),
  ).toBeVisible();
  const scanResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/libraries/") &&
      response.url().endsWith("/scan"),
  );
  await libraryMenu.getByRole("menuitem", { name: "Обновить" }).click();
  expect((await scanResponse).ok()).toBe(true);
  await collection.click({ button: "right" });
  await libraryMenu.getByRole("menuitem", { name: "Удалить" }).click();
  const removeLibraryDialog = page.getByRole("dialog");
  await expect(removeLibraryDialog).toContainText(
    "Файлы музыки на диске останутся",
  );
  await removeLibraryDialog.getByRole("button", { name: "Отмена" }).click();
  await page
    .getByRole("button", { name: new RegExp(`Downloads ${browser}`) })
    .first()
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(7);
  await expect(page.locator(".libraries-panel .list-tile svg")).toHaveCount(0);
  await expect(page.locator(".track-row .track-number, .track-row .row-play")).toHaveCount(0);
  const collectionTile = page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: `Collection ${browser}` });
  await collectionTile.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(page.locator(".libraries-panel .list-tile.selected")).toHaveCount(2);
  await collectionTile.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(page.locator(".libraries-panel .list-tile.selected")).toHaveCount(1);

  const genreRow = page
    .locator(".genres-panel .list-tile")
    .filter({ hasText: "Ambient" });
  const genreButton = genreRow.getByRole("button");
  await expect(genreRow.getByRole("checkbox")).toHaveCount(0);

  const artistRow = page
    .locator(".artists-panel .list-tile")
    .filter({ hasText: "Исполнитель альбома" });
  await expect(page.getByRole("heading", { name: "Исполнители" })).toBeVisible();
  const artistButton = artistRow.locator(".list-tile-main");
  await expect(artistRow.getByRole("checkbox")).toHaveCount(0);
  const firstTrackRow = page.getByTestId("track-row").first();
  const listTileGeometry = await page.evaluate(() => {
    const selectors = [
      ".libraries-panel .list-tile",
      ".genres-panel .list-tile",
      ".artists-panel .list-tile",
      '[data-testid="track-row"]',
    ];
    return selectors.map((selector) => {
      const rows = [...document.querySelectorAll<HTMLElement>(selector)];
      const first = rows[0]!;
      const second = rows[1];
      const list = first.closest<HTMLElement>(
        ".library-list, .genre-list, .artist-scroll, .track-scroll",
      )!;
      const rowRect = first.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      return {
        height: rowRect.height,
        left: rowRect.left - listRect.left,
        right: listRect.left + list.clientWidth - rowRect.right,
        radius: getComputedStyle(
          first.querySelector<HTMLElement>(".list-tile-main")!,
        ).borderRadius,
        gap:
          selector === '[data-testid="track-row"]' || !second
            ? null
            : second.getBoundingClientRect().top - rowRect.bottom,
      };
    });
  });
  for (const geometry of listTileGeometry) {
    expect(geometry.height).toBe(42);
    expect(Math.abs(geometry.left)).toBeLessThan(0.5);
    expect(Math.abs(geometry.right)).toBeLessThan(0.5);
    expect(geometry.radius).toBe("0px");
    if (geometry.gap !== null) expect(geometry.gap).toBeCloseTo(0, 1);
  }
  await expect(firstTrackRow.locator(".list-tile-main")).toHaveCSS(
    "height",
    "42px",
  );
  await artistButton.click();
  await expect(artistRow).toHaveClass(/selected/);
  await artistButton.dispatchEvent("click", { ctrlKey: true });
  await expect(artistRow).not.toHaveClass(/selected/);
  await artistButton.click();
  await expect(artistRow).toHaveClass(/selected/);

  const firstAlbum = page
    .locator(".album-card")
    .filter({ hasText: "Исполнитель альбома" });
  const firstAlbumButton = firstAlbum.locator(".album-main");
  await expect(firstAlbum.getByRole("checkbox")).toHaveCount(0);
  await expect(firstAlbum.locator(".album-cover")).toHaveCSS(
    "border-color",
    /transparent|rgba\(0, 0, 0, 0\)/,
  );
  await firstAlbumButton.click();
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(firstAlbum.locator(".album-cover")).toHaveCSS(
    "border-color",
    /rgb\(185, 212, 183\)/,
  );
  await genreButton.click();
  await expect(genreRow).toHaveClass(/selected/);
  await expect(artistRow).not.toHaveClass(/selected/);
  await expect(firstAlbum).not.toHaveClass(/selected/);
  await page
    .locator(".genres-panel")
    .getByRole("button", { name: "Все жанры" })
    .click();

  await artistButton.click();
  await expect(artistRow).toHaveClass(/selected/);
  await artistButton.dispatchEvent("click", { ctrlKey: true });
  await expect(artistRow).not.toHaveClass(/selected/);
  await artistButton.click();
  await page
    .locator(".artists-panel")
    .getByRole("button", { name: "Все исполнители" })
    .click();
  await expect(artistRow).not.toHaveClass(/selected/);

  const secondAlbum = page
    .locator(".album-card")
    .filter({ hasText: "Неизвестный исполнитель" });
  const secondAlbumButton = secondAlbum.locator(".album-main");
  await firstAlbumButton.click();
  await secondAlbumButton.dispatchEvent("click", { ctrlKey: true });
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(secondAlbum).toHaveClass(/selected/);
  await firstAlbumButton.dispatchEvent("click", { ctrlKey: true });
  await expect(firstAlbum).not.toHaveClass(/selected/);
  await expect(secondAlbum).toHaveClass(/selected/);

  await expect(firstAlbum.locator(".album-details")).toHaveCount(1);
  await expect(firstAlbum.locator(".album-details > small")).toHaveCount(2);
  await expect(firstAlbum.locator(".album-year")).toHaveCount(1);
  await expect(firstAlbum.locator(".album-track-count")).toHaveText(
    /^\d+ трек(?:а|ов)?$/,
  );
  await firstAlbumButton.click();
  await expect(firstAlbum).toHaveClass(/selected/);
  await firstAlbumButton.click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await secondAlbumButton.dispatchEvent("click", { ctrlKey: true });
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(secondAlbum).toHaveClass(/selected/);
  await firstAlbumButton.click();
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(secondAlbum).toHaveClass(/selected/);
  await page
    .locator(".albums-panel")
    .getByRole("button", { name: "Все альбомы" })
    .click();
  await expect(firstAlbum).not.toHaveClass(/selected/);
  await expect(secondAlbum).not.toHaveClass(/selected/);

  const inheritedTrackCount = Number(
    (await firstAlbum.locator(".album-track-count").textContent())?.match(
      /\d+/,
    )?.[0],
  );
  const addAlbumBookmark = firstAlbum.getByRole("button", {
    name: "Добавить альбом «Тестовый альбом» в закладки",
  });
  await page.mouse.move(0, 0);
  await expect(addAlbumBookmark).toHaveCSS("opacity", "0");
  await firstAlbum.hover();
  await expect(addAlbumBookmark).toHaveCSS("opacity", "1");
  const albumBookmarkAlignment = await firstAlbum.evaluate((card) => {
    const cover = card.querySelector<HTMLElement>(".album-cover")!;
    const button = card.querySelector<HTMLElement>(".bookmark-toggle")!;
    const coverRect = cover.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      topInset: buttonRect.top - coverRect.top,
      rightInset: coverRect.right - buttonRect.right,
    };
  });
  expect(albumBookmarkAlignment.topInset).toBeCloseTo(7, 1);
  expect(albumBookmarkAlignment.rightInset).toBeCloseTo(7, 1);
  await addAlbumBookmark.click();
  await expect(firstAlbum).not.toHaveClass(/selected/);
  const removeAlbumBookmark = firstAlbum.getByRole("button", {
    name: "Удалить альбом «Тестовый альбом» из закладок",
  });
  await expect(removeAlbumBookmark).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0);
  await expect(removeAlbumBookmark).toHaveCSS("opacity", "1");
  await firstAlbum.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await expect(
    page.getByRole("menuitem", { name: "Удалить из закладок" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const bookmarkToggle = page.getByRole("button", {
    name: "Показать музыку из закладок",
  });
  await bookmarkToggle.click();
  const activeBookmarkToggle = page.getByRole("button", {
    name: "Отключить фильтр закладок",
  });
  await expect(activeBookmarkToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("track-row")).toHaveCount(inheritedTrackCount);
  await expect(page.locator(".album-card")).toHaveCount(1);
  await expect(
    page
      .getByTestId("track-row")
      .getByRole("button", { name: /Добавить трек .* в закладки/ }),
  ).toHaveCount(inheritedTrackCount);
  await activeBookmarkToggle.click();
  await firstAlbum.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await page.getByRole("menuitem", { name: "Удалить из закладок" }).click();
  await page
    .getByRole("button", { name: "Показать музыку из закладок" })
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(0);
  await expect(page.getByText("В закладках пока пусто")).toBeVisible();
  await page.getByRole("button", { name: "Показать всю музыку" }).click();

  const artistBookmark = artistRow.getByRole("button", {
    name: /Добавить исполнителя .* в закладки/,
  });
  await page.mouse.move(0, 0);
  await expect(artistRow.locator(".list-tile-suffix")).toHaveCSS(
    "visibility",
    "visible",
  );
  await artistBookmark.focus();
  await expect(artistBookmark).toHaveCSS("opacity", "1");
  await expect(artistRow.locator(".list-tile-suffix")).toHaveCSS(
    "visibility",
    "hidden",
  );
  const artistBookmarkAlignment = await artistRow.evaluate((row) => {
    const rowRect = row.getBoundingClientRect();
    const buttonRect = row
      .querySelector<HTMLElement>(".bookmark-toggle")!
      .getBoundingClientRect();
    return {
      centerOffset:
        buttonRect.top +
        buttonRect.height / 2 -
        (rowRect.top + rowRect.height / 2),
      rightInset: rowRect.right - buttonRect.right,
      suffixCenterOffset:
        row
          .querySelector<HTMLElement>(".list-tile-suffix")!
          .getBoundingClientRect().left +
        row
          .querySelector<HTMLElement>(".list-tile-suffix")!
          .getBoundingClientRect().width /
          2 -
        (buttonRect.left + buttonRect.width / 2),
    };
  });
  expect(artistBookmarkAlignment.centerOffset).toBeCloseTo(0, 1);
  expect(artistBookmarkAlignment.rightInset).toBeCloseTo(7, 1);
  expect(artistBookmarkAlignment.suffixCenterOffset).toBeCloseTo(0, 1);
  await artistBookmark.press("Enter");
  await expect(artistRow).not.toHaveClass(/selected/);
  const removeArtistBookmark = artistRow.getByRole("button", {
    name: /Удалить исполнителя .* из закладок/,
  });
  await expect(removeArtistBookmark).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Показать музыку из закладок" })
    .click();
  await expect(page.locator(".album-card")).toHaveCount(1);
  await expect(
    page
      .locator(".album-card")
      .getByRole("button", { name: /Добавить альбом .* в закладки/ }),
  ).toHaveCount(1);
  await expect(
    page
      .getByTestId("track-row")
      .getByRole("button", { name: /Добавить трек .* в закладки/ }),
  ).toHaveCount(inheritedTrackCount);
  await page.getByRole("button", { name: "Отключить фильтр закладок" }).click();
  await removeArtistBookmark.press("Space");

  const firstTrack = page.getByTestId("track-row").first();
  await expect(firstTrack.getByRole("checkbox")).toHaveCount(0);
  await firstTrack.locator(".list-tile-main").click();
  await expect(firstTrack).toHaveClass(/selected/);
  const trackBookmarkAlignment = await firstTrack.evaluate((row) => {
    const rowRect = row.getBoundingClientRect();
    const buttonRect = row
      .querySelector<HTMLElement>(".bookmark-toggle")!
      .getBoundingClientRect();
    return {
      centerOffset:
        buttonRect.top +
        buttonRect.height / 2 -
        (rowRect.top + rowRect.height / 2),
      rightInset: rowRect.right - buttonRect.right,
    };
  });
  expect(trackBookmarkAlignment.centerOffset).toBeCloseTo(0, 1);
  expect(trackBookmarkAlignment.rightInset).toBeCloseTo(7, 1);
  await firstTrack
    .getByRole("button", { name: /Добавить трек .* в закладки/ })
    .click();
  await expect(firstTrack).toHaveClass(/selected/);
  await page.reload();
  await expect(page.getByLabel("Поиск музыки")).toBeVisible();
  const persistedTrackBookmark = page
    .getByTestId("track-row")
    .first()
    .getByRole("button", { name: /Удалить трек .* из закладок/ });
  await expect(persistedTrackBookmark).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Поиск музыки").fill("Несуществующая композиция");
  await expect(page.getByTestId("track-row")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Показать музыку из закладок" })
    .click();
  await expect(page.getByText("В закладках ничего не найдено")).toBeVisible();
  await expect(page.getByText("Текущие фильтры скрывают")).toBeVisible();
  await page
    .getByRole("button", { name: "Сбросить остальные фильтры" })
    .click();
  await expect(page.getByLabel("Поиск музыки")).toHaveValue("");
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  await persistedTrackBookmark.click();
  await expect(page.getByText("В закладках пока пусто")).toBeVisible();
  await page.getByRole("button", { name: "Показать всю музыку" }).click();

  await page.route("**/api/bookmarks", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Тестовая ошибка закладок" }),
    });
  });
  const failedArtistBookmark = artistRow.getByRole("button", {
    name: /Добавить исполнителя .* в закладки/,
  });
  await failedArtistBookmark.click();
  await expect(
    artistRow.getByRole("button", {
      name: /Удалить исполнителя .* из закладок/,
    }),
  ).toHaveAttribute("aria-busy", "true");
  await expect(failedArtistBookmark).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("status")).toContainText(
    "Тестовая ошибка закладок",
  );
  await page.unroute("**/api/bookmarks");
  await page
    .getByRole("button", { name: new RegExp(`Downloads ${browser}`) })
    .first()
    .click();

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
  const coverAfterMusicBrainz = await firstAlbum
    .locator("img")
    .getAttribute("src");
  const coverTarget = firstAlbum.locator(".album-cover");
  await coverTarget.evaluate((element) => {
    element.dispatchEvent(
      new DragEvent("dragenter", {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      }),
    );
  });
  await expect(coverTarget).toContainText("Отпустите обложку");
  await expect(coverTarget).toHaveCSS(
    "box-shadow",
    /rgb\(185, 212, 183\)/,
  );
  await coverTarget.evaluate((element) => {
    element.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
  });
  const dropFile = async (name: string, type: string, base64: string) => {
    await coverTarget.evaluate(
      (element, file) => {
        const bytes = Uint8Array.from(atob(file.base64), (char) =>
          char.charCodeAt(0),
        );
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], file.name, { type: file.type }));
        element.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
      },
      { name, type, base64 },
    );
  };
  await dropFile("not-cover.gif", "image/gif", "R0lGODlh");
  await expect(page.locator(".toast")).toContainText("JPEG или PNG");
  await coverTarget.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
        type: "image/png",
      }),
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });
  await expect(page.locator(".toast")).toContainText("JPEG или PNG");
  const droppedCover = (
    await readFile(path.resolve(".fixtures/cover.png"))
  ).toString("base64");
  await dropFile("dropped-cover.png", "image/png", droppedCover);
  const coverDialog = page.getByRole("dialog");
  await expect(coverDialog).toContainText(
    "Применить обложку «dropped-cover.png»",
  );
  await coverDialog.getByRole("button", { name: "Отмена" }).click();
  await expect(coverDialog).not.toBeVisible();
  await expect(firstAlbum.locator("img")).toHaveAttribute(
    "src",
    coverAfterMusicBrainz!,
  );
  await dropFile("dropped-cover.png", "image/png", droppedCover);
  await coverDialog
    .getByRole("button", { name: "Применить", exact: true })
    .click();
  await expect(coverDialog).not.toBeVisible();
  await expect
    .poll(() => firstAlbum.locator("img").getAttribute("src"))
    .not.toBe(coverAfterMusicBrainz);
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
    await row.dblclick();
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
  await expect(page.locator(".track-number")).toHaveCount(0);
  await expect(page.locator(".track-copy")).toHaveCount(0);
  await expect(page.locator(".track-format")).toHaveCount(0);
  await expect(page.locator(".album-formats")).toHaveCount(0);
  const taggedAlbumHeader = page
    .locator(".track-album-header")
    .filter({ hasText: "Исполнитель альбома" });
  await expect(taggedAlbumHeader).toContainText("Исполнитель альбома");
  await expect(taggedAlbumHeader).not.toContainText("FLAC");
  await page
    .locator(".artists-panel")
    .locator(".list-tile-main")
    .filter({ hasText: "Исполнитель альбома" })
    .click();
  await expect(rows).toHaveCount(6);
  await flac().dblclick();
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
  await flac().locator(".list-tile-main").click();
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
    page.locator(".genres-panel .list-tile").filter({ hasText: "E2E Fresh" }),
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
  await flac().locator(".list-tile-main").click();
  await page.getByRole("button", { name: "Перенести треки" }).click();
  await page
    .getByLabel("Куда перенести")
    .selectOption({ label: `Collection ${browser}` });
  await page.getByRole("button", { name: "Посмотреть изменения" }).click();
  await page.getByRole("button", { name: /^Применить к/ }).click();
  await expect(rows).toHaveCount(5);
  await page.getByRole("button", { name: "Вся музыка" }).click();
  await page
    .getByRole("button", { name: new RegExp(`Collection ${browser}`) })
    .first()
    .click();
  await expect(rows).toHaveCount(1);
  await flac().locator(".list-tile-main").click();
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
  await collection.click({ button: "right" });
  await libraryMenu.getByRole("menuitem", { name: "Удалить" }).click();
  await page.getByRole("button", { name: "Отключить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(`Collection ${browser}`) }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
