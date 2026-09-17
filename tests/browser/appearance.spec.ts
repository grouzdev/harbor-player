import { expect, test } from "@playwright/test";
import path from "node:path";

test("applies and persists appearance settings", async ({ page }) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Открыть настройки" });
  await expect(settings).toBeVisible();
  await settings.click();

  const dialog = page.getByRole("dialog", { name: /Настройки/ });
  await dialog.getByRole("radio", { name: "Светлая" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await dialog.getByRole("button", { name: "Выбрать цвет #79b9d4" }).click();
  await expect(page.locator("html")).toHaveCSS("--accent", "#79b9d4");

  await dialog
    .locator('input[type="file"]')
    .setInputFiles(path.resolve("assets/bg_lounge.jpg"));
  await expect(page.locator("body")).toHaveCSS(
    "background-image",
    /appearance\/background/,
  );
  await dialog.getByRole("button", { name: "Закрыть" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
