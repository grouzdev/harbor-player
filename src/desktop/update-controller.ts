import type {
  UpdatePreferences,
  UpdateStage,
  UpdateState,
} from "../shared/desktop-contract.js";

export interface UpdateDriver {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  channel: string | null;
  logger: unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  on(
    event: "update-available" | "update-downloaded",
    listener: (info: { version: string }) => void,
  ): unknown;
  on(
    event: "download-progress",
    listener: (progress: { percent: number }) => void,
  ): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent: boolean, forceRun: boolean): void;
}

type Operation = {
  id: number;
  stage: UpdateStage;
  manual: boolean;
  version?: string;
  failed: boolean;
};

export function createUpdateController(options: {
  updater: UpdateDriver;
  portable: boolean;
  beta: boolean;
  preferences: {
    get(): UpdatePreferences;
    set(patch: unknown): UpdatePreferences;
  };
  log(event: string, id: number, error?: unknown, version?: string): void;
  publish(state: UpdateState): void;
  notify(version: string): void;
  openReleases(): void;
  prepareInstall(): Promise<void>;
}) {
  const { updater } = options;
  let state: UpdateState = {
    status: options.portable ? "unsupported" : "idle",
  };
  let operation: Operation | undefined;
  let sequence = 0;
  let automaticChecksDismissed = false;
  let dismissedVersion: string | undefined;
  let notifiedVersion: string | undefined;

  function publish(next: UpdateState) {
    state = {
      ...next,
      notificationId: next.notificationId ?? String(operation?.id ?? sequence),
      notificationHidden: next.notificationHidden ?? false,
    };
    options.publish(state);
  }

  function fail(error: unknown) {
    // electron-updater emits an error and then rejects the same promise.
    // The operation remains locked until that promise settles.
    if (!operation || operation.failed) return;
    operation.failed = true;
    const { stage, version, id } = operation;
    options.log(`${stage}-failed`, id, error, version);
    publish({
      status: "error",
      message:
        stage === "download"
          ? "Не удалось скачать обновление. Повторите попытку."
          : stage === "install"
            ? "Не удалось установить обновление."
            : "Не удалось проверить обновления. Повторите попытку.",
      stage,
      version,
      retryable: stage !== "install",
      notificationHidden: state.notificationHidden,
    });
  }

  async function run(
    stage: UpdateStage,
    manual: boolean,
    version: string | undefined,
    action: () => Promise<unknown>,
  ) {
    const current: Operation = {
      id: ++sequence,
      stage,
      manual,
      version,
      failed: false,
    };
    operation = current;
    options.log(`${stage}-start`, current.id, undefined, version);
    try {
      await action();
    } catch (error) {
      fail(error);
    } finally {
      options.log(`${stage}-settled`, current.id, undefined, version);
      if (operation === current) operation = undefined;
    }
  }

  async function check(manual = false) {
    if (options.portable) {
      if (manual) options.openReleases();
      publish({ status: "unsupported" });
      return;
    }
    if (
      operation ||
      state.status === "downloaded" ||
      state.status === "preparingInstall"
    )
      return;
    if (
      !manual &&
      (!options.preferences.get().automaticChecks ||
        automaticChecksDismissed ||
        state.status === "error")
    )
      return;
    await run("check", manual, undefined, async () => {
      publish({ status: "checking" });
      await updater.checkForUpdates();
      if (state.status === "checking") publish({ status: "upToDate" });
    });
  }

  async function download() {
    if (options.portable) return check(true);
    if (operation) return;
    if (
      state.status !== "available" &&
      !(state.status === "error" && state.stage === "download" && state.version)
    )
      return;
    const version = state.version!;
    await run("download", true, version, async () => {
      publish({ status: "downloading", version, percent: 0 });
      await updater.downloadUpdate();
    });
  }

  async function install() {
    if (operation || state.status !== "downloaded") return;
    const version = state.version;
    await run("install", true, version, async () => {
      publish({ status: "preparingInstall", version });
      await options.prepareInstall();
      updater.quitAndInstall(false, true);
    });
  }

  if (!options.portable) {
    // Default library logging includes private URLs and arbitrary error text.
    updater.logger = null;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.channel = options.beta ? "beta" : "latest";
    updater.allowPrerelease = options.beta;
    // Setting channel enables downgrades in electron-updater 6.8.9.
    updater.allowDowngrade = false;
    updater.on("error", fail);
    updater.on("update-available", ({ version }) => {
      if (
        operation?.stage !== "check" ||
        operation.failed ||
        state.status === "available"
      )
        return;
      const hidden =
        !operation.manual &&
        (options.preferences.get().skippedVersion === version ||
          dismissedVersion === version);
      publish({ status: "available", version, notificationHidden: hidden });
      options.log("update-available", operation.id, undefined, version);
      if (!hidden && (operation.manual || notifiedVersion !== version)) {
        options.notify(version);
        notifiedVersion = version;
      }
    });
    updater.on("update-not-available", () => {
      if (operation?.stage === "check" && !operation.failed)
        publish({ status: "upToDate" });
    });
    updater.on("download-progress", ({ percent }) => {
      if (operation?.stage !== "download" || operation.failed) return;
      publish({
        status: "downloading",
        version: operation.version!,
        percent: Number.isFinite(percent)
          ? Math.max(0, Math.min(100, Math.round(percent)))
          : 0,
        notificationHidden: state.notificationHidden,
      });
    });
    updater.on("update-downloaded", ({ version }) => {
      if (operation?.stage !== "download" || operation.failed) return;
      publish({
        status: "downloaded",
        version,
        notificationHidden: state.notificationHidden,
      });
      options.log("download-complete", operation.id, undefined, version);
    });
  }

  return {
    getState: () => state,
    check,
    download,
    install,
    async retry() {
      if (state.status !== "error" || !state.retryable) return;
      if (state.stage === "download") await download();
      else await check(true);
    },
    dismiss() {
      if (state.status === "error") automaticChecksDismissed = true;
      if ("version" in state) dismissedVersion = state.version;
      publish({ ...state, notificationHidden: true });
    },
    setPreferences(patch: unknown) {
      try {
        const preferences = options.preferences.set(patch);
        if (
          (state.status === "available" || state.status === "downloaded") &&
          preferences.skippedVersion === state.version
        )
          publish({ ...state, notificationHidden: true });
        return preferences;
      } catch (error) {
        options.log("preferences-failed", sequence, error);
        throw new Error("Не удалось сохранить настройки обновлений.");
      }
    },
  };
}
