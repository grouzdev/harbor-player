import { randomUUID } from "node:crypto";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

async function prepareHistory(page: Page, busyAlbums = 0) {
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
  const busyDate = "2025-05-16";
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
    makeEvent(0, "2023-01-01"),
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
