import { expect, test } from "@playwright/test";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let checkForUpdatesCalls = 0;
    Object.assign(window, {
      harborPlayerDesktop: {
        getAppInfo: async () => ({
          version: "0.2.1-beta.6",
          commit: "abcdef0",
          portable: false,
        }),
        getUpdateState: async () => ({ status: "idle" }),
        getUpdatePreferences: async () => ({ automaticChecks: true }),
        setUpdatePreferences: async (patch: object) => ({
          automaticChecks: true,
          ...patch,
        }),
        dismissUpdate: async () => {},
        retryUpdate: async () => {},
        openUpdateLog: async () => {},
        checkForUpdates: async () => {
          checkForUpdatesCalls += 1;
        },
        downloadUpdate: async () => {},
        installUpdate: async () => {},
        chooseImageFile: async () => null,
        chooseLibraryDirectory: async () => null,
        reportClientReady: async () => {},
        getWindowFullscreen: async () => false,
        toggleWindowFullscreen: async () => false,
        subscribeWindowFullscreen: () => () => {},
        subscribeUpdateState: () => () => {},
      },
      getCheckForUpdatesCalls: () => checkForUpdatesCalls,
    });
  });
});

test("keeps the dark theme and persists appearance settings", async ({
  page,
}) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Открыть настройки" });
  await expect(settings).toBeVisible();
  await settings.click();

  const dialog = page.getByRole("main", { name: "Настройки" });
  await expect(dialog.getByRole("radiogroup", { name: "Тема" })).toHaveCount(0);
  await expect(dialog.getByText("HARBOR 0.2.1", { exact: true })).toBeVisible();
  await expect(dialog.getByText("beta 6", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("Сборка abcdef0", { exact: true }),
  ).toBeVisible();
  const checkForUpdates = dialog.getByRole("button", {
    name: "Проверить обновления",
  });
  await expect(checkForUpdates).toBeVisible();
  await checkForUpdates.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & {
            getCheckForUpdatesCalls: () => number;
          }
        ).getCheckForUpdatesCalls(),
      ),
    )
    .toBe(1);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("button", { name: "Выбрать цвет #79b9d4" }).click();
  await expect(page.locator("html")).toHaveCSS("--accent", "#79b9d4");

  const scanIntervals = dialog.getByRole("combobox", {
    name: "Автосканирование",
  });
  await expect(scanIntervals.getByRole("option")).toHaveText([
    "Только вручную",
    "Каждые 60 мин.",
    "Каждые 15 мин.",
    "Каждые 5 мин.",
  ]);
  await scanIntervals.selectOption("0");
  await expect(scanIntervals).toHaveValue("0");
  await expect(scanIntervals).toBeEnabled();
  await scanIntervals.selectOption("5");
  await expect(scanIntervals).toBeEnabled();

  const oneDayRetention = dialog.getByRole("combobox", {
    name: "Срок хранения резервных копий",
  });
  await expect(oneDayRetention).toBeEnabled();
  await expect(
    dialog.getByText("Резервных копий нет", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Очистить резервные копии" }),
  ).toBeDisabled();
  await oneDayRetention.selectOption("1d");
  await expect(oneDayRetention).toHaveValue("1d");
  await expect(oneDayRetention).toBeEnabled();

  await dialog
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("assets/bg_lounge.jpg"));
  await expect(page.locator("body")).toHaveCSS(
    "background-image",
    /appearance\/background/,
  );
  await page
    .getByRole("button", { name: "Вернуться в каталог", exact: true })
    .click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.click();
  await expect(
    page.getByRole("main", { name: "Настройки" }).getByRole("combobox", {
      name: "Автосканирование",
    }),
  ).toHaveValue("5");
});

test("starts ordinary and full scans from settings", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route("**/api/libraries/scan", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const dialog = page.getByRole("main", { name: "Настройки" });

  await dialog.getByRole("button", { name: "Быстрое сканирование" }).click();
  await dialog.getByRole("button", { name: "Полное обновление" }).click();

  await expect
    .poll(() => requests)
    .toEqual([{ force: false }, { force: true }]);
});

test("selects numbered bundled backgrounds and persists the selection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const settings = page.getByRole("main", { name: "Настройки" });
  const presets = settings.locator(".settings-background-preset");
  await expect(presets).toHaveCount(5);
  await expect(
    settings.getByRole("img", { name: "Предпросмотр фона" }),
  ).toHaveCount(0);
  const tops = await presets.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().top),
  );
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
  for (const image of await presets.locator("img").all()) {
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBeGreaterThan(0);
  }
  const preset = settings.getByRole("button", {
    name: "Выбрать фон 2",
    exact: true,
  });
  await preset.click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveCSS("background-image", /2-.*\.jpg/);
  await page.reload();
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  await expect(preset).toHaveAttribute("aria-pressed", "true");
  await settings.getByRole("button", { name: "Убрать фон" }).click();
  await expect(preset).toHaveAttribute("aria-pressed", "false");
});

test("edits the accent code separately and shows compact desktop updates", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const settings = page.getByRole("main", { name: "Настройки" });
  const code = settings.getByRole("textbox", { name: "Код акцентного цвета" });
  await code.fill("#123ABC");
  await code.press("Enter");
  await expect(page.locator("html")).toHaveCSS("--accent", "#123abc");
  await code.fill("#invalid");
  await code.press("Enter");
  await expect(page.locator("html")).toHaveCSS("--accent", "#123abc");
  await code.press("Escape");
  await expect(code).toHaveValue("#123ABC");
  const version = settings.getByRole("region", { name: "Версия и обновления" });
  const update = version.getByRole("button", { name: "Проверить обновления" });
  await expect(update).toHaveClass(/secondary/);
  await expect(
    version.getByRole("heading", { name: "Что нового" }),
  ).toBeVisible();
  const olderNotes = version.locator("details").first();
  await expect(olderNotes).not.toHaveAttribute("open");
  await olderNotes.locator("summary").click();
  await expect(olderNotes).toHaveAttribute("open", "");
  await expect(
    olderNotes.getByRole("heading", { name: "Новое" }),
  ).toBeVisible();
});

test("desktop background chooser imports its selection without a path form", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((imagePath) => {
    window.harborPlayerDesktop!.chooseImageFile = async () => imagePath;
  }, path.resolve("assets/bg_lounge.jpg"));
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const settings = page.getByRole("main", { name: "Настройки" });
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/appearance/background") &&
      response.request().method() === "POST",
  );
  await settings.getByRole("button", { name: "Выбрать изображение" }).click();
  expect((await response).ok()).toBe(true);
  await expect(
    settings.getByRole("button", { name: "Убрать фон" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveCSS(
    "background-image",
    /appearance\/background/,
  );
  await expect(settings.getByPlaceholder("Путь к изображению")).toHaveCount(0);
});

test("disables mass scan actions while a scan is active", async ({ page }) => {
  await page.route("**/api/jobs", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "active-scan",
          kind: "scan",
          label: "Сканирование: Музыка",
          status: "running",
          completed: 1,
          total: 10,
          errors: [],
          createdAt: "2026-09-27T12:00:00.000Z",
        },
      ]),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const dialog = page.getByRole("main", { name: "Настройки" });

  await expect(
    dialog.getByRole("button", { name: "Быстрое сканирование" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Полное обновление" }),
  ).toBeDisabled();
});
