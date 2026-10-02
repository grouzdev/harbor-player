import { expect, test, type Page } from "@playwright/test";

async function widths(page: Page) {
  return page
    .locator(".settings-panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().width),
    );
}

test("settings are four fixed panels with equal entry widths and adjacent resizing", async ({
  page,
}) => {
  await page.goto("/");
  const catalog = page.locator(".workspace");
  const catalogNode = await catalog.elementHandle();
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const settings = page.getByRole("main", { name: "Настройки" });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { level: 2 })).toHaveText([
    "Внешний вид",
    "Приложение",
    "Версия и обновления",
    "История действий",
  ]);
  await expect(settings.locator(".settings-panel")).toHaveCount(4);
  await expect(settings.getByRole("separator")).toHaveCount(3);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Закрыть" })).toHaveCount(
    0,
  );
  await expect(page.locator(".topbar button:visible")).toHaveCount(1);
  await expect(page.locator(".topbar input:visible")).toHaveCount(0);
  await expect(page.locator(".topbar-brand")).toHaveCSS(
    "filter",
    /drop-shadow/,
  );
  await expect(settings.getByPlaceholder("Путь к изображению")).toHaveCount(0);
  await expect(settings.locator(".settings-background-preview")).toHaveCount(0);
  await expect(
    settings.getByRole("link", { name: "Скачать обновление" }),
  ).toHaveCount(0);
  const catalogBackground = await page
    .locator(".libraries-panel")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect(settings.locator(".settings-panel").first()).toHaveCSS(
    "background-color",
    catalogBackground,
  );
  await expect(catalog).toBeHidden();
  await expect
    .poll(async () => {
      const current = await widths(page);
      return Math.max(...current) - Math.min(...current);
    })
    .toBeLessThan(1);
  const original = await widths(page);
  const separator = settings.getByRole("separator").first();
  const bounds = await separator.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 2, bounds!.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 82, bounds!.y + 80);
  await page.mouse.up();
  await expect
    .poll(async () => (await widths(page))[0] - original[0])
    .toBeGreaterThan(75);
  const resized = await widths(page);
  expect(Math.abs(resized[2] - original[2])).toBeLessThan(1);
  expect(Math.abs(resized[3] - original[3])).toBeLessThan(1);
  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => resized[0] - (await widths(page))[0])
    .toBeGreaterThan(19);
  await page.keyboard.press("Home");
  await expect
    .poll(async () => {
      const current = await widths(page);
      return Math.max(...current) - Math.min(...current);
    })
    .toBeLessThan(1);
  for (const index of [1, 2]) {
    const before = await widths(page);
    const adjacentSeparator = settings.getByRole("separator").nth(index);
    await adjacentSeparator.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await widths(page))[index] - before[index])
      .toBeGreaterThan(19);
    const after = await widths(page);
    expect(before[index + 1] - after[index + 1]).toBeGreaterThan(19);
    for (const panel of [0, 1, 2, 3]) {
      if (panel !== index && panel !== index + 1) {
        expect(Math.abs(after[panel] - before[panel])).toBeLessThan(1);
      }
    }
    await page.keyboard.press("Home");
    await expect
      .poll(async () => {
        const current = await widths(page);
        return Math.max(...current) - Math.min(...current);
      })
      .toBeLessThan(1);
  }
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("button", { name: "Вернуться в каталог", exact: true })
    .click();
  await expect(catalog).toBeVisible();
  expect(
    await catalogNode!.evaluate(
      (node) => node === document.querySelector(".workspace"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  await expect
    .poll(async () => {
      const current = await widths(page);
      return Math.max(...current) - Math.min(...current);
    })
    .toBeLessThan(1);
  await page.setViewportSize({ width: 760, height: 600 });
  await expect.poll(async () => Math.min(...(await widths(page)))).toBe(300);
  const boxes = await page
    .locator(".settings-panel")
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().top),
    );
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(1);
  expect(await settings.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
});

test("history is embedded, polls operations, and expands details in the matching record", async ({
  page,
}) => {
  const operation = {
    id: "settings-history",
    kind: "move",
    createdAt: "2026-07-17T12:00:00Z",
    status: "done",
    total: 1,
    completed: 1,
    errors: [],
  };
  let requests = 0;
  await page.route("**/api/operations", async (route) => {
    requests++;
    await route.fulfill({ json: [operation] });
  });
  await page.route("**/api/operations/settings-history", async (route) => {
    await route.fulfill({
      json: {
        id: operation.id,
        kind: operation.kind,
        createdAt: operation.createdAt,
        status: operation.status,
        items: [
          {
            id: "file-1",
            trackId: "track-1",
            source: "D:\\Incoming\\song.flac",
            destination: "D:\\Music\\song.flac",
            title: "Song",
            artist: "Artist",
            album: "Album",
            phase: "done",
            size: 1024,
            mtimeMs: 0,
            hash: "",
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const history = page.getByRole("region", { name: "История действий" });
  await expect(history.locator(".history-item")).toHaveCount(1);
  await history.getByRole("button", { name: "Подробнее", exact: true }).click();
  await expect(history.locator(".history-item .history-details")).toContainText(
    "song.flac",
  );
  await history.getByRole("button", { name: "Скрыть подробности" }).click();
  await expect(history.locator(".history-details")).toHaveCount(0);
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
});

test("canceling history recovery returns to the same settings workspace", async ({
  page,
}) => {
  const createdAt = "2026-07-17T12:00:00Z";
  await page.route("**/api/operations", (route) =>
    route.fulfill({
      json: [
        {
          id: "recoverable-tags",
          kind: "tags",
          createdAt,
          status: "done",
          total: 1,
          completed: 1,
          errors: [],
          recoverable: true,
        },
      ],
    }),
  );
  await page.route("**/api/operations/recoverable-tags/restore", (route) =>
    route.fulfill({
      json: {
        id: "restore-preview",
        kind: "restore",
        createdAt,
        status: "preview",
        items: [
          {
            id: "file-1",
            trackId: null,
            source: "D:\\Backup\\song.flac",
            destination: "D:\\Music\\song.flac",
            title: "Song",
            phase: "preview",
            size: 1024,
            mtimeMs: 0,
            hash: "",
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const settings = page.getByRole("main", { name: "Настройки" });
  const separator = settings.getByRole("separator").first();
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  const before = await widths(page);
  await settings
    .getByRole("button", { name: "Восстановить", exact: true })
    .click();
  const preview = page.getByRole("dialog", {
    name: "Восстановление: предварительный просмотр",
  });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(settings).toBeVisible();
  const after = await widths(page);
  expect(Math.abs(after[0] - before[0])).toBeLessThan(1);
  await expect(page.locator(".topbar button:visible")).toHaveCount(1);
});
