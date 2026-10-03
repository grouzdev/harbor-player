import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createApp } from "../dist/server/app.js";
import { apiResponseContract } from "../src/shared/api-contracts.js";

let root: string;
let context: Awaited<ReturnType<typeof createApp>>;

beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "playlist-snapshot-"));
  context = await createApp({ dataDir: root });
});

afterEach(async () => {
  await context.app.close();
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});

async function sessionHeaders() {
  const session = await context.app.inject({
    url: "/api/session",
    headers: { host: "127.0.0.1:4317" },
  });
  return {
    host: "127.0.0.1:4317",
    cookie: String(session.headers["set-cookie"]).split(";")[0],
    "x-csrf-token": session.json().csrf,
  };
}

describe("complete playlist snapshot HTTP contract", () => {
  it("loads more than 5000 occurrences and selects an exact occurrence beyond the first page", async () => {
    const music = path.join(root, "Music");
    await mkdir(music);
    const catalog = context.service.catalog;
    const library = catalog.addLibrary("Music", music);
    for (let index = 0; index < 1001; index++) {
      catalog.upsert({
        id: `track-${index}`,
        libraryId: library.id,
        relativePath: `Album/${index}.flac`,
        title: `Track ${index}`,
        artists: ["Artist"],
        albumTitle: "Album",
        albumArtists: ["Artist"],
        albumKey: "album",
        genres: ["Rock"],
        year: 2025,
        trackNumber: index + 1,
        discNumber: 1,
        duration: 2,
        format: "flac",
        size: 1,
        mtimeMs: 0,
        coverId: null,
        available: true,
      });
    }
    const id = catalog.createPlaylist("Large snapshot").playlist.id;
    const detail = catalog.addPlaylistEntries(
      id,
      "album",
      Array(6).fill("album"),
    );
    const headers = await sessionHeaders();
    const url = `/api/playlists/${id}/tracks`;

    const page = await context.app.inject({ url: `${url}?limit=500`, headers });
    expect(page.statusCode).toBe(200);
    expect(page.json().items).toHaveLength(500);
    expect(page.json().total).toBe(6006);

    // This is the exact request made by PlaylistPanel, not a mocked browser route.
    const snapshot = await context.app.inject({
      url: `${url}?limit=all`,
      headers,
    });
    expect(snapshot.statusCode).toBe(200);
    const data = apiResponseContract("GET", url)!.parse(snapshot.json());
    expect(data).toMatchObject({
      total: 6006,
      offset: 0,
      totalDuration: 12012,
    });
    expect(snapshot.json().items).toHaveLength(6006);
    expect(snapshot.json().items.at(-1)).toMatchObject({
      entryId: detail.entries[5].id,
      track: { id: "track-1000" },
      position: 6005,
    });

    const queue = await context.app.inject({
      method: "POST",
      url: "/api/queue",
      headers,
      payload: {
        playlistId: id,
        startId: "track-1000",
        startEntryId: detail.entries[5].id,
      },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toMatchObject({
      playlistId: id,
      entryId: detail.entries[5].id,
      position: 6005,
      total: 6006,
      track: { id: "track-1000" },
    });
  }, 30000);

  it("accepts the full-snapshot token without weakening validation of other limits", async () => {
    const id =
      context.service.catalog.createPlaylist("Empty snapshot").playlist.id;
    const headers = await sessionHeaders();
    const url = `/api/playlists/${id}/tracks`;
    const snapshot = await context.app.inject({
      url: `${url}?limit=all`,
      headers,
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({
      items: [],
      total: 0,
      totalDuration: 0,
    });
    for (const limit of ["invalid", "0", "-1", "5001", "1.5"]) {
      const response = await context.app.inject({
        url: `${url}?limit=${limit}`,
        headers,
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
