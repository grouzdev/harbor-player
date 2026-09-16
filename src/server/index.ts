import { dataDirectory } from "./config.js";
import { startLocalServer } from "./local-server.js";

const port = Number(process.env.MYMUSICLIB_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Недопустимый порт");
try {
  const server = await startLocalServer({
    dataDir: dataDirectory(),
    port,
    dev: process.env.MYMUSICLIB_DEV === "1",
    logger: true,
    openBrowser:
      !process.argv.includes("--no-open") && !process.env.MYMUSICLIB_NO_OPEN,
  });
  console.log(
    `MyMusicLib: ${server.url}\nКаталог данных: ${server.service.dataDir}`,
  );
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.stop();
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
