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
    name: "Добавить фильтр «Закладки»",
    exact: true,
  });
  await expect(open).toBeVisible();
  await expect(
    page.locator(".catalog-search button, .catalog-filter-add"),
  ).toHaveCount(5);
  for (const button of [
    open,
    ...(await page.locator(".catalog-filter-add").all()),
  ]) {
    await expect(button).toHaveClass(/icon-button/);
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await open.click();
  await expect(search).toBeFocused();
  await expect(shell).toHaveCSS("width", "220px");
  await page.locator(".topbar").click({ position: { x: 500, y: 10 } });
  await expect(shell).toHaveClass(/is-collapsed/);
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

test("filter buttons keep their order and return when filters are removed", async ({
  page,
}) => {
  await page.goto("/");
  const buttons = page.locator(".catalog-filter-add");
  expect(
    await buttons.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    ),
  ).toEqual([
    "Добавить фильтр «Закладки»",
    "Добавить фильтр «Недавние»",
    "Добавить фильтр «Не просмотрено»",
    "Добавить фильтр «Рейтинг»",
  ]);
  await addCatalogFilter(page, "Недавние");
  await expect(page.locator(".catalog-filter-editor")).toHaveCount(0);
  for (const label of ["Не просмотрено", "Закладки"])
    await addCatalogFilter(page, label);
  await expect(buttons).toHaveCount(1);
  await addCatalogFilter(page, "Рейтинг");
  await expect(buttons).toHaveCount(0);
  await page
    .getByRole("button", { name: "Закрыть изменение рейтинга" })
    .click();
  await expect(page.locator(".catalog-filter-chip")).toHaveText([
    "Закладки",
    "Добавлено 1 день назад",
    "Не просмотрено",
    "Рейтинг: от 0 до 5",
  ]);
  await expect(buttons).toHaveCount(0);
  await page.getByLabel("Поиск музыки", { exact: true }).fill("global");
  await expect(
    page.getByRole("button", { name: "Удалить фильтр «Рейтинг»" }),
  ).toBeDisabled();
  await expect(page.locator(".catalog-filter-chip")).toHaveCount(4);
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await page
    .getByRole("button", { name: "Удалить фильтр «Не просмотрено»" })
    .click();
  await expect(buttons).toHaveCount(1);
  await addCatalogFilter(page, "Не просмотрено");
  await expect(page.locator(".catalog-filter-chip").nth(2)).toHaveText(
    "Не просмотрено",
  );
  for (const label of ["Недавние", "Закладки", "Рейтинг", "Не просмотрено"]) {
    await page
      .getByRole("button", { name: `Удалить фильтр «${label}»` })
      .click();
  }
  await expect(page.locator(".catalog-filter-chip")).toHaveCount(0);
  await expect(buttons).toHaveCount(4);
  for (const button of await buttons.all()) await expect(button).toBeEnabled();
});

test("rating filter applies changes immediately", async ({ page }) => {
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

test("recent filter applies its period immediately", async ({ page }) => {
  const requests: CatalogFilter[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/tracks" && url.searchParams.has("filter"))
      requests.push(JSON.parse(url.searchParams.get("filter")!));
  });
  await page.goto("/");
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await addCatalogFilter(page, "Недавние");
  const period = page.getByRole("slider", {
    name: "Период недавнего добавления",
    exact: true,
  });
  const recent = page.getByRole("button", {
    name: "Редактировать период недавнего добавления",
  });
  await expect(recent).toContainText("Добавлено 1 день назад");
  await expect(period).toHaveCount(0);
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(1);
  await recent.click();
  await expect(page.locator(".catalog-filter-editor")).toContainText(
    "Добавлено 1 день назад",
  );
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(1);
  await expect(period).toHaveAttribute("min", "1");
  await expect(period).toHaveAttribute("max", "30");
  await expect(period).toHaveAttribute("step", "1");
  await page.evaluate(() => document.fonts.ready);
  const editor = page.getByRole("group", {
    name: "Фильтр по времени добавления",
  });
  const editorBounds = await editor.boundingBox();
  const sliderBounds = await period.boundingBox();
  for (let days = 1; days <= 30; days++) {
    await period.fill(String(days));
    await expect(period).toHaveValue(String(days));
    expect(await editor.boundingBox()).toEqual(editorBounds);
    expect(await period.boundingBox()).toEqual(sliderBounds);
  }
  await period.fill("2");
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(2);
  await period.focus();
  await period.press("ArrowRight");
  await expect(period).toHaveValue("3");
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(3);
  await period.fill("14");
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
  await recent.click();
  await expect(period).toHaveValue("14");
  await period.fill("21");
  await expect(page.locator(".catalog-filter-editor")).toContainText(
    "Добавлено 21 день назад",
  );
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(21);
  await period.fill("30");
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(30);
  await page.keyboard.press("Escape");
  await expect(page.locator(".catalog-filter-editor")).toHaveCount(0);
  expect(requests.at(-1)?.recentlyAddedDays).toBe(30);
  await recent.click();
  await page
    .getByRole("button", { name: "Удалить фильтр «Недавние»" })
    .first()
    .click();
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBeNull();
  await expect(recent).toHaveCount(0);

  await addCatalogFilter(page, "Недавние");
  await expect(recent).toContainText("Добавлено 30 дней назад");
  await expect(period).toHaveCount(0);
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(30);

  await page.reload();
  await expect(recent).toHaveCount(0);
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBeNull();
  await addCatalogFilter(page, "Недавние");
  await expect(recent).toContainText("Добавлено 30 дней назад");
  await expect(period).toHaveCount(0);
  await expect.poll(() => requests.at(-1)?.recentlyAddedDays).toBe(30);
});

test("recent filter reaches every catalog panel", async ({ page }) => {
  const requests = new Map<string, CatalogFilter[]>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.searchParams.has("filter")) return;
    const panel = url.pathname.match(
      /^\/api\/(libraries|genres|artists|albums|tracks)$/,
    )?.[1];
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
        requests.get(panel)?.some((filter) => filter.recentlyAddedDays === 1),
      )
      .toBe(true);
});

for (const theme of ["dark", "light"]) {
  test(`catalog filter layout fits wide and narrow windows in ${theme} theme`, async ({
    page,
  }, info) => {
    await page.goto("/");
    for (const name of ["Закладки", "Не просмотрено", "Недавние"]) {
      await addCatalogFilter(page, name);
      if (name === "Недавние") await page.keyboard.press("Escape");
    }
    await addCatalogFilter(page, "Рейтинг");
    await page.keyboard.press("Escape");
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
      const coverModeToggle = await page
        .locator(".topbar .cover-mode-toggle")
        .boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(coverModeToggle!.x);
      const editor = await page.locator(".catalog-filter-editor").boundingBox();
      expect(editor!.x + editor!.width).toBeLessThanOrEqual(coverModeToggle!.x);
      const fullscreen = await page
        .getByRole("button", { name: "Развернуть окно на весь экран" })
        .boundingBox();
      expect(fullscreen!.x + fullscreen!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`${theme}-rating-${width}.png`),
      });
    }
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Удалить фильтр «Рейтинг»" })
      .click();
    const add = page.getByRole("button", {
      name: "Добавить фильтр «Рейтинг»",
      exact: true,
    });
    const bounds = (await add.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(600);
    await add.click();
    await expect(page.locator(".catalog-filter-editor")).toBeVisible();
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
  const retry = page.getByRole("button", {
    name: "Повторить загрузку закладок",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  await expect(page.locator('[data-filter="bookmarks"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Показать всю музыку", exact: true }),
  ).toHaveCount(0);
  fail = false;
  await retry.click();
  const bookmarks = page.getByRole("button", {
    name: "Добавить фильтр «Закладки»",
    exact: true,
  });
  await expect(bookmarks).toBeEnabled();
  await bookmarks.click();
  await expect(page.locator('[data-filter="bookmarks"]')).toHaveText(
    "Закладки",
  );
  // The reset action belongs to a successfully loaded, empty bookmark result,
  // not to the failed-load state or to a still-loading catalog.
  await expect(
    page.getByRole("heading", { name: "В закладках пока пусто", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Показать всю музыку", exact: true })
    .click();
  await expect(page.locator('[data-filter="bookmarks"]')).toHaveCount(0);
  await expect(bookmarks).toBeEnabled();
});
