import { errorMessage } from "./config.js";
import { writeTags } from "./tag-writer.js";
import type { TagPatch } from "../shared/contracts.js";

process.once("message", async (message: { file: string; patch: TagPatch }) => {
  try {
    await writeTags(message.file, message.patch);
    process.send?.({ ok: true }, () => process.disconnect());
  } catch (error) {
    process.send?.({ ok: false, error: errorMessage(error) }, () =>
      process.disconnect(),
    );
  }
});
