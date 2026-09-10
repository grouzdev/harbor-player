import { mkdir, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import { createApp } from "../dist/server/app.js";
const root = path.resolve(".test-data/browser");
if (!root.startsWith(path.resolve(".test-data") + path.sep))
  throw new Error("Unsafe test path");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
for (const browser of ["chrome", "edge"]) {
  const source = path.join(root, browser, "Downloads");
  const target = path.join(root, browser, "Collection");
  await mkdir(path.join(source, "Album"), { recursive: true });
  await mkdir(target, { recursive: true });
  for (const format of ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"])
    await copyFile(
      path.resolve(".fixtures", `sample.${format}`),
      path.join(source, "Album", `sample.${format}`),
    );
  await copyFile(
    path.resolve(".fixtures/cover.png"),
    path.join(source, "Album", "cover.png"),
  );
}
const { app } = await createApp({
  dataDir: path.join(root, "data"),
  port: 4327,
});
await app.listen({ host: "127.0.0.1", port: 4327 });
const close = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
