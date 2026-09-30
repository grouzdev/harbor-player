import type { Page } from "@playwright/test";

export async function addCatalogFilter(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Добавить фильтр", exact: true })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  if (name === "Недавние")
    await page
      .getByRole("button", { name: "Применить период недавнего добавления" })
      .click();
}
