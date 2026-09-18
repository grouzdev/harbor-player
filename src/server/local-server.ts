import open from "open";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import type { TagWriter } from "./isolated-tag-writer.js";
import type { MusicBrainzOptions } from "./musicbrainz.js";

export interface LocalServerOptions {
  dataDir: string;
  port?: number;
  dev?: boolean;
  logger?: boolean;
  openBrowser?: boolean;
  tagWriter?: TagWriter;
  musicBrainz?: MusicBrainzOptions;
}

export interface LocalServerHandle {
  url: string;
  service: Awaited<ReturnType<typeof createApp>>["service"];
  stop(): Promise<void>;
}

function validatePort(port: number) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Недопустимый порт");
  if (port !== 0 && port < 1024) throw new Error("Недопустимый порт");
}

export async function startLocalServer(
  options: LocalServerOptions,
): Promise<LocalServerHandle> {
  const port = options.port ?? 4317;
  validatePort(port);
  const context = await createApp({
    dataDir: options.dataDir,
    port,
    dev: options.dev,
    logger: options.logger,
    tagWriter: options.tagWriter,
    musicBrainz: options.musicBrainz,
  });
  let stopping: Promise<void> | undefined;
  try {
    await context.app.listen({ port, host: "127.0.0.1" });
    const address = context.app.server.address() as AddressInfo;
    context.allowLocalPort(address.port);
    const url = `http://127.0.0.1:${address.port}`;
    if (options.openBrowser) await open(url);
    await context.scanScheduler.start();
    return {
      url,
      service: context.service,
      stop() {
        if (!stopping)
          stopping = (async () => {
            context.service.beginShutdown();
            context.scanScheduler.stop();
            await context.app.close();
          })();
        return stopping;
      },
    };
  } catch (error) {
    context.scanScheduler.stop();
    await context.app.close();
    throw error;
  }
}
