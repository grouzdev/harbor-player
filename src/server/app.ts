import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync, type ReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  emptyFilter,
  filterSchema,
  perTrackTagPatchSchema,
  selectionSchema,
  tagPatchSchema,
} from "../shared/contracts.js";
import type { BookmarkKind } from "../shared/contracts.js";
import { MusicService } from "./service.js";
import { errorMessage } from "./config.js";
import { openInExplorer, type ExplorerLauncher } from "./explorer.js";
import type { MusicBrainzOptions } from "./musicbrainz.js";

const pageSchema = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  filter: z.string().max(100000).default("{}"),
});
const idParam = z.object({ id: z.string().min(1).max(100) });
export function rangeFor(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) throw new Error("range");
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), size - 1)
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start > end ||
    start >= size
  )
    throw new Error("range");
  return { start, end };
}
export async function createApp(options: {
  dataDir: string;
  port?: number;
  dev?: boolean;
  logger?: boolean;
  openExplorer?: ExplorerLauncher;
  musicBrainz?: MusicBrainzOptions;
}) {
  const app = Fastify({
    logger: options.logger || false,
    bodyLimit: 16 * 1024 * 1024,
    requestTimeout: 120000,
  });
  const service = new MusicService(options.dataDir, options.musicBrainz);
  const openExplorer = options.openExplorer || openInExplorer;
  await service.initialize();
  const port = options.port || 4317;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (options.dev) {
    hosts.add("127.0.0.1:5173");
    hosts.add("localhost:5173");
  }
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  const session = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  const streams = new Map<string, Set<ReadStream>>();
  const blocked = new Set<string>();
  const eventConnections = new Set<import("node:http").ServerResponse>();
  await app.register(cookie);
  app.addHook("onRequest", async (request, reply) => {
    if (!hosts.has(request.headers.host || ""))
      return reply.code(403).send({ error: "Недопустимый Host" });
    const origin = request.headers.origin;
    if (
      (origin && !origins.has(origin)) ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      return reply
        .code(403)
        .send({ error: "Доступ разрешён только из локального приложения" });
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'${options.dev ? " ws://127.0.0.1:5173 ws://localhost:5173" : ""}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
    );
    if (request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      if (
        request.url.split("?")[0] !== "/api/session" &&
        request.cookies.mml_session !== session
      )
        return reply
          .code(401)
          .send({ error: "Локальная сессия завершена. Обновите страницу." });
      if (
        !["GET", "HEAD"].includes(request.method) &&
        request.headers["x-csrf-token"] !== csrf
      )
        return reply.code(403).send({ error: "Недопустимый запрос" });
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof z.ZodError ? 400 : 400).send({
      error:
        error instanceof z.ZodError
          ? error.issues.map((i) => i.message).join("; ")
          : errorMessage(error),
    });
  });
  app.get("/api/session", async (_request, reply) => {
    reply.setCookie("mml_session", session, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
    });
    return { csrf, capabilities: service.capabilities };
  });
  app.get("/api/libraries", async () => {
    await service.refreshAvailability();
    return service.catalog.libraries();
  });
  app.get("/api/bookmarks", async () => service.catalog.bookmarks());
  app.post("/api/bookmarks", async (request) => {
    const body = z
      .object({
        kind: z.enum(["artist", "album", "track"]),
        id: z.string().max(1000),
        bookmarked: z.boolean(),
      })
      .strict()
      .parse(request.body);
    service.catalog.setBookmark(
      body.kind as BookmarkKind,
      body.id,
      body.bookmarked,
    );
    return service.catalog.bookmarks();
  });
  app.post("/api/libraries", async (request) => {
    const body = z
      .object({
        name: z.string().max(100).default(""),
        path: z.string().min(1).max(32000),
      })
      .parse(request.body);
    return service.addLibrary(body.name, body.path);
  });
  app.post("/api/libraries/:id/remove", async (request) =>
    service.removeLibrary(idParam.parse(request.params).id),
  );
  app.post("/api/libraries/:id/scan", async (request) =>
    service.scan(
      idParam.parse(request.params).id,
      z.object({ force: z.boolean().default(false) }).parse(request.body || {})
        .force,
    ),
  );
  app.get("/api/tracks", async (request) => {
    const q = pageSchema.parse(request.query);
    return service.catalog.tracks(
      filterSchema.parse(JSON.parse(q.filter)),
      q.offset,
      q.limit,
    );
  });
  app.get("/api/albums", async (request) => {
    const q = pageSchema.parse(request.query);
    return service.catalog.albums(
      filterSchema.parse(JSON.parse(q.filter)),
      q.offset,
      q.limit,
    );
  });
  app.get("/api/genres", async (request) => {
    const q = pageSchema.parse(request.query);
    return service.catalog.genres(filterSchema.parse(JSON.parse(q.filter)));
  });
  app.get("/api/facet-relevance", async (request) => {
    const q = pageSchema.parse(request.query);
    return service.catalog.facetRelevance(
      filterSchema.parse(JSON.parse(q.filter)),
    );
  });
  app.get("/api/artists", async (request) => {
    const q = pageSchema.parse(request.query);
    return service.catalog.artists(
      filterSchema.parse(JSON.parse(q.filter)),
      q.offset,
      q.limit,
    );
  });
  app.get("/api/filter-validity", async (request) => {
    const q = pageSchema.parse(request.query);
    const filter = filterSchema.parse(JSON.parse(q.filter));
    return {
      albumIds: service.catalog.validAlbumIds(filter),
      artists: filter.artists.length
        ? service.catalog
            .artists(filter, 0, 100000)
            .items.map((a) => a.name)
            .filter((a) => filter.artists.includes(a))
        : [],
    };
  });
  app.get(
    "/api/tracks/:id",
    async (request, reply) =>
      service.catalog.track(idParam.parse(request.params).id) ||
      reply.code(404).send({ error: "Трек не найден" }),
  );
  app.post("/api/explorer", async (request) => {
    const body = z
      .object({
        kind: z.enum(["album", "track"]),
        id: z.string().min(1).max(100),
      })
      .strict()
      .parse(request.body);
    const track =
      body.kind === "track"
        ? service.catalog.track(body.id)
        : service.catalog.firstAlbumTrack(body.id);
    if (!track || !track.available)
      throw new Error(
        body.kind === "track" ? "Трек не найден" : "Альбом не найден",
      );
    const library = service.catalog.library(track.libraryId);
    if (!library.available) throw new Error("Библиотека недоступна");
    const file = path.join(library.path, track.relativePath);
    await service.safePath(file);
    await openExplorer(
      body.kind === "track"
        ? { directory: path.dirname(file), selectFile: file }
        : { directory: path.dirname(file) },
    );
    return { ok: true };
  });
  app.get("/api/covers/:id", async (request, reply) => {
    const id = z
      .object({ id: z.string().regex(/^[a-f0-9]{64}\.(jpg|png)$/) })
      .parse(request.params).id;
    const file = path.join(service.dataDir, "covers", id);
    if (!existsSync(file)) return reply.code(404).send();
    return reply
      .header("Cache-Control", "private, max-age=86400")
      .type(id.endsWith(".png") ? "image/png" : "image/jpeg")
      .send(createReadStream(file));
  });
  app.get("/api/audio/:id", async (request, reply) => {
    const id = idParam.parse(request.params).id;
    if (blocked.has(id))
      return reply.code(409).send({ error: "Файл обрабатывается" });
    const track = service.catalog.track(id);
    if (!track || !track.available)
      return reply.code(404).send({ error: "Трек недоступен" });
    const file = path.join(
      service.catalog.library(track.libraryId).path,
      track.relativePath,
    );
    await service.safePath(file);
    const { size } = await stat(file);
    let range;
    try {
      range = rangeFor(request.headers.range, size);
    } catch {
      return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    }
    reply.header("Accept-Ranges", "bytes");
    reply.type(
      (
        {
          mp3: "audio/mpeg",
          flac: "audio/flac",
          m4a: "audio/mp4",
          aac: "audio/aac",
          wav: "audio/wav",
          ogg: "audio/ogg",
          oga: "audio/ogg",
          opus: "audio/ogg",
        } as Record<string, string>
      )[track.format] || "application/octet-stream",
    );
    if (range)
      reply
        .code(206)
        .header("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
        .header("Content-Length", range.end - range.start + 1);
    else reply.header("Content-Length", size);
    const stream = createReadStream(file, range || {});
    if (!streams.has(id)) streams.set(id, new Set());
    streams.get(id)!.add(stream);
    stream.on("close", () => {
      streams.get(id)?.delete(stream);
      if (!streams.get(id)?.size) streams.delete(id);
    });
    reply.raw.on("close", () => stream.destroy());
    return reply.send(stream);
  });
  service.closeStreams = async (ids) => {
    for (const id of ids) blocked.add(id);
    service.emit("change", { type: "operation-start", trackIds: ids });
    await Promise.all(
      ids.flatMap((id) =>
        [...(streams.get(id) || [])].map(
          (stream) =>
            new Promise<void>((resolve) => {
              stream.once("close", resolve);
              stream.destroy();
            }),
        ),
      ),
    );
  };
  service.on("change", (event) => {
    if (event.type === "operation-finished") blocked.clear();
  });
  app.get("/api/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    eventConnections.add(reply.raw);
    reply.raw.write(": connected\n\n");
    const send = (event: unknown) => {
      if (!reply.raw.destroyed)
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    service.on("change", send);
    const heartbeat = setInterval(
      () => reply.raw.write(": heartbeat\n\n"),
      15000,
    );
    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      service.off("change", send);
      eventConnections.delete(reply.raw);
    });
  });
  app.get("/api/jobs", async () => service.catalog.jobs());
  app.post("/api/selection-summary", async (request) => {
    const selection = selectionSchema.parse(request.body);
    const tracks = service.catalog.selected(selection);
    const fields: Record<string, { mixed: boolean; value: unknown }> = {};
    for (const key of [
      "title",
      "artists",
      "albumTitle",
      "albumArtists",
      "genres",
      "year",
      "trackNumber",
      "discNumber",
    ] as const) {
      const value = tracks[0]?.[key] ?? null;
      fields[key] = {
        value,
        mixed: tracks.some(
          (t) => JSON.stringify(t[key]) !== JSON.stringify(value),
        ),
      };
    }
    return {
      count: tracks.length,
      formats: [...new Set(tracks.map((t) => t.format))],
      fields,
      musicBrainz: service.musicBrainz.context(selection),
    };
  });
  app.post("/api/metadata/musicbrainz/search", async (request) => {
    const body = z
      .object({
        selection: selectionSchema,
        title: z.string().max(1000),
        artist: z.string().max(1000).default(""),
      })
      .strict()
      .parse(request.body);
    return service.musicBrainz.search(body.selection, {
      title: body.title,
      artist: body.artist,
    });
  });
  app.post("/api/metadata/musicbrainz/proposal", async (request) => {
    const body = z
      .object({
        selection: selectionSchema,
        releaseId: z.string().uuid(),
        recordingId: z.string().uuid().optional(),
      })
      .strict()
      .parse(request.body);
    return service.musicBrainz.proposal(
      body.selection,
      body.releaseId,
      body.recordingId,
    );
  });
  app.get("/api/metadata/musicbrainz/thumbnail/:id", async (request, reply) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const image = await service.musicBrainz.thumbnail(id);
    if (!image) return reply.code(404).send();
    return reply
      .header("Cache-Control", "private, max-age=86400")
      .type(image.mime)
      .send(image.data);
  });
  app.get("/api/operations", async () =>
    service.catalog
      .history()
      .filter((o) => o.status !== "preview")
      .map((o) => ({
        id: o.id,
        kind: o.kind,
        createdAt: o.createdAt,
        status: o.status,
        total: o.items.length,
        completed: o.items.filter((i) => i.phase === "done").length,
        errors: o.items
          .filter((i) => i.error)
          .map((i) => `${i.title}: ${i.error}`),
      })),
  );
  app.get("/api/operations/:id", async (request) =>
    service.catalog.operation(idParam.parse(request.params).id),
  );
  app.post("/api/operations/preview", async (request) => {
    const body = z
      .object({
        kind: z.enum(["move", "trash", "tags"]),
        selection: selectionSchema,
        targetLibraryId: z.string().optional(),
        patch: tagPatchSchema.optional(),
        itemPatches: z
          .record(z.string().min(1).max(100), perTrackTagPatchSchema)
          .optional(),
        coverId: z
          .string()
          .regex(/^[a-f0-9]{64}\.(jpg|png)$/)
          .optional(),
        coverTrackIds: z.array(z.string()).max(100000).optional(),
        companions: z.boolean().default(false),
      })
      .parse(request.body);
    if (body.patch?.cover && body.coverId)
      throw new Error("Выберите только один источник обложки");
    if (body.coverId) {
      const file = path.join(service.dataDir, "covers", body.coverId);
      if (!existsSync(file)) throw new Error("Обложка больше недоступна");
      const data = await readFile(file);
      body.patch = {
        ...(body.patch || {}),
        cover: {
          data: data.toString("base64"),
          mime: body.coverId.endsWith(".png") ? "image/png" : "image/jpeg",
        },
      };
    }
    if (body.patch?.cover) {
      const b = Buffer.from(body.patch.cover.data, "base64");
      const png = b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
      if (
        b.length > 10 * 1024 * 1024 ||
        !(png || jpeg) ||
        (png ? "image/png" : "image/jpeg") !== body.patch.cover.mime
      )
        throw new Error("Выберите JPEG или PNG размером до 10 МБ");
    }
    return service.preview(
      body.kind,
      body.selection,
      body.targetLibraryId,
      body.patch,
      body.companions,
      body.itemPatches,
      body.coverId ? body.coverTrackIds : undefined,
    );
  });
  app.post("/api/operations/:id/execute", async (request) =>
    service.execute(idParam.parse(request.params).id),
  );
  app.post("/api/operations/:id/retry", async (request) =>
    service.retry(idParam.parse(request.params).id),
  );
  app.post("/api/operations/:id/restore", async (request) =>
    service.previewRestore(idParam.parse(request.params).id),
  );
  app.post("/api/queue", async (request) => {
    const body = z
      .union([
        z.object({ filter: filterSchema, startId: z.string() }),
        z.object({ albumId: z.string() }),
      ])
      .parse(request.body);
    const ids = "albumId" in body
      ? service.catalog.trackIds({ ...emptyFilter, albumIds: [body.albumId] })
      : service.catalog.trackIds(body.filter);
    const position = "albumId" in body ? 0 : ids.indexOf(body.startId);
    if (position < 0 || !ids.length)
      throw new Error(
        "albumId" in body
          ? "В альбоме нет доступных треков"
          : "Трек больше не входит в результат",
      );
    const id = randomUUID();
    service.catalog.db
      .prepare("INSERT INTO queues VALUES (?,?,?)")
      .run(id, new Date().toISOString(), JSON.stringify(ids));
    service.catalog.db
      .prepare(
        "DELETE FROM queues WHERE id NOT IN (SELECT id FROM queues ORDER BY createdAt DESC LIMIT 20)",
      )
      .run();
    return {
      id,
      position,
      total: ids.length,
      track: service.catalog.track(ids[position]),
    };
  });
  app.get("/api/queue/:id", async (request) => {
    const id = idParam.parse(request.params).id;
    const position = z
      .object({ position: z.coerce.number().int().min(0).max(100000) })
      .parse(request.query).position;
    const row = service.catalog.db
      .prepare("SELECT trackIds FROM queues WHERE id=?")
      .get(id) as { trackIds: string } | undefined;
    if (!row) throw new Error("Очередь больше недоступна");
    const ids: string[] = JSON.parse(row.trackIds);
    return {
      id,
      position,
      total: ids.length,
      track: ids[position]
        ? service.catalog.track(ids[position]) || null
        : null,
    };
  });
  const clientDir = fileURLToPath(new URL("../client", import.meta.url));
  if (existsSync(path.join(clientDir, "index.html")))
    await app.register(staticFiles, { root: clientDir });
  app.addHook("preClose", async () => {
    for (const connection of eventConnections) connection.end();
    for (const list of streams.values())
      for (const stream of list) stream.destroy();
  });
  app.addHook("onClose", async () => {
    for (const list of streams.values())
      for (const stream of list) stream.destroy();
    await service.close();
  });
  return { app, service };
}
