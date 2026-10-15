import { expect, test, type Page } from "@playwright/test";

const idle = (page: Page) =>
  expect(page.locator(".workspace")).not.toHaveAttribute(
    "data-panel-transition",
  );

async function seek(page: Page, time: number) {
  await page.evaluate((time) => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = time;
    }
  }, time);
}

async function finish(page: Page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await idle(page);
}

test("sidebar buttons have normal brightness and share the logo settings action", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.locator(".catalog-sidebar");
  const settings = sidebar.getByRole("button", {
    name: "Настройки",
    exact: true,
  });
  const restore = sidebar.locator("[data-restore-panel]").first();
  const pulse = sidebar.getByRole("button", {
    name: "Открыть Пульс",
    exact: true,
  });
  await expect(page.locator(".topbar .pulse-mode-toggle")).toHaveCount(0);
  const pulseBox = (await pulse.boundingBox())!;
  const settingsBox = (await settings.boundingBox())!;
  expect(pulseBox.x).toBe(settingsBox.x);
  expect(pulseBox.y + pulseBox.height).toBeLessThan(settingsBox.y);
  await expect(sidebar).toHaveCSS("width", "48px");
  const libraryBackground = await page
    .locator(".libraries-panel")
    .evaluate((panel) => ({
      image: getComputedStyle(panel).backgroundImage,
      color: getComputedStyle(panel).backgroundColor,
    }));
  await expect(sidebar).toHaveCSS("background-image", libraryBackground.image);
  await expect(sidebar).toHaveCSS("background-color", libraryBackground.color);
  await expect(sidebar.getByRole("separator")).toHaveCount(0);
  await expect(restore).toHaveCSS("opacity", "1");
  expect(
    await restore.evaluate((button) => getComputedStyle(button).color),
  ).toBe(await settings.evaluate((button) => getComputedStyle(button).color));
  const [rail, topbar, player, workspace] = await Promise.all(
    [
      sidebar,
      page.locator(".topbar"),
      page.locator(".player"),
      page.locator(".workspace"),
    ].map((node) => node.boundingBox()),
  );
  expect(rail!.y).toBe(topbar!.y + topbar!.height);
  expect(rail!.y + rail!.height).toBe(player!.y);
  expect(rail!.x).toBe(workspace!.x + workspace!.width);
  expect(rail!.x + rail!.width).toBe(topbar!.x + topbar!.width);
  await page.screenshot({ path: test.info().outputPath("sidebar-dark.png") });
  await settings.click();
  await expect(settings).toHaveAttribute("aria-pressed", "true");
  await expect(sidebar.locator("[data-restore-panel]")).toHaveCount(0);
  await expect(
    page.getByRole("main", { name: "Настройки", exact: true }),
  ).toBeVisible();
  await page.locator(".topbar-brand").click();
  await expect(settings).toHaveAttribute("aria-pressed", "false");
  await page.locator(".topbar-brand").click();
  await settings.click();
  await expect(page.locator(".workspace")).toBeVisible();
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-mode")).toBeVisible();
  await expect(sidebar.locator(".pulse-mode-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator("[data-restore-panel]")).toHaveCount(0);
  await settings.click();
  await settings.click();
  await expect(page.locator(".pulse-mode")).toBeVisible();
});

for (const [layout, viewport] of [
  ["horizontal", { width: 1600, height: 900 }],
  ["portrait", { width: 1000, height: 1200 }],
] as const) {
  test(`${layout} panels shrink and reveal smoothly without an end jump`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const workspace = page.locator(".workspace");
    const library = workspace.locator(".libraries-panel");
    const oldWidth = (await library.boundingBox())!.width;
    await workspace
      .getByRole("button", { name: "Закрыть панель «Жанры»" })
      .dispatchEvent("click");
    await expect(workspace).toHaveAttribute("data-panel-transition", "closing");
    await seek(page, 200);
    const ghost = page.locator(".panel-transition-snapshot");
    expect((await ghost.boundingBox())!.width).toBeGreaterThan(0);
    expect((await library.boundingBox())!.width).toBeGreaterThan(oldWidth);
    const restore = page.locator('[data-restore-panel="genres"]');
    await expect(restore).toBeDisabled();
    await expect(restore).toHaveCSS("opacity", "0");
    await seek(page, 399);
    const before = (await library.boundingBox())!;
    await finish(page);
    const after = (await library.boundingBox())!;
    expect(after.width).toBeCloseTo(before.width, 1);
    expect(after.x).toBeCloseTo(before.x, 1);
    await expect(ghost).toHaveCount(0);
    await expect(restore).toHaveCSS("opacity", "1");
    await restore.dispatchEvent("click");
    await expect(workspace).toHaveAttribute("data-panel-transition", "opening");
    await seek(page, 200);
    const genres = workspace.locator(".genres-panel");
    const clip = await genres.evaluate(
      (panel) => getComputedStyle(panel).clipPath,
    );
    expect(clip).not.toBe("none");
    expect(clip).not.toBe("inset(0px)");
    await finish(page);
    expect((await library.boundingBox())!.width).toBeCloseTo(oldWidth, 1);
    await expect(genres).toHaveCSS("clip-path", "none");
    await expect(restore).toHaveCount(0);
  });
}

test("resize and mode changes settle an active panel transition", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Закрыть панель «Жанры»" })
    .dispatchEvent("click");
  await seek(page, 100);
  await page.setViewportSize({ width: 950, height: 1000 });
  await idle(page);
  await expect(page.locator(".panel-transition-snapshot")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Показать панель «Жанры»" })
    .dispatchEvent("click");
  await seek(page, 100);
  await page.locator(".sidebar-settings").click();
  await idle(page);
  await expect(page.locator(".panel-transition-snapshot")).toHaveCount(0);
  await page.locator(".sidebar-settings").click();
  await expect(page.locator(".genres-panel")).toBeVisible();
});

test("reduced motion and first load do not animate panel visibility", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await idle(page);
  await page.getByRole("button", { name: "Закрыть панель «Жанры»" }).click();
  await idle(page);
  await expect(page.locator(".panel-transition-snapshot")).toHaveCount(0);
  await page.getByRole("button", { name: "Показать панель «Жанры»" }).click();
  await idle(page);
  await expect(page.locator(".genres-panel")).toBeVisible();
  await page.reload();
  await idle(page);
  await expect(page.locator(".panel-transition-snapshot")).toHaveCount(0);
});
