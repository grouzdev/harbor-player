import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { LyricsSearch, readEmbeddedLyrics } from "../src/server/lyrics.js";
import { createApp } from "../dist/server/app.js";
import { emptyFilter } from "../src/shared/contracts.js";
import { audioDigest } from "../dist/server/audio-digest.js";
import { writeTagsIsolated } from "../dist/server/isolated-tag-writer.js";
import { parseFile } from "music-metadata";
import { selectAutomaticLyrics } from "../src/shared/lyrics.js";

describe("automatic match selection", () => {
  const track = {
    title: "Маяк",
    artists: ["Гавань"],
    albumTitle: "Берег",
    duration: 258,
  };
  it("requires an exact version and accepts duplicate records only with identical lyrics", () => {
    expect(selectAutomaticLyrics(track, [candidate])).toEqual(candidate);
    expect(
      selectAutomaticLyrics(track, [candidate, { ...candidate, id: 124 }]),
    ).toEqual(candidate);
    expect(
      selectAutomaticLyrics(track, [
        candidate,
        { ...candidate, id: 124, plainLyrics: "Другой текст" },
      ]),
    ).toBeNull();
  });
  it.each([
    { trackName: "Маяк (Live)" },
    { artistName: "Кавер" },
    { albumName: "Концерт" },
    { duration: 265 },
    { instrumental: true },
    { plainLyrics: "" },
  ])(
    "does not automatically select a different or empty version: %j",
    (change) => {
      expect(
        selectAutomaticLyrics(track, [{ ...candidate, ...change }]),
      ).toBeNull();
    },
  );
  it("does not guess when the album is missing", () => {
    expect(
      selectAutomaticLyrics({ ...track, albumTitle: "" }, [candidate]),
    ).toBeNull();
  });
});

const text = "Берег рядом\nСвет в окне\n\nВозвращайся ко мне — déjà vu.";
const candidate = {
  id: 123,
  trackName: "Маяк",
  artistName: "Гавань",
  albumName: "Берег",
  duration: 258,
  instrumental: false,
  plainLyrics: text,
};
describe("LRCLIB client", () => {
  it("uses structured, encoded queries, validates data and caches repeated searches", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json([candidate]));
    const client = new LyricsSearch(request);
    expect(await client.search("Гавань & море", "Маяк?")).toEqual([candidate]);
    expect(await client.search("Гавань & море", "Маяк?")).toEqual([candidate]);
    expect(request).toHaveBeenCalledTimes(1);
    const url = request.mock.calls[0][0] as URL;
    expect(url.origin).toBe("https://lrclib.net");
    expect(url.searchParams.get("artist_name")).toBe("Гавань & море");
    expect(request.mock.calls[0][1]?.headers).toHaveProperty("User-Agent");
  });
  it("honors Retry-After without issuing another request", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
    );
    const client = new LyricsSearch(request);
    await expect(client.search("a", "b")).rejects.toMatchObject({
      statusCode: 429,
    });
    await expect(client.search("a", "c")).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    () => Response.json([{ ...candidate, plainLyrics: 42 }]),
    () => new Response("<html>busy</html>"),
    () => new Response("error", { status: 500 }),
    () => Response.json([{ ...candidate, plainLyrics: "a".repeat(100_001) }]),
  ])("rejects malformed and unsuccessful responses", async (response) => {
    await expect(
      new LyricsSearch(
        vi.fn<typeof fetch>().mockResolvedValue(response()),
      ).search("a", "b"),
    ).rejects.toMatchObject({ statusCode: 502 });
  });
  it("returns an empty search and instrumental metadata without inventing lyrics", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json([
          { ...candidate, instrumental: true, plainLyrics: null },
        ]),
      );
    expect(
      (await new LyricsSearch(request).search("a", "b"))[0].plainLyrics,
    ).toBeNull();
    expect(
      await new LyricsSearch(
        vi.fn<typeof fetch>().mockResolvedValue(Response.json([])),
      ).search("a", "b"),
    ).toEqual([]);
  });
});

describe("lyrics API and verified file operations", () => {
  let root: string;
  let context: Awaited<ReturnType<typeof createApp>>;
  let headers: Record<string, string>;
  const request = vi.fn<typeof fetch>();
  beforeEach(async () => {
    await mkdir(".test-data", { recursive: true });
    root = await mkdtemp(path.resolve(".test-data", "lyrics-"));
    request.mockReset().mockResolvedValue(Response.json([candidate]));
    context = await createApp({
      dataDir: path.join(root, "data"),
      lyricsFetch: request,
    });
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
  });
  afterEach(async () => {
    await context.app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function add(format: string) {
    const folder = path.join(root, format);
    await mkdir(folder);
    const file = path.join(folder, `track.${format}`);
    await copyFile(path.resolve(".fixtures", `sample.${format}`), file);
    await context.service.addLibrary(format, folder);
    await context.service.idle();
    return {
      track: context.service.catalog
        .tracks(emptyFilter)
        .items.find((item) => item.format === format)!,
      file,
    };
  }
  const automatic = (id: string) =>
    context.app.inject({
      method: "POST",
      url: `/api/tracks/${id}/lyrics/auto`,
      headers,
      payload: {},
    });
  function matching(track: {
    title: string;
    artists: string[];
    albumTitle: string;
    duration: number;
  }) {
    return {
      ...candidate,
      trackName: track.title,
      artistName: track.artists.join(", "),
      albumName: track.albumTitle,
      duration: track.duration,
    };
  }
  it.each(["mp3", "flac"])(
    "automatically finds and writes missing %s lyrics exactly once across concurrent opens",
    async (format) => {
      const { track, file } = await add(format);
      await writeTagsIsolated(file, { lyrics: "" });
      context.service.scan(track.libraryId);
      await context.service.idle();
      context.service.capabilities = {
        writableFormats: [format],
        verificationDate: "test",
      };
      request.mockImplementation(async () => Response.json([matching(track)]));
      const digest = await audioDigest(file);
      const results = await Promise.all([
        automatic(track.id),
        automatic(track.id),
      ]);
      for (const result of results) {
        expect(result.statusCode).toBe(200);
        expect(result.json()).toEqual({ text, candidates: [], saved: true });
      }
      expect(request).toHaveBeenCalledTimes(1);
      expect(
        context.service.catalog.history().filter((op) => op.kind === "tags"),
      ).toHaveLength(1);
      expect(await readEmbeddedLyrics(file)).toBe(text);
      expect(await audioDigest(file)).toBe(digest);
      expect((await automatic(track.id)).json().saved).toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("does not search or change an existing embedded or local text", async () => {
    const { track, file } = await add("flac");
    await writeTagsIsolated(file, { lyrics: "Существующий" });
    const before = await readFile(file);
    expect((await automatic(track.id)).json().text).toBe("Существующий");
    context.service.catalog.saveLocalLyrics(track.id, "Локальный");
    expect((await automatic(track.id)).json().text).toBe("Локальный");
    expect(request).not.toHaveBeenCalled();
    expect(await readFile(file)).toEqual(before);
  });
  it("returns conflicting candidates without writing and saves only the user's selection", async () => {
    const { track, file } = await add("flac");
    await writeTagsIsolated(file, { lyrics: "" });
    context.service.scan(track.libraryId);
    await context.service.idle();
    context.service.capabilities = {
      writableFormats: ["flac"],
      verificationDate: "test",
    };
    const options = [
      matching(track),
      { ...matching(track), id: 124, plainLyrics: "Другой" },
    ];
    request.mockImplementation(async () => Response.json(options));
    const before = await readFile(file);
    const result = await automatic(track.id);
    expect(result.json()).toEqual({
      text: null,
      candidates: options,
      saved: false,
    });
    expect(await readFile(file)).toEqual(before);
    const chosen = await context.app.inject({
      method: "POST",
      url: `/api/tracks/${track.id}/lyrics/fill`,
      headers,
      payload: { text: "Другой" },
    });
    expect(chosen.statusCode).toBe(200);
    expect(chosen.json().saved).toBe(true);
    expect(await readEmbeddedLyrics(file)).toBe("Другой");
  });
  it("guards against text appearing after preview, including retries", async () => {
    const { track, file } = await add("flac");
    await writeTagsIsolated(file, { lyrics: "" });
    context.service.scan(track.libraryId);
    await context.service.idle();
    context.service.capabilities = {
      writableFormats: ["flac"],
      verificationDate: "test",
    };
    const preview = await context.service.previewMissingLyrics(track.id, text);
    await writeTagsIsolated(file, { lyrics: "Добавлен извне" });
    const before = await readFile(file);
    const job = context.service.execute(preview.id);
    await context.service.idle();
    expect(job.errors.join(" ")).toContain("Автоматическая замена отменена");
    expect(await readFile(file)).toEqual(before);
    const retry = await context.service.previewRetry(preview.id);
    expect(retry.lyricsOnlyIfMissing).toBe(true);
    const retried = context.service.execute(retry.id);
    await context.service.idle();
    expect(retried.errors.length).toBeGreaterThan(0);
    expect(await readFile(file)).toEqual(before);
  });
  it("refuses an automatic write if a local text appears after preview", async () => {
    const { track, file } = await add("flac");
    await writeTagsIsolated(file, { lyrics: "" });
    context.service.scan(track.libraryId);
    await context.service.idle();
    context.service.capabilities = {
      writableFormats: ["flac"],
      verificationDate: "test",
    };
    const preview = await context.service.previewMissingLyrics(track.id, text);
    context.service.catalog.saveLocalLyrics(track.id, "Новый локальный текст");
    const before = await readFile(file);
    const job = context.service.execute(preview.id);
    await context.service.idle();
    expect(job.errors.join(" ")).toContain("Автоматическая замена отменена");
    expect(await readFile(file)).toEqual(before);
    expect(context.service.catalog.localLyrics(track.id)).toBe(
      "Новый локальный текст",
    );
  });
  it("validates authenticated searches and does not access the network on the read-only lyrics endpoint", async () => {
    const { track } = await add("mp3");
    const result = await context.app.inject({
      url: `/api/tracks/${track.id}/lyrics`,
      headers,
    });
    expect(result.statusCode).toBe(200);
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/lyrics/search",
          headers,
          payload: { title: "" },
        })
      ).statusCode,
    ).toBe(400);
    const search = await context.app.inject({
      method: "POST",
      url: "/api/lyrics/search",
      headers,
      payload: { artist: "Гавань", title: "Маяк" },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual([candidate]);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/lyrics/search",
          headers: { host: headers.host },
          payload: { artist: "a", title: "b" },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("persists a separate local choice across reopening the database without changing audio files", async () => {
    const { track, file } = await add("flac");
    const before = await readFile(file);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: `/api/tracks/${track.id}/lyrics`,
          headers,
          payload: { text },
        })
      ).statusCode,
    ).toBe(200);
    expect(await readFile(file)).toEqual(before);
    await context.app.close();
    context = await createApp({
      dataDir: path.join(root, "data"),
      lyricsFetch: request,
    });
    expect(context.service.catalog.localLyrics(track.id)).toBe(text);
  });
  it.each(["mp3", "flac"])(
    "writes, replaces and clears %s lyrics through staged operations, preserving audio and other tags",
    async (format) => {
      const { file, track } = await add(format);
      context.service.capabilities = {
        writableFormats: ["mp3", "flac"],
        verificationDate: "test",
      };
      const before = await parseFile(file);
      const digest = await audioDigest(file);
      for (const value of [text, "Новая строка\n\nВторой абзац", ""]) {
        const op = await context.service.preview(
          "tags",
          { trackIds: [track.id] },
          undefined,
          { lyrics: value },
        );
        expect(op.items.map((item) => item.error).filter(Boolean)).toEqual([]);
        const job = context.service.execute(op.id);
        await context.service.idle();
        expect(job.errors).toEqual([]);
        expect(await readEmbeddedLyrics(file)).toBe(value || null);
        expect(await audioDigest(file)).toBe(digest);
        const after = await parseFile(file);
        for (const field of [
          "title",
          "artists",
          "album",
          "genre",
          "track",
          "disk",
          "picture",
        ] as const)
          expect(after.common[field]).toEqual(before.common[field]);
      }
    },
  );
  it("preserves lyrics during unrelated tag edits and rejects unsupported formats", async () => {
    const { file } = await add("mp3");
    await writeTagsIsolated(file, { lyrics: text });
    await writeTagsIsolated(file, { title: "Новое название" });
    expect(await readEmbeddedLyrics(file)).toBe(text);
    const { track } = await add("m4a");
    context.service.capabilities = {
      writableFormats: ["m4a"],
      verificationDate: "test",
    };
    const op = await context.service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { lyrics: text },
    );
    expect(op.items[0].error).toContain("MP3 и FLAC");
  });
  it.each(["mp3", "flac"])(
    "restores original %s bytes when recovery is enabled",
    async (format) => {
      const { file, track } = await add(format);
      context.service.capabilities = {
        writableFormats: [format],
        verificationDate: "test",
      };
      await context.service.updateRecoverySettings({
        backupRetention: "never",
      });
      const before = await readFile(file);
      const op = await context.service.preview(
        "tags",
        { trackIds: [track.id] },
        undefined,
        { lyrics: text },
      );
      expect(op.recoverable).toBe(true);
      const job = context.service.execute(op.id);
      await context.service.idle();
      expect(job.errors).toEqual([]);
      const restore = await context.service.previewRestore(op.id);
      const restoreJob = context.service.execute(restore.id);
      await context.service.idle();
      expect(restoreJob.errors).toEqual([]);
      expect(await readFile(file)).toEqual(before);
    },
  );
  it("retains access to locally saved lyrics when the audio file disappears", async () => {
    const { file, track } = await add("flac");
    context.service.catalog.saveLocalLyrics(track.id, text);
    await rm(file);
    const result = await context.app.inject({
      url: `/api/tracks/${track.id}/lyrics`,
      headers,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({
      local: text,
      embedded: null,
      writable: false,
    });
  });
  it("updates an older local choice after a confirmed file lyrics write", async () => {
    const { track } = await add("flac");
    context.service.capabilities = {
      writableFormats: ["flac"],
      verificationDate: "test",
    };
    context.service.catalog.saveLocalLyrics(track.id, "Старый выбор");
    const op = await context.service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { lyrics: text },
    );
    const job = context.service.execute(op.id);
    await context.service.idle();
    expect(job.errors).toEqual([]);
    expect(context.service.catalog.localLyrics(track.id)).toBe(text);
  });
  it.each(["v2.4", "no-id3"])(
    "writes Unicode lyrics with %s MP3 input",
    async (kind) => {
      const { file } = await add("mp3");
      const bytes = await readFile(file);
      const size =
        ((bytes[6] & 127) << 21) |
        ((bytes[7] & 127) << 14) |
        ((bytes[8] & 127) << 7) |
        (bytes[9] & 127);
      const audio = bytes.subarray(10 + size);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        file,
        kind === "no-id3"
          ? audio
          : Buffer.concat([
              Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 8, 0]),
              Buffer.alloc(1024),
              audio,
            ]),
      );
      const digest = await audioDigest(file);
      await writeTagsIsolated(file, { lyrics: text });
      expect(await readEmbeddedLyrics(file)).toBe(text);
      expect(await audioDigest(file)).toBe(digest);
    },
  );
});
