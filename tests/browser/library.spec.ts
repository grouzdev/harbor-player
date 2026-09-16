import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("Tab cycles only through text entry fields", async ({ page }) => {
  await page.goto("/");

  const focusedTags: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Tab");
    focusedTags.push(
      await page.evaluate(() => document.activeElement?.tagName ?? ""),
    );
  }

  expect(focusedTags).not.toContain("BUTTON");
  expect(focusedTags).not.toContain("SELECT");
  expect(focusedTags).not.toContain("A");
  expect(focusedTags).toContain("INPUT");
});

test("a dialog keeps Tab navigation in its text fields", async ({ page }) => {
  await page.goto("/");
  await page.locator(".add-library").click();

  const folder = page.getByPlaceholder("D:\\Music\\Collection");
  const name = page.getByPlaceholder("Например, Коллекция");
  await expect(folder).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(name).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(folder).toBeFocused();
});

test("a dialog without text fields keeps focus off its close button", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = page.locator("dialog");
  await page.getByRole("button", { name: "Журнал операций" }).click();

  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveCSS("outline-style", "none");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
});

test("icon buttons keep their geometry on hover", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Журнал операций" });
  const before = await button.boundingBox();

  await button.hover();
  const after = await button.boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.width).toBeCloseTo(before!.width, 5);
  expect(after!.height).toBeCloseTo(before!.height, 5);
});

test("fullscreen button changes the application shell", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "Развернуть окно на весь экран",
  });
  await expect(page.locator(".app-shell")).toHaveCSS("border-radius", "0px");

  await button.click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await expect(
    page.getByRole("button", {
      name: "Свернуть окно из полноэкранного режима",
    }),
  ).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCSS("border-radius", "14px");

  const resizeHandle = page.locator(".fullscreen-window-resize--se");
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2,
    resizeBox!.y + resizeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x - 160, resizeBox!.y - 120);
  await page.mouse.up();

  const resized = await page.locator(".app-shell").boundingBox();
  expect(resized).not.toBeNull();
  expect(resized!.width).toBeLessThan(await page.evaluate(() => innerWidth));

  const topbar = page.locator(".topbar");
  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  await page.mouse.move(topbarBox!.x + 20, topbarBox!.y + 30);
  await page.mouse.down();
  await page.mouse.move(topbarBox!.x + 70, topbarBox!.y + 70);
  await page.mouse.up();
  const moved = await page.locator(".app-shell").boundingBox();
  expect(moved).not.toBeNull();
  expect(moved!.x).toBeGreaterThan(resized!.x + 20);

  await topbar.dblclick({ position: { x: 20, y: 30 } });
  await expect(page.locator(".app-shell")).toHaveCSS("border-radius", "14px");

  await topbar.dblclick({ position: { x: 20, y: 30 } });
  await expect(page.locator(".app-shell")).toHaveCSS("border-radius", "0px");
  await expect(page.locator(".fullscreen-window-resize").first()).toBeHidden();

  await topbar.dblclick({ position: { x: 20, y: 30 } });
  await expect(page.locator(".app-shell")).toHaveCSS("border-radius", "14px");

  await page
    .getByRole("button", { name: "Свернуть окно из полноэкранного режима" })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);

  await page
    .getByRole("button", { name: "Развернуть окно на весь экран" })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await expect(page.locator(".app-shell")).toHaveClass(
    /fullscreen-window--custom/,
  );
  const restored = await page.locator(".app-shell").boundingBox();
  expect(restored).not.toBeNull();
  expect(restored!.width).toBeCloseTo(moved!.width, 0);
});

test("fullscreen window adapts to its own orientation and reaches screen edges", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Развернуть окно на весь экран" })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);

  const initial = await page.locator(".app-shell").boundingBox();
  expect(initial).not.toBeNull();
  expect(initial!.x).toBeGreaterThan(0);
  expect(initial!.y).toBeGreaterThan(0);
  await expect(page.locator(".app-shell")).not.toHaveClass(/layout--portrait/);

  const resizeHandle = page.locator(".fullscreen-window-resize--se");
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2,
    resizeBox!.y + resizeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x - 510, resizeBox!.y - 10);
  await page.mouse.up();

  await expect(page.locator(".app-shell")).toHaveClass(/layout--portrait/);
  const portraitTops = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().top),
    );
  expect(portraitTops[0]).toBeCloseTo(portraitTops[1], 1);
  expect(portraitTops[0]).toBeLessThan(portraitTops[3]);

  const topbar = page.locator(".topbar");
  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  await page.mouse.move(topbarBox!.x + 20, topbarBox!.y + 30);
  await page.mouse.down();
  await page.mouse.move(20, 30);
  await page.mouse.up();

  const atScreenEdge = await page.locator(".app-shell").boundingBox();
  expect(atScreenEdge).not.toBeNull();
  expect(atScreenEdge!.x).toBeCloseTo(0, 1);
  expect(atScreenEdge!.y).toBeCloseTo(0, 1);

  const portraitResizeBox = await resizeHandle.boundingBox();
  expect(portraitResizeBox).not.toBeNull();
  await page.mouse.move(
    portraitResizeBox!.x + portraitResizeBox!.width / 2,
    portraitResizeBox!.y + portraitResizeBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(portraitResizeBox!.x + 300, portraitResizeBox!.y - 100);
  await page.mouse.up();

  await expect(page.locator(".app-shell")).not.toHaveClass(/layout--portrait/);
  const landscapeTops = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().top),
    );
  expect(
    landscapeTops.every((top) => Math.abs(top - landscapeTops[0]) < 0.5),
  ).toBe(true);
});

test("portrait workspace uses two independently resizable rows", async ({
  page,
}) => {
  await page.goto("/");
  await page.setViewportSize({ width: 1000, height: 1200 });
  await expect(page.locator(".app-shell")).toHaveClass(/layout--portrait/);

  const portraitLayout = await page
    .locator(".workspace")
    .evaluate((workspace) => {
      const rect = (selector: string) => {
        const element = workspace.querySelector<HTMLElement>(selector)!;
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        };
      };
      return {
        library: rect(".libraries-panel"),
        genres: rect(".genres-panel"),
        artists: rect(".artists-panel"),
        albums: rect(".albums-panel"),
        tracks: rect(".tracks-panel"),
        scrollsHorizontally: workspace.scrollWidth > workspace.clientWidth,
      };
    });
  expect(portraitLayout.library.top).toBeCloseTo(portraitLayout.genres.top, 1);
  expect(portraitLayout.library.top).toBeCloseTo(portraitLayout.artists.top, 1);
  expect(portraitLayout.albums.top).toBeCloseTo(portraitLayout.tracks.top, 1);
  expect(portraitLayout.library.top).toBeLessThan(portraitLayout.albums.top);
  expect(portraitLayout.library.height).toBeCloseTo(
    portraitLayout.albums.height,
    1,
  );
  expect(portraitLayout.scrollsHorizontally).toBe(false);
  await expect(page.getByRole("separator")).toHaveCount(4);

  async function resizeSeparator(label: string, deltaX: number) {
    const separator = page.getByRole("separator", { name: label });
    const box = await separator.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2 + deltaX,
      box!.y + box!.height / 2,
    );
    await page.mouse.up();
  }

  async function resizeRows(deltaY: number) {
    const separator = page.getByRole("separator", { name: "Высота строк" });
    const box = await separator.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2 + deltaY,
    );
    await page.mouse.up();
  }

  const beforeFacetResize = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().width),
    );
  await resizeSeparator("Ширина: Библиотеки — Жанры", 24);
  const afterFacetResize = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().width),
    );
  expect(afterFacetResize[0]).not.toBeCloseTo(beforeFacetResize[0], 1);
  expect(afterFacetResize[3]).toBeCloseTo(beforeFacetResize[3], 1);
  expect(afterFacetResize[4]).toBeCloseTo(beforeFacetResize[4], 1);

  const beforeArtistResize = afterFacetResize;
  await resizeSeparator("Ширина: Жанры — Исполнители", -24);
  const afterArtistResize = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().width),
    );
  expect(afterArtistResize[2]).not.toBeCloseTo(beforeArtistResize[2], 1);
  expect(afterArtistResize[3]).toBeCloseTo(beforeArtistResize[3], 1);
  expect(afterArtistResize[4]).toBeCloseTo(beforeArtistResize[4], 1);

  const beforeCatalogResize = afterArtistResize;
  await resizeSeparator("Ширина: Альбомы — Треки", 24);
  const afterCatalogResize = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().width),
    );
  expect(afterCatalogResize[0]).toBeCloseTo(beforeCatalogResize[0], 1);
  expect(afterCatalogResize[1]).toBeCloseTo(beforeCatalogResize[1], 1);
  expect(afterCatalogResize[2]).toBeCloseTo(beforeCatalogResize[2], 1);
  expect(afterCatalogResize[3]).not.toBeCloseTo(beforeCatalogResize[3], 1);

  const beforeRowResize = await page
    .locator(".workspace-row")
    .evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().height),
    );
  await resizeRows(120);
  const afterRowResize = await page
    .locator(".workspace-row")
    .evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().height),
    );
  expect(afterRowResize[0]).toBeGreaterThan(beforeRowResize[0]);
  expect(afterRowResize[1]).toBeLessThan(beforeRowResize[1]);

  await page.setViewportSize({ width: 1200, height: 1000 });
  const landscapeTops = await page
    .locator(".panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().top),
    );
  expect(landscapeTops.every((top) => top === landscapeTops[0])).toBe(true);
});

test("panel visibility controls reshape and persist the catalog", async ({
  page,
}) => {
  await page.goto("/");
  const workspace = page.locator(".workspace");

  await page.getByRole("button", { name: "Скрыть панель «Жанры»" }).click();
  await expect(page.locator(".genres-panel")).toBeHidden();
  await page.mouse.move(500, 500);
  await expect(
    page.getByRole("button", { name: "Показать панель «Жанры»" }),
  ).toHaveCSS("opacity", "0.55");
  await expect(
    page.getByRole("separator", {
      name: "Ширина: Библиотеки — Исполнители",
    }),
  ).toBeVisible();

  const libraryBefore = await page
    .locator(".libraries-panel")
    .evaluate((panel) => panel.getBoundingClientRect().width);
  const nonAdjacentSeparator = page.getByRole("separator", {
    name: "Ширина: Библиотеки — Исполнители",
  });
  const separatorBox = await nonAdjacentSeparator.boundingBox();
  expect(separatorBox).not.toBeNull();
  await page.mouse.move(
    separatorBox!.x + separatorBox!.width / 2,
    separatorBox!.y + separatorBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(separatorBox!.x + 40, separatorBox!.y);
  await page.mouse.up();
  const libraryAfter = await page
    .locator(".libraries-panel")
    .evaluate((panel) => panel.getBoundingClientRect().width);
  expect(libraryAfter).toBeGreaterThan(libraryBefore);

  for (const label of ["Библиотеки", "Исполнители", "Альбомы", "Треки"]) {
    await page
      .getByRole("button", { name: `Скрыть панель «${label}»` })
      .click();
  }
  await expect(workspace.locator(".panel:visible")).toHaveCount(0);
  await expect(workspace.getByRole("separator")).toHaveCount(0);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".player")).toBeVisible();

  await page.getByRole("button", { name: "Показать панель «Альбомы»" }).click();
  await page.reload();
  await expect(page.locator(".panel:visible")).toHaveCount(1);
  await expect(page.locator(".albums-panel")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Скрыть панель «Альбомы»" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.setViewportSize({ width: 1000, height: 1200 });
  await expect(
    page.getByRole("separator", { name: "Высота строк" }),
  ).toHaveCount(0);
  const albumOnlyHeight = await page
    .locator(".workspace-catalog")
    .evaluate((row) => row.getBoundingClientRect().height);
  expect(albumOnlyHeight).toBeCloseTo(
    await workspace.evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
    1,
  );

  await page
    .getByRole("button", { name: "Показать панель «Библиотеки»" })
    .click();
  await expect(
    page.getByRole("separator", { name: "Высота строк" }),
  ).toBeVisible();
  const twoRowHeights = await page
    .locator(".workspace-row")
    .evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().height),
    );
  expect(twoRowHeights).toHaveLength(2);
  expect(twoRowHeights[0]).toBeGreaterThan(0);
  expect(twoRowHeights[1]).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Скрыть панель «Альбомы»" }).click();
  await expect(
    page.getByRole("separator", { name: "Высота строк" }),
  ).toHaveCount(0);
  const libraryOnlyHeight = await page
    .locator(".workspace-facets")
    .evaluate((row) => row.getBoundingClientRect().height);
  expect(libraryOnlyHeight).toBeCloseTo(
    await workspace.evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
    1,
  );
});

test("a single visible panel fills the workspace width", async ({ page }) => {
  const panels = [
    ["Библиотеки", ".libraries-panel"],
    ["Жанры", ".genres-panel"],
    ["Исполнители", ".artists-panel"],
    ["Альбомы", ".albums-panel"],
    ["Треки", ".tracks-panel"],
  ] as const;

  for (const [viewport, label] of [
    [{ width: 1200, height: 800 }, "landscape"],
    [{ width: 1000, height: 1200 }, "portrait"],
  ] as const) {
    await page.setViewportSize(viewport);

    for (const [visibleLabel, selector] of panels) {
      await page.goto("/");
      await page.evaluate((visible) => {
        localStorage.setItem(
          "mml-panel-visibility-v1",
          JSON.stringify({
            libraries: visible === "Библиотеки",
            genres: visible === "Жанры",
            artists: visible === "Исполнители",
            albums: visible === "Альбомы",
            tracks: visible === "Треки",
          }),
        );
      }, visibleLabel);
      await page.reload();

      const dimensions = await page.locator(".workspace").evaluate(
        (workspace, panelSelector) => {
          const panel = workspace.querySelector<HTMLElement>(panelSelector)!;
          return {
            workspaceWidth: workspace.getBoundingClientRect().width,
            panelWidth: panel.getBoundingClientRect().width,
          };
        },
        selector,
      );
      expect(dimensions.panelWidth, `${label}: ${visibleLabel}`).toBeCloseTo(
        dimensions.workspaceWidth,
        1,
      );
    }
  }
});

test("player keeps volume visible and reflows progress below controls", async ({
  page,
}) => {
  await page.goto("/");

  const layouts: Array<{ width: number; seekRangeWidth: number }> = [];
  for (const [width, expectTwoRows] of [
    [1600, false],
    [1000, false],
    [999, true],
    [720, true],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator(".player").evaluate((player) => {
      const buttons = player.querySelector<HTMLElement>(".transport-buttons")!;
      const seek = player.querySelector<HTMLElement>(".seek")!;
      const volume = player.querySelector<HTMLElement>(".volume")!;
      const shuffle = player.querySelector<HTMLElement>(
        '[aria-label="Перемешать"]',
      )!;
      const repeat = player.querySelector<HTMLElement>(
        '[aria-label^="Повтор:"]',
      )!;
      const mute = player.querySelector<HTMLElement>(
        '[aria-label="Выключить звук"], [aria-label="Включить звук"]',
      )!;
      const volumeRange = player.querySelector<HTMLElement>(".volume-range")!;
      const nowPlaying = player.querySelector<HTMLElement>(".now-playing")!;
      const nowArtistLink = document.createElement("button");
      nowArtistLink.className = "now-artist-link";
      nowArtistLink.textContent = "Очень длинное имя исполнителя";
      nowArtistLink.style.cssText = "position: fixed; visibility: hidden";
      nowPlaying.append(nowArtistLink);
      const seekRange = player.querySelector<HTMLElement>(".seek-range")!;
      const playerRect = player.getBoundingClientRect();
      const transportRect = player
        .querySelector<HTMLElement>(".transport")!
        .getBoundingClientRect();
      const volumeRect = volume.getBoundingClientRect();
      const nowPlayingRect = nowPlaying.getBoundingClientRect();
      const buttonsRect = buttons.getBoundingClientRect();
      const seekRect = seek.getBoundingClientRect();
      const shuffleRect = shuffle.getBoundingClientRect();
      const repeatRect = repeat.getBoundingClientRect();
      const muteRect = mute.getBoundingClientRect();
      const volumeRangeRect = volumeRange.getBoundingClientRect();
      return {
        playerHeight: player.getBoundingClientRect().height,
        panelCenter: playerRect.left + playerRect.width / 2,
        transportCenter: transportRect.left + transportRect.width / 2,
        panelBottom: playerRect.bottom,
        buttonsBottom: buttonsRect.bottom,
        seekTop: seekRect.top,
        seekRangeWidth: seekRange.getBoundingClientRect().width,
        volumeVisible: getComputedStyle(volume).display !== "none",
        volumeRangeWidth: volumeRange.getBoundingClientRect().width,
        volumeBottom: volumeRect.bottom,
        nowPlayingBottom: nowPlayingRect.bottom,
        shuffleRight: shuffleRect.right,
        shuffleLeft: shuffleRect.left,
        repeatRight: repeatRect.right,
        repeatLeft: repeatRect.left,
        muteLeft: muteRect.left,
        muteRight: muteRect.right,
        volumeRangeLeft: volumeRangeRect.left,
        volumeRangeRight: volumeRangeRect.right,
        artistLinkStyle: getComputedStyle(nowArtistLink).textOverflow,
      };
    });

    expect(layout.volumeVisible, `${width}px volume`).toBe(true);
    expect(layout.artistLinkStyle, `${width}px artist ellipsis`).toBe(
      "ellipsis",
    );
    expect(layout.volumeRangeWidth, `${width}px volume range`).toBeGreaterThanOrEqual(
      64,
    );
    expect(layout.transportCenter, `${width}px transport center`).toBeCloseTo(
      layout.panelCenter,
      1,
    );
    expect(layout.muteRight).toBeLessThanOrEqual(layout.volumeRangeLeft);
    expect(layout.volumeRangeRight).toBeLessThanOrEqual(layout.repeatLeft);
    expect(layout.repeatRight).toBeLessThanOrEqual(layout.shuffleLeft);
    if (expectTwoRows) {
      expect(layout.playerHeight).toBe(80);
      expect(layout.seekTop).toBeGreaterThanOrEqual(layout.buttonsBottom);
      expect(layout.volumeBottom).toBeLessThanOrEqual(layout.panelBottom);
      expect(layout.nowPlayingBottom).toBeLessThanOrEqual(layout.panelBottom);
    } else {
      expect(layout.playerHeight).toBe(72);
      expect(layout.seekTop).toBeLessThan(layout.buttonsBottom);
    }
    layouts.push({ width, seekRangeWidth: layout.seekRangeWidth });
  }
  expect(layouts[0].seekRangeWidth).toBeGreaterThan(layouts[1].seekRangeWidth);
});

test("local library: readable UI, playback, tags, move, delete and restore", async ({
  page,
}, info) => {
  const browser = info.project.name;
  const source = path.resolve(".test-data/browser", browser, "Downloads");
  const target = path.resolve(".test-data/browser", browser, "Collection");
  const tree = path.resolve(".test-data/browser", browser, "Tree");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByLabel("Поиск музыки")).toBeVisible();
  await expect(page.locator(".brand, .page-heading")).toHaveCount(0);
  await expect(page.locator(".topbar")).toHaveCSS("height", "65px");
  await expect(page.locator(".player")).toHaveCSS("height", "72px");
  const rangeStyles = await page.locator(".seek-range").evaluate((shell) => {
    const styles = getComputedStyle(shell);
    return {
      height: styles.height,
      backgroundImage: styles.backgroundImage,
      backgroundSize: styles.backgroundSize,
      borderRadius: styles.borderRadius,
      progress: shell.style.getPropertyValue("--range-progress"),
    };
  });
  expect(rangeStyles.height).toBe("18px");
  expect(rangeStyles.backgroundImage).toContain("linear-gradient");
  expect(rangeStyles.backgroundSize).toBe("100% 5px");
  expect(rangeStyles.borderRadius).toBe("999px");
  expect(rangeStyles.progress).toBe("0%");
  const volumeStyles = await page.locator(".volume-range").evaluate((shell) => {
    const styles = getComputedStyle(shell);
    return {
      height: styles.height,
      backgroundImage: styles.backgroundImage,
      backgroundSize: styles.backgroundSize,
      borderRadius: styles.borderRadius,
    };
  });
  expect(volumeStyles.height).toBe("18px");
  expect(volumeStyles.backgroundImage).toContain("linear-gradient");
  expect(volumeStyles.backgroundSize).toBe("100% 5px");
  expect(volumeStyles.borderRadius).toBe("999px");
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
  await expect(
    libraryMenu.getByRole("menuitem", { name: "Переименовать" }),
  ).toBeVisible();
  await libraryMenu.getByRole("menuitem", { name: "Переименовать" }).click();
  const renameLibraryDialog = page.getByRole("dialog");
  await expect(renameLibraryDialog).toBeVisible();
  await renameLibraryDialog
    .getByLabel("Название библиотеки")
    .fill(`Collection renamed ${browser}`);
  await renameLibraryDialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(renameLibraryDialog).not.toBeVisible();
  await expect(
    page
      .getByRole("button", {
        name: new RegExp(`Collection renamed ${browser}`),
      })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: new RegExp(`Collection renamed ${browser}`) })
    .first()
    .click({ button: "right" });
  const scanResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/libraries/") &&
      response.url().endsWith("/scan"),
  );
  await libraryMenu.getByRole("menuitem", { name: "Обновить" }).click();
  expect((await scanResponse).ok()).toBe(true);
  await page
    .getByRole("button", { name: new RegExp(`Collection renamed ${browser}`) })
    .first()
    .click({ button: "right" });
  await libraryMenu.getByRole("menuitem", { name: "Удалить" }).click();
  const removeLibraryDialog = page.getByRole("dialog");
  await expect(removeLibraryDialog).toContainText(
    "Файлы музыки на диске останутся",
  );
  await removeLibraryDialog.getByRole("button", { name: "Отмена" }).click();
  const downloadsTile = page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: `Downloads ${browser}` });
  await downloadsTile.locator(".list-tile-main").click();
  await expect(page.getByTestId("track-row")).toHaveCount(7);
  await page
    .getByRole("button", {
      name: `Развернуть библиотеку «Downloads ${browser}»`,
    })
    .click();
  const albumFolderButton = page
    .locator(".libraries-panel")
    .getByTitle("Album", { exact: true });
  const albumFolder = albumFolderButton.locator("..");
  await expect(albumFolder).toBeVisible();
  await albumFolderButton.click();
  await expect(albumFolder).toHaveClass(/selected/);
  await expect(page.getByTestId("track-row")).toHaveCount(7);
  await expect(
    page.locator(".libraries-panel .panel-selection-chip"),
  ).toHaveText(/^0 из \d+$/);
  await downloadsTile.locator(".list-tile-main").click();
  await expect(
    page.locator(".track-row .track-number, .track-row .row-play"),
  ).toHaveCount(0);
  const collectionTile = page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: `Collection renamed ${browser}` });
  await collectionTile
    .locator(".list-tile-main")
    .click({ modifiers: ["Control"] });
  await expect(
    page.locator(".libraries-panel .list-tile.selected"),
  ).toHaveCount(2);
  await collectionTile
    .locator(".list-tile-main")
    .click({ modifiers: ["Control"] });
  await expect(
    page.locator(".libraries-panel .list-tile.selected"),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Скрыть панель «Библиотеки»" })
    .click();
  await page
    .getByRole("button", { name: "Показать панель «Библиотеки»" })
    .click();
  await expect(
    page.locator(".libraries-panel .list-tile.selected"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: `Свернуть библиотеку «Downloads ${browser}»`,
    }),
  ).toBeVisible();
  await downloadsTile.locator(".list-tile-main").click();
  await expect(
    page.locator(".libraries-panel .panel-selection-chip"),
  ).toHaveText(/^1 из \d+$/);

  const genreRow = page
    .locator(".genres-panel .list-tile")
    .filter({ hasText: "Ambient" });
  const genreButton = genreRow.getByRole("button");
  await expect(genreRow.getByRole("checkbox")).toHaveCount(0);

  const artistRow = page
    .locator(".artists-panel .list-tile")
    .filter({ hasText: "Исполнитель альбома" });
  await expect(
    page.getByRole("heading", { name: "Исполнители" }),
  ).toBeVisible();
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
    expect(geometry.height).toBe(36);
    expect(Math.abs(geometry.left)).toBeLessThan(0.5);
    expect(Math.abs(geometry.right)).toBeLessThan(0.5);
    expect(geometry.radius).toBe("0px");
    if (geometry.gap !== null) expect(geometry.gap).toBeCloseTo(0, 1);
  }
  await expect(firstTrackRow.locator(".list-tile-main")).toHaveCSS(
    "height",
    "36px",
  );
  const trackDurationInset = await firstTrackRow.evaluate((row) => {
    const scroll = row.closest<HTMLElement>(".track-scroll")!;
    const duration = row.querySelector<HTMLElement>(".list-tile-suffix")!;
    const scrollRect = scroll.getBoundingClientRect();
    const durationRect = duration.getBoundingClientRect();
    return scrollRect.left + scroll.clientWidth - durationRect.right;
  });
  expect(Math.abs(trackDurationInset - 36)).toBeLessThan(0.5);
  await expect(
    page.getByRole("button", { name: "Сбросить выбор треков" }),
  ).toHaveCount(0);
  await expect(page.locator(".tracks-panel .panel-count")).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await firstTrackRow.locator(".list-tile-main").click();
  await expect(page.getByRole("heading", { name: "Треки" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сбросить выбор треков" }),
  ).toBeVisible();
  await expect(
    page.locator(".tracks-panel .panel-selection-chip"),
  ).toContainText(/^1 из \d+$/);
  await page.getByRole("button", { name: "Скрыть панель «Треки»" }).click();
  await page.getByRole("button", { name: "Показать панель «Треки»" }).click();
  await expect(firstTrackRow).not.toHaveClass(/selected/);
  await artistButton.click();
  await expect(artistRow).toHaveClass(/selected/);
  await artistButton.dispatchEvent("click", { ctrlKey: true });
  await expect(artistRow).not.toHaveClass(/selected/);
  await artistButton.click();
  await expect(artistRow).toHaveClass(/selected/);

  await expect(downloadsTile).toHaveClass(/related/);
  await expect(
    downloadsTile.locator(".list-tile-related-marker"),
  ).toBeVisible();
  await expect(collectionTile).not.toHaveClass(/related/);
  await expect(collectionTile.locator(".list-tile-related-marker")).toHaveCount(
    0,
  );
  await expect(artistRow).toHaveClass(/related/);
  await expect(artistRow.locator(".list-tile-related-marker")).toBeVisible();

  const firstAlbum = page.getByTitle("Тестовый альбом · Исполнитель альбома", {
    exact: true,
  });
  const firstAlbumButton = firstAlbum.locator(".album-main");
  await expect(
    page
      .locator(".album-artist-header")
      .filter({ hasText: "Исполнитель альбома" }),
  ).toHaveCount(1);
  const albumArtistLink = page.getByRole("button", {
    name: "Выбрать исполнителя «Исполнитель альбома»",
  });
  await page
    .getByRole("button", { name: "Сбросить исполнителей" })
    .click();
  await expect(
    page
      .locator(".artists-panel .list-tile.selected")
      .filter({ hasText: "Исполнитель альбома" }),
  ).toHaveCount(0);
  await albumArtistLink.click();
  await expect(
    page
      .locator(".artists-panel .list-tile.selected")
      .filter({ hasText: "Исполнитель альбома" }),
  ).toHaveCount(1);
  await expect(firstAlbum.getByRole("checkbox")).toHaveCount(0);
  await expect(firstAlbum.locator(".album-cover")).toHaveCSS(
    "border-color",
    /transparent|rgba\(0, 0, 0, 0\)/,
  );
  await expect(firstAlbum.locator(".album-cover")).toHaveCSS(
    "background-clip",
    "padding-box",
  );
  const albumGridGeometry = await page
    .locator(".album-grid-row")
    .evaluate((grid) => {
      const style = getComputedStyle(grid);
      return { gap: style.gap };
    });
  expect(albumGridGeometry.gap).toBe("8px");
  await firstAlbumButton.click();
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(firstAlbum.locator(".album-cover")).toHaveCSS(
    "border-color",
    /rgb\(198, 202, 145\)/,
  );
  const firstTrackAlbumHeader = page
    .locator(".track-album-header")
    .filter({ hasText: "Исполнитель альбома" });
  await expect(firstTrackAlbumHeader.locator(".tiny-cover")).toHaveCSS(
    "width",
    "40px",
  );
  await expect(firstTrackAlbumHeader).toHaveCSS("height", "78px");
  await expect(firstTrackAlbumHeader.locator(":scope > svg")).toHaveCount(0);
  await expect(firstTrackAlbumHeader.locator("small").first()).toHaveText(
    "Исполнитель альбома",
  );
  await expect(firstTrackAlbumHeader.locator("strong")).toHaveText(
    "Тестовый альбом",
  );
  await expect(firstTrackAlbumHeader.locator("small").last()).toContainText(
    /^2024 · Ambient$/,
  );
  await firstTrackAlbumHeader.click();
  await expect(firstTrackAlbumHeader).toHaveClass(/selected/);
  await expect(page.locator('[data-testid="track-row"].selected')).toHaveCount(
    0,
  );
  await firstTrackRow.locator(".list-tile-main").click();
  await expect(firstTrackRow).toHaveClass(/selected/);
  await firstTrackAlbumHeader.click();
  await expect(firstTrackAlbumHeader).toHaveClass(/selected/);
  await expect(page.locator('[data-testid="track-row"].selected')).toHaveCount(
    0,
  );
  await firstTrackAlbumHeader.click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Сбросить выбор треков" }).click();
  await genreButton.click();
  await expect(genreRow).toHaveClass(/selected/);
  await expect(
    page.locator(".genres-panel .panel-selection-chip"),
  ).toContainText(/^1 из \d+$/);
  await expect(artistRow).toHaveClass(/selected/);
  await expect(firstAlbum).toHaveClass(/selected/);
  await page
    .locator(".genres-panel")
    .getByRole("button", { name: "Сбросить жанры" })
    .click();
  await expect(
    page.getByRole("button", { name: "Сбросить жанры" }),
  ).toHaveCount(0);
  await expect(artistRow).toHaveClass(/selected/);
  await expect(firstAlbum).toHaveClass(/selected/);

  await artistButton.click();
  await expect(artistRow).toHaveClass(/selected/);
  await expect(
    page.locator(".artists-panel .panel-selection-chip"),
  ).toContainText(/^1 из \d+$/);
  await artistButton.dispatchEvent("click", { ctrlKey: true });
  await expect(artistRow).not.toHaveClass(/selected/);
  await artistButton.click();
  await page
    .locator(".artists-panel")
    .getByRole("button", { name: "Сбросить исполнителей" })
    .click();
  await expect(
    page.getByRole("button", { name: "Сбросить исполнителей" }),
  ).toHaveCount(0);
  await expect(artistRow).not.toHaveClass(/selected/);
  await expect(firstAlbum).toHaveClass(/selected/);

  const secondAlbum = page.getByTitle("Тестовый альбом · Исполнитель", {
    exact: true,
  });
  const secondAlbumButton = secondAlbum.locator(".album-main");
  await firstAlbumButton.click();
  await secondAlbumButton.dispatchEvent("click", { ctrlKey: true });
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(secondAlbum).toHaveClass(/selected/);
  await firstAlbumButton.dispatchEvent("click", { ctrlKey: true });
  await expect(firstAlbum).not.toHaveClass(/selected/);
  await expect(secondAlbum).toHaveClass(/selected/);

  await expect(firstAlbum.locator(".album-details")).toHaveCount(1);
  await expect(firstAlbum.locator(".album-details > small")).toHaveCount(1);
  await expect(firstAlbum.locator(".album-details")).toHaveText(/^\d{4}$/);
  await expect(firstAlbum.locator(".album-track-count")).toHaveText(
    /^\d+ трек(?:а|ов)?$/,
  );
  await firstAlbumButton.click();
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(
    page.locator(".albums-panel .panel-selection-chip"),
  ).toContainText(/^1 из \d+$/);
  await firstAlbumButton.click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await secondAlbumButton.dispatchEvent("click", { ctrlKey: true });
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(secondAlbum).toHaveClass(/selected/);
  await firstAlbum.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  await expect(
    page.getByRole("menuitem", { name: "Редактировать теги (2)" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Редактировать теги (2)" }).click();
  const groupedAlbumTrackCount =
    Number(
      (await firstAlbum.locator(".album-track-count").textContent())?.match(
        /\d+/,
      )?.[0],
    ) +
    Number(
      (await secondAlbum.locator(".album-track-count").textContent())?.match(
        /\d+/,
      )?.[0],
    );
  await expect(page.getByRole("dialog")).toContainText(
    `Выбрано треков: ${groupedAlbumTrackCount}`,
  );
  await page.getByRole("button", { name: "Отмена" }).click();
  await firstAlbumButton.click();
  await expect(firstAlbum).toHaveClass(/selected/);
  await expect(secondAlbum).toHaveClass(/selected/);
  await page
    .locator(".albums-panel")
    .getByRole("button", { name: "Сбросить альбомы" })
    .click();
  await expect(
    page.getByRole("button", { name: "Сбросить альбомы" }),
  ).toHaveCount(0);
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
  await expect(artistRow.locator(".list-tile-suffix")).toHaveCSS(
    "visibility",
    "visible",
  );
  const savedArtistBookmarkGeometry = await artistRow.evaluate((row) => {
    const suffixRect = row
      .querySelector<HTMLElement>(".list-tile-suffix")!
      .getBoundingClientRect();
    const buttonRect = row
      .querySelector<HTMLElement>(".bookmark-toggle")!
      .getBoundingClientRect();
    return { gap: buttonRect.left - suffixRect.right };
  });
  expect(savedArtistBookmarkGeometry.gap).toBeCloseTo(0, 1);
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
  const firstTrackKey = await firstTrack.getAttribute("data-selection-key");
  expect(firstTrackKey).not.toBeNull();
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
    .locator(`[data-testid="track-row"][data-selection-key="${firstTrackKey}"]`)
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
  expect(await page.getByTestId("track-row").count()).toBeGreaterThan(0);
  await expect(page.locator(".catalog-footer")).toHaveCount(0);

  for (const action of [
    "Редактировать теги",
    "Перенести треки",
    "Удалить треки",
  ])
    await expect(
      page.getByRole("button", { name: action, exact: true }),
    ).toHaveCount(0);

  const trackActions = [
    "Редактировать теги",
    "Перенести треки",
    "Удалить треки",
  ];
  for (const action of trackActions) {
    await page.getByTestId("track-row").first().dispatchEvent("contextmenu");
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Выбрано треков: 1");
    await page.getByRole("button", { name: "Отмена" }).click();
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          (window as typeof window & { copiedText?: string }).copiedText =
            value;
          return Promise.resolve();
        },
      },
    });
  });
  await firstAlbum.first().dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Копировать данные" }).click();
  await expect(page.getByRole("status")).toContainText("Данные скопированы");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { copiedText?: string }).copiedText,
      ),
    )
    .toBe("Исполнитель альбома — Тестовый альбом (2024)");
  await page.getByTestId("track-row").first().dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Копировать данные" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { copiedText?: string }).copiedText,
      ),
    )
    .toBe("Исполнитель — Первый трек");
  await page.reload();
  await expect(page.getByLabel("Поиск музыки")).toBeVisible();

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
  await downloadsTile.locator(".list-tile-main").click();

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
  await page.getByRole("button", { name: "Далее" }).click();
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
  await expect(coverTarget).toHaveCSS("box-shadow", /rgb\(185, 212, 183\)/);
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
  await expect(coverDialog).toBeFocused();
  await coverDialog.getByRole("button", { name: "Отмена" }).click();
  await expect(coverDialog).not.toBeVisible();
  await expect(firstAlbum.locator("img")).toHaveAttribute(
    "src",
    coverAfterMusicBrainz!,
  );
  await dropFile("dropped-cover.png", "image/png", droppedCover);
  await expect(coverDialog).toBeFocused();
  await page.keyboard.press("Enter");
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
  await page.getByRole("button", { name: "Сбросить исполнителей" }).click();
  await flac().dblclick();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await expect(flac()).toHaveClass(/current/);
  await expect(flac().locator(".list-tile-status-icon svg")).toBeVisible();
  await flac().locator(".list-tile-main").click();
  await expect(flac()).toHaveClass(/selected/);
  await expect(flac().locator(".list-tile-main")).toHaveCSS(
    "box-shadow",
    /inset/,
  );
  await expect(artistRow).toHaveClass(/current/);
  await expect(artistRow.locator(".list-tile-status-icon svg")).toBeVisible();
  const nowPlaying = page.locator(".now-playing");
  await expect(
    nowPlaying.getByRole("button", { name: /Открыть альбом/ }),
  ).toBeVisible();
  await expect(nowPlaying.locator(".now-copy")).evaluate((copy) =>
    [...copy.children].map((child) => child.className),
  ).toEqual(["now-artists", "now-track-link"]);
  await page.getByRole("button", { name: "Скрыть панель «Альбомы»" }).click();
  await expect(page.locator(".albums-panel")).toBeHidden();
  await nowPlaying.getByRole("button", { name: /Открыть альбом/ }).click();
  await expect(page.locator(".albums-panel")).toBeHidden();
  await expect(page.locator(".albums-panel .album-card.selected")).toHaveCount(
    0,
  );
  await expect(
    page
      .locator(".artists-panel .list-tile.selected")
      .filter({ hasText: "Исполнитель альбома" }),
  ).toHaveCount(0);
  await expect(rows).toHaveCount(6);
  await page
    .getByRole("button", { name: "Скрыть панель «Исполнители»" })
    .click();
  await page.getByRole("button", { name: "Скрыть панель «Альбомы»" }).click();
  await expect(page.locator(".artists-panel")).toBeHidden();
  await nowPlaying
    .getByRole("button", { name: "Открыть исполнителя «Исполнитель альбома»" })
    .click();
  await expect(page.locator(".artists-panel")).toBeHidden();
  await expect(page.locator(".albums-panel")).toBeHidden();
  await expect(
    page
      .locator(".artists-panel .list-tile.selected")
      .filter({ hasText: "Исполнитель альбома" }),
  ).toHaveCount(0);
  await expect(rows).toHaveCount(6);
  await downloadsTile.locator(".list-tile-main").click();
  await page.locator("audio").evaluate((a: HTMLAudioElement) => {
    a.loop = true;
    a.currentTime = 0.8;
    return a.play();
  });
  await flac().locator(".list-tile-main").click();
  await flac().dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Редактировать теги" }).click();
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue(
    "Первый трек",
  );
  await page.getByLabel("Название", { exact: true }).press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Редактировать теги");
  await page.getByLabel("Название", { exact: true }).fill("Обновлённый трек");
  await page.getByLabel("Изменить: Жанры").check();
  const genreInput = page.getByLabel("Жанры", { exact: true });
  await genreInput.focus();
  await expect(page.getByRole("option", { name: "Ambient" })).toBeVisible();
  await genreInput.fill("Ambient; amb");
  await genreInput.press("ArrowDown");
  await genreInput.press("Enter");
  await expect(genreInput).toHaveValue("Ambient; Ambient");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Очистить жанры" }).click();
  await expect(genreInput).toHaveValue("");
  await expect(page.getByLabel("Изменить: Жанры")).toBeChecked();
  await genreInput.fill("E2E Fresh");
  await genreInput.press("Enter");
  await expect(page.getByText("Первый трек → Обновлённый трек")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Enter");
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
  await flac().dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Перенести треки" }).click();
  await expect(page.getByRole("dialog")).toBeFocused();
  await page
    .getByLabel("Куда перенести")
    .selectOption({ label: `Collection renamed ${browser}` });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(5);
  await page.getByRole("button", { name: "Сбросить библиотеки" }).click();
  await expect(
    page.getByRole("button", { name: "Сбросить библиотеки" }),
  ).toHaveCount(0);
  await collectionTile.locator(".list-tile-main").click();
  await expect(rows).toHaveCount(1);
  await flac().locator(".list-tile-main").click();
  await flac().dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Удалить треки" }).click();
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Enter");
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
  await page
    .getByRole("button", { name: new RegExp(`Collection renamed ${browser}`) })
    .first()
    .click({ button: "right" });
  await libraryMenu.getByRole("menuitem", { name: "Удалить" }).click();
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", {
      name: new RegExp(`Collection renamed ${browser}`),
    }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("cover mode shows the album, artwork and quick playback search", async ({
  page,
}, info) => {
  const browser = info.project.name;
  const source = path.resolve(".test-data/browser", browser, "Downloads");
  const libraryName = `Downloads ${browser}`;
  const librariesLoaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/libraries" && response.ok(),
  );
  await page.goto("/");
  await librariesLoaded;

  let libraryTile = page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: libraryName });
  if ((await libraryTile.count()) === 0) {
    await page.locator(".add-library").click();
    await page.getByLabel("Путь к папке", { exact: true }).fill(source);
    await page.getByLabel("Название библиотеки").fill(libraryName);
    await page.getByRole("button", { name: "Подключить", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    libraryTile = page
      .locator(".libraries-panel .list-tile")
      .filter({ hasText: libraryName });
  }
  await expect(libraryTile).toBeVisible();
  await libraryTile.locator(".list-tile-main").click();
  await expect
    .poll(() => page.getByTestId("track-row").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.getByTestId("track-row").first().dblclick();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  const currentTrack = page.getByTestId("track-row").first();
  await expect(currentTrack).toHaveClass(/playing/);
  await expect(
    currentTrack.locator(".list-tile-status-icon svg"),
  ).toBeVisible();
  await currentTrack.locator(".list-tile-main").click();
  await expect(currentTrack).toHaveClass(/selected/);
  await expect(libraryTile).toHaveClass(/playing/);
  await expect(libraryTile.locator(".list-tile-status-icon svg")).toBeVisible();
  const currentAlbum = page.locator(".albums-panel .album-card.playing");
  await expect(currentAlbum).toHaveCount(1);
  await expect(currentAlbum.locator(".album-playing-icon")).toBeVisible();
  await expect(currentAlbum.locator(".album-main > strong")).toHaveCSS(
    "color",
    "rgb(185, 212, 183)",
  );
  await expect(currentAlbum.locator(".album-cover")).toHaveCSS(
    "border-top-color",
    "rgb(185, 212, 183)",
  );
  await expect
    .poll(() => page.locator(".genres-panel .list-tile.playing").count())
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator(".artists-panel .artist-row.playing").count())
    .toBeGreaterThan(0);
  await expect(
    page
      .locator(".artists-panel .artist-row.playing")
      .first()
      .locator(".list-tile-status-icon svg"),
  ).toBeVisible();

  await page.locator(".cover-mode-toggle").click();
  const coverMode = page.getByRole("main", { name: "Режим обложки" });
  await expect(coverMode).toBeVisible();
  await expect(page.locator(".workspace")).toBeHidden();
  await expect(page.locator(".app-shell")).toHaveClass(/app-shell--cover-mode/);
  await expect(page.locator(".panel-visibility-controls")).toHaveCount(0);
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".player")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Показать музыку из закладок" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Журнал операций" }),
  ).toHaveCount(0);
  await expect(page.locator(".cover-mode-toggle")).toBeVisible();
  await expect(coverMode).toHaveCSS("background-image", /bg_lounge/);
  await expect(coverMode.getByRole("heading", { level: 1 })).toContainText(
    "Первый трек",
  );
  await page
    .getByRole("button", { name: "Развернуть окно на весь экран" })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await expect(page.locator(".app-shell")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(coverMode).toHaveCSS("background-image", /linear-gradient/);
  await page
    .getByRole("button", { name: "Свернуть окно из полноэкранного режима" })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  await expect
    .poll(() => coverMode.locator(".cover-track-row").count())
    .toBeGreaterThan(0);
  await expect(coverMode.locator(".cover-track-row.current")).toHaveCount(1);
  await page.screenshot({ path: `.test-data/cover-mode-${browser}.png` });

  await coverMode.locator(".cover-track-row").nth(1).click();
  await expect(coverMode.locator(".cover-track-row").nth(1)).toHaveAttribute(
    "aria-current",
    "true",
  );

  await page.getByRole("button", { name: "Открыть быстрый поиск" }).click();
  const quickSearch = page.getByRole("dialog", { name: "Быстрый поиск" });
  await quickSearch.getByLabel("Быстрый поиск музыки").fill("Первый трек");
  await expect(
    quickSearch.getByRole("heading", { name: "Треки" }),
  ).toBeVisible();
  await quickSearch
    .locator(".quick-search-result")
    .filter({ hasText: "Первый трек" })
    .first()
    .click();
  await expect(quickSearch).not.toBeVisible();

  await coverMode
    .getByRole("button", { name: "Открыть обложку в оригинальном размере" })
    .click();
  const artworkViewer = page.getByRole("dialog", {
    name: "Просмотр обложки",
  });
  await expect(artworkViewer).toBeVisible();
  await expect(artworkViewer.locator("img")).toHaveClass(/fit/);
  await expect(artworkViewer.locator("img")).not.toHaveClass(/zoomable/);
  await page.keyboard.press("Escape");
  await expect(artworkViewer).not.toBeVisible();

  await page.setViewportSize({ width: 500, height: 500 });
  await coverMode
    .getByRole("button", { name: "Открыть обложку в оригинальном размере" })
    .click();
  await expect(artworkViewer.locator("img")).toHaveClass(/zoomable/);
  await artworkViewer.locator("img").click();
  await expect(artworkViewer.locator("img")).toHaveClass(/original/);
  await artworkViewer.locator(".artwork-viewer-scroll").click({
    position: { x: 4, y: 4 },
  });
  await expect(artworkViewer.locator("img")).toHaveClass(/fit/);
  await artworkViewer.locator("img").click();
  await expect(artworkViewer.locator("img")).toHaveClass(/original/);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1600, height: 1000 });

  await page.locator(".cover-mode-toggle").click();
  await expect(coverMode).not.toBeVisible();
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".panel-visibility-controls")).toBeVisible();
  await expect(libraryTile).toHaveClass(/selected/);

  await page.locator(".cover-mode-toggle").click();
  await page.locator(".cover-mode-toggle").click();
  await expect(coverMode).not.toBeVisible();
});

test("library folders expand independently and support Ctrl selection", async ({
  page,
}, info) => {
  const browser = info.project.name;
  const tree = path.resolve(".test-data/browser", browser, "Tree");
  const name = `Tree controls ${browser}`;
  const explorerRequests: { kind: string; relativePath?: string }[] = [];
  await page.route("**/api/explorer", async (route) => {
    explorerRequests.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(tree);
  await page.getByLabel("Название библиотеки").fill(name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  const treeTile = page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: name });
  await treeTile.locator(".list-tile-main").click();
  await expect(treeTile).toHaveClass(/selected/);
  await treeTile.dispatchEvent("contextmenu", { clientX: 200, clientY: 200 });
  await page.getByRole("menuitem", { name: "Открыть в проводнике" }).click();
  await expect(page.getByTitle("Rock", { exact: true })).toHaveCount(0);
  await treeTile
    .getByRole("button", { name: `Развернуть библиотеку «${name}»` })
    .click();
  const rockTile = page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: "Rock" });
  const jazzTile = page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: "Jazz" });
  await rockTile.dispatchEvent("contextmenu", { clientX: 200, clientY: 250 });
  await page.getByRole("menuitem", { name: "Открыть в проводнике" }).click();
  expect(explorerRequests).toEqual([
    { kind: "library", libraryId: expect.any(String) },
    { kind: "folder", libraryId: expect.any(String), relativePath: "Rock" },
  ]);
  await rockTile
    .getByRole("button", { name: "Развернуть папку «Rock»" })
    .click();
  await jazzTile
    .getByRole("button", { name: "Развернуть папку «Jazz»" })
    .click();
  await expect(page.getByTitle(/Rock\\Live$/)).toBeVisible();
  await expect(
    jazzTile.getByRole("button", { name: "Свернуть папку «Jazz»" }),
  ).toBeVisible();
  await rockTile.getByRole("button", { name: "Свернуть папку «Rock»" }).click();
  await expect(page.getByTitle(/Rock\\Live$/)).toHaveCount(0);
  await rockTile
    .getByRole("button", { name: "Развернуть папку «Rock»" })
    .click();
  await rockTile.locator(".list-tile-main").click();
  await jazzTile.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(page.getByTestId("track-row")).toHaveCount(3);
  const rockAlbumTile = page.getByTitle(/Rock\\Album$/).locator("..");
  await rockAlbumTile
    .locator(".list-tile-main")
    .click({ modifiers: ["Control"] });
  await rockTile.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await rockTile.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(rockAlbumTile).not.toHaveClass(/selected/);
  await expect(page.getByTestId("track-row")).toHaveCount(3);
});

test("panel selection supports Shift ranges and bounded marquee drag", async ({
  page,
}, info) => {
  const browser = info.project.name;
  const source = path.resolve(".test-data/browser", browser, "Downloads");
  const sources = [
    [`Selection A ${browser}`, source],
    [
      `Selection B ${browser}`,
      path.resolve(".test-data/browser", browser, "Collection"),
    ],
    [
      `Selection C ${browser}`,
      path.resolve(".test-data/browser", browser, "Tree"),
    ],
  ] as const;
  const createdNames: string[] = [];
  await page.goto("/");
  await expect(page.getByLabel("Поиск музыки")).toBeVisible();
  for (const [name, folder] of sources) {
    const response = await page.request.get("/api/libraries");
    const connected = (await response.json()) as { path: string }[];
    const normalizedFolder = path
      .resolve(folder)
      .replaceAll("/", "\\")
      .toLowerCase();
    if (
      connected.some(
        (library) =>
          path.resolve(library.path).replaceAll("/", "\\").toLowerCase() ===
          normalizedFolder,
      )
    )
      continue;
    await page.locator(".add-library").click();
    await page.getByLabel("Путь к папке", { exact: true }).fill(folder);
    await page.getByLabel("Название библиотеки").fill(name);
    await page.getByRole("button", { name: "Подключить", exact: true }).click();
    createdNames.push(name);
  }
  const libraryTile = page
    .locator(".libraries-panel .list-tile-main")
    .filter({ hasText: new RegExp(`Downloads|Selection A ${browser}`) })
    .first();
  await libraryTile.click();
  await expect
    .poll(() => page.getByTestId("track-row").count())
    .toBeGreaterThan(1);

  const libraryButtons = page.locator(
    ".libraries-panel .library-list > .library-container > .list-tile .list-tile-main",
  );
  await expect.poll(() => libraryButtons.count()).toBeGreaterThanOrEqual(3);
  await libraryButtons.nth(2).click();
  await libraryButtons.nth(0).click({ modifiers: ["Control"] });
  await libraryButtons.nth(1).click({ modifiers: ["Control", "Shift"] });
  await expect(
    page.locator(
      ".libraries-panel .library-list > .library-container > .list-tile.selected",
    ),
  ).toHaveCount(3);

  await page.locator(".libraries-panel .facet-reset").click();
  const libraryRows = page.locator(
    ".libraries-panel .library-list > .library-container > .list-tile",
  );
  const surface = page.locator(".libraries-panel .library-list");
  const first = await libraryRows.nth(0).boundingBox();
  const second = await libraryRows.nth(1).boundingBox();
  const surfaceBox = await surface.boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  await page.mouse.move(first!.x + 40, first!.y + 4);
  await page.mouse.down();
  await page.mouse.move(
    second!.x + second!.width - 4,
    second!.y + second!.height - 4,
    { steps: 4 },
  );
  const marquee = page.getByTestId("selection-marquee");
  await expect(marquee).toBeVisible();
  const marqueeBox = await marquee.boundingBox();
  expect(marqueeBox).not.toBeNull();
  expect(marqueeBox!.x).toBeGreaterThanOrEqual(surfaceBox!.x - 1);
  expect(marqueeBox!.x + marqueeBox!.width).toBeLessThanOrEqual(
    surfaceBox!.x + surfaceBox!.width + 1,
  );
  await page.mouse.up();
  await expect(
    page.locator(
      ".libraries-panel .library-list > .library-container > .list-tile.selected",
    ),
  ).toHaveCount(2);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");

  await libraryButtons.nth(2).click();
  await page.keyboard.down("Control");
  await page.mouse.move(first!.x + 40, first!.y + 4);
  await page.mouse.down();
  await page.mouse.move(
    second!.x + second!.width - 4,
    second!.y + second!.height - 4,
    { steps: 4 },
  );
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect(
    page.locator(
      ".libraries-panel .library-list > .library-container > .list-tile.selected",
    ),
  ).toHaveCount(3);

  for (const [surfaceSelector, candidateSelector, selectedSelector] of [
    [".genres-panel .genre-list", ".list-tile", ".list-tile.selected"],
    [".artists-panel .artist-scroll", ".list-tile", ".list-tile.selected"],
    [".albums-panel .album-scroll", ".album-card", ".album-card.selected"],
    [
      ".tracks-panel .track-scroll",
      '[data-testid="track-row"]',
      '[data-testid="track-row"].selected',
    ],
  ] as const) {
    const candidates = page.locator(`${surfaceSelector} ${candidateSelector}`);
    if ((await candidates.count()) < 2) continue;
    const a = await candidates.nth(0).boundingBox();
    const b = await candidates.nth(1).boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await page.mouse.move(a!.x + 3, a!.y + 3);
    await page.mouse.down();
    await page.mouse.move(b!.x + b!.width - 3, b!.y + b!.height - 3, {
      steps: 4,
    });
    await page.mouse.up();
    await expect(
      page.locator(`${surfaceSelector} ${selectedSelector}`),
    ).toHaveCount(2);
    const surfaceBox = await page.locator(surfaceSelector).boundingBox();
    expect(surfaceBox).not.toBeNull();
    await page.mouse.click(
      surfaceBox!.x + surfaceBox!.width - 4,
      surfaceBox!.y + surfaceBox!.height - 4,
    );
    await expect(
      page.locator(`${surfaceSelector} ${selectedSelector}`),
    ).toHaveCount(0);
    const reset = page.locator(`${surfaceSelector.split(" ")[0]} .facet-reset`);
    if (await reset.count()) await reset.click();
    if (surfaceSelector.includes("libraries")) await libraryTile.click();
  }

  for (const name of createdNames) {
    const tile = page
      .locator(".libraries-panel .list-tile")
      .filter({ hasText: name });
    await tile.dispatchEvent("contextmenu", { clientX: 200, clientY: 200 });
    await page.getByRole("menuitem", { name: "Удалить" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Отключить", exact: true })
      .click();
    await expect(tile).toHaveCount(0);
  }
});
