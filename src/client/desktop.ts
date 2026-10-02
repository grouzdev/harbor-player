import type { UpdateState } from "../shared/desktop-contract";

export interface DesktopBridge {
  getAppInfo(): Promise<{ version: string; commit: string; portable: boolean }>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  chooseImageFile(): Promise<string | null>;
  chooseLibraryDirectory(): Promise<string | null>;
  choosePlaylistFile(): Promise<string | null>;
  choosePlaylistDirectory(): Promise<string | null>;
  choosePlaylistExportFile(
    name: string,
    format: "m3u8" | "xspf",
  ): Promise<string | null>;
  saveCover(
    defaultDirectory: string,
    mime: "image/jpeg" | "image/png",
    data: Uint8Array,
  ): Promise<boolean>;
  reportClientReady(): Promise<void>;
  subscribeUpdateState(listener: (state: UpdateState) => void): () => void;
  getWindowFullscreen(): Promise<boolean>;
  toggleWindowFullscreen(): Promise<boolean>;
  subscribeWindowFullscreen(
    listener: (fullscreen: boolean) => void,
  ): () => void;
}

declare global {
  interface Window {
    harborPlayerDesktop?: DesktopBridge;
  }
}

export {};
