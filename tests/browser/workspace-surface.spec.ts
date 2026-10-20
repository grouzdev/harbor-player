import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

async function setRange(page: Page, name: string, key: "Home" | "End") {
  const slider = page.getByRole("slider", { name, exact: true });
  await expect(slider).toBeEnabled();
  await slider.press(key);
  await expect(slider).toBeEnabled();
}

async function surface(page: Page) {
  return page.locator(".app-shell").evaluate((shell) => {
    const layer = getComputedStyle(shell, "::after");
    const blur = getComputedStyle(shell, "::before");
    const rect = shell
      .querySelector(".workspace:not(.workspace-hidden)")
      ?.getBoundingClientRect();
    return {
      opacity: layer.opacity,
      image: layer.backgroundImage,
      color: layer.backgroundColor,
      blur: blur.backdropFilter,
      row: layer.gridRowStart,
      column: layer.gridColumnStart,
      workspaceWidth: rect?.width ?? 0,
    };
  });
}

test("shares the catalog texture, transparency and background blur across all modes", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть настройки", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выбрать фон 2", exact: true })
    .click();
  await setRange(page, "Прозрачность панелей", "Home");
  await setRange(page, "Размытие фона", "Home");
  const opaque = await surface(page);
  expect(opaque).toMatchObject({
    opacity: "1",
    color: "rgb(24, 25, 23)",
    row: "2",
    column: "1",
  });
  expect(opaque.image).toContain("data:image/svg+xml");
  await page.screenshot({ path: info.outputPath("settings-opaque.png") });
  await setRange(page, "Прозрачность панелей", "End");
  await setRange(page, "Размытие фона", "End");
  expect((await surface(page)).opacity).toBe("0");
  await page.reload();
  await page
    .getByRole("button", { name: "Открыть настройки", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Прозрачность панелей", exact: true }),
  ).toHaveValue("100");
  await expect(
    page.getByRole("slider", { name: "Размытие фона", exact: true }),
  ).toHaveValue("40");
  // Custom image import and removal must preserve both controls.
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("assets/bg_lounge.jpg"));
  await expect(page.locator("body")).toHaveCSS(
    "background-image",
    /appearance\/background/,
  );
  await expect(
    page.getByRole("slider", { name: "Размытие фона", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Убрать фон", exact: true }).click();
  await expect(page.locator("html")).toHaveCSS("--appearance-background", "");
  await expect(page.locator("body")).toHaveCSS(
    "background-image",
    /assets\/.*\.jpg/,
  );
  await expect(
    page.getByRole("slider", { name: "Прозрачность панелей", exact: true }),
  ).toHaveValue("100");
  await page
    .getByRole("button", { name: "Выбрать фон 2", exact: true })
    .click();
  await setRange(page, "Прозрачность панелей", "Home");
  const slider = page.getByRole("slider", {
    name: "Прозрачность панелей",
    exact: true,
  });
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(slider).toBeEnabled();
  expect(Number(await slider.inputValue())).toBeGreaterThanOrEqual(49);
  expect(Number(await slider.inputValue())).toBeLessThanOrEqual(51);
  const common = await surface(page);
  await page.screenshot({ path: info.outputPath("settings-glass.png") });
  await page
    .getByRole("button", { name: "Вернуться в каталог", exact: true })
    .click();
  expect(await surface(page)).toMatchObject({
    opacity: common.opacity,
    image: common.image,
    color: common.color,
    blur: common.blur,
  });
  await expect(page.locator(".libraries-panel")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.screenshot({ path: info.outputPath("catalog-glass.png") });
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-mode")).toBeVisible();
  expect(await surface(page)).toMatchObject({
    opacity: common.opacity,
    image: common.image,
    color: common.color,
    blur: common.blur,
  });
  await page.screenshot({ path: info.outputPath("pulse-glass.png") });
  await page
    .getByRole("button", { name: "Вернуться к панелям", exact: true })
    .click();
  const source = path.resolve(
    ".test-data/browser",
    info.project.name,
    "cover-mode",
    "Downloads",
  );
  const libraries = (await (
    await page.request.get("/api/libraries")
  ).json()) as { name: string; path: string }[];
  let libraryName = libraries.find(
    (library) => path.resolve(library.path) === source,
  )?.name;
  if (!libraryName) {
    libraryName = `Surface ${info.project.name}`;
    await page.locator(".add-library").click();
    await page.getByLabel("Путь к папке", { exact: true }).fill(source);
    await page.getByLabel("Название библиотеки").fill(libraryName);
    await page.getByRole("button", { name: "Подключить", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: libraryName })
    .locator(".list-tile-main")
    .click();
  await expect(page.getByTestId("track-row").first()).toBeVisible();
  await page.locator(".cover-mode-toggle").click();
  await expect(page.locator(".cover-mode")).toBeVisible();
  await expect(page.locator(".cover-mode")).toHaveCSS(
    "background-image",
    "none",
  );
  expect(await surface(page)).toMatchObject({
    opacity: common.opacity,
    image: common.image,
    color: common.color,
    blur: common.blur,
  });
  await page.screenshot({ path: info.outputPath("cover-glass.png") });
  for (const selector of [".topbar", ".player", ".catalog-sidebar"]) {
    await expect(page.locator(selector)).toHaveCSS(
      "background-image",
      /url|gradient/,
    );
  }
  await page
    .getByRole("button", { name: "Развернуть окно на весь экран", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  expect((await surface(page)).image).toBe(common.image);
  await page.screenshot({ path: info.outputPath("fullscreen-glass.png") });
  await page
    .getByRole("button", {
      name: "Свернуть окно из полноэкранного режима",
      exact: true,
    })
    .click();
  await page.setViewportSize({ width: 800, height: 1000 });
  await expect(page.locator("body")).toHaveCSS("background-image", /2-.*\.jpg/);
});

test("previews until interaction ends, saves once and rolls back failed saves", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть настройки", exact: true })
    .click();
  await setRange(page, "Прозрачность панелей", "Home");
  const requests: unknown[] = [];
  await page.route("**/api/appearance", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 500,
      json: { message: "Surface save failed" },
    });
  });
  const slider = page.getByRole("slider", {
    name: "Прозрачность панелей",
    exact: true,
  });
  await slider.focus();
  await page.keyboard.down("End");
  await expect(slider).toHaveValue("100");
  expect((await surface(page)).opacity).toBe("0");
  expect(requests).toHaveLength(0);
  await page.keyboard.up("End");
  await expect(page.getByRole("alert")).toContainText("500");
  await expect(slider).toHaveValue("0");
  expect((await surface(page)).opacity).toBe("1");
  expect(requests).toHaveLength(1);
});
