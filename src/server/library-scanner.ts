import { randomUUID } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Job, Track } from "../shared/contracts.js";
import { audioExtensions, errorMessage } from "./config.js";
import { Catalog } from "./database.js";
import { readTrack } from "./metadata.js";
import { Workers } from "./workers.js";

export class LibraryScanner {
  constructor(
    private readonly catalog: Catalog,
    private readonly workers: Workers,
    private readonly dataDir: string,
  ) {}

  async refreshAvailability(): Promise<void> {
    for (const library of this.catalog.libraries()) {
      let available = false;
      try {
        available =
          (await stat(library.path)).isDirectory() &&
          (await realpath(library.path)) === library.path;
      } catch {
        /* offline */
      }
      this.catalog.setLibraryAvailability(library.id, available);
    }
  }

  async scan(
    libraryId: string,
    job: Job,
    force: boolean,
    publishProgress: () => void,
  ): Promise<void> {
    await this.refreshAvailability();
    const library = this.catalog.library(libraryId);
    if (!library.available) throw new Error("Папка библиотеки недоступна");
    const scanId = job.id;
    const directories = [library.path];
    let traversalComplete = true;
    const processFile = async (file: string) => {
      job.total++;
      const relative = path.relative(library.path, file);
      const old = this.catalog.scannedTrack(libraryId, relative);
      try {
        const info = await stat(file);
        if (
          !force &&
          old &&
          old.size === info.size &&
          old.mtimeMs === info.mtimeMs &&
          old.missingTagFields !== null
        )
          this.catalog.markTrackScanned(old.id, scanId);
        else {
          const args = {
            file,
            libraryId,
            root: library.path,
            id: old?.id || randomUUID(),
            dataDir: this.dataDir,
          };
          let track: Track;
          try {
            track = await this.workers.run("read", args);
            if (!track || !Array.isArray(track.artists))
              throw new Error("Рабочий процесс вернул неполные метаданные");
          } catch {
            // A parser/native-module failure in a worker is recoverable by
            // retrying the same read in the serialized server process.
            track = await readTrack(
              args.file,
              args.libraryId,
              args.root,
              args.id,
              args.dataDir,
            );
          }
          this.catalog.upsert(track, scanId);
        }
      } catch (error) {
        if (old) this.catalog.markTrackScanned(old.id, scanId);
        if (job.errors.length < 100)
          job.errors.push(`${relative}: ${errorMessage(error)}`);
      }
      job.completed++;
      if (job.completed % 20 === 0) publishProgress();
    };
    while (directories.length) {
      const folder = directories.pop()!;
      let entries;
      try {
        entries = await readdir(folder, { withFileTypes: true });
      } catch (error) {
        traversalComplete = false;
        if (job.errors.length < 100)
          job.errors.push(`${folder}: ${errorMessage(error)}`);
        continue;
      }
      const files: string[] = [];
      for (const entry of entries) {
        if (
          entry.isSymbolicLink() ||
          entry.name.startsWith(".harbor-player-") ||
          entry.name.startsWith(".mymusiclib-")
        )
          continue;
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) directories.push(file);
        else if (
          entry.isFile() &&
          audioExtensions.has(path.extname(entry.name).toLowerCase())
        )
          files.push(file);
      }
      for (let i = 0; i < files.length; i += 2)
        await Promise.all(files.slice(i, i + 2).map(processFile));
    }
    const completedAt = new Date().toISOString();
    if (traversalComplete)
      this.catalog.finishScan(libraryId, scanId, completedAt);
    else this.catalog.markLibraryScanned(libraryId, completedAt);
  }
}
