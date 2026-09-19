import { expect, test } from "@playwright/test";
import path from "node:path";

test("catalog search filters every panel from one result set", async ({
  page,
}, info) => {
  const browser = info.project.name;
  const libraryName = `Search Needle ${browser}`;
  const source = path.resolve(".test-data/browser", browser, "folders", "Tree");

  await page.goto("/");
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(source);
  await page.getByLabel("Название библиотеки").fill(libraryName);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByTestId("track-row")).toHaveCount(3);

  await page.getByLabel("Поиск музыки").fill("Search Needle");
  await expect(
    page
      .locator(".libraries-panel .list-tile")
      .filter({ hasText: libraryName }),
  ).toHaveCount(1);
  await expect(page.locator(".genres-panel .list-tile")).not.toHaveCount(0);
  await expect(page.locator(".artists-panel .list-tile")).not.toHaveCount(0);
  await expect(page.locator(".album-card")).not.toHaveCount(0);
  await expect(page.getByTestId("track-row")).toHaveCount(3);

  await page
    .getByRole("button", { name: `Развернуть библиотеку «${libraryName}»` })
    .click();
  await expect(
    page.locator(".libraries-panel .library-folder-tile"),
  ).not.toHaveCount(0);
});
