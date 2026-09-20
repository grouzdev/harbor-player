import { expect, test } from "@playwright/test";
import path from "node:path";

test("catalog search filters every panel from one result set", async ({
  page,
}, info) => {
  const browser = info.project.name;
  const libraryName = `Search Needle ${browser}`;
  const source = path.resolve(".test-data/browser", browser, "search", "Tree");

  await page.goto("/");
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(source);
  await page.getByLabel("Название библиотеки").fill(libraryName);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await page
    .locator(".libraries-panel .list-tile-main")
    .filter({ hasText: libraryName })
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(3);

  await page.getByLabel("Поиск музыки").fill(libraryName);
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

  await page.getByLabel("Поиск музыки").fill("");
  const otherName = `Outside Needle ${browser}`;
  await page.locator(".add-library").click();
  await page
    .getByLabel("Путь к папке", { exact: true })
    .fill(path.resolve(".test-data/browser", browser, "search", "Downloads"));
  await page.getByLabel("Название библиотеки").fill(otherName);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByTestId("track-row")).toHaveCount(3);
  await page.getByLabel("Поиск музыки").fill(otherName);
  await expect(page.getByTestId("track-row")).toHaveCount(7);
  await expect(
    page.getByRole("button", { name: "Сбросить библиотеки" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Очистить поиск", exact: true })
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(3);
  await expect(
    page
      .locator(".libraries-panel .list-tile.selected")
      .filter({ hasText: libraryName }),
  ).toHaveCount(1);
});
