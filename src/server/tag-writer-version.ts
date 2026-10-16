import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

/** Match the writer Node actually loads, including ancestor node_modules. */
export async function installedTagWriterVersion(): Promise<string> {
  const file = createRequire(import.meta.url).resolve(
    "@digimezzo/node-taglib-sharp/package.json",
  );
  const { version } = JSON.parse(await readFile(file, "utf8"));
  if (typeof version !== "string" || !version)
    throw new Error("Не удалось определить версию библиотеки записи тегов");
  return version;
}
