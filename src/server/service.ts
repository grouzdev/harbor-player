import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  rmdir,
  rm,
  realpath,
  stat,
  lstat,
  unlink,
  rename,
  readFile,
  open,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Catalog } from "./database.js";
import { Workers } from "./workers.js";
import { acquireInstanceLock } from "./instance-lock.js";
import { forkedTagWriter, type TagWriter } from "./isolated-tag-writer.js";
import { writeId3InPlace } from "./in-place-id3.js";
import { errorMessage, inside } from "./config.js";
import { badRequest, conflict, unavailable } from "./http-error.js";
import { LibraryScanner } from "./library-scanner.js";
import { readTrack } from "./metadata.js";
import { normalizedAlbumFolder } from "./album-identity.js";
import { MusicBrainzService, type MusicBrainzOptions } from "./musicbrainz.js";
import {
  OperationOrchestrator,
  type OperationBackend,
} from "./operation-orchestrator.js";
import type { ServiceEvent } from "./service-events.js";
import type {
  Capabilities,
  Job,
  OperationItem,
  OperationKind,
  OperationPreview,
  OperationRetryResult,
  Selection,
  FolderMoveRoot,
  TagPatch,
  PerTrackTagPatch,
  Track,
} from "../shared/contracts.js";
import { emptyFilter } from "../shared/contracts.js";
import type {
  RecoverySettings,
  RecoveryStatus,
} from "../shared/recovery-settings.js";
import {
  readRecoverySettings,
  writeRecoverySettings,
} from "./recovery-settings.js";

interface JournalItem extends OperationItem {
  producedHash?: string;
  stage?: string;
  backup?: string;
  restoreExpectedHash?: string;
}
// Keep the verified recovery workflow available for a future opt-in, but make
// ordinary deletion irreversible until that mode is explicitly re-enabled.
const softDeleteEnabled = false;
const exists = async (file: string) => {
  try {
    await lstat(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
};
const flushFile = async (file: string) => {
  const handle = await open(file, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export class MusicService extends EventEmitter {
  readonly catalog: Catalog;
  readonly workers: Workers;
  readonly scanner: LibraryScanner;
  readonly musicBrainz: MusicBrainzService;
  readonly operations: OperationOrchestrator;
  private readonly unlock: () => void;
  private pending = Promise.resolve();
  private cancelledJobs = new Set<string>();
  private active = new Set<string>();
  private stopping = false;
  private closePromise?: Promise<void>;
  private recoverySettings: RecoverySettings = { backupRetention: "none" };
  private recoveryTimer?: NodeJS.Timeout;
  capabilities: Capabilities = { writableFormats: [], verificationDate: null };
  closeStreams: (trackIds: string[]) => Promise<void> = async () => {};
  constructor(
    readonly dataDir: string,
    musicBrainzOptions: MusicBrainzOptions = {},
    private readonly tagWriter: TagWriter = forkedTagWriter,
  ) {
    super();
    this.unlock = acquireInstanceLock(dataDir);
    try {
      this.catalog = new Catalog(dataDir);
      this.workers = new Workers(2);
      this.scanner = new LibraryScanner(this.catalog, this.workers, dataDir);
      this.musicBrainz = new MusicBrainzService(
        this.catalog,
        dataDir,
        musicBrainzOptions,
      );
      this.operations = new OperationOrchestrator({
        preview: (...args) => this.previewInternal(...args),
        previewRestore: (id) => this.previewRestoreInternal(id),
        previewRetry: (id) => this.previewRetryInternal(id),
        execute: (id) => this.executeInternal(id),
        operation: (id) => this.catalog.operation(id),
      } satisfies OperationBackend);
    } catch (e) {
      this.unlock();
      throw e;
    }
    for (const job of this.catalog.jobs())
      if (job.status === "queued" || job.status === "running") {
        job.status = "error";
        job.errors.push("Работа прервана остановкой сервиса");
        this.catalog.saveJob(job);
      }
    for (const operation of this.catalog.history())
      if (operation.status === "running") {
        operation.status = "interrupted";
        this.catalog.saveOperation(operation);
      }
  }
  async initialize() {
    this.recoverySettings = await readRecoverySettings(this.dataDir);
    await this.maintainRecovery();
    this.recoveryTimer = setInterval(
      () => void this.maintainRecovery(),
      60 * 60 * 1000,
    );
    try {
      const report = JSON.parse(
        await readFile(
          new URL("../../verification/tag-support.json", import.meta.url),
          "utf8",
        ),
      );
      const pkg = JSON.parse(
        await readFile(
          new URL(
            "../../node_modules/@digimezzo/node-taglib-sharp/package.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      if (report.writerVersion === pkg.version)
        this.capabilities = {
          writableFormats: report.formats
            .filter((f: { passed: boolean }) => f.passed)
            .map((f: { format: string }) => f.format),
          verificationDate: report.date,
        };
    } catch {
      /* No proof of safe writes: keep the editor read-only. */
    }
    await this.scanner.refreshAvailability();
  }
  async recoveryStatus(): Promise<RecoveryStatus> {
    const recovery = path.join(this.dataDir, "recovery");
    let size = 0;
    let hasFiles = false;
    const visit = async (directory: string): Promise<void> => {
      let entries: Array<{
        name: string;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile()) {
          size += (await stat(file)).size;
          hasFiles = true;
        }
      }
    };
    await visit(recovery);
    return { ...this.recoverySettings, size, hasFiles };
  }
  async updateRecoverySettings(settings: RecoverySettings) {
    this.recoverySettings = await writeRecoverySettings(this.dataDir, settings);
    await this.maintainRecovery();
    return this.recoveryStatus();
  }
  async clearRecovery() {
    await rm(path.join(this.dataDir, "recovery"), {
      recursive: true,
      force: true,
    });
    this.markRecoveryUnavailable(() => true);
    return this.recoveryStatus();
  }
  private markRecoveryUnavailable(
    matches: (operation: OperationPreview) => boolean,
  ) {
    for (const operation of this.catalog.history()) {
      if (
        matches(operation) &&
        ["tags", "trash"].includes(operation.kind) &&
        operation.recoverable !== false
      ) {
        operation.recoverable = false;
        this.catalog.saveOperation(operation);
      }
    }
  }
  private async maintainRecovery() {
    const retention = this.recoverySettings.backupRetention;
    if (retention === "none" || retention === "never") return;
    const age =
      retention === "1d" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - age;
    const expired = this.catalog
      .history()
      .filter(
        (operation) =>
          operation.status === "done" &&
          ["tags", "trash"].includes(operation.kind) &&
          operation.recoverable !== false &&
          Date.parse(operation.createdAt) < cutoff,
      );
    for (const operation of expired)
      await rm(path.join(this.dataDir, "recovery", operation.id), {
        recursive: true,
        force: true,
      });
    const expiredIds = new Set(expired.map((operation) => operation.id));
    this.markRecoveryUnavailable((operation) => expiredIds.has(operation.id));
  }
  async refreshAvailability() {
    await this.scanner.refreshAvailability();
  }
  async addLibrary(name: string, folder: string) {
    if (!path.isAbsolute(folder))
      throw badRequest("Укажите абсолютный путь к папке");
    const resolved = await realpath(folder);
    if (!(await stat(resolved)).isDirectory()) throw new Error("Укажите папку");
    await access(resolved, constants.R_OK);
    if (inside(resolved, this.dataDir) || inside(this.dataDir, resolved))
      throw new Error(
        "Каталог данных приложения не может быть музыкальной библиотекой",
      );
    for (const l of this.catalog.libraries())
      if (inside(l.path, resolved) || inside(resolved, l.path))
        throw conflict("Эта папка или её родитель уже подключены");
    const library = this.catalog.addLibrary(
      name.trim() || path.basename(resolved),
      resolved,
    );
    return { library, job: this.scan(library.id) };
  }
  renameLibrary(libraryId: string, name: string) {
    return this.catalog.renameLibrary(libraryId, name);
  }
  removeLibrary(libraryId: string): Job {
    const library = this.catalog.library(libraryId);
    return this.enqueue(
      "library",
      `Отключение библиотеки: ${library.name}`,
      async () => {
        this.catalog.removeLibrary(libraryId);
      },
    );
  }
  private publish(job: Job) {
    this.catalog.saveJob(job);
    this.publishEvent({ type: "job", job });
  }
  publishEvent(event: ServiceEvent): void {
    this.emit("change", event);
  }
  onChange(listener: (event: ServiceEvent) => void): void {
    this.on("change", listener);
  }
  offChange(listener: (event: ServiceEvent) => void): void {
    this.off("change", listener);
  }
  private enqueue(
    kind: Job["kind"],
    label: string,
    action: (job: Job) => Promise<void>,
    operationId?: string,
  ): Job {
    if (this.stopping) throw unavailable("Сервис останавливается");
    const job: Job = {
      id: randomUUID(),
      kind,
      label,
      status: "queued",
      completed: 0,
      total: 0,
      errors: [],
      createdAt: new Date().toISOString(),
      operationId,
    };
    this.publish(job);
    this.pending = this.pending.then(async () => {
      // A queued scan can be cancelled during a controlled desktop update.
      // Its already-scheduled callback must not turn it back into a running job.
      if (job.status !== "queued" || this.cancelledJobs.has(job.id)) return;
      job.status = "running";
      this.publish(job);
      try {
        await action(job);
        job.status = job.errors.length ? "error" : "done";
      } catch (e) {
        job.status = "error";
        job.errors.push(errorMessage(e));
      }
      this.publish(job);
      this.publishEvent({ type: "catalog" });
    });
    return job;
  }
  scan(libraryId: string, force = false): Job {
    const existing = this.catalog
      .jobs()
      .find(
        (j) =>
          j.label === `Сканирование: ${this.catalog.library(libraryId).name}` &&
          ["queued", "running"].includes(j.status),
      );
    if (existing) return existing;
    return this.enqueue(
      "scan",
      `Сканирование: ${this.catalog.library(libraryId).name}`,
      (job) =>
        this.scanner.scan(libraryId, job, force, () => this.publish(job)),
    );
  }
  async safePath(
    file: string,
    destination = false,
    recovery = false,
    allowLibraryRoot = false,
  ): Promise<void> {
    const roots = this.catalog.libraries().map((l) => l.path);
    if (recovery) roots.push(path.join(this.dataDir, "recovery"));
    const root = roots.find((root) => inside(root, file));
    if (!root || (file === root && !allowLibraryRoot))
      throw new Error("Путь вне музыкальных библиотек");
    // Check every existing ancestor: no symlink/junction traversal, including destination parents.
    const components = path.relative(root, file).split(path.sep);
    let cursor = root;
    if ((await realpath(root)) !== root)
      throw new Error("Папка библиотеки была подменена ссылкой");
    for (const component of components) {
      cursor = path.join(cursor, component);
      try {
        if ((await lstat(cursor)).isSymbolicLink())
          throw new Error("Операции с символическими ссылками запрещены");
      } catch (e) {
        if (destination && (e as NodeJS.ErrnoException).code === "ENOENT")
          break;
        throw e;
      }
    }
  }
  async fingerprint(
    file: string,
    purpose: "source" | "stage" | "other" = "other",
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await stat(file);
      const hash = await this.workers.run("hash", { file });
      const after = await stat(file);
      if (before.size === after.size && before.mtimeMs === after.mtimeMs)
        return { size: after.size, mtimeMs: after.mtimeMs, hash };
      // A timestamp-only touch is not a content conflict. Confirm the bytes once more.
      if (purpose === "source" && before.size === after.size) {
        const confirmed = await this.workers.run("hash", { file });
        const settled = await stat(file);
        if (settled.size === after.size && confirmed === hash)
          return {
            size: settled.size,
            mtimeMs: settled.mtimeMs,
            hash: confirmed,
          };
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (purpose === "stage")
      throw new Error("Временный файл записи нестабилен; исходник сохранён");
    if (purpose === "source")
      throw new Error(
        "Исходный файл изменяется при проверке; повторите операцию",
      );
    throw new Error("Файл изменился при проверке");
  }
  async preview(
    ...args: Parameters<OperationBackend["preview"]>
  ): Promise<OperationPreview> {
    return this.operations.preview(...args);
  }
  private async previewInternal(
    kind: Exclude<OperationKind, "restore">,
    selection: Selection,
    targetLibraryId?: string,
    patch?: TagPatch,
    companions = true,
    itemPatches: Record<string, PerTrackTagPatch> = {},
    coverTrackIds?: string[],
    folderRoots?: FolderMoveRoot[],
    intent?: OperationPreview["intent"],
  ): Promise<OperationPreview> {
    const tracks = folderRoots?.length
      ? this.catalog.selected({
          filter: {
            ...emptyFilter,
            libraryIds: [],
            folders: folderRoots,
            genres: [],
            artists: [],
            albumIds: [],
            search: "",
          },
        })
      : this.catalog.selected(selection);
    if (!tracks.length) throw new Error("Выберите треки");
    if (intent === "album-merge") {
      const allowedFields = new Set([
        "albumTitle",
        "albumArtists",
        "year",
        "cover",
      ]);
      if (
        kind !== "tags" ||
        !("filter" in selection) ||
        new Set(selection.filter.albumIds).size < 2 ||
        selection.filter.libraryIds.length > 0 ||
        selection.filter.folders.length > 0 ||
        selection.filter.genres.length > 0 ||
        selection.filter.artists.length > 0 ||
        selection.filter.search !== "" ||
        selection.filter.bookmarksOnly ||
        companions ||
        folderRoots?.length ||
        Object.keys(itemPatches).length > 0 ||
        !patch ||
        Object.keys(patch).some((field) => !allowedFields.has(field))
      )
        throw new Error("Некорректные параметры объединения альбомов");
      const context = this.catalog.albumMergeContext(selection.filter.albumIds);
      if (!context.compatible) throw new Error(context.blockers[0]);
    }
    const target = targetLibraryId
      ? this.catalog.library(targetLibraryId)
      : undefined;
    if (kind === "move" && !target)
      throw new Error("Выберите целевую библиотеку");
    if (folderRoots?.length && kind !== "move")
      throw new Error("Папки можно переносить только в другую библиотеку");
    if (
      kind === "tags" &&
      (!patch || !Object.keys(patch).length) &&
      !Object.values(itemPatches).some(
        (itemPatch) => Object.keys(itemPatch).length,
      )
    )
      throw new Error("Нет изменений тегов");
    const selectedIds = new Set(tracks.map((track) => track.id));
    if (
      Object.keys(itemPatches).some((id) => !selectedIds.has(id)) ||
      coverTrackIds?.some((id) => !selectedIds.has(id))
    )
      throw new Error("Изменения содержат трек вне текущего выбора");
    const op: OperationPreview = {
      id: randomUUID(),
      kind,
      status: "preview",
      createdAt: new Date().toISOString(),
      items: [],
      targetLibraryId,
      patch,
      coverTrackIds,
      intent,
      recoverable:
        kind === "tags"
          ? this.recoverySettings.backupRetention !== "none"
          : kind !== "trash" || softDeleteEnabled,
    };
    if (
      (kind === "tags" && op.recoverable) ||
      (kind === "trash" && softDeleteEnabled)
    )
      await mkdir(path.join(this.dataDir, "recovery", op.id), {
        recursive: true,
      });
    const tracksBySource = new Map<string, Track>();
    for (const track of tracks) {
      const library = this.catalog.library(track.libraryId);
      tracksBySource.set(path.join(library.path, track.relativePath), track);
    }
    const normalizedRoots = (folderRoots || []).map((root) => ({
      ...root,
      relativePath: path.normalize(root.relativePath),
    }));
    if (folderRoots?.length) {
      const seenRoots = new Set<string>();
      for (const root of normalizedRoots) {
        const library = this.catalog.library(root.libraryId);
        if (
          !library.available ||
          !this.catalog.hasFolder(library.id, root.relativePath)
        )
          throw new Error("Выбранная папка больше недоступна");
        if (library.id === target!.id)
          throw new Error("Целевая библиотека совпадает с источником папки");
        const key = `${library.id}\u0000${root.relativePath}`;
        if (seenRoots.has(key)) throw new Error("Папка выбрана повторно");
        seenRoots.add(key);
      }
      for (const root of normalizedRoots)
        if (
          normalizedRoots.some(
            (parent) =>
              parent !== root &&
              parent.libraryId === root.libraryId &&
              root.relativePath.startsWith(`${parent.relativePath}${path.sep}`),
          )
        )
          throw new Error(
            "Нельзя одновременно переносить папку и её вложенную папку",
          );
      const addFolder = async (libraryId: string, relativePath: string) => {
        const library = this.catalog.library(libraryId);
        const source = path.join(library.path, relativePath);
        const destination = path.join(target!.path, relativePath);
        await this.safePath(source);
        const walk = async (directory: string, targetDirectory: string) => {
          op.items.push({
            id: randomUUID(),
            trackId: null,
            title: path.basename(directory),
            source: directory,
            destination: targetDirectory,
            size: 0,
            mtimeMs: 0,
            hash: "",
            phase: "preview",
            directory: true,
          });
          for (const entry of await readdir(directory, {
            withFileTypes: true,
          })) {
            const child = path.join(directory, entry.name);
            const targetChild = path.join(targetDirectory, entry.name);
            if (entry.isSymbolicLink())
              throw new Error(
                `Символическая ссылка не поддерживается: ${child}`,
              );
            if (entry.isDirectory()) await walk(child, targetChild);
            else if (entry.isFile()) {
              const track = tracksBySource.get(child);
              const item: OperationItem = {
                id: randomUUID(),
                trackId: track?.id || null,
                title: track?.title || entry.name,
                source: child,
                destination: targetChild,
                size: track?.size || 0,
                mtimeMs: track?.mtimeMs || 0,
                hash: "",
                phase: "preview",
                companion: !track,
              };
              try {
                await this.safePath(child);
                await this.safePath(targetChild, true);
                Object.assign(item, await this.fingerprint(child, "source"));
                if (await exists(targetChild))
                  throw new Error(
                    "В целевой папке уже есть файл с таким именем",
                  );
              } catch (error) {
                item.error = errorMessage(error);
              }
              op.items.push(item);
            }
          }
        };
        await walk(source, destination);
      };
      for (const root of normalizedRoots)
        await addFolder(root.libraryId, root.relativePath);
      op.items.sort(
        (left, right) =>
          Number(Boolean(left.directory)) - Number(Boolean(right.directory)) ||
          (left.directory ? right.source.length - left.source.length : 0),
      );
    }
    for (const track of folderRoots?.length ? [] : tracks) {
      const library = this.catalog.library(track.libraryId);
      const source = path.join(library.path, track.relativePath);
      const destination =
        kind === "move"
          ? path.join(target!.path, track.relativePath)
          : kind === "trash"
            ? softDeleteEnabled
              ? path.join(
                  this.dataDir,
                  "recovery",
                  op.id,
                  track.id + path.extname(source),
                )
              : source
            : source;
      const item: OperationItem = {
        id: randomUUID(),
        trackId: track.id,
        title: track.title,
        source,
        destination,
        size: track.size,
        mtimeMs: track.mtimeMs,
        hash: "",
        phase: "preview",
        patch: itemPatches[track.id],
      };
      const effectivePatch =
        kind === "tags" ? this.effectiveTagPatch(op, item) : undefined;
      // A non-null cover is written beside the audio file, so it remains a
      // meaningful operation even though it is deliberately absent from the
      // tag-writer patch below.
      const appliesExternalCover =
        kind === "tags" &&
        op.patch?.cover !== undefined &&
        (!op.coverTrackIds || op.coverTrackIds.includes(track.id));
      if (
        kind === "tags" &&
        ((effectivePatch && Object.keys(effectivePatch).length) ||
          appliesExternalCover)
      )
        item.before = Object.fromEntries(
          Object.keys(effectivePatch || {})
            .filter((k) => k !== "cover")
            .map((k) => [k, track[k as keyof Track]]),
        );
      else if (kind === "tags")
        item.error = "Для трека нет выбранных изменений";
      op.items.push(item);
    }
    // Keep preview item order stable while using both hash workers.
    if (!folderRoots?.length)
      for (let start = 0; start < tracks.length; start += 2)
        await Promise.all(
          tracks.slice(start, start + 2).map(async (track, offset) => {
            const item = op.items[start + offset];
            try {
              await this.safePath(item.source);
              const current = await stat(item.source);
              if (current.size !== track.size)
                throw new Error(
                  "Файл изменился извне. Сначала обновите библиотеку.",
                );
              if (kind === "tags") {
                item.size = current.size;
                item.mtimeMs = current.mtimeMs;
              } else
                Object.assign(
                  item,
                  await this.fingerprint(item.source, "source"),
                );
              if (
                kind === "tags" &&
                Object.keys(this.effectiveTagPatch(op, item)).length > 0 &&
                !this.capabilities.writableFormats.includes(track.format)
              )
                throw new Error(
                  `Запись ${track.format.toUpperCase()} не прошла проверку безопасности и отключена`,
                );
              if (kind === "move") {
                await this.safePath(item.destination, true);
                if (await exists(item.destination))
                  throw new Error(
                    "В целевой папке уже есть файл с таким именем",
                  );
              }
            } catch (e) {
              item.error = errorMessage(e);
            }
          }),
        );
    if (kind === "move" && companions) {
      const selectedIds = new Set(tracks.map((track) => track.id));
      const albums = new Map<string, Track[]>();
      for (const track of tracks) {
        const key = `${track.libraryId}\u0000${track.albumKey}`;
        albums.set(key, [...(albums.get(key) || []), track]);
      }
      const roots = new Set<string>();
      for (const albumTracks of albums.values()) {
        const first = albumTracks[0];
        const library = this.catalog.library(first.libraryId);
        if (
          this.catalog.albumAvailableTrackCount(first.albumKey) !==
          albumTracks.length
        )
          continue;
        const root = path.join(
          library.path,
          normalizedAlbumFolder(first.relativePath),
        );
        // Never turn the library root itself into a removable album folder.
        if (
          path.resolve(root) === path.resolve(library.path) ||
          roots.has(root)
        )
          continue;
        const available = this.catalog.availableLibraryTracks(library.id);
        if (
          available.some(
            (track) =>
              inside(root, path.join(library.path, track.relativePath)) &&
              !selectedIds.has(track.id),
          )
        )
          continue;
        roots.add(root);
        const addTree = async (directory: string) => {
          const destination = path.join(
            target!.path,
            path.relative(library.path, directory),
          );
          op.items.push({
            id: randomUUID(),
            trackId: null,
            title: path.basename(directory),
            source: directory,
            destination,
            size: 0,
            mtimeMs: 0,
            hash: "",
            phase: "preview",
            directory: true,
          });
          for (const entry of await readdir(directory, {
            withFileTypes: true,
          })) {
            const source = path.join(directory, entry.name);
            if (entry.isSymbolicLink())
              throw new Error(
                `Символическая ссылка не поддерживается: ${source}`,
              );
            if (entry.isDirectory()) {
              await addTree(source);
              continue;
            }
            if (!entry.isFile()) continue;
            if (tracksBySource.has(source)) continue;
            const item: OperationItem = {
              id: randomUUID(),
              trackId: null,
              title: entry.name,
              source,
              destination: path.join(destination, entry.name),
              size: 0,
              mtimeMs: 0,
              hash: "",
              phase: "preview",
              companion: true,
            };
            try {
              await this.safePath(source);
              await this.safePath(item.destination, true);
              Object.assign(item, await this.fingerprint(source));
              if (await exists(item.destination))
                throw new Error("В целевой папке уже есть файл с таким именем");
            } catch (error) {
              item.error = errorMessage(error);
            }
            op.items.push(item);
          }
        };
        await addTree(root);
      }
      op.items.sort(
        (left, right) =>
          Number(Boolean(left.directory)) - Number(Boolean(right.directory)) ||
          (left.directory ? right.source.length - left.source.length : 0),
      );
    }
    const destinations = new Set<string>();
    for (const item of op.items) {
      const key =
        process.platform === "win32"
          ? item.destination.toLowerCase()
          : item.destination;
      if (destinations.has(key))
        item.error = "Несколько файлов имеют один целевой путь";
      destinations.add(key);
    }
    this.catalog.saveOperation(op);
    return op;
  }
  async previewRestore(id: string): Promise<OperationPreview> {
    return this.operations.previewRestore(id);
  }
  private async previewRestoreInternal(id: string): Promise<OperationPreview> {
    const original = this.catalog.operation(id);
    if (!["trash", "tags"].includes(original.kind))
      throw new Error("Восстановление доступно для удаления и тегов");
    if (original.recoverable === false)
      throw new Error(
        "Удаление было окончательным и не может быть восстановлено",
      );
    const op: OperationPreview = {
      id: randomUUID(),
      kind: "restore",
      status: "preview",
      createdAt: new Date().toISOString(),
      items: [],
      restoreOf: id,
    };
    for (const item of original.items as JournalItem[]) {
      if (item.phase !== "done") continue;
      const source =
        original.kind === "trash" ? item.destination : item.backup!;
      const restored: JournalItem = {
        ...item,
        id: randomUUID(),
        source,
        destination: item.source,
        phase: "preview",
        error: undefined,
        stage: undefined,
        backup: undefined,
        producedHash: undefined,
        restoreExpectedHash:
          original.kind === "tags" ? item.producedHash : undefined,
      };
      try {
        await this.safePath(source, false, true);
        Object.assign(restored, await this.fingerprint(source));
        if (original.kind === "trash" && (await exists(restored.destination)))
          throw new Error("Исходный путь уже занят");
      } catch (e) {
        restored.error = errorMessage(e);
      }
      op.items.push(restored);
    }
    if (!op.items.length) throw new Error("Нет файлов для восстановления");
    this.catalog.saveOperation(op);
    return op;
  }
  async previewRetry(id: string): Promise<OperationPreview> {
    return this.operations.previewRetry(id);
  }
  private async previewRetryInternal(id: string): Promise<OperationPreview> {
    const original = this.catalog.operation(id);
    if (original.kind !== "tags" || original.status === "running")
      throw new Error(
        "Повторный просмотр доступен только для завершённой операции тегов",
      );
    if (!original.patch && !original.items.some((item) => item.patch))
      throw new Error("В исходной операции отсутствуют данные тегов");
    const trackIds = [
      ...new Set(
        original.items
          .filter((item) => item.phase !== "done" && item.trackId)
          .map((item) => item.trackId!),
      ),
    ];
    if (!trackIds.length) throw new Error("Нет незавершённых файлов");
    const itemPatches = Object.fromEntries(
      original.items
        .filter(
          (item) =>
            item.trackId && item.patch && trackIds.includes(item.trackId),
        )
        .map((item) => [item.trackId!, item.patch!]),
    );
    const retry = await this.previewInternal(
      "tags",
      { trackIds },
      undefined,
      original.patch,
      false,
      itemPatches,
      original.coverTrackIds?.filter((trackId) => trackIds.includes(trackId)),
    );
    if (original.intent) {
      retry.intent = original.intent;
      this.catalog.saveOperation(retry);
    }
    return retry;
  }
  async retry(id: string): Promise<OperationRetryResult> {
    return this.operations.retry(id);
  }
  execute(id: string): Job {
    return this.operations.execute(id);
  }
  private executeInternal(id: string): Job {
    const op = this.catalog.operation(id);
    if (this.active.has(id) || op.status === "running")
      throw new Error("Операция уже запущена");
    if (
      op.status === "done" &&
      op.items.every(
        (i) => i.phase === "done" || (i.error && i.phase === "preview"),
      )
    )
      throw new Error("Операция уже завершена");
    if (
      op.intent === "album-merge" &&
      op.items.some((item) => item.error && item.phase === "preview")
    )
      throw new Error(
        "Объединение нельзя запустить, пока в предпросмотре есть ошибки",
      );
    this.active.add(id);
    op.status = "running";
    this.catalog.saveOperation(op);
    return this.enqueue(
      "operation",
      op.intent === "album-merge"
        ? "Объединение альбомов"
        : {
            move: "Перенос файлов",
            trash: "Удаление с восстановлением",
            tags: "Сохранение тегов",
            restore: "Восстановление",
          }[op.kind],
      async (job) => {
        try {
          job.total = op.items.length;
          const ids = op.items.filter((i) => i.trackId).map((i) => i.trackId!);
          await this.closeStreams(ids);
          await this.applyExternalCovers(op);
          for (const item of op.items as JournalItem[]) {
            if (item.phase === "done") {
              job.completed++;
              continue;
            }
            if (item.error && item.phase === "preview") {
              if (job.errors.length < 100)
                job.errors.push(`${item.title}: ${item.error}`);
              job.completed++;
              continue;
            }
            try {
              if (
                op.kind === "tags" &&
                !Object.keys(this.effectiveTagPatch(op, item)).length
              ) {
                await this.reindexItem(op, item, true);
                item.phase = "done";
                job.completed++;
                this.catalog.saveOperation(op);
                this.publish(job);
                continue;
              }
              await this.applyItem(op, item);
              item.phase = "done";
              item.error = undefined;
            } catch (e) {
              item.error = errorMessage(e);
              if (job.errors.length < 100)
                job.errors.push(`${item.title}: ${item.error}`);
            }
            job.completed++;
            this.catalog.saveOperation(op);
            this.publish(job);
          }
          op.status = "done";
          this.catalog.saveOperation(op);
        } finally {
          this.active.delete(id);
          this.publishEvent({ type: "operation-finished", operationId: id });
        }
      },
      id,
    );
  }
  private async assertOriginal(item: JournalItem) {
    const actual = await this.fingerprint(item.source, "source");
    if (actual.hash !== item.hash || actual.size !== item.size)
      throw new Error(
        "Исходный файл изменился после предварительного просмотра",
      );
  }
  private async applyItem(
    op: OperationPreview,
    item: JournalItem,
  ): Promise<void> {
    if (item.directory) {
      await this.safePath(item.source);
      await this.safePath(item.destination, true);
      if (!(await stat(item.source)).isDirectory())
        throw new Error("Исходная папка больше не существует");
      if (await exists(item.destination)) {
        if (!(await stat(item.destination)).isDirectory())
          throw new Error("Целевой путь занят файлом");
      } else await mkdir(item.destination, { recursive: true });
      await rmdir(item.source);
      return;
    }
    const restoringTags =
      op.kind === "restore" &&
      this.catalog.operation(op.restoreOf!).kind === "tags";
    const editing = op.kind === "tags" || restoringTags;
    const hardDeleting = op.kind === "trash" && op.recoverable === false;
    await this.safePath(item.source, true, op.kind === "restore");
    if (!hardDeleting)
      await this.safePath(item.destination, true, op.kind === "trash");
    if (hardDeleting) {
      if (item.phase === "copied") {
        await this.reindexItem(op, item);
        return;
      }
      if (await exists(item.source)) {
        await this.assertOriginal(item);
        item.phase = "prepared";
        this.catalog.saveOperation(op);
        await unlink(item.source);
      } else if (item.phase !== "prepared") {
        throw new Error("Исходный файл больше не существует");
      }
      item.phase = "copied";
      this.catalog.saveOperation(op);
      await this.reindexItem(op, item);
      return;
    }
    if (op.kind === "tags" && item.phase === "preview" && !item.hash) {
      const fast = await writeId3InPlace(
        item.destination,
        this.effectiveTagPatch(op, item),
      );
      if (fast.fast) {
        item.result = "Теги записаны без копирования аудиофайла";
        await this.reindexItem(op, item, true);
        return;
      }
      item.result = `Требуется полная запись: ${fast.reason}`;
      Object.assign(item, await this.fingerprint(item.source, "source"));
    }
    if (item.phase === "prepared" && (await exists(item.destination))) {
      const destinationHash = (await this.fingerprint(item.destination)).hash;
      if (
        (!editing && destinationHash === item.hash) ||
        (editing &&
          item.producedHash &&
          destinationHash === item.producedHash &&
          item.backup &&
          (await exists(item.backup)))
      ) {
        item.phase = "copied";
        this.catalog.saveOperation(op);
      }
    }
    // A verified destination can be reconciled after interruption without repeating the copy.
    if (item.phase === "copied" && (await exists(item.destination))) {
      if (
        (await this.fingerprint(item.destination)).hash !==
        (item.producedHash || item.hash)
      )
        throw new Error("Целевой файл изменился; требуется ручная проверка");
      if (!editing && (await exists(item.source))) {
        await this.assertOriginal(item);
        await unlink(item.source);
      }
      await this.reindexItem(op, item);
      return;
    }
    await this.assertOriginal(item);
    await mkdir(path.dirname(item.destination), { recursive: true });
    await this.safePath(item.destination, true, op.kind === "trash");
    if (!editing && (await exists(item.destination)))
      throw new Error("Целевой путь занят. Исходный файл сохранён.");
    if (
      restoringTags &&
      (!(await exists(item.destination)) ||
        (await this.fingerprint(item.destination)).hash !==
          item.restoreExpectedHash)
    )
      throw new Error(
        "Теги уже изменились после операции. Восстановление отменено.",
      );
    if (editing) {
      const stage =
        item.stage ||
        path.join(
          path.dirname(item.destination),
          `.harbor-player-${op.id}-${item.id}${path.extname(item.destination)}`,
        );
      const backup = op.recoverable
        ? item.backup ||
          path.join(
            this.dataDir,
            "recovery",
            op.id,
            item.id + path.extname(item.destination),
          )
        : undefined;
      item.stage = stage;
      item.backup = backup;
      item.phase = "prepared";
      this.catalog.saveOperation(op);
      if (backup) await mkdir(path.dirname(backup), { recursive: true });
      // This path is generated by us and recorded before creation. Retry rebuilds only this owned copy.
      if (await exists(stage)) {
        await this.safePath(stage);
        await unlink(stage);
      }
      await copyFile(item.source, stage, constants.COPYFILE_EXCL);
      try {
        if ((await this.fingerprint(stage, "stage")).hash !== item.hash)
          throw new Error("Временная копия не прошла проверку");
        if (op.kind === "tags")
          await this.tagWriter.write(stage, this.effectiveTagPatch(op, item));
        item.producedHash = (await this.fingerprint(stage, "stage")).hash;
        if (
          restoringTags &&
          (await this.fingerprint(item.destination)).hash !==
            item.restoreExpectedHash
        )
          throw new Error("Файл изменился перед восстановлением");
        const expectedBackup = restoringTags
          ? item.restoreExpectedHash
          : item.hash;
        if (backup) {
          if (!(await exists(backup)))
            await copyFile(item.destination, backup, constants.COPYFILE_EXCL);
          if ((await this.fingerprint(backup)).hash !== expectedBackup) {
            if (op.kind === "tags") await this.assertOriginal(item);
            throw new Error("Резервная копия не прошла проверку");
          }
          await flushFile(backup);
        }
        await flushFile(stage);
        this.catalog.saveOperation(op);
        if (op.kind === "tags") await this.assertOriginal(item);
        else if (
          (await this.fingerprint(item.destination)).hash !==
          item.restoreExpectedHash
        )
          throw new Error("Файл изменился перед заменой");
        // rename replaces atomically on the local filesystem; the original is already backed up.
        await rename(stage, item.destination);
        item.phase = "copied";
        this.catalog.saveOperation(op);
      } catch (e) {
        await unlink(stage).catch(() => {});
        throw e;
      }
    } else {
      item.phase = "prepared";
      this.catalog.saveOperation(op);
      await copyFile(item.source, item.destination, constants.COPYFILE_EXCL);
      if ((await this.fingerprint(item.destination)).hash !== item.hash)
        throw new Error("Копия не прошла проверку. Исходник сохранён.");
      await flushFile(item.destination);
      item.phase = "copied";
      this.catalog.saveOperation(op);
      await this.assertOriginal(item);
      await unlink(item.source);
    }
    await this.reindexItem(op, item);
  }
  private effectiveTagPatch(
    op: OperationPreview,
    item: OperationItem,
  ): TagPatch {
    const patch: TagPatch = { ...(item.patch || {}), ...(op.patch || {}) };
    if (
      patch.cover !== undefined &&
      op.coverTrackIds &&
      (!item.trackId || !op.coverTrackIds.includes(item.trackId))
    )
      delete patch.cover;
    // New artwork lives beside the album instead of being duplicated in audio files.
    if (patch.cover !== undefined && patch.cover !== null) delete patch.cover;
    return patch;
  }
  private async applyExternalCovers(op: OperationPreview) {
    if (op.kind !== "tags" || op.patch?.cover === undefined) return;
    const allowed = op.coverTrackIds ? new Set(op.coverTrackIds) : undefined;
    const folders = new Set(
      op.items
        .filter(
          (item) => item.trackId && (!allowed || allowed.has(item.trackId)),
        )
        .map((item) => path.dirname(item.source)),
    );
    for (const folder of folders) {
      if (op.patch.cover === null) {
        for (const name of [
          "cover.jpg",
          "cover.png",
          "folder.jpg",
          "folder.png",
        ])
          await unlink(path.join(folder, name)).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            },
          );
        continue;
      }
      const ext = op.patch.cover.mime === "image/png" ? "png" : "jpg";
      const target = path.join(folder, `cover.${ext}`);
      const stage = path.join(folder, `.harbor-player-cover-${op.id}.${ext}`);
      await writeFile(stage, Buffer.from(op.patch.cover.data, "base64"), {
        flag: "wx",
      });
      await rename(stage, target);
      const other = path.join(folder, `cover.${ext === "png" ? "jpg" : "png"}`);
      await unlink(other).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  private async reindexItem(
    op: OperationPreview,
    item: OperationItem,
    tagsOnly = false,
  ) {
    if (!item.trackId) return;
    const old = this.catalog.track(item.trackId);
    if (!old) throw new Error("Запись трека не найдена");
    if (op.kind === "trash") this.catalog.markTrackUnavailable(old.id);
    else {
      const lib = this.catalog.library(
        op.kind === "move" ? op.targetLibraryId! : old.libraryId,
      );
      try {
        // This final, serialized read must not depend on the worker result
        // channel: a completed replacement is recoverable by reindexing only.
        const track = await readTrack(
          item.destination,
          lib.id,
          lib.path,
          old.id,
          this.dataDir,
          undefined,
          tagsOnly ? old.duration : undefined,
        );
        if (!track) throw new Error("Обработчик не вернул данные трека");
        this.catalog.upsert(track);
      } catch (error) {
        const restoringTags =
          op.kind === "restore" &&
          this.catalog.operation(op.restoreOf!).kind === "tags";
        if (op.kind === "tags" || restoringTags)
          throw new Error(
            `Теги записаны, но каталог не обновлён; повторите завершение операции (${errorMessage(error)})`,
          );
        throw error;
      }
    }
  }
  async idle() {
    await this.pending;
  }
  beginShutdown() {
    this.stopping = true;
    for (const job of this.catalog.jobs())
      if (job.kind === "scan" && job.status === "queued") {
        this.cancelledJobs.add(job.id);
        job.status = "error";
        job.errors.push("Сканирование отменено при подготовке к обновлению");
        this.publish(job);
      }
  }
  get isStopping() {
    return this.stopping;
  }
  async close() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.beginShutdown();
    if (!this.closePromise)
      this.closePromise = (async () => {
        try {
          await this.pending;
          await this.workers.close();
          this.catalog.close();
        } finally {
          this.unlock();
        }
      })();
    await this.closePromise;
  }
}
