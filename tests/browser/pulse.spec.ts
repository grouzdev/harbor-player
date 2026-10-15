import { randomUUID } from "node:crypto";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

async function prepareHistory(
  page: Page,
  busyAlbums = 0,
  firstDay = "2023-01-01",
  busyDate = "2025-05-16",
) {
  const session = await (await page.request.get("/api/session")).json();
  const headers = { "X-CSRF-Token": session.csrf };
  const current = await (await page.request.get("/api/pulse/settings")).json();
  const initialized = await page.request.patch("/api/pulse/settings", {
    headers,
    data: {
      enabled: true,
      ...(current.timeZone === null ? { timeZone: "UTC" } : {}),
    },
  });
  expect(initialized.ok()).toBe(true);
  const settings = await initialized.json();
  const cleared = await page.request.post("/api/pulse/clear", {
    headers,
    data: { confirm: true, historyGeneration: settings.historyGeneration },
  });
  expect(cleared.ok()).toBe(true);
  const generation = (await cleared.json()).historyGeneration;
  const makeEvent = (album: number, day: string, visit = randomUUID()) => {
    const start = Date.parse(`${day}T12:00:00Z`);
    return {
      eventId: randomUUID(),
      revision: 1,
      trackId: null,
      albumKey: `pulse-browser-${album}`,
      snapshot: {
        title: `Pulse album ${album}`,
        artists: ["Pulse artist"],
        year: 2025,
        coverId: null,
      },
      sessionId: "pulse-browser",
      visitId: visit,
      startedAtUtc: start,
      endedAtUtc: start + 60_000,
      playedMs: 60_000,
      final: true,
    };
  };
  const events = [
    makeEvent(0, firstDay),
    makeEvent(0, busyDate),
    makeEvent(0, busyDate),
    ...Array.from({ length: busyAlbums }, (_, index) =>
      makeEvent(index + 1, busyDate),
    ),
  ];
  for (let start = 0; start < events.length; start += 100) {
    const response = await page.request.post("/api/listening-events", {
      headers,
      data: {
        historyGeneration: generation,
        events: events.slice(start, start + 100),
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const acknowledgement = await response.json();
    expect(acknowledgement.historyGeneration).toBe(generation);
    expect(
      acknowledgement.acknowledgements.map(
        (entry: { eventId: string; revision: number }) => ({
          eventId: entry.eventId,
          revision: entry.revision,
        }),
      ),
    ).toEqual(
      events
        .slice(start, start + 100)
        .map(({ eventId, revision }) => ({ eventId, revision })),
    );
  }
  return { busyDate };
}

test("Pulse has its own button and preserves the mounted catalog", async ({
  page,
}) => {
  await prepareHistory(page);
  await page.goto("/");
  const workspace = page.locator(".workspace");
  const addLibrary = page.locator(".add-library");
  await expect(addLibrary).toBeVisible();
  await addLibrary.focus();
  const originalStyle = await workspace.getAttribute("style");
  const originalPanels = await workspace.locator("section").count();
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-mode")).toBeVisible();
  await expect(workspace).toHaveAttribute("inert", "");
  await expect(workspace).toBeHidden();
  await expect(page.locator(".cover-mode-toggle")).toBeVisible();
  expect(await workspace.locator("section").count()).toBe(originalPanels);
  await page.keyboard.press("Escape");
  await expect(workspace).toBeVisible();
  await expect(addLibrary).toBeFocused();
  expect(await workspace.getAttribute("style")).toBe(originalStyle);
});

test("Pulse bounds busy-day DOM and supports wheel, drag and year navigation", async ({
  page,
}) => {
  const { busyDate } = await prepareHistory(page, 260);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  const pulse = page.locator(".pulse-mode");
  const rail = page.getByRole("region", {
    name: "Все альбомы по дням и прослушанное время",
  });
  const slider = page.getByRole("slider", { name: "Дата на таймлайне" });
  await expect(rail).toBeVisible();
  const firstDayIndex = Math.round(
    (Date.parse(`${busyDate}T00:00:00Z`) - Date.parse("2023-01-01T00:00:00Z")) /
      86_400_000,
  );
  await slider.fill(String(firstDayIndex));
  await expect(slider).toHaveAttribute("aria-valuetext", busyDate);
  await expect
    .poll(() => rail.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await expect(
    pulse.getByRole("button", { name: /Pulse album/ }).first(),
  ).toBeVisible();
  expect(
    await pulse.getByRole("button", { name: /Pulse album/ }).count(),
  ).toBeLessThan(100);
  const initial = await rail.evaluate((element) => element.scrollLeft);
  await rail.hover();
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => rail.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(initial);
  const bounds = (await rail.boundingBox())!;
  const afterWheel = await rail.evaluate((element) => element.scrollLeft);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 200, bounds.y + 20, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(() => rail.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(afterWheel);
  await slider.fill("0");
  await expect(slider).toHaveAttribute("aria-valuetext", /2023/);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  expect(Number(await slider.inputValue())).toBeGreaterThan(0);
  await page.setViewportSize({ width: 800, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Pulse collection controls do not let Escape close both dialog and screen", async ({
  page,
}) => {
  await prepareHistory(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Настройки истории прослушивания" })
    .click();
  const dialog = page.getByRole("dialog", { name: "История прослушивания" });
  await expect(dialog).toBeVisible();
  const collection = dialog.getByRole("checkbox", {
    name: "Сохранять историю прослушивания на этом устройстве",
  });
  await expect(collection).toBeChecked();
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(collection).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Очистить историю", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(collection).toBeFocused();
  await collection.uncheck();
  await expect(collection).not.toBeChecked();
  await collection.check();
  await expect(collection).toBeChecked();
  await dialog
    .getByRole("button", { name: "Очистить историю", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "Подтверждение очистки истории" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".pulse-mode")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Настройки истории прослушивания",
    }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Настройки истории прослушивания" })
    .click();
  await dialog
    .getByRole("button", { name: "Очистить историю", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Удалить историю", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "Подтверждение очистки истории" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(
    page.getByText("История прослушивания пока пуста", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".pulse-copy h2")).toHaveCount(0);
});

test("Pulse recovers the selected artwork after a failed image", async ({
  page,
}) => {
  const { busyDate } = await prepareHistory(page);
  const session = await (await page.request.get("/api/session")).json();
  const settings = await (await page.request.get("/api/pulse/settings")).json();
  const id = randomUUID();
  const badCover = `${"1".repeat(64)}.png`;
  const goodCover = `${"2".repeat(64)}.png`;
  const sharp = (await import("sharp")).default;
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  await page.route(`**/api/covers/${badCover}`, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.route(`**/api/covers/${goodCover}`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: png }),
  );
  const titles = [`Artwork failed ${id}`, `Artwork recovered ${id}`];
  const response = await page.request.post("/api/listening-events", {
    headers: { "X-CSRF-Token": session.csrf },
    data: {
      historyGeneration: settings.historyGeneration,
      events: titles.map((title, index) => {
        const start = Date.parse(`${busyDate}T13:00:00Z`) + index * 60_000;
        return {
          eventId: randomUUID(),
          revision: 1,
          trackId: null,
          albumKey: `artwork-${id}-${index}`,
          snapshot: {
            title,
            artists: ["Artwork fixture"],
            year: 2025,
            coverId: index ? goodCover : badCover,
          },
          sessionId: id,
          visitId: randomUUID(),
          startedAtUtc: start,
          endedAtUtc: start + 30_000,
          playedMs: 30_000,
          final: true,
        };
      }),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  const range = await (
    await page.request.get("/api/pulse/history-range")
  ).json();
  const dayIndex =
    (Date.parse(busyDate) - Date.parse(range.firstDay)) / 86_400_000;
  await page
    .getByRole("slider", { name: "Дата на таймлайне" })
    .fill(String(dayIndex));
  const image = page.locator(".pulse-selected img");
  await page
    .getByRole("button", { name: titles[0] })
    .locator(".pulse-time")
    .click();
  await expect(page.locator(".pulse-copy h2")).toHaveText(titles[0]);
  await expect(image).toHaveCSS("visibility", "hidden");
  await page
    .getByRole("button", { name: titles[1] })
    .locator(".pulse-time")
    .click();
  await expect(image).toHaveAttribute("src", `/api/covers/${goodCover}`);
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(8);
});

test("Pulse records real audio and mode switches preserve playback", async ({
  page,
}, info) => {
  await prepareHistory(page);
  const source = path.resolve(
    ".test-data/browser",
    info.project.name,
    "cover-mode",
    "Downloads",
  );
  const response = await page.request.get("/api/libraries");
  const libraries = (await response.json()) as { name: string; path: string }[];
  let name = libraries.find(
    (library) =>
      path.resolve(library.path).toLowerCase() === source.toLowerCase(),
  )?.name;
  await page.goto("/");
  if (!name) {
    name = `Pulse playback ${info.project.name}`;
    await page.locator(".add-library").click();
    await page.getByLabel("Путь к папке", { exact: true }).fill(source);
    await page.getByLabel("Название библиотеки", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Подключить", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: name })
    .locator(".list-tile-main")
    .click();
  await expect
    .poll(() => page.getByTestId("track-row").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.getByTestId("track-row").first().dblclick();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.3);
  const sourceBefore = await page.locator("audio").getAttribute("src");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-mode")).toBeVisible();
  expect(await page.locator("audio").getAttribute("src")).toBe(sourceBefore);
  expect(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(false);
  const today = new Date().toISOString().slice(0, 10);
  await expect
    .poll(
      async () => {
        const result = await (
          await page.request.get(`/api/pulse/layout?from=${today}&to=${today}`)
        ).json();
        return result.days.reduce(
          (total: number, day: { playedMs: number }) => total + day.playedMs,
          0,
        );
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(500);
  await page
    .getByRole("button", { name: "Вернуться к панелям", exact: true })
    .click();
  await expect(page.locator(".workspace")).toBeVisible();
  await page.locator(".cover-mode-toggle").click();
  await expect(page.locator(".cover-mode")).toBeVisible();
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-mode")).toBeVisible();
  await expect(page.locator(".cover-mode")).toHaveCount(0);
  await page.locator(".cover-mode-toggle").click();
  await expect(page.locator(".cover-mode")).toBeVisible();
});

test("all 1000 busy-day ranks are keyboard reachable with bounded DOM", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = `${Number(today.slice(0, 4)) - 10}${today.slice(4)}`;
  const { busyDate } = await prepareHistory(page, 999, firstDay, today);
  const session = await (await page.request.get("/api/session")).json();
  // Prevent restored real playback from extending this deterministic history.
  expect(
    (
      await page.request.patch("/api/pulse/settings", {
        headers: { "X-CSRF-Token": session.csrf },
        data: { enabled: false },
      })
    ).ok(),
  ).toBe(true);
  const expected: string[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const response = await page.request.get(
      `/api/pulse/days/${busyDate}/albums?offset=${offset}&limit=100`,
    );
    expect(response.ok()).toBe(true);
    const result = await response.json();
    expected.push(
      ...result.items.map((album: { albumId: string }) => album.albumId),
    );
  }
  expect(new Set(expected).size).toBe(1000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  const slider = page.getByRole("slider", { name: "Дата на таймлайне" });
  await expect(slider).toBeVisible();
  // Cold opening at the far end must render the same ranks it requests, rather
  // than slots 0..3 with pages for ranks 980..999.
  await expect(page.locator('.pulse-album[data-rank="999"]')).toBeVisible();
  await expect(page.locator('.pulse-album[data-rank="999"]')).toHaveAttribute(
    "data-album-id",
    expected[999],
  );
  // Range input jumps to the start of the busy day; no programmatic scroll
  // or direct focus on an unmounted album is used to enter or traverse the day.
  await slider.focus();
  await slider.fill(
    String(
      Math.round(
        (Date.parse(`${busyDate}T00:00:00Z`) -
          Date.parse(`${firstDay}T00:00:00Z`)) /
          86_400_000,
      ),
    ),
  );
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", busyDate);
  await expect(page.locator('.pulse-album[data-rank="0"]')).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  const active = page.locator(".pulse-album:focus");
  await expect(active).toHaveAttribute("data-rank", "0");
  for (let rank = 0; rank < 1000; rank++) {
    await expect(active).toHaveAttribute("data-rank", String(rank));
    await expect(active).toHaveAttribute("data-album-id", expected[rank]);
    if (rank < 999) await page.keyboard.press("ArrowRight");
  }
  expect(await page.locator(".pulse-album").count()).toBeLessThan(50);
  await page.keyboard.press("Enter");
  await expect(active).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 640, height: 480 });
  await expect(active).toHaveAttribute("data-rank", "999");
  await page.keyboard.press("Home");
  await expect(active).toHaveAttribute("data-rank", "0");
  await page.keyboard.press("PageDown");
  await expect(active).not.toHaveAttribute("data-rank", "0");
  await page.keyboard.press("PageUp");
  await expect(active).toHaveAttribute("data-rank", "0");
  await page.keyboard.press("Space");
  await expect(active).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("End");
  await expect(active).toHaveAttribute("data-rank", "999");
  await page.keyboard.press("Tab");
  await expect(slider).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(active).toHaveAttribute("data-rank", "999");
});

test("clear while Pulse is unmounted cannot restore shell selection", async ({
  page,
}) => {
  await prepareHistory(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-copy h2")).toHaveText("Pulse album 0");
  await page
    .getByRole("button", { name: "Открыть настройки", exact: true })
    .click();
  await expect(page.locator(".pulse-mode")).toHaveCount(0);
  // The settings workspace does not mount Pulse's collection control. A clear
  // through the real API while it is unmounted must still invalidate saved state.
  const session = await (await page.request.get("/api/session")).json();
  const settings = await (await page.request.get("/api/pulse/settings")).json();
  const cleared = await page.request.post("/api/pulse/clear", {
    headers: { "X-CSRF-Token": session.csrf },
    data: { confirm: true, historyGeneration: settings.historyGeneration },
  });
  expect(cleared.ok()).toBe(true);
  await page
    .getByRole("button", { name: "Вернуться в Пульс", exact: true })
    .click();
  await expect(
    page.getByText("История прослушивания пока пуста", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".pulse-copy h2")).toHaveCount(0);
  await expect(page.locator(".pulse-stat-numbers")).toHaveCount(0);
  await expect(
    page.getByText("Загрузка статистики…", { exact: true }),
  ).toHaveCount(0);
});

test("clear wins over delayed pages and statistics", async ({ page }) => {
  const { busyDate } = await prepareHistory(page, 40);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(
    /\/api\/pulse\/(days\/.*\/albums|albums\/.*\/stats)/,
    async (route) => {
      if (new URL(route.request().url()).searchParams.get("limit") === "1") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      requests++;
      await held;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  const slider = page.getByRole("slider", { name: "Дата на таймлайне" });
  await expect(slider).toBeVisible();
  await slider.fill(
    String(
      Math.round(
        (Date.parse(`${busyDate}T00:00:00Z`) -
          Date.parse("2023-01-01T00:00:00Z")) /
          86_400_000,
      ),
    ),
  );
  await expect.poll(() => requests).toBeGreaterThan(1);
  await page
    .getByRole("button", { name: "Настройки истории прослушивания" })
    .click();
  const dialog = page.getByRole("dialog", { name: "История прослушивания" });
  await dialog
    .getByRole("button", { name: "Очистить историю", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Удалить историю", exact: true })
    .click();
  await expect(dialog.getByRole("group")).toHaveCount(0);
  release();
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(
    page.getByText("История прослушивания пока пуста", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".pulse-album, .pulse-copy h2, .pulse-stat-numbers"),
  ).toHaveCount(0);
});

test("Pulse errors retry and disabled collection keeps existing history", async ({
  page,
}) => {
  await prepareHistory(page);
  await page.route("**/api/pulse/history-range", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "History unavailable" }),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-empty[role=alert]")).toBeVisible();
  await page.unroute("**/api/pulse/history-range");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator(".pulse-stat-numbers")).toBeVisible();
  await expect(page.locator(".pulse-empty[role=alert]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Настройки истории прослушивания" })
    .click();
  const dialog = page.getByRole("dialog", { name: "История прослушивания" });
  await dialog.getByRole("checkbox").uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pulse-copy h2")).toHaveText("Pulse album 0");
  await expect(page.locator(".pulse-rail")).toBeVisible();
});

test("Pulse pointer cancellation and capture loss leave the next drag usable", async ({
  page,
}) => {
  await prepareHistory(page, 40);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  const rail = page.locator(".pulse-rail");
  await expect(rail).toBeVisible();
  const box = (await rail.boundingBox())!;
  for (const type of ["pointercancel", "lostpointercapture"]) {
    await page.mouse.move(box.x + box.width / 2, box.y + 5);
    await page.mouse.down();
    await expect(rail).toHaveClass(/pulse-dragging/);
    await rail.dispatchEvent(type, { pointerId: 1, pointerType: "mouse" });
    await expect(rail).not.toHaveClass(/pulse-dragging/);
    await page.mouse.up();
  }
  const before = await rail.evaluate((element) => element.scrollLeft);
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + 5);
  await page.mouse.move(box.x + box.width / 2 + 150, box.y - 20);
  await page.mouse.up();
  await expect(rail).not.toHaveClass(/pulse-dragging/);
  await expect
    .poll(() => rail.evaluate((element) => element.scrollLeft))
    .toBeLessThan(before);
});

test("Pulse geometry fits small, portrait and low viewports without hiding statistics", async ({
  page,
}) => {
  await prepareHistory(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-stat-numbers")).toBeVisible();
  for (const width of [390, 640, 800, 1366, 1600]) {
    for (const height of [480, 900, ...(width === 390 ? [844] : [])]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const pulse = document
                .querySelector(".pulse-mode")!
                .getBoundingClientRect();
              const rects = [
                ".pulse-selected",
                ".pulse-statistics",
                ".pulse-rail",
                ".pulse-history-range",
              ].map((selector) =>
                document.querySelector(selector)!.getBoundingClientRect(),
              );
              return JSON.stringify({
                pulse: { top: pulse.top, bottom: pulse.bottom },
                rects: rects.map((rect) => ({
                  top: rect.top,
                  bottom: rect.bottom,
                  height: rect.height,
                  left: rect.left,
                  right: rect.right,
                })),
                fits:
                  rects.every(
                    (rect) =>
                      rect.height > 0 &&
                      rect.top >= pulse.top &&
                      rect.bottom <= pulse.bottom + 1 &&
                      rect.left >= pulse.left &&
                      rect.right <= pulse.right + 1,
                  ) &&
                  rects[2].height >= 116 &&
                  document.documentElement.scrollWidth <= innerWidth &&
                  document.documentElement.scrollHeight <= innerHeight,
              });
            }),
          { message: `Pulse geometry at ${width}x${height}` },
        )
        .toContain('"fits":true');
    }
  }
});

test("Pulse keeps loading distinct from empty while layout is in flight", async ({
  page,
}) => {
  await prepareHistory(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/api/pulse/layout?**", async (route) => {
    const response = await route.fetch();
    requested = true;
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect.poll(() => requested).toBe(true);
  await expect(
    page.getByText("Загрузка истории…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("История прослушивания пока пуста", { exact: true }),
  ).toHaveCount(0);
  release();
  await expect(page.locator(".pulse-rail")).toBeVisible();
  await expect(
    page.getByText("Загрузка истории…", { exact: true }),
  ).toHaveCount(0);
});

test("Pulse returns focus to a visible catalog fallback if the saved target disappeared", async ({
  page,
}) => {
  await prepareHistory(page);
  await page.goto("/");
  await page.locator(".add-library").focus();
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".workspace")).toBeHidden();
  await page.locator(".add-library").evaluate((element) => element.remove());
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".workspace")).toBeFocused();
});
