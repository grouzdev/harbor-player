import type { UpdateState } from "../shared/desktop-contract";

export interface DesktopBridge {
  getAppInfo(): Promise<{ version: string; portable: boolean }>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  chooseImageFile(): Promise<string | null>;
  subscribeUpdateState(listener: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    myMusicLibDesktop?: DesktopBridge;
  }
}

export {};
