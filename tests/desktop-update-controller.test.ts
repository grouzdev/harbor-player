import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createUpdateController } from "../src/desktop/update-controller.js";
import { normalizeUpdatePreferences } from "../src/desktop/update-preferences.js";
import type {
  UpdatePreferences,
  UpdateState,
} from "../src/shared/desktop-contract.js";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = true;
  channel: string | null = null;
  logger: unknown = console;
  checkForUpdates = vi.fn(async () => {
    this.emit("update-available", { version: "0.3.0-beta.4" });
  });
  downloadUpdate = vi.fn(async () => {
    this.emit("update-downloaded", { version: "0.3.0-beta.4" });
  });
  quitAndInstall = vi.fn();
}

function fixture(initial: UpdatePreferences = { automaticChecks: true }) {
  const updater = new FakeUpdater();
  let preferences = initial;
  const states: UpdateState[] = [];
  const log = vi.fn();
  const notify = vi.fn();
  const prepareInstall = vi.fn(async () => {});
  const controller = createUpdateController({
    updater,
    portable: false,
    beta: true,
    preferences: {
      get: () => preferences,
      set: (patch) =>
        (preferences = normalizeUpdatePreferences({
          ...preferences,
          ...(patch as object),
        })),
    },
    publish: (state) => states.push(state),
    log,
    notify,
    prepareInstall,
    openReleases: vi.fn(),
  });
  return { updater, controller, states, log, notify, prepareInstall };
}

describe("desktop updater operations", () => {
  it("blocks concurrent checks and downloads until the current promise settles", async () => {
    const { updater, controller } = fixture();
    let resolve!: () => void;
    updater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const pending = controller.check(true);
    await controller.check(true);
    await controller.download();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    updater.emit("update-available", { version: "0.3.0-beta.4" });
    await controller.download();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    resolve();
    await pending;
    let finish!: () => void;
    updater.downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    const download = controller.download();
    await controller.download();
    await controller.check(true);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    finish();
    await download;
  });

  it("deduplicates error event and catch; retries download without losing its version", async () => {
    const { updater, controller, states, log } = fixture();
    await controller.check(true);
    updater.downloadUpdate.mockImplementationOnce(async () => {
      const error = new Error("secret response body");
      updater.emit("error", error);
      updater.emit("download-progress", { percent: 50 });
      throw error;
    });
    await controller.download();
    expect(states.filter((state) => state.status === "error")).toHaveLength(1);
    expect(
      log.mock.calls.filter(([event]) => event === "download-failed"),
    ).toHaveLength(1);
    expect(controller.getState()).toMatchObject({
      status: "error",
      stage: "download",
      retryable: true,
      version: "0.3.0-beta.4",
    });
    expect(JSON.stringify(states)).not.toContain("secret");
    const failedId = controller.getState().notificationId;
    await controller.check();
    await controller.retry();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({
      status: "downloaded",
      version: "0.3.0-beta.4",
    });
    expect(controller.getState().notificationId).not.toBe(failedId);
  });

  it("dismissed errors stop automatic checks for the session but allow manual retry", async () => {
    const { updater, controller } = fixture();
    updater.checkForUpdates.mockRejectedValueOnce(new Error("private"));
    await controller.check();
    controller.dismiss();
    expect(controller.getState()).toMatchObject({ notificationHidden: true });
    await controller.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit("update-not-available");
    });
    await controller.retry();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({
      status: "upToDate",
      notificationHidden: false,
    });
    // Session suppression remains after manual success.
    await controller.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("skipped versions hide both notifications, with manual override and immediate preference freshness", async () => {
    const { updater, controller, notify, states } = fixture({
      automaticChecks: true,
      skippedVersion: "0.3.0-beta.4",
    });
    await controller.check();
    expect(controller.getState()).toMatchObject({
      status: "available",
      notificationHidden: true,
    });
    expect(notify).not.toHaveBeenCalled();
    await controller.check(true);
    expect(controller.getState()).toMatchObject({ notificationHidden: false });
    expect(notify).toHaveBeenCalledTimes(1);
    controller.setPreferences({ skippedVersion: "0.3.0-beta.4" });
    expect(states.at(-1)).toMatchObject({ notificationHidden: true });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("respects disabled automatic checking and preserves explicit-only install", async () => {
    const { updater, controller, prepareInstall } = fixture({
      automaticChecks: false,
    });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    await controller.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await controller.check(true);
    await controller.download();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await controller.install();
    expect(prepareInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("keeps a dismissed download hidden after completion and hides a skipped downloaded version", async () => {
    const { updater, controller } = fixture();
    await controller.check(true);
    updater.downloadUpdate.mockImplementationOnce(async () => {
      controller.dismiss();
      updater.emit("download-progress", { percent: 50 });
      expect(controller.getState().notificationHidden).toBe(true);
      updater.emit("update-downloaded", { version: "0.3.0-beta.4" });
    });
    await controller.download();
    expect(controller.getState()).toMatchObject({
      status: "downloaded",
      notificationHidden: true,
    });

    const other = fixture();
    await other.controller.check(true);
    await other.controller.download();
    other.controller.setPreferences({ skippedVersion: "0.3.0-beta.4" });
    expect(other.controller.getState().notificationHidden).toBe(true);
    expect(other.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("continues checking for future versions without re-notifying a dismissed or skipped version", async () => {
    const { updater, controller, notify } = fixture();
    await controller.check();
    controller.dismiss();
    await controller.check();
    expect(controller.getState().notificationHidden).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    controller.setPreferences({ skippedVersion: "0.3.0-beta.4" });
    await controller.check();
    expect(controller.getState().notificationHidden).toBe(true);
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit("update-available", { version: "0.3.0-beta.5" });
    });
    await controller.check();
    expect(controller.getState()).toMatchObject({
      version: "0.3.0-beta.5",
      notificationHidden: false,
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
