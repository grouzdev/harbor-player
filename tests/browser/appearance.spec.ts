import { expect, test } from "@playwright/test";
import path from "node:path";

test("keeps the dark theme and persists appearance settings", async ({
  page,
}) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Открыть настройки" });
  await expect(settings).toBeVisible();
  await settings.click();

  const dialog = page.getByRole("dialog", { name: /Настройки/ });
  await expect(dialog.getByRole("radiogroup", { name: "Тема" })).toHaveCount(0);
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
