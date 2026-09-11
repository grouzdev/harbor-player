import { spawn } from "node:child_process";

export interface ExplorerTarget {
  directory: string;
  selectFile?: string;
}

export type ExplorerLauncher = (target: ExplorerTarget) => Promise<void>;

export function explorerArgs(target: ExplorerTarget): string[] {
  return target.selectFile
    ? ["/select,", target.selectFile]
    : [target.directory];
}

export function explorerCommand(target: ExplorerTarget) {
  return {
    command: "explorer.exe",
    args: explorerArgs(target),
    options: { stdio: "ignore" as const },
  };
}

export const openInExplorer: ExplorerLauncher = (target) =>
  new Promise((resolve, reject) => {
    if (process.platform !== "win32")
      return reject(
        new Error("Открытие в Проводнике доступно только в Windows"),
      );
    const { command, args, options } = explorerCommand(target);
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("spawn", resolve);
  });
