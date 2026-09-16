import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { TagPatch } from "../shared/contracts.js";

export interface TagWriter {
  write(file: string, patch: TagPatch): Promise<void>;
}

export async function writeTagsIsolated(
  file: string,
  patch: TagPatch,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = fork(
      fileURLToPath(new URL("./tag-child.js", import.meta.url)),
      [],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let result: { ok: boolean; error?: string } | undefined;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.once("error", fail);
    child.on("message", (message: { ok?: boolean; error?: string }) => {
      result = { ok: message.ok === true, error: message.error };
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      if (result?.ok && code === 0) resolve();
      else
        reject(
          new Error(
            result?.error ||
              `Сбой обработчика тегов${signal ? ` (${signal})` : ""}`,
          ),
        );
    });
    child.send({ file, patch }, (error) => {
      if (error) fail(error);
    });
  });
}

export const forkedTagWriter: TagWriter = {
  write: writeTagsIsolated,
};
