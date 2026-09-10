import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createApp, rangeFor } from "../dist/server/app.js";

let root: string;
let context: Awaited<ReturnType<typeof createApp>>;
beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "api-"));
  context = await createApp({ dataDir: root });
});
afterEach(async () => {
  await context.app.close();
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});
describe("HTTP boundary", () => {
  it("rejects DNS rebinding, foreign origins and unauthenticated clients", async () => {
    expect(
      (
        await context.app.inject({
          url: "/api/session",
          headers: { host: "evil.test:4317" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await context.app.inject({
          url: "/api/session",
          headers: { host: "127.0.0.1:4317", origin: "https://evil.test" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await context.app.inject({
          url: "/api/tracks",
          headers: { host: "127.0.0.1:4317" },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("requires CSRF and validates mutation inputs", async () => {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const cookie = String(session.headers["set-cookie"]).split(";")[0];
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/libraries",
          headers: { host: "127.0.0.1:4317", cookie },
          payload: { path: "relative" },
        })
      ).statusCode,
    ).toBe(403);
    const response = await context.app.inject({
      method: "POST",
      url: "/api/libraries",
      headers: {
        host: "127.0.0.1:4317",
        cookie,
        "x-csrf-token": session.json().csrf,
      },
      payload: { path: "relative" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("абсолютный");
  });
  it("parses bounded, open-ended and suffix ranges and rejects malformed ones", () => {
    expect(rangeFor("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(rangeFor("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(rangeFor("bytes=-5", 100)).toEqual({ start: 95, end: 99 });
    for (const range of [
      "bytes=100-",
      "bytes=20-10",
      "bytes=-0",
      "bytes=0-2,4-8",
      "bad",
    ])
      expect(() => rangeFor(range, 100)).toThrow();
  });
});
