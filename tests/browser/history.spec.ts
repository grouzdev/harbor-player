import { expect, test } from "@playwright/test";
import type { OperationSummary } from "../../src/shared/contracts";

test("history supports single, successful and full removal without deleting active actions", async ({
  page,
}) => {
  const createdAt = "2026-07-17T12:00:00Z";
  let entries: OperationSummary[] = [
    {
      id: "tags",
      kind: "tags",
      createdAt,
      status: "done",
      total: 1,
      completed: 1,
      errors: [],
      recoverable: true,
      deletable: true,
    },
    {
      id: "move",
      kind: "move",
      createdAt,
      status: "done",
      total: 1,
      completed: 1,
      errors: [],
      deletable: true,
    },
    {
      id: "failed",
      kind: "trash",
      createdAt,
      status: "interrupted",
      total: 1,
      completed: 0,
      errors: ["Ошибка"],
      deletable: true,
    },
    {
      id: "active",
      kind: "tags",
      createdAt,
      status: "running",
      total: 1,
      completed: 0,
      errors: [],
      deletable: false,
    },
  ];
  let failOnce = true;
  let deletes = 0;
  let listRequests = 0;
  await page.route("**/api/operations", (route) => {
    listRequests++;
    return route.fulfill({ json: entries });
  });
  await page.route("**/api/operations/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "DELETE") {
      deletes++;
      if (failOnce) {
        failOnce = false;
        return route.fulfill({
          status: 503,
          json: { error: "Очистка временно недоступна" },
        });
      }
      const before = entries.length;
      if (url.pathname === "/api/operations/tags/history")
        entries = entries.filter((entry) => entry.id !== "tags");
      else if (url.searchParams.get("scope") === "successful")
        entries = entries.filter(
          (entry) =>
            entry.status !== "done" ||
            entry.errors.length > 0 ||
            !entry.deletable,
        );
      else entries = entries.filter((entry) => !entry.deletable);
      return route.fulfill({
        json: {
          removed: before - entries.length,
          skippedActive: url.searchParams.get("scope") === "all" ? 1 : 0,
        },
      });
    }
    if (url.pathname === "/api/operations/history")
      return route.fulfill({
        json: {
          total: entries.length,
          successful: entries.filter(
            (entry) =>
              entry.status === "done" &&
              !entry.errors.length &&
              entry.deletable,
          ).length,
          removable: entries.filter((entry) => entry.deletable).length,
          active: entries.filter((entry) => !entry.deletable).length,
        },
      });
    return route.fulfill({
      json: {
        id: "tags",
        kind: "tags",
        createdAt,
        status: "done",
        recoverable: true,
        items: [
          {
            id: "item",
            trackId: null,
            source: "/song.flac",
            destination: "/song.flac",
            size: 1,
            mtimeMs: 0,
            hash: "",
            title: "Song",
            phase: "done",
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const history = page.getByRole("region", { name: "История действий" });
  await expect(history.locator(".history-item")).toHaveCount(4);
  await expect(history.locator(".history-remove")).toHaveCount(3);
  await expect(
    history
      .locator(".history-item")
      .last()
      .getByRole("button", { name: /Удалить из истории/ }),
  ).toHaveCount(0);
  await history
    .locator(".history-item")
    .first()
    .getByRole("button", { name: "Подробнее", exact: true })
    .click();
  await expect(history.locator(".history-details")).toBeVisible();

  await history.locator(".history-remove").first().click();
  let confirmation = page.getByRole("dialog", {
    name: "Удалить действие из истории?",
  });
  await expect(confirmation).toContainText("Резервные копии не будут удалены");
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  expect(deletes).toBe(0);
  await expect(history.locator(".history-item")).toHaveCount(4);

  await history.locator(".history-remove").first().click();
  confirmation = page.getByRole("dialog", {
    name: "Удалить действие из истории?",
  });
  await confirmation
    .getByRole("button", { name: "Удалить из истории", exact: true })
    .click();
  await expect(confirmation.getByRole("alert")).toContainText(
    "Очистка временно недоступна",
  );
  await expect(history.locator(".history-item")).toHaveCount(4);
  await confirmation
    .getByRole("button", { name: "Удалить из истории", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(history.locator(".history-item")).toHaveCount(3);
  await expect(history.locator(".history-details")).toHaveCount(0);
  await expect(history.getByRole("status")).toContainText("Удалено записей: 1");

  await history
    .getByRole("button", { name: "Удалить успешные", exact: true })
    .click();
  confirmation = page.getByRole("dialog", {
    name: "Удалить успешные действия?",
  });
  await confirmation
    .getByRole("button", { name: "Удалить успешные", exact: true })
    .click();
  await expect(history.locator(".history-item")).toHaveCount(2);
  await expect(
    history.getByRole("button", { name: "Удалить успешные", exact: true }),
  ).toBeDisabled();
  await history.getByRole("button", { name: "Очистить историю…" }).click();
  confirmation = page.getByRole("dialog", {
    name: "Очистить историю действий?",
  });
  await confirmation
    .getByRole("button", { name: "Очистить историю", exact: true })
    .click();
  await expect(history.locator(".history-item")).toHaveCount(1);
  await expect(history.getByRole("status")).toContainText(
    "Активные действия сохранены: 1",
  );
  await expect(
    history.getByRole("button", { name: "Очистить историю…" }),
  ).toBeDisabled();
  await expect(history.locator(".history-remove")).toHaveCount(0);
  // A later poll must not resurrect removed entries.
  const requestsAfterRemoval = listRequests;
  await expect.poll(() => listRequests).toBeGreaterThan(requestsAfterRemoval);
  await expect(history.locator(".history-count")).toHaveText("1");
  await expect(history.locator(".history-item")).toHaveCount(1);
});

test("empty history keeps both cleanup controls visible and disabled", async ({
  page,
}) => {
  await page.route("**/api/operations", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/operations/history", (route) =>
    route.fulfill({
      json: { total: 0, successful: 0, removable: 0, active: 0 },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const history = page.getByRole("region", { name: "История действий" });
  await expect(
    history.getByText("Здесь появятся переносы, удаления и изменения тегов."),
  ).toBeVisible();
  await expect(
    history.getByRole("button", { name: "Удалить успешные" }),
  ).toBeDisabled();
  await expect(
    history.getByRole("button", { name: "Очистить историю…" }),
  ).toBeDisabled();
});
