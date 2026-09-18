// @ts-check
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createApp } from "../dist/server/app.js";
import { emptyFilter } from "../dist/shared/contracts.js";
const root = path.resolve(".test-data/benchmark");
const writeBaseline = process.argv.slice(2).includes("--write-baseline");
const outputPath = writeBaseline
  ? path.resolve("verification/catalog-benchmark.json")
  : path.join(root, "catalog-benchmark.json");
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
  const albumArtist = service.catalog.db.prepare(
    "INSERT INTO track_album_artists VALUES (?,?)",
  );
  const seedStart = performance.now();
  service.catalog.db.transaction(() => {
    for (let i = 0; i < 100000; i++) {
      const album = Math.floor(i / 10)
        .toString()
        .padStart(5, "0");
      const artistFolder = `Artist ${Math.floor(Number(album) / 100)
        .toString()
        .padStart(3, "0")}`;
      const artist = `Исполнитель ${String(Math.floor(i / 10) % 1000).padStart(4, "0")}`;
      const genreName = `Жанр ${String(i % 20).padStart(2, "0")}`;
      const id = `track-${i}`;
      insert.run(
        id,
        lib.id,
        path.join(artistFolder, `Album ${album}`, `${i}.flac`),
        `Трек ${i}`,
        JSON.stringify([artist]),
        `Альбом ${album}`,
        JSON.stringify([artist]),
        album.padStart(64, "0"),
        JSON.stringify([genreName]),
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
      genre.run(id, genreName);
      albumArtist.run(id, artist);
      service.catalog.db
        .prepare("INSERT INTO track_artists VALUES (?,?)")
        .run(id, artist);
    }
  })();
  const seedMs = Math.round(performance.now() - seedStart);
  /** @template T @param {() => T} fn */
  const timed = (fn) => {
    const start = performance.now();
    const result = fn();
    return { ms: Math.round(performance.now() - start), result };
  };
  /** @param {number[]} values */
  const median = (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    return Math.round(sorted[Math.floor(sorted.length / 2)]);
  };
  /** @template T @param {() => T} fn */
  const timedMedian = (fn) => {
    /** @type {T | undefined} */
    let result;
    const samples = Array.from({ length: 5 }, () => {
      const measurement = timed(fn);
      result = measurement.result;
      return measurement.ms;
    });
    return { ms: median(samples), samples, result };
  };
  const tracks = timed(() => service.catalog.tracks(emptyFilter));
  const albums = timed(() => service.catalog.albums(emptyFilter));
  const genres = timed(() => service.catalog.genres(emptyFilter));
  const queue = timed(() => service.catalog.trackIds(emptyFilter));
  const rootFolders = timed(() => service.catalog.folders(lib.id, null));
  const nestedFolders = timed(() =>
    service.catalog.folders(lib.id, "Artist 000"),
  );
  const folderTracks = timed(() =>
    service.catalog.tracks({
      ...emptyFilter,
      folders: [{ libraryId: lib.id, relativePath: "Artist 000" }],
    }),
  );
  const facetArtists = Array.from(
    { length: 50 },
    (_, index) => `Исполнитель ${String(index * 2).padStart(4, "0")}`,
  );
  const facetArtistsResult = timedMedian(() =>
    service.catalog.artists(emptyFilter),
  );
  const facetRelevance = timedMedian(() =>
    service.catalog.facetRelevance({ ...emptyFilter, artists: facetArtists }),
  );
  const filterValidity = timedMedian(() =>
    service.catalog.filterValidity({
      ...emptyFilter,
      genres: ["Жанр 00", "Жанр 01"],
      artists: facetArtists.slice(0, 2),
    }),
  );
  const expected = {
    tracks: 100000,
    albums: 10000,
    selectedTracks: 1000,
  };
  if (
    tracks.result.total !== expected.tracks ||
    albums.result.total !== expected.albums ||
    folderTracks.result.total !== expected.selectedTracks
  )
    throw new Error(
      `Benchmark fixture mismatch: ${JSON.stringify({
        expected,
        tracks: tracks.result.total,
        albums: albums.result.total,
        selectedTracks: folderTracks.result.total,
      })}`,
    );
  if (
    facetArtistsResult.result?.total !== 1000 ||
    facetRelevance.result?.folders.length !== 510 ||
    filterValidity.result?.artists.length !== 2
  )
    throw new Error("Facet benchmark fixture mismatch");
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
    expected,
    seedMs,
    queryMs: {
      tracks: tracks.ms,
      albums: albums.ms,
      genres: genres.ms,
      queueSnapshot: queue.ms,
      rootFolders: rootFolders.ms,
      nestedFolders: nestedFolders.ms,
      folderTracks: folderTracks.ms,
    },
    facetBenchmark: {
      medianBudgetMs: 500,
      artists: {
        medianMs: facetArtistsResult.ms,
        samplesMs: facetArtistsResult.samples,
        total: facetArtistsResult.result?.total,
      },
      facetRelevance: {
        medianMs: facetRelevance.ms,
        samplesMs: facetRelevance.samples,
        folders: facetRelevance.result?.folders.length,
      },
      filterValidity: {
        medianMs: filterValidity.ms,
        samplesMs: filterValidity.samples,
        artists: filterValidity.result?.artists.length,
      },
    },
    folderCounts: {
      root: rootFolders.result.length,
      nested: nestedFolders.result.length,
      selectedTracks: folderTracks.result.total,
    },
    renderedTracks,
    renderedAlbums,
    renderedTracksAfterScroll: afterScroll,
    note: "Synthetic database benchmark; not a measurement of scanning 100000 real files. Facet medians use five warm runs.",
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  await app.close();
}
