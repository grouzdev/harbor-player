import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  session,
  shell,
  Tray,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import electronUpdater from "electron-updater";
import { appName, dataDirectory } from "../shared/app-paths.js";
import type {
  BackendToMainMessage,
  MainToBackendMessage,
  MainToTagWriterMessage,
  TagWriterToMainMessage,
  UpdateState,
} from "../shared/desktop-contract.js";

const { autoUpdater } = electronUpdater;

const appId = "app.harborplayer.desktop";
const smokeFixture = process.argv
  .find((argument) => argument.startsWith("--smoke-test="))
  ?.slice("--smoke-test=".length);
const smokeReport = process.env.HARBOR_PLAYER_SMOKE_REPORT;
const startupBenchmarkReport =
  process.env.HARBOR_PLAYER_STARTUP_BENCHMARK_REPORT ||
  process.argv
    .find((argument) => argument.startsWith("--startup-benchmark="))
    ?.slice("--startup-benchmark=".length);
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
if (smokeFixture) {
  process.env.HARBOR_PLAYER_PORT = "0";
  process.env.HARBOR_PLAYER_SMOKE = "1";
}

const dataRoot = dataDirectory();
const electronData = path.join(dataRoot, "electron");
const sessionData = path.join(electronData, "session");
mkdirSync(sessionData, { recursive: true });
app.setPath("userData", electronData);
app.setPath("sessionData", sessionData);
app.setAppUserModelId(appId);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let backend: UtilityProcess | null = null;
let backendUrl = "";
let backendStopped = false;
let stoppingBackend: Promise<void> | undefined;
let resolveBackendStop: (() => void) | undefined;
let applicationExit: Promise<void> | undefined;
let isQuitting = false;
const tagProcesses = new Set<UtilityProcess>();
let updateState: UpdateState = isPortable
  ? { status: "unsupported" }
  : { status: "idle" };
let updateTimer: NodeJS.Timeout | undefined;
const startupStartedAt = process.hrtime.bigint();
let startupReadyToShowMs: number | undefined;
let startupBenchmarkReported = false;

function startupElapsedMs() {
  return Number(process.hrtime.bigint() - startupStartedAt) / 1_000_000;
}

async function reportStartupBenchmark() {
  if (!startupBenchmarkReport || startupBenchmarkReported) return;
  startupBenchmarkReported = true;
  if (startupReadyToShowMs === undefined)
    await new Promise<void>((resolve) =>
      mainWindow?.once("ready-to-show", () => resolve()),
    );
  await writeFile(
    startupBenchmarkReport,
    JSON.stringify({
      mainEntryToReadyToShowMs: startupReadyToShowMs,
      mainEntryToClientShellMs: startupElapsedMs(),
    }),
  );
  await quitApplication();
}

function publishUpdateState(state: UpdateState) {
  updateState = state;
  mainWindow?.webContents.send("desktop:update-state", state);
}

function updateError(error: unknown) {
  publishUpdateState({ status: "error", message: errorText(error) });
}

async function checkForUpdates(manual = false) {
  if (isPortable) {
    void shell.openExternal(
      "https://github.com/grouzdev/harbor-player/releases",
    );
    publishUpdateState({ status: "unsupported" });
    return;
  }
  try {
    publishUpdateState({ status: "checking" });
    await autoUpdater.checkForUpdates();
    if (manual && updateState.status === "checking")
      publishUpdateState({ status: "upToDate" });
  } catch (error) {
    updateError(error);
  }
}

async function downloadUpdate() {
  if (isPortable) return checkForUpdates(true);
  if (updateState.status !== "available") return;
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    updateError(error);
  }
}

async function installUpdate() {
  if (updateState.status !== "downloaded") return;
  publishUpdateState({
    status: "preparingInstall",
    version: updateState.version,
  });
  try {
    await quitApplication();
    autoUpdater.quitAndInstall(false, true);
  } catch (error) {
    updateError(error);
  }
}

function configureUpdates() {
  if (isPortable) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.channel = app.getVersion().includes("-beta.") ? "beta" : "latest";
  autoUpdater.on("checking-for-update", () =>
    publishUpdateState({ status: "checking" }),
  );
  autoUpdater.on("update-available", (info) => {
    publishUpdateState({ status: "available", version: info.version });
    void new Notification({
      title: appName,
      body: `Доступна версия ${info.version}`,
    }).show();
  });
  autoUpdater.on("update-not-available", () =>
    publishUpdateState({ status: "upToDate" }),
  );
  autoUpdater.on("download-progress", (progress) => {
    const version =
      updateState.status === "available" || updateState.status === "downloading"
        ? updateState.version
        : "";
    publishUpdateState({
      status: "downloading",
      version,
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on("update-downloaded", (info) =>
    publishUpdateState({ status: "downloaded", version: info.version }),
  );
  autoUpdater.on("error", updateError);
  setTimeout(() => void checkForUpdates(), 30_000).unref();
  updateTimer = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
  updateTimer.unref();
}

async function reportSmokeProgress(phase: string) {
  if (smokeReport)
    await writeFile(smokeReport, JSON.stringify({ ok: false, phase }));
}

function entryPath(file: string) {
  return path.join(app.getAppPath(), "dist", "server", file);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isAllowedLocalUrl(value: string) {
  if (!backendUrl) return false;
  try {
    const candidate = new URL(value);
    const expected = new URL(backendUrl);
    return (
      candidate.protocol === "http:" && candidate.origin === expected.origin
    );
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function sendToBackend(message: MainToBackendMessage) {
  if (backend && !backendStopped) backend.postMessage(message);
}

function runTagWriter(
  message: Extract<BackendToMainMessage, { type: "tag-write" }>,
) {
  const writer = utilityProcess.fork(entryPath("electron-tag-writer.js"), [], {
    env: process.env,
  });
  tagProcesses.add(writer);
  let settled = false;
  const finish = (result: TagWriterToMainMessage) => {
    if (settled) return;
    settled = true;
    sendToBackend(result);
  };
  writer.on("message", (result: TagWriterToMainMessage) => {
    if (result.type === "tag-write-result") finish(result);
  });
  writer.once("error", (error) => {
    finish({
      type: "tag-write-result",
      requestId: message.requestId,
      ok: false,
      error: errorText(error),
    });
  });
  writer.once("exit", (code) => {
    tagProcesses.delete(writer);
    if (!settled)
      finish({
        type: "tag-write-result",
        requestId: message.requestId,
        ok: false,
        error: `Обработчик тегов завершился с кодом ${code ?? "unknown"}`,
      });
  });
  const request: MainToTagWriterMessage = {
    type: "write-tags",
    requestId: message.requestId,
    file: message.file,
    patch: message.patch,
  };
  writer.postMessage(request);
}

function startBackend(): Promise<string> {
  return new Promise((resolve, reject) => {
    let ready = false;
    backend = utilityProcess.fork(entryPath("electron-backend.js"), [], {
      env: process.env,
    });
    backend.on("message", (message: BackendToMainMessage) => {
      if (message.type === "ready") {
        ready = true;
        backendUrl = message.url;
        resolve(message.url);
      } else if (message.type === "fatal") {
        if (!ready) reject(new Error(message.error));
        else if (!isQuitting)
          void failApplication(`Локальный сервис остановлен: ${message.error}`);
      } else if (message.type === "stopped") {
        backendStopped = true;
        resolveBackendStop?.();
      } else if (message.type === "tag-write") {
        runTagWriter(message);
      }
    });
    backend.once("error", (error) => {
      if (!ready) reject(error);
      else if (!isQuitting) void failApplication(errorText(error));
    });
    backend.once("exit", (code) => {
      backendStopped = true;
      resolveBackendStop?.();
      if (!ready)
        reject(
          new Error(`Локальный сервис завершился с кодом ${code ?? "unknown"}`),
        );
      else if (!isQuitting)
        void failApplication(
          `Локальный сервис неожиданно завершился с кодом ${code ?? "unknown"}`,
        );
    });
  });
}

function stopBackend() {
  if (backendStopped || !backend) return Promise.resolve();
  if (!stoppingBackend)
    stoppingBackend = new Promise<void>((resolve) => {
      resolveBackendStop = resolve;
      sendToBackend({ type: "stop" });
    });
  return stoppingBackend;
}

async function quitApplication(exitCode = 0) {
  if (!applicationExit)
    applicationExit = (async () => {
      isQuitting = true;
      if (updateTimer) clearInterval(updateTimer);
      await stopBackend();
      for (const writer of tagProcesses) writer.kill();
      tagProcesses.clear();
      tray?.destroy();
      tray = null;
      if (exitCode !== 0 || updateState.status !== "preparingInstall")
        app.exit(exitCode);
    })();
  await applicationExit;
}

async function failApplication(message: string) {
  if (!smokeFixture) dialog.showErrorBox(`${appName} не запущен`, message);
  if (smokeReport)
    await writeFile(smokeReport, JSON.stringify({ ok: false, error: message }));
  await quitApplication(1);
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    show: false,
    icon: path.join(app.getAppPath(), "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "desktop", "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!isAllowedLocalUrl(target)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isAllowedExternalUrl(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.once("ready-to-show", () => {
    startupReadyToShowMs = startupElapsedMs();
    mainWindow?.show();
  });
  void mainWindow.loadURL(url);
}

function createTray() {
  tray = new Tray(path.join(app.getAppPath(), "assets", "icon.ico"));
  tray.setToolTip(appName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Показать", click: showWindow },
      {
        label: "Открыть в браузере",
        click: () => {
          if (isAllowedLocalUrl(backendUrl))
            void shell.openExternal(backendUrl);
        },
      },
      { type: "separator" },
      {
        label: "Проверить обновления",
        click: () => void checkForUpdates(true),
      },
      { type: "separator" },
      { label: "Выход", click: () => void quitApplication() },
    ]),
  );
  tray.on("double-click", showWindow);
}

async function waitFor<T>(read: () => Promise<T | undefined>, label: string) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Истекло время ожидания: ${label}`);
}

async function runSmoke(url: string, fixture: string) {
  await reportSmokeProgress("client");
  const home = await fetch(url);
  if (!home.ok || !(await home.text()).includes('<div id="root"></div>'))
    throw new Error("Packaged client не загрузился");
  const sessionResponse = await fetch(`${url}/api/session`);
  if (!sessionResponse.ok) throw new Error("Не удалось создать API session");
  const sessionBody = (await sessionResponse.json()) as { csrf: string };
  const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("API session не вернул cookie");
  const request = async <T>(
    endpoint: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const response = await fetch(`${url}${endpoint}`, {
      method: options.method,
      headers: {
        cookie,
        ...(options.body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "x-csrf-token": sessionBody.csrf,
            }),
        ...options.headers,
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok)
      throw new Error(
        `${endpoint}: ${response.status} ${await response.text()}`,
      );
    return (await response.json()) as T;
  };
  const libraryDirectory = path.dirname(fixture);
  await reportSmokeProgress("scan");
  const added = await request<{ job: { id: string } }>("/api/libraries", {
    method: "POST",
    body: { name: "Packaged smoke", path: libraryDirectory },
  });
  await waitFor(async () => {
    const jobs =
      await request<{ id: string; status: string; errors: string[] }[]>(
        "/api/jobs",
      );
    const job = jobs.find((candidate) => candidate.id === added.job.id);
    if (!job || ["queued", "running"].includes(job.status)) return undefined;
    if (job.status !== "done")
      throw new Error(`Packaged scan failed: ${job.errors.join("; ")}`);
    return job;
  }, "packaged scan");
  const filter = {
    libraryIds: [],
    folders: [],
    genres: [],
    artists: [],
    albumIds: [],
    search: "",
    bookmarksOnly: false,
  };
  const tracks = await request<{
    items: { id: string; title: string }[];
  }>(`/api/tracks?${new URLSearchParams({ filter: JSON.stringify(filter) })}`);
  const track = tracks.items[0];
  if (!track) throw new Error("Packaged scan не нашёл тестовый трек");
  const audio = await fetch(`${url}/api/audio/${track.id}`, {
    headers: { cookie, range: "bytes=0-31" },
  });
  if (audio.status !== 206 || (await audio.arrayBuffer()).byteLength !== 32)
    throw new Error("Packaged HTTP Range не прошёл");
  await reportSmokeProgress("tag-write");
  const preview = await request<{ id: string }>("/api/operations/preview", {
    method: "POST",
    body: {
      kind: "tags",
      selection: { trackIds: [track.id] },
      patch: { title: "Packaged smoke title", genres: ["Smoke"] },
    },
  });
  await request(`/api/operations/${preview.id}/execute`, {
    method: "POST",
    body: {},
  });
  await waitFor(async () => {
    const operation = await request<{
      status: string;
      items: { phase: string; error?: string }[];
    }>(`/api/operations/${preview.id}`);
    if (operation.status === "running") return undefined;
    const failure = operation.items.find((item) => item.error);
    if (operation.status !== "done" || failure)
      throw new Error(
        `Packaged tag write failed: ${failure?.error || operation.status}`,
      );
    return operation;
  }, "packaged tag write");
  const updated = await request<{ title: string }>(`/api/tracks/${track.id}`);
  if (updated.title !== "Packaged smoke title")
    throw new Error("Packaged catalog не обновился после записи тегов");
}

const gotLock = app.requestSingleInstanceLock();
async function bootstrap() {
  try {
    await app.whenReady();
    await reportSmokeProgress("app-ready");
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    await reportSmokeProgress("backend-starting");
    const url = await startBackend();
    await reportSmokeProgress("backend-ready");
    if (smokeFixture) {
      await runSmoke(url, path.resolve(smokeFixture));
      if (smokeReport)
        await writeFile(
          smokeReport,
          JSON.stringify({ ok: true, url, portable: isPortable }),
        );
      await quitApplication();
    } else {
      ipcMain.handle("desktop:get-app-info", (event) => {
        if (
          !mainWindow ||
          event.sender !== mainWindow.webContents ||
          !isAllowedLocalUrl(event.senderFrame?.url || "")
        )
          throw new Error("Недопустимый IPC sender");
        return { version: app.getVersion(), portable: isPortable };
      });
      const requireDesktopSender = (event: Electron.IpcMainInvokeEvent) => {
        if (
          !mainWindow ||
          event.sender !== mainWindow.webContents ||
          !isAllowedLocalUrl(event.senderFrame?.url || "")
        )
          throw new Error("Недопустимый IPC sender");
      };
      ipcMain.handle("desktop:get-update-state", (event) => {
        requireDesktopSender(event);
        return updateState;
      });
      ipcMain.handle("desktop:check-for-updates", (event) => {
        requireDesktopSender(event);
        return checkForUpdates(true);
      });
      ipcMain.handle("desktop:download-update", (event) => {
        requireDesktopSender(event);
        return downloadUpdate();
      });
      ipcMain.handle("desktop:install-update", (event) => {
        requireDesktopSender(event);
        return installUpdate();
      });
      ipcMain.handle("desktop:choose-image-file", async (event) => {
        requireDesktopSender(event);
        const result = await dialog.showOpenDialog(mainWindow!, {
          title: "Выберите фоновое изображение",
          properties: ["openFile"],
          filters: [
            { name: "Изображения", extensions: ["jpg", "jpeg", "png", "webp"] },
          ],
        });
        return result.canceled ? null : result.filePaths[0] || null;
      });
      ipcMain.handle("desktop:report-client-ready", async (event) => {
        requireDesktopSender(event);
        await reportStartupBenchmark();
      });
      if (!startupBenchmarkReport) configureUpdates();
      createWindow(url);
      if (!startupBenchmarkReport) createTray();
    }
  } catch (error) {
    await failApplication(errorText(error));
  }
}

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("before-quit", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    void quitApplication();
  });
  app.on("window-all-closed", () => {});
  app.on("activate", showWindow);
  void bootstrap();
}
