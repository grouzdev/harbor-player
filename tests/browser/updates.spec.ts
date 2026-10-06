import { expect, test, type Page } from "@playwright/test";
import type { UpdateState } from "../../src/shared/desktop-contract";

const failedCheck: UpdateState = {
  status: "error",
  stage: "check",
  message: "Не удалось проверить обновления. Сервер временно недоступен.",
  retryable: true,
  notificationId: "attempt-1",
};

async function mockUpdater(page: Page, initial: UpdateState) {
  await page.addInitScript((initialState) => {
    let state = initialState;
    let preferences = JSON.parse(
      localStorage.getItem("test-update-preferences") ??
        '{"automaticChecks":true}',
    );
    const listeners = new Set<(next: typeof state) => void>();
    const calls: string[] = [];
    const publish = (next: typeof state) => {
      state = next;
      for (const listener of listeners) listener(next);
    };
    const bridge = {
      getAppInfo: async () => ({
        version: "0.3.0-beta.3",
        commit: "test",
        portable: false,
      }),
      getUpdateState: async () => state,
      getUpdatePreferences: async () => preferences,
      setUpdatePreferences: async (next: object) => {
        preferences = { ...preferences, ...next };
        localStorage.setItem(
          "test-update-preferences",
          JSON.stringify(preferences),
        );
        if (preferences.skippedVersion) {
          publish({ ...state, notificationHidden: true });
        }
        return preferences;
      },
      dismissUpdate: async () => {
        calls.push("dismiss");
        publish({ ...state, notificationHidden: true });
      },
      retryUpdate: async () => {
        calls.push("retry");
        publish({ ...state, notificationId: "attempt-2" });
      },
      checkForUpdates: async () => {
        calls.push("check");
        publish({
          status: "available",
          version: "0.4.0",
          notificationId: "manual-check",
        });
      },
      downloadUpdate: async () => {
        calls.push("download");
      },
      installUpdate: async () => {
        calls.push("install");
      },
      openUpdateLog: async () => {
        calls.push("log");
        throw new Error("HttpError: secret technical stack");
      },
      reportClientReady: async () => {},
      getWindowFullscreen: async () => false,
      subscribeWindowFullscreen: () => () => {},
      subscribeUpdateState: (listener: (next: typeof state) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    Object.assign(window, {
      harborPlayerDesktop: bridge,
      updateTest: { publish, calls },
    });
  }, initial);
}

async function publish(page: Page, state: UpdateState) {
  await page.evaluate((next) => {
    const helper = (
      window as unknown as {
        updateTest: { publish: (state: UpdateState) => void };
      }
    ).updateTest;
    helper.publish(next);
  }, state);
}

const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Обновление приложения" });

test("update error is selectable, dismissible and does not reopen for the same attempt", async ({
  page,
}) => {
  await mockUpdater(page, failedCheck);
  await page.goto("/");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("status")).toHaveCSS(
    "user-select",
    "text",
  );
  await panel(page)
    .getByRole("button", { name: "Закрыть уведомление об обновлении" })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await publish(page, failedCheck);
  await expect(panel(page)).toHaveCount(0);
  await publish(page, { ...failedCheck, notificationId: "new-attempt" });
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Не сейчас" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator(".workspace")).toBeVisible();
});

test("retry uses updater retry and IPC exceptions remain short", async ({
  page,
}) => {
  await mockUpdater(page, failedCheck);
  await page.goto("/");
  await panel(page).getByRole("button", { name: "Повторить" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { updateTest: { calls: string[] } }).updateTest
            .calls,
      ),
    )
    .toEqual(["retry"]);
  await panel(page).getByRole("button", { name: "Открыть журнал" }).click();
  await expect(panel(page)).toContainText("Не удалось выполнить действие.");
  await expect(page.getByText("HttpError", { exact: false })).toHaveCount(0);
});

test("a large notification keeps close and defer controls inside a small viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 420 });
  await mockUpdater(page, {
    ...failedCheck,
    message: "Диагностическое сообщение ".repeat(1000),
  });
  await page.goto("/");
  const bounds = await panel(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.height).toBeLessThanOrEqual(304);
  const close = panel(page).getByRole("button", {
    name: "Закрыть уведомление об обновлении",
  });
  const later = panel(page).getByRole("button", { name: "Не сейчас" });
  for (const control of [close, later]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThan(328);
  }
  await close.click();
  await expect(panel(page)).toHaveCount(0);
});

test("hidden download stays hidden while its status and install action remain in settings", async ({
  page,
}) => {
  await mockUpdater(page, {
    status: "downloading",
    version: "0.4.0",
    percent: 10,
    notificationId: "download-1",
  });
  await page.goto("/");
  await panel(page).getByRole("button", { name: "Скрыть" }).click();
  await publish(page, {
    status: "downloading",
    version: "0.4.0",
    percent: 50,
    notificationId: "download-1",
  });
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const settings = page.getByRole("region", { name: "Версия и обновления" });
  await expect(settings).toContainText("Загрузка 0.4.0: 50%");
  await publish(page, {
    status: "downloaded",
    version: "0.4.0",
    notificationId: "download-1",
    notificationHidden: true,
  });
  await expect(panel(page)).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Перезапустить и установить" }),
  ).toBeVisible();
});

test("skip version and disabled automatic checks survive reload; manual check still works", async ({
  page,
}) => {
  await mockUpdater(page, {
    status: "available",
    version: "0.4.0",
    notificationId: "available-1",
  });
  await page.goto("/");
  await panel(page)
    .getByRole("button", { name: "Пропустить эту версию" })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const automatic = page.getByRole("checkbox", {
    name: "Автоматически проверять обновления",
  });
  await expect(automatic).toBeChecked();
  await automatic.uncheck();
  await expect(automatic).not.toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  await expect(automatic).not.toBeChecked();
  await expect(page.getByText(/Пропущена версия 0.4.0/)).toBeVisible();
  await page.getByRole("button", { name: "Проверить обновления" }).click();
  await expect(panel(page)).toBeVisible();
});

test("skipping an already hidden update from settings immediately confirms the saved preference", async ({
  page,
}) => {
  await mockUpdater(page, {
    status: "available",
    version: "0.4.0",
    notificationId: "hidden-available",
    notificationHidden: true,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Открыть настройки" }).click();
  const settings = page.getByRole("region", { name: "Версия и обновления" });
  await settings.getByRole("button", { name: "Пропустить эту версию" }).click();
  await expect(settings).toContainText("Пропущена версия 0.4.0.");
});

test("an ID-less dismissed notification does not suppress an unrelated future error", async ({
  page,
}) => {
  await mockUpdater(page, { ...failedCheck, notificationId: undefined });
  await page.goto("/");
  await panel(page).getByRole("button", { name: "Не сейчас" }).click();
  await expect(panel(page)).toHaveCount(0);
  await publish(page, { status: "checking" });
  await publish(page, { ...failedCheck, notificationId: undefined });
  await expect(panel(page)).toBeVisible();
});
