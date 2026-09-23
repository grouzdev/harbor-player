const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("harborPlayerDesktop", {
  getAppInfo: () =>
    ipcRenderer.invoke("desktop:get-app-info") as Promise<{
      version: string;
      portable: boolean;
    }>,
  getUpdateState: () =>
    ipcRenderer.invoke("desktop:get-update-state") as Promise<
      import("../shared/desktop-contract.js").UpdateState
    >,
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("desktop:download-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  chooseImageFile: () =>
    ipcRenderer.invoke("desktop:choose-image-file") as Promise<string | null>,
  chooseLibraryDirectory: () =>
    ipcRenderer.invoke("desktop:choose-library-directory") as Promise<
      string | null
    >,
  reportClientReady: () => ipcRenderer.invoke("desktop:report-client-ready"),
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
