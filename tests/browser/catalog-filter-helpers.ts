import type { Page } from "@playwright/test";

export async function addCatalogFilter(page: Page, name: string) {
  await page
    .getByRole("button", { name: `Добавить фильтр «${name}»`, exact: true })
    .click();
}
