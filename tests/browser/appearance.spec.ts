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

  const dialog = page.getByRole("dialog", { name: /Настройки/ });
  await expect(dialog.getByRole("radiogroup", { name: "Тема" })).toHaveCount(0);
  await expect(
    dialog.getByText(/^Версия 0\.2\.1-beta\.6 \(abcdef0\)$/),
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

  const scanIntervals = dialog.getByRole("radiogroup", {
    name: "Автосканирование",
  });
  await expect(scanIntervals.getByRole("radio")).toHaveText([
    "Только вручную",
    "Каждые 60 мин.",
    "Каждые 15 мин.",
    "Каждые 5 мин.",
  ]);
  const manualScan = dialog.getByRole("radio", { name: "Только вручную" });
  await manualScan.click();
  await expect(manualScan).toHaveAttribute("aria-checked", "true");
  await expect(manualScan).toHaveCSS("border-top-left-radius", "7px");

  const fiveMinuteScan = dialog.getByRole("radio", {
    name: "Каждые 5 мин.",
  });
  await fiveMinuteScan.click();
  await expect(fiveMinuteScan).toHaveCSS("border-bottom-right-radius", "7px");

  const oneDayRetention = dialog.getByRole("radio", { name: "1 день" });
  await expect(oneDayRetention).toBeEnabled();
  await expect(
    dialog.getByText("Резервных копий нет", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Очистить резервные копии" }),
  ).toBeDisabled();
  await oneDayRetention.click();
  await expect(oneDayRetention).toHaveAttribute("aria-checked", "true");

  await dialog
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("assets/bg_lounge.jpg"));
  await expect(page.locator("body")).toHaveCSS(
    "background-image",
    /appearance\/background/,
  );
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await settings.click();
  await expect(
    page.getByRole("dialog", { name: /Настройки/ }).getByRole("radio", {
      name: "Каждые 5 мин.",
    }),
  ).toHaveAttribute("aria-checked", "true");
});

test("starts ordinary and full scans from settings", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route("**/api/libraries/scan", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const dialog = page.getByRole("dialog", { name: /Настройки/ });

  await dialog.getByRole("button", { name: "Быстрое сканирование" }).click();
  await dialog.getByRole("button", { name: "Полное обновление" }).click();

  await expect
    .poll(() => requests)
    .toEqual([{ force: false }, { force: true }]);
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
  const dialog = page.getByRole("dialog", { name: /Настройки/ });

  await expect(
    dialog.getByRole("button", { name: "Быстрое сканирование" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Полное обновление" }),
  ).toBeDisabled();
});
