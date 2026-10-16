import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// This is the exact namespace emitted by PulseStore.copyCover, not a glob.
const ownedStaging =
  /^\.pulse-[a-f0-9]{64}\.(?:jpg|png)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/;

async function retry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt === 3 ||
        !["EPERM", "EBUSY", "EACCES"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      await delay(20 * 2 ** attempt);
    }
  }
}

/**
 * Startup only: caller must hold the data-directory lifetime ownership lock,
 * before exposing APIs or starting copies. No recursive removal or link traversal.
 * Unknown entries are preserved; persistent I/O errors fail initialization.
 */
export async function recoverPulseStaging(dataDir: string): Promise<void> {
  const directory = path.join(dataDir, "pulse-covers");
  let preserved = 0;
  try {
    const root = await retry(() => lstat(directory));
    if (!root.isDirectory() || root.isSymbolicLink()) {
      console.warn(
        "Pulse staging recovery skipped unsafe directory",
        directory,
      );
      return;
    }
    for (const name of await retry(() => readdir(directory))) {
      if (!ownedStaging.test(name)) continue;
      const staging = path.join(directory, name);
      try {
        const info = await retry(() => lstat(staging));
        if (!info.isDirectory() || info.isSymbolicLink()) {
          preserved++;
          continue;
        }
        const contents = await retry(() => readdir(staging));
        if (
          contents.length > 1 ||
          (contents.length === 1 && contents[0] !== "image")
        ) {
          preserved++;
          continue;
        }
        if (contents.length === 1) {
          const image = path.join(staging, "image");
          const file = await retry(() => lstat(image));
          // A hard-linked image is ambiguous too.
          if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) {
            preserved++;
            continue;
          }
          await retry(() => unlink(image));
        }
        await retry(() => rmdir(staging));
      } catch (error) {
        throw new Error(`Pulse staging recovery failed for ${staging}`, {
          cause: error,
        });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  } finally {
    if (preserved)
      console.warn(
        `Pulse staging recovery preserved ${preserved} ambiguous entries`,
        directory,
      );
  }
}
