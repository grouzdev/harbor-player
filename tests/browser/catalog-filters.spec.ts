import { expect, test } from "@playwright/test";
import { addCatalogFilter } from "./catalog-filter-helpers";
import type { CatalogFilter } from "../../src/shared/contracts";

test("catalog search expands on click and Tab, collapses empty, and preserves entered text", async ({
  page,
}) => {
  await page.goto("/");
  const shell = page.locator(".catalog-search");
  const search = page.getByRole("textbox", {
    name: "Поиск музыки",
    exact: true,
  });
  const open = page.getByRole("button", { name: "Открыть поиск", exact: true });
  const add = page.getByRole("button", {
    name: "Добавить фильтр",
    exact: true,
  });
  await expect(open).toBeVisible();
  await expect(page.locator(".catalog-user-filters button")).toHaveCount(2);
  for (const button of [open, add]) {
    await expect(button).toHaveClass(/icon-button/);
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await open.click();
  await expect(search).toBeFocused();
  await expect(shell).toHaveCSS("width", "220px");
  await add.click();
  await expect(shell).toHaveClass(/is-collapsed/);
  await expect
    .poll(async () => {
      const menuBox = await page
        .getByRole("menu", { name: "Добавить фильтр", exact: true })
        .boundingBox();
      const triggerBox = await add.boundingBox();
      return Math.abs(menuBox!.x - triggerBox!.x);
    })
    .toBeLessThan(1);
  await page.keyboard.press("Escape");
  await search.focus();
  await search.fill("test");
  await page.locator(".topbar").click({ position: { x: 500, y: 10 } });
  await expect(shell).not.toHaveClass(/is-collapsed/);
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await expect(search).toBeFocused();
  await add.click();
  await expect(open).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(open).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await expect(shell).not.toHaveClass(/is-collapsed/);
});

test("filter menu excludes active filters and restores removed filters", async ({
  page,
}) => {
  await page.goto("/");
  const add = page.getByRole("button", {
    name: "Добавить фильтр",
    exact: true,
  });
  const menu = page.getByRole("menu", { name: "Добавить фильтр", exact: true });
  await add.click();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Закладки",
    "Не просмотрено",
    "Рейтинг",
    "Недавние",
  ]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await add.click();
  await page.locator(".topbar").click({ position: { x: 500, y: 10 } });
  await expect(menu).toHaveCount(0);
  for (const label of ["Недавние", "Не просмотрено", "Закладки"])
    await addCatalogFilter(page, label);
  await add.click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Рейтинг"]);
  await menu.getByRole("menuitem", { name: "Рейтинг", exact: true }).click();
  await expect(add).toBeDisabled();
  await page.getByRole("button", { name: "Закрыть изменение рейтинга" }).click();
  await expect(page.locator(".catalog-filter-chip")).toHaveText([
    "Добавлено 1 день назад",
    "Не просмотрено",
    "Закладки",
    "Рейтинг: от 0 до 5",
  ]);
  await expect(add).toBeDisabled();
  await page.getByLabel("Поиск музыки", { exact: true }).fill("global");
  await expect(
    page.getByRole("button", { name: "Удалить фильтр «Рейтинг»" }),
  ).toBeDisabled();
  await expect(page.locator(".catalog-filter-chip")).toHaveCount(4);
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await page
    .getByRole("button", { name: "Удалить фильтр «Не просмотрено»" })
    .click();
  await add.click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Не просмотрено"]);
  await menu.getByRole("menuitem").click();
  await expect(page.locator(".catalog-filter-chip").last()).toHaveText(
    "Не просмотрено",
  );
  for (const label of ["Недавние", "Закладки", "Рейтинг", "Не просмотрено"]) {
    await page
      .getByRole("button", { name: `Удалить фильтр «${label}»` })
      .click();
  }
  await expect(page.locator(".catalog-filter-chip")).toHaveCount(0);
  await expect(add).toBeEnabled();
});

test("rating filter applies changes immediately", async ({
  page,
}) => {
  const requests: CatalogFilter[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/tracks" && url.searchParams.has("filter"))
      requests.push(JSON.parse(url.searchParams.get("filter")!));
  });
  await page.goto("/");
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await addCatalogFilter(page, "Рейтинг");
  await page.getByLabel("Минимальная оценка").fill("3");
  await page.getByLabel("Максимальная оценка").fill("4");
  await expect(page.locator(".catalog-filter-editor")).toContainText(
    "Рейтинг: от 3 до 4",
  );
  await expect.poll(() => requests.at(-1)?.trackRatingMin).toBe(3);
  expect(requests.at(-1)?.trackRatingMax).toBe(4);
  await page
    .getByRole("button", { name: "Закрыть изменение рейтинга" })
    .click();
  await expect(page.locator(".catalog-filter-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "Редактировать рейтинг" }).click();
  await page.getByLabel("Минимальная оценка").fill("1");
  await expect.poll(() => requests.at(-1)?.trackRatingMin).toBe(1);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Редактировать рейтинг" }),
  ).toHaveText("Рейтинг: от 1 до 4");
  expect(requests.at(-1)?.trackRatingMin).toBe(1);
  await page.getByRole("button", { name: "Редактировать рейтинг" }).click();
  await page
    .getByRole("button", { name: "Удалить фильтр «Рейтинг»" })
    .first()
    .click();
  await expect.poll(() => requests.at(-1)?.trackRatingMin).toBeNull();
});

test("recent filter applies its period immediately", async ({
  page,
}) => {
  const requests: CatalogFilter[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/tracks" && url.searchParams.has("filter"))
      requests.push(JSON.parse(url.searchParams.get("filter")!));
  });
  await page.goto("/");
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Добавить фильтр", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Недавние", exact: true }).click();
  const period = page.getByRole("slider", {
    name: "Период недавнего добавления",
    exact: true,
  });
  await expect(page.locator(".catalog-filter-editor")).toContainText(
    "Добавлено 1 день назад",
  );
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(1);
  await period.fill("3");
  await expect(page.locator(".catalog-filter-editor")).toContainText(
    "Добавлено 14 дней назад",
  );
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(14);
  await page
    .getByRole("button", {
      name: "Закрыть изменение периода недавнего добавления",
    })
    .click();
  await expect(page.locator(".catalog-filter-editor")).toHaveCount(0);
  expect(requests.at(-1)?.recentlyAddedDays).toBe(14);
  const recent = page.getByRole("button", {
    name: "Редактировать период недавнего добавления",
  });
  await recent.click();
  await period.fill("4");
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(30);
  await page.keyboard.press("Escape");
  await expect(page.locator(".catalog-filter-editor")).toHaveCount(0);
  expect(requests.at(-1)?.recentlyAddedDays).toBe(30);
  await recent.click();
  await page.getByRole("button", { name: "Удалить фильтр «Недавние»" }).first().click();
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBeNull();
  await expect(recent).toHaveCount(0);
});

test("recent filter reaches every catalog panel", async ({ page }) => {
  const requests = new Map<string, CatalogFilter[]>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.searchParams.has("filter")) return;
    const panel = url.pathname.match(/^\/api\/(libraries|genres|artists|albums|tracks)$/)?.[1];
    if (!panel) return;
    const panelRequests = requests.get(panel) || [];
    panelRequests.push(JSON.parse(url.searchParams.get("filter")!));
    requests.set(panel, panelRequests);
  });
  await page.goto("/");
  await addCatalogFilter(page, "Недавние");
  for (const panel of ["libraries", "genres", "artists", "albums", "tracks"])
    await expect
      .poll(() =>
        requests
          .get(panel)
          ?.some((filter) => filter.recentlyAddedDays === 1),
      )
      .toBe(true);
});

for (const theme of ["dark", "light"]) {
  test(`catalog filter layout fits wide and narrow windows in ${theme} theme`, async ({
    page,
  }, info) => {
    await page.goto("/");
    for (const name of ["Закладки", "Не просмотрено", "Недавние", "Рейтинг"])
      await addCatalogFilter(page, name);
    await page
      .getByRole("button", { name: "Закрыть изменение рейтинга" })
      .click();
    await page.getByRole("button", { name: "Открыть поиск" }).click();
    // The app currently selects dark; exercise the retained light CSS explicitly
    // after startup has finished applying the saved appearance.
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({
      path: info.outputPath(`${theme}-all-filters.png`),
    });
    await page.getByRole("button", { name: "Редактировать рейтинг" }).click();
    for (const width of [1600, 800, 600]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator(".catalog-user-filters").boundingBox();
      const settings = await page
        .getByRole("button", { name: "Открыть настройки", exact: true })
        .boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(settings!.x);
      const editor = await page.locator(".catalog-filter-editor").boundingBox();
      expect(editor!.x + editor!.width).toBeLessThanOrEqual(settings!.x);
      const fullscreen = await page
        .getByRole("button", { name: "Развернуть окно на весь экран" })
        .boundingBox();
      expect(fullscreen!.x + fullscreen!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`${theme}-rating-${width}.png`),
      });
    }
    await page
      .getByRole("button", { name: "Закрыть изменение рейтинга" })
      .click();
    await page
      .getByRole("button", { name: "Удалить фильтр «Рейтинг»" })
      .click();
    await page
      .getByRole("button", { name: "Добавить фильтр", exact: true })
      .click();
    const menu = (await page
      .getByRole("menu", { name: "Добавить фильтр" })
      .boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(8);
    expect(menu.x + menu.width).toBeLessThanOrEqual(592);
    await page.screenshot({ path: info.outputPath(`${theme}-menu.png`) });
  });
}

test("bookmark filter retries a failed load and follows external reset", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/bookmarks", async (route) => {
    await route.fulfill({
      status: fail ? 503 : 200,
      contentType: "application/json",
      body: fail ? JSON.stringify({ error: "Unavailable" }) : "[]",
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Добавить фильтр", exact: true })
    .click();
  const retry = page.getByRole("menuitem", {
    name: "Закладки: повторить загрузку",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  fail = false;
  await retry.click();
  const bookmarks = page.getByRole("menuitem", {
    name: "Закладки",
    exact: true,
  });
  await expect(bookmarks).toBeEnabled();
  await bookmarks.click();
  await expect(page.locator('[data-filter="bookmarks"]')).toHaveText(
    "Закладки",
  );
  await page
    .getByRole("button", { name: "Показать всю музыку", exact: true })
    .click();
  await expect(page.locator('[data-filter="bookmarks"]')).toHaveCount(0);
  await page
    .getByRole("button", { name: "Добавить фильтр", exact: true })
    .click();
  await expect(bookmarks).toBeEnabled();
});
