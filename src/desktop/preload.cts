const { contextBridge, ipcRenderer } =
  require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("myMusicLibDesktop", {
  getAppInfo: () =>
    ipcRenderer.invoke("desktop:get-app-info") as Promise<{
      version: string;
      portable: boolean;
    }>,
});
