const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("harborPlayerDesktop", {
  getAppInfo: () =>
    ipcRenderer.invoke("desktop:get-app-info") as Promise<{
      version: string;
      commit: string;
      portable: boolean;
    }>,
  getUpdateState: () =>
    ipcRenderer.invoke("desktop:get-update-state") as Promise<
      import("../shared/desktop-contract.js").UpdateState
    >,
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  retryUpdate: () => ipcRenderer.invoke("desktop:retry-update"),
  dismissUpdate: () => ipcRenderer.invoke("desktop:dismiss-update"),
  openUpdateLog: () => ipcRenderer.invoke("desktop:open-update-log"),
  getUpdatePreferences: () =>
    ipcRenderer.invoke("desktop:get-update-preferences") as Promise<
      import("../shared/desktop-contract.js").UpdatePreferences
    >,
  setUpdatePreferences: (
    preferences: Partial<
      import("../shared/desktop-contract.js").UpdatePreferences
    >,
  ) =>
    ipcRenderer.invoke(
      "desktop:set-update-preferences",
      preferences,
    ) as Promise<import("../shared/desktop-contract.js").UpdatePreferences>,
  chooseImageFile: () =>
    ipcRenderer.invoke("desktop:choose-image-file") as Promise<string | null>,
  chooseLibraryDirectory: () =>
    ipcRenderer.invoke("desktop:choose-library-directory") as Promise<
      string | null
    >,
  choosePlaylistFile: () =>
    ipcRenderer.invoke("desktop:choose-playlist-file") as Promise<
      string | null
    >,
  choosePlaylistDirectory: () =>
    ipcRenderer.invoke("desktop:choose-playlist-directory") as Promise<
      string | null
    >,
  choosePlaylistExportFile: (name: string, format: "m3u8" | "xspf") =>
    ipcRenderer.invoke(
      "desktop:choose-playlist-export-file",
      name,
      format,
    ) as Promise<string | null>,
  saveCover: (
    defaultDirectory: string,
    mime: "image/jpeg" | "image/png",
    data: Uint8Array,
  ) =>
    ipcRenderer.invoke(
      "desktop:save-cover",
      defaultDirectory,
      mime,
      data,
    ) as Promise<boolean>,
  reportClientReady: () => ipcRenderer.invoke("desktop:report-client-ready"),
  getWindowFullscreen: () =>
    ipcRenderer.invoke("desktop:get-window-fullscreen") as Promise<boolean>,
  toggleWindowFullscreen: () =>
    ipcRenderer.invoke("desktop:toggle-window-fullscreen") as Promise<boolean>,
  subscribeWindowFullscreen: (listener: (fullscreen: boolean) => void) => {
    const receive = (_event: unknown, fullscreen: boolean) =>
      listener(fullscreen);
    ipcRenderer.on("desktop:window-fullscreen", receive);
    return () =>
      ipcRenderer.removeListener("desktop:window-fullscreen", receive);
  },
  subscribeUpdateState: (
    listener: (
      state: import("../shared/desktop-contract.js").UpdateState,
    ) => void,
  ) => {
    const receive = (
      _event: unknown,
      state: import("../shared/desktop-contract.js").UpdateState,
    ) => listener(state);
    ipcRenderer.on("desktop:update-state", receive);
    return () => ipcRenderer.removeListener("desktop:update-state", receive);
  },
});
