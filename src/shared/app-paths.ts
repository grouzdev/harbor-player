import { existsSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const appName = "Harbor Player";
export const legacyAppName = "MyMusicLib";

function platformDataBase(): string {
  return process.platform === "win32"
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
    : process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
}

export function migrateLegacyDataDirectory(
  target: string,
  legacy: string,
): void {
  if (existsSync(target) || !existsSync(legacy)) return;
  try {
    renameSync(legacy, target);
  } catch (cause) {
    const detail = cause instanceof Error ? ` ${cause.message}` : "";
    throw new Error(
      `Не удалось перенести данные ${legacyAppName} в ${appName}. Закройте ${legacyAppName} и повторите запуск.${detail}`,
    );
  }
}

export function dataDirectory(): string {
  if (process.env.HARBOR_PLAYER_DATA_DIR)
    return path.resolve(process.env.HARBOR_PLAYER_DATA_DIR);
  const base = platformDataBase();
  const target = path.join(base, appName);
  migrateLegacyDataDirectory(target, path.join(base, legacyAppName));
  return target;
}
