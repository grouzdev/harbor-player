// @ts-check
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { LibraryScanner } from "../dist/server/library-scanner.js";

const root = path.resolve(".test-data/scan-benchmark");
const music = path.join(root, "music");
const fileCount = 10_000;
const directories = 1_000;
if (!root.startsWith(path.resolve(".test-data") + path.sep))
  throw new Error("Unsafe test path");

await rm(root, { recursive: true, force: true });
await mkdir(music, { recursive: true });
for (let directory = 0; directory < directories; directory++) {
  const folder = path.join(
    music,
    `Artist-${String(directory).padStart(4, "0")}`,
  );
  await mkdir(folder, { recursive: true });
  await Promise.all(
    Array.from({ length: fileCount / directories }, (_, index) =>
      writeFile(path.join(folder, `${index}.mp3`), ""),
    ),
  );
}

const libraries = new Map();
const tracks = new Map();
const library = {
  id: "scan-benchmark",
  name: "Scan benchmark",
  path: music,
  available: true,
};
libraries.set(library.id, library);
/** @type {any} */
const catalog = {
  libraries: () => [...libraries.values()],
  /** @param {string} id @param {boolean} available */
  setLibraryAvailability: (id, available) => {
    const entry = libraries.get(id);
    if (entry) entry.available = available;
  },
  /** @param {string} id */
  library: (id) => {
    const entry = libraries.get(id);
    if (!entry) throw new Error("Library missing from benchmark");
    return entry;
  },
  /** @param {string} libraryId @param {string} relativePath */
  scannedTrack: (libraryId, relativePath) =>
    tracks.get(`${libraryId}:${relativePath}`),
  markTrackScanned: () => {},
  /** @param {any} track */
  upsert: (track) =>
    tracks.set(`${track.libraryId}:${track.relativePath}`, track),
  finishScan: () => {},
  markLibraryScanned: () => {},
};
let metadataReads = 0;
const workers = {
  /** @param {any} _kind @param {any} args */
  async run(_kind, args) {
    metadataReads++;
    const relativePath = path.relative(args.root, args.file);
    const info = await stat(args.file);
    return {
      id: args.id,
      libraryId: args.libraryId,
      relativePath,
      title: path.basename(relativePath, ".mp3"),
      artists: ["Benchmark"],
      albumTitle: "Scan benchmark",
      albumArtists: ["Benchmark"],
      albumKey: "scan-benchmark",
      genres: [],
      year: null,
      trackNumber: null,
      discNumber: null,
      duration: 0,
      format: "mp3",
      size: 0,
      mtimeMs: info.mtimeMs,
      coverId: null,
      missingTagFields: [],
      available: true,
    };
  },
};
const scanner = new LibraryScanner(catalog, workers, path.join(root, "data"));
/** @param {string} id */
const job = (id) => ({
  id,
  kind: "scan",
  label: "Scan benchmark",
  status: "running",
  completed: 0,
  total: 0,
  errors: [],
  createdAt: new Date().toISOString(),
});
/** @param {string} id @param {string} libraryId */
const measure = async (id, libraryId) => {
  const scanJob = job(id);
  const readsBefore = metadataReads;
  const start = performance.now();
  let error = null;
  try {
    await scanner.scan(libraryId, scanJob, false, () => {});
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return {
    durationMs: Math.round(performance.now() - start),
    audioFiles: scanJob.total,
    completed: scanJob.completed,
    metadataReads: metadataReads - readsBefore,
    errors: scanJob.errors.length,
    error,
  };
};

const full = await measure("full", library.id);
const incremental = await measure("incremental", library.id);
const unavailable = {
  id: "unavailable-benchmark",
  name: "Unavailable benchmark",
  path: path.join(root, "unavailable"),
  available: false,
};
libraries.set(unavailable.id, unavailable);
const unavailableResult = await measure("unavailable", unavailable.id);
const report = {
  date: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  fixture: { files: fileCount, directories, extension: "mp3" },
  full,
  incremental,
  unavailable: unavailableResult,
  note: "Synthetic traversal benchmark. Metadata reads use a deterministic worker stub; it measures scan scheduling, traversal, stat and incremental reuse, not codec parsing throughput.",
};
if (
  full.metadataReads !== fileCount ||
  incremental.metadataReads !== 0 ||
  unavailableResult.error !== "Папка библиотеки недоступна"
)
  throw new Error(`Scan benchmark fixture mismatch: ${JSON.stringify(report)}`);
await writeFile(
  path.join(root, "scan-benchmark.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
