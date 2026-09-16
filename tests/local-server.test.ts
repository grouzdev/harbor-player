import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import {
  startLocalServer,
  type LocalServerHandle,
} from "../dist/server/local-server.js";

let root: string;
const servers: LocalServerHandle[] = [];

beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "local-server-"));
});

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.stop()));
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});

describe("local server lifecycle", () => {
  it("returns the actual URL, rejects a second data owner and releases the lock", async () => {
    const dataDir = path.join(root, "data");
    const first = await startLocalServer({ dataDir, port: 0 });
    servers.push(first);
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await expect(fetch(`${first.url}/api/session`)).resolves.toMatchObject({
      status: 200,
    });
    await expect(startLocalServer({ dataDir, port: 0 })).rejects.toThrow(
      "уже запущен",
    );

    await first.stop();
    servers.splice(servers.indexOf(first), 1);
    const restarted = await startLocalServer({ dataDir, port: 0 });
    servers.push(restarted);
    await expect(fetch(`${restarted.url}/api/session`)).resolves.toMatchObject({
      status: 200,
    });
  });

  it("cleans up its data lock after a port conflict", async () => {
    const first = await startLocalServer({
      dataDir: path.join(root, "first"),
      port: 0,
    });
    servers.push(first);
    const port = Number(new URL(first.url).port);
    const secondData = path.join(root, "second");
    await expect(
      startLocalServer({ dataDir: secondData, port }),
    ).rejects.toThrow();

    const recovered = await startLocalServer({ dataDir: secondData, port: 0 });
    servers.push(recovered);
  });

  it("rejects new jobs after shutdown begins", async () => {
    const server = await startLocalServer({
      dataDir: path.join(root, "data"),
      port: 0,
    });
    servers.push(server);
    const library = server.service.catalog.addLibrary("Test", root);
    server.service.beginShutdown();
    expect(() => server.service.scan(library.id)).toThrow(
      "Сервис останавливается",
    );
  });

  it("cancels a queued scan while allowing shutdown to drain safely", async () => {
    const server = await startLocalServer({
      dataDir: path.join(root, "data"),
      port: 0,
    });
    servers.push(server);
    const library = server.service.catalog.addLibrary("Test", root);
    const scan = server.service.scan(library.id);
    server.service.beginShutdown();
    await server.service.idle();
    expect(server.service.catalog.jobs().find((job) => job.id === scan.id)).toMatchObject({
      status: "error",
      errors: ["Сканирование отменено при подготовке к обновлению"],
    });
  });
});
