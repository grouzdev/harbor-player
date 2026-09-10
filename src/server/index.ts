import { createApp } from "./app.js";
import { dataDirectory } from "./config.js";
import open from "open";

const port = Number(process.env.MYMUSICLIB_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Недопустимый порт");
const { app, service } = await createApp({
  dataDir: dataDirectory(),
  port,
  dev: process.env.MYMUSICLIB_DEV === "1",
  logger: true,
});
try {
  await app.listen({ port, host: "127.0.0.1" });
  const url = `http://127.0.0.1:${port}`;
  console.log(`MyMusicLib: ${url}\nКаталог данных: ${service.dataDir}`);
  if (!process.argv.includes("--no-open") && !process.env.MYMUSICLIB_NO_OPEN)
    await open(url);
  for (const library of service.catalog.libraries()) service.scan(library.id);
  const timer = setInterval(
    () => {
      for (const library of service.catalog.libraries())
        service.scan(library.id);
    },
    5 * 60 * 1000,
  );
  const shutdown = async () => {
    clearInterval(timer);
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (e) {
  console.error(e);
  await app.close();
  process.exitCode = 1;
}
