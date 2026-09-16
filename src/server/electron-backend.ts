import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { dataDirectory, errorMessage } from "./config.js";
import type { TagWriter } from "./isolated-tag-writer.js";
import { startLocalServer, type LocalServerHandle } from "./local-server.js";
import type {
  BackendToMainMessage,
  MainToBackendMessage,
} from "../shared/desktop-contract.js";
import type { TagPatch } from "../shared/contracts.js";

interface UtilityParentPort {
  on(
    event: "message",
    listener: (event: { data: MainToBackendMessage }) => void,
  ): void;
  postMessage(message: BackendToMainMessage): void;
}

const detectedParentPort = (
  process as NodeJS.Process & { parentPort?: UtilityParentPort }
).parentPort;
if (!detectedParentPort)
  throw new Error("Electron backend запущен без parentPort");
const parentPort: UtilityParentPort = detectedParentPort;

const pendingWrites = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void }
>();
let server: LocalServerHandle | undefined;
let stopPromise: Promise<void> | undefined;

const electronTagWriter: TagWriter = {
  write(file: string, patch: TagPatch) {
    return new Promise<void>((resolve, reject) => {
      const requestId = randomUUID();
      pendingWrites.set(requestId, { resolve, reject });
      parentPort.postMessage({ type: "tag-write", requestId, file, patch });
    });
  },
};

async function stop(exitCode = 0) {
  if (!stopPromise)
    stopPromise = (async () => {
      await server?.stop();
      for (const pending of pendingWrites.values())
        pending.reject(new Error("Сервис останавливается"));
      pendingWrites.clear();
      parentPort.postMessage({ type: "stopped" });
      setImmediate(() => process.exit(exitCode));
    })();
  return stopPromise;
}

parentPort.on("message", (event) => {
  const message = event.data;
  if (message.type === "stop") {
    void stop();
    return;
  }
  if (message.type === "tag-write-result") {
    const pending = pendingWrites.get(message.requestId);
    if (!pending) return;
    pendingWrites.delete(message.requestId);
    if (message.ok) pending.resolve();
    else pending.reject(new Error(message.error || "Сбой обработчика тегов"));
  }
});

try {
  if (process.env.MYMUSICLIB_SMOKE === "1")
    await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  const port = Number(process.env.MYMUSICLIB_PORT || 4317);
  server = await startLocalServer({
    dataDir: dataDirectory(),
    port,
    logger: process.env.MYMUSICLIB_SMOKE !== "1",
    openBrowser: false,
    tagWriter: electronTagWriter,
  });
  parentPort.postMessage({ type: "ready", url: server.url });
} catch (error) {
  parentPort.postMessage({ type: "fatal", error: errorMessage(error) });
  await stop(1).catch(() => process.exit(1));
}
