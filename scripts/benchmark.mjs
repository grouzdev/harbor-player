import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createApp } from "../dist/server/app.js";
import { emptyFilter } from "../dist/shared/contracts.js";
const root = path.resolve(".test-data/benchmark");
if (!root.startsWith(path.resolve(".test-data") + path.sep))
  throw new Error("Unsafe test path");
await rm(root, { recursive: true, force: true });
await mkdir(path.join(root, "music"), { recursive: true });
const { app, service } = await createApp({
  dataDir: path.join(root, "data"),
  port: 4328,
});
let browser;
try {
  const lib = service.catalog.addLibrary(
    "Нагрузочная коллекция",
    path.join(root, "music"),
  );
  const insert = service.catalog.db.prepare(
    `INSERT INTO tracks(id,libraryId,relativePath,title,artists,albumTitle,albumArtists,albumKey,genres,year,trackNumber,discNumber,duration,format,size,mtimeMs,coverId,available) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const genre = service.catalog.db.prepare(
    "INSERT INTO track_genres VALUES (?,?)",
  );
  const seedStart = performance.now();
  service.catalog.db.transaction(() => {
    for (let i = 0; i < 100000; i++) {
      const album = Math.floor(i / 10)
        .toString()
        .padStart(5, "0");
      const id = `track-${i}`;
      insert.run(
        id,
        lib.id,
        `Album ${album}/${i}.flac`,
        `Трек ${i}`,
        '["Исполнитель"]',
        `Альбом ${album}`,
        '["Исполнитель"]',
        album.padStart(64, "0"),
        '["Ambient"]',
        2024,
        (i % 10) + 1,
        1,
        180,
        "flac",
        1000000,
        0,
        null,
        1,
      );
      genre.run(id, "Ambient");
      service.catalog.db
        .prepare("INSERT INTO track_artists VALUES (?,?)")
        .run(id, "Исполнитель");
    }
  })();
  const seedMs = Math.round(performance.now() - seedStart);
  const timed = (fn) => {
    const start = performance.now();
    const result = fn();
    return { ms: Math.round(performance.now() - start), result };
  };
  const tracks = timed(() => service.catalog.tracks(emptyFilter));
  const albums = timed(() => service.catalog.albums(emptyFilter));
  const genres = timed(() => service.catalog.genres(emptyFilter));
  const queue = timed(() => service.catalog.trackIds(emptyFilter));
  await app.listen({ port: 4328, host: "127.0.0.1" });
  browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await page.goto("http://127.0.0.1:4328");
  await page.waitForSelector("[data-testid=track-row]");
  const renderedTracks = await page.locator("[data-testid=track-row]").count();
  const renderedAlbums = await page.locator(".album-card").count();
  if (renderedTracks > 60 || renderedAlbums > 100)
    throw new Error("Virtualization failed");
  await page.locator(".track-scroll").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await page.waitForTimeout(1000);
  const afterScroll = await page.locator("[data-testid=track-row]").count();
  if (afterScroll > 60)
    throw new Error("Virtualization failed after pagination");
  await page.screenshot({ path: ".test-data/benchmark.png" });
  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    node: process.version,
    syntheticCatalog: true,
    tracks: tracks.result.total,
    albums: albums.result.total,
    seedMs,
    queryMs: {
      tracks: tracks.ms,
      albums: albums.ms,
      genres: genres.ms,
      queueSnapshot: queue.ms,
    },
    renderedTracks,
    renderedAlbums,
    renderedTracksAfterScroll: afterScroll,
    note: "Synthetic database benchmark; not a measurement of scanning 100000 real files.",
  };
  await writeFile(
    "verification/catalog-benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  await app.close();
}
