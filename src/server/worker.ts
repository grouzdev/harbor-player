import { parentPort } from "node:worker_threads";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readTrack } from "./metadata.js";
import { errorMessage } from "./config.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";
import type { Track } from "../shared/contracts.js";

parentPort!.on("message", async (request: WorkerRequest) => {
  const { id, task, args } = request;
  try {
    let result: Track | string;
    if (task === "read")
      result = await readTrack(
        args.file,
        args.libraryId,
        args.root,
        args.id,
        args.dataDir,
      );
    else if (task === "hash") {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(args.file)) hash.update(chunk);
      result = hash.digest("hex");
    } else throw new Error("Неизвестная задача");
    parentPort!.postMessage({ id, result } satisfies WorkerResponse);
  } catch (e) {
    parentPort!.postMessage({
      id,
      error: errorMessage(e),
    } satisfies WorkerResponse);
  }
});
