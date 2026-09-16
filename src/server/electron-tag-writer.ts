import { errorMessage } from "./config.js";
import { writeTags } from "./tag-writer.js";
import type {
  MainToTagWriterMessage,
  TagWriterToMainMessage,
} from "../shared/desktop-contract.js";

interface UtilityParentPort {
  once(
    event: "message",
    listener: (event: { data: MainToTagWriterMessage }) => void,
  ): void;
  postMessage(message: TagWriterToMainMessage): void;
}

const detectedParentPort = (
  process as NodeJS.Process & { parentPort?: UtilityParentPort }
).parentPort;
if (!detectedParentPort) throw new Error("Tag writer запущен без parentPort");
const parentPort: UtilityParentPort = detectedParentPort;

parentPort.once("message", async (event) => {
  const message = event.data;
  if (message.type !== "write-tags") return;
  let result: TagWriterToMainMessage;
  try {
    await writeTags(message.file, message.patch);
    result = {
      type: "tag-write-result",
      requestId: message.requestId,
      ok: true,
    };
  } catch (error) {
    result = {
      type: "tag-write-result",
      requestId: message.requestId,
      ok: false,
      error: errorMessage(error),
    };
  }
  parentPort.postMessage(result);
  setImmediate(() => process.exit(result.ok ? 0 : 1));
});
