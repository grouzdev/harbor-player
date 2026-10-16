import { test, expect, type Locator } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";

test("catalog state uses RMB and only visible indicators consume title space", async ({
  page,
}, info) => {
  let showCovers = true;
  await page.route("**/api/covers/catalog-state-cover", async (route) => {
    await route.fulfill({
      contentType: "image/png",
      body: await readFile(".fixtures/cover.png"),
    });
  });
  await page.route(/\/api\/albums\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.items = body.items.map((album: object) => ({
      ...album,
      coverId: showCovers ? "catalog-state-cover" : null,
    }));
    await route.fulfill({ response, json: body });
  });
  await page.route(/\/api\/tracks\?/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.items = body.items.map((track: object) => ({
      ...track,
      title: "Part 1 (Eyes Like Stars) — A deliberately long track title",
      duration: 7425,
      coverId: showCovers ? "catalog-state-cover" : null,
    }));
    await route.fulfill({ response, json: body });
  });
  await page.goto("/");
  await page.locator(".add-library").click();
  await page
    .getByLabel("Путь к папке", { exact: true })
    .fill(
      path.resolve(
        ".test-data/browser",
        info.project.name,
        "catalog-state",
        "Downloads",
      ),
    );
  await page
    .getByLabel("Название библиотеки")
    .fill(`Catalog state ${info.project.name}`);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: `Catalog state ${info.project.name}` })
    .locator(".list-tile-main")
    .click();
  const firstAlbum = page
    .locator(".albums-panel .album-card")
    .filter({
      has: page.locator(".album-track-count", { hasText: "6 треков" }),
    })
    .first();
  await expect(firstAlbum).toBeVisible();
  const albumId = await firstAlbum.getAttribute("data-selection-key");
  const album = page.locator(
    `.album-card[data-selection-key=${JSON.stringify(albumId)}]`,
  );
  await album.locator(".album-main").click();
  const firstTrack = page.getByTestId("track-row").first();
  await expect(firstTrack).toBeVisible();
  const trackId = await firstTrack.getAttribute("data-selection-key");
  const track = page.locator(
    `[data-testid="track-row"][data-selection-key=${JSON.stringify(trackId)}]`,
  );
  const header = page.locator(
    `.tracks-panel .track-album-header[data-album-id=${JSON.stringify(albumId)}]`,
  );
  const choose = async (target: Locator, name: string) => {
    const box = await target.boundingBox();
    await target.dispatchEvent("contextmenu", {
      clientX: box!.x + 20,
      clientY: box!.y + 10,
    });
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  const rate = async (target: Locator, value: number) => {
    await choose(target, "Изменить оценку…");
    await page
      .getByRole("dialog", { name: "Изменить оценку" })
      .getByRole("button", { name: `${value} из 5` })
      .click();
  };
  const checkGeometry = async () => {
    const geometry = await track.evaluate((row) => {
      const box = (selector: string) =>
        row.querySelector(selector)!.getBoundingClientRect();
      const value = box(".list-tile-value");
      const suffix = box(".list-tile-suffix");
      const duration = box(".track-duration");
      return {
        gap: suffix.left - value.right,
        rightInset: row.getBoundingClientRect().right - duration.right,
        durationWidth: duration.width,
        suffixWidth: suffix.width,
        marks: Array.from(
          row.querySelectorAll(".catalog-state-mark"),
          (mark) => {
            const b = mark.getBoundingClientRect();
            return {
              left: b.left - row.getBoundingClientRect().left,
              right: b.right - row.getBoundingClientRect().left,
            };
          },
        ),
        durationLeft: duration.left - row.getBoundingClientRect().left,
      };
    });
    expect(geometry.gap).toBeGreaterThanOrEqual(9.5);
    expect(geometry.gap).toBeLessThan(10.5);
    expect(Math.abs(geometry.rightInset - 20)).toBeLessThan(0.5);
    expect(geometry.durationWidth).toBeGreaterThan(29);
    for (const mark of geometry.marks)
      expect(mark.right).toBeLessThanOrEqual(geometry.durationLeft);
    const headerGap = await header.evaluate((node) => {
      const copy = node
        .querySelector(".track-album-copy")!
        .getBoundingClientRect();
      const duration = node
        .querySelector(".track-album-duration")!
        .getBoundingClientRect();
      return duration.left - copy.right;
    });
    expect(headerGap).toBeGreaterThanOrEqual(8.5);
    expect(headerGap).toBeLessThan(9.5);
    return geometry;
  };
  await expect(track.locator(".catalog-state-indicators")).toHaveCount(0);
  await expect(track.locator(".track-duration")).toHaveText("2:03:45");
  const panel = page.locator(".tracks-panel");
  for (const width of [280, 480]) {
    await panel.evaluate((node, width) => {
      node.style.width = `${width}px`;
    }, width);
    const empty = await checkGeometry();
    expect(empty.suffixWidth).toBeCloseTo(empty.durationWidth, 1);
    await track.hover();
    expect(await checkGeometry()).toEqual(empty);
    await track.locator(".list-tile-main").focus();
    expect(await checkGeometry()).toEqual(empty);
  }
  await rate(track, 5);
  await expect(track.getByRole("img", { name: "Оценка 5 из 5" })).toBeVisible();
  await choose(track, "Добавить в закладки");
  await expect(track.getByRole("img", { name: "В закладках" })).toBeVisible();
  await checkGeometry();
  await rate(track, 5);
  await expect(track.locator(".is-rated")).toHaveCount(0);
  await checkGeometry();
  await rate(track, 4);
  // Open the menu during an optimistic rating update, not after a fast ACK.
  // Its live guard must enable both actions without closing/reopening it.
  let releaseRating!: () => void;
  const ratingGate = new Promise<void>((resolve) => {
    releaseRating = resolve;
  });
  let ratingStarted!: () => void;
  const ratingRequest = new Promise<void>((resolve) => {
    ratingStarted = resolve;
  });
  await page.route("**/api/catalog-user-state", async (route) => {
    ratingStarted();
    await ratingGate;
    await route.continue();
  });
  await rate(album, 4);
  await ratingRequest;
  await album.dispatchEvent("contextmenu", { clientX: 300, clientY: 300 });
  const rateAction = page.getByRole("menuitem", {
    name: "Изменить оценку…",
    exact: true,
  });
  const viewedAction = page.getByRole("menuitem", {
    name: "Отметить просмотренными",
    exact: true,
  });
  try {
    await expect(rateAction).toBeDisabled();
    await expect(viewedAction).toBeDisabled();
  } finally {
    releaseRating();
  }
  await expect(rateAction).toBeEnabled();
  await expect(viewedAction).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.unroute("**/api/catalog-user-state");
  await choose(album, "Добавить в закладки");
  await choose(album, "Отметить просмотренными");
  for (const target of [album, header]) {
    await expect(target.locator(".catalog-state-mark")).toHaveCount(3);
    await expect(
      target.locator(".rating-control, .bookmark-toggle, .viewed-toggle"),
    ).toHaveCount(0);
    const marks = target.locator(".catalog-state-mark");
    const positions = await marks.evaluateAll((nodes) =>
      nodes.map((node) => {
        const b = node.getBoundingClientRect();
        return [b.x, b.y, b.width, b.height];
      }),
    );
    await target.hover();
    expect(
      await marks.evaluateAll((nodes) =>
        nodes.map((node) => {
          const b = node.getBoundingClientRect();
          return [b.x, b.y, b.width, b.height];
        }),
      ),
    ).toEqual(positions);
    const bounds = await target.evaluate((node) => {
      const cover = node
        .querySelector(".tiny-cover, .album-cover")!
        .getBoundingClientRect();
      return Array.from(
        node.querySelectorAll(".catalog-state-mark"),
        (mark) => {
          const b = mark.getBoundingClientRect();
          return (
            b.left >= cover.left &&
            b.right <= cover.right &&
            b.top >= cover.top &&
            b.bottom <= cover.bottom
          );
        },
      );
    });
    expect(bounds.every(Boolean)).toBe(true);
  }
  await panel.evaluate((node) => {
    node.style.width = "280px";
  });
  await checkGeometry();
  await page.screenshot({ path: info.outputPath("catalog-state-narrow.png") });
  await expect(album.locator(".album-cover img")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await checkGeometry();
  await expect(header.locator(".catalog-state-mark")).toHaveCount(3);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  showCovers = false;
  await page.reload();
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: `Catalog state ${info.project.name}` })
    .locator(".list-tile-main")
    .click();
  await album.locator(".album-main").click();
  await expect(album.locator(".album-cover .cover-placeholder")).toBeVisible();
  await expect(header.locator(".tiny-cover .cover-placeholder")).toBeVisible();
  await expect(track.getByRole("img", { name: "Оценка 4 из 5" })).toBeVisible();
  await expect(track.getByRole("img", { name: "В закладках" })).toBeVisible();
  await expect(album.locator(".catalog-state-mark")).toHaveCount(3);
  await choose(header, "Отметить непросмотренными");
  await expect(album.locator(".is-viewed")).toHaveCount(0);
  await choose(header, "Удалить из закладок");
  await expect(album.locator(".is-bookmarked")).toHaveCount(0);
  await choose(track, "Удалить из закладок");
  await expect(track.locator(".is-bookmarked")).toHaveCount(0);
  const secondTrack = page
    .locator(
      `[data-testid="track-row"]:not([data-selection-key=${JSON.stringify(trackId)}])`,
    )
    .first();
  await track.locator(".list-tile-main").click();
  await secondTrack
    .locator(".list-tile-main")
    .click({ modifiers: ["Control"] });
  await choose(track, "Изменить оценку… (2)");
  await page
    .getByRole("dialog", { name: "Изменить оценку" })
    .getByRole("button", { name: "3 из 5" })
    .click();
  await expect(track.getByRole("img", { name: "Оценка 3 из 5" })).toBeVisible();
  await expect(
    secondTrack.getByRole("img", { name: "Оценка 3 из 5" }),
  ).toBeVisible();
  await choose(track, "Добавить в закладки (2)");
  await expect(
    secondTrack.getByRole("img", { name: "В закладках" }),
  ).toBeVisible();
  await choose(track, "Удалить из закладок (2)");
  await expect(track.locator(".is-bookmarked")).toHaveCount(0);
  await expect(secondTrack.locator(".is-bookmarked")).toHaveCount(0);
  await expect(
    page.locator(".artists-panel .bookmark-toggle").first(),
  ).toBeAttached();
});
