import { parentPort } from "node:worker_threads";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readTrack, writeTags } from "./metadata.js";
import { errorMessage } from "./config.js";

parentPort!.on("message", async ({ id, task, args }) => {
  try {
    let result: unknown;
    if (task === "read")
      result = await readTrack(
        args.file,
        args.libraryId,
        args.root,
        args.id,
        args.dataDir,
      );
    else if (task === "tags") result = await writeTags(args.file, args.patch);
    else if (task === "hash") {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(args.file)) hash.update(chunk);
      result = hash.digest("hex");
    } else throw new Error("Неизвестная задача");
    parentPort!.postMessage({ id, result });
  } catch (e) {
    parentPort!.postMessage({ id, error: errorMessage(e) });
  }
});
