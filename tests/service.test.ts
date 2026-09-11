import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { MusicService } from "../dist/server/service.js";
import { emptyFilter } from "../src/shared/contracts.js";
import { audioDigest } from "../src/server/audio-digest.js";
import { parseFile } from "music-metadata";

let root: string;
let external: string | undefined;
let service: MusicService;
const fixtures = path.resolve(".fixtures");
beforeAll(() => {
  if (!existsSync(path.join(fixtures, "sample.flac")))
    execFileSync(process.execPath, ["scripts/generate-fixtures.mjs"]);
});
beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "service-"));
  service = new MusicService(path.join(root, "data"));
  service.capabilities = {
    writableFormats: ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"],
    verificationDate: new Date().toISOString(),
  };
});
afterEach(async () => {
  await service.close();
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
  if (external) {
    if (!external.startsWith(path.join(os.tmpdir(), "mymusiclib-test-")))
      throw new Error("Unsafe external test cleanup");
    await rm(external, { recursive: true, force: true });
    external = undefined;
  }
});
async function library(name: string, extension = "flac") {
  const folder = path.join(root, name);
  await mkdir(path.join(folder, "Album"), { recursive: true });
  await copyFile(
    path.join(fixtures, `sample.${extension}`),
    path.join(folder, "Album", `track.${extension}`),
  );
  const { library } = await service.addLibrary(name, folder);
  await service.idle();
  return library;
}
const tracks = () => service.catalog.tracks(emptyFilter).items;

describe("catalog and safe filesystem operations", () => {
  it("filters multiple performers with genre and library intersection", async () => {
    const a = await library("A");
    await library("B");
    const t = tracks().find((t) => t.libraryId !== a.id)!;
    service.catalog.upsert({
      ...t,
      artists: ["Другой исполнитель", "Исполнитель"],
      genres: ["Jazz"],
    });
    expect(
      service.catalog
        .artists({ ...emptyFilter, genres: ["Jazz"] })
        .items.map((a) => a.name),
    ).toEqual(["Другой исполнитель", "Исполнитель"]);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        artists: ["Другой исполнитель"],
      }).total,
    ).toBe(1);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        artists: ["Другой исполнитель", "Исполнитель"],
      }).total,
    ).toBe(2);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        libraryIds: [a.id],
        artists: ["Другой исполнитель"],
      }).total,
    ).toBe(0);
  });
  it("prevents a second service from mutating the same catalog", () => {
    expect(() => new MusicService(path.join(root, "data"))).toThrow(
      "уже запущен",
    );
  });
  it("scans incrementally, preserves stable IDs, isolates corrupt files, releases folder handles", async () => {
    const lib = await library("Downloads");
    const id = tracks()[0].id;
    await copyFile(
      path.join(fixtures, "broken.mp3"),
      path.join(lib.path, "broken.mp3"),
    );
    service.scan(lib.id);
    await service.idle();
    expect(tracks()).toHaveLength(1);
    expect(tracks()[0].id).toBe(id);
    expect(service.catalog.jobs()[0].errors[0]).toContain("broken.mp3");
    await rename(lib.path, lib.path + "-offline");
    await service.refreshAvailability();
    expect(service.catalog.library(lib.id).available).toBe(false);
    expect(service.catalog.track(id)).toBeDefined();
    expect(tracks()).toHaveLength(0);
    await rename(lib.path + "-offline", lib.path);
    await service.refreshAvailability();
    expect(tracks()).toHaveLength(1);
  });
  it("rejects overlaps and symlink escapes", async () => {
    const lib = await library("Music");
    await expect(
      service.addLibrary("nested", path.join(lib.path, "Album")),
    ).rejects.toThrow("уже подключены");
    await expect(
      service.safePath(path.join(root, "secret.mp3")),
    ).rejects.toThrow("вне");
    await expect(
      service.addLibrary("data", path.join(root, "data")),
    ).rejects.toThrow("Каталог данных");
  });
  it("filters OR within facets, AND between facets, and supports excluded selections", async () => {
    const a = await library("A");
    const b = await library("B");
    const t = tracks().find((t) => t.libraryId === b.id)!;
    service.catalog.upsert({ ...t, genres: ["Rock", "Pop"] });
    expect(
      service.catalog.tracks({ ...emptyFilter, genres: ["Ambient", "Rock"] })
        .total,
    ).toBe(2);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        libraryIds: [a.id],
        genres: ["Rock"],
      }).total,
    ).toBe(0);
    expect(
      service.catalog
        .genres({ ...emptyFilter, libraryIds: [b.id] })
        .map((g) => g.name),
    ).toEqual(["Pop", "Rock"]);
    expect(
      service.catalog.selected({
        filter: emptyFilter,
        excludeTrackIds: [t.id],
      }),
    ).toHaveLength(1);
  });
  it("moves across volumes with original structure, ID and byte identity", async () => {
    const lib = await library("Downloads");
    const track = tracks()[0];
    external = await mkdtemp(path.join(os.tmpdir(), "mymusiclib-test-"));
    const dest = (await service.addLibrary("Collection", external)).library;
    await service.idle();
    const before = await readFile(path.join(lib.path, track.relativePath));
    const op = await service.preview("move", { trackIds: [track.id] }, dest.id);
    expect(op.items[0].error).toBeUndefined();
    service.execute(op.id);
    await service.idle();
    const result = service.catalog.operation(op.id);
    expect(result.items[0].phase, result.items[0].error).toBe("done");
    expect(existsSync(path.join(lib.path, track.relativePath))).toBe(false);
    expect(await readFile(path.join(dest.path, track.relativePath))).toEqual(
      before,
    );
    expect(service.catalog.track(track.id)?.libraryId).toBe(dest.id);
  });
  it("never overwrites a conflicting target and rejects changes made after preview", async () => {
    const a = await library("Downloads");
    const b = await library("Collection");
    const t = tracks().find((t) => t.libraryId === a.id)!;
    const op = await service.preview("move", { trackIds: [t.id] }, b.id);
    expect(op.items[0].error).toContain("уже есть");
    const trash = await service.preview("trash", { trackIds: [t.id] });
    await writeFile(path.join(a.path, t.relativePath), "externally changed");
    service.execute(trash.id);
    await service.idle();
    expect(service.catalog.operation(trash.id).items[0].error).toContain(
      "изменился",
    );
    expect(await readFile(path.join(a.path, t.relativePath), "utf8")).toBe(
      "externally changed",
    );
  });
  it("deletes into recovery and restores original bytes and catalog entry", async () => {
    const a = await library("Downloads");
    const t = tracks()[0];
    const original = await readFile(path.join(a.path, t.relativePath));
    const op = await service.preview("trash", { trackIds: [t.id] });
    service.execute(op.id);
    await service.idle();
    expect(tracks()).toHaveLength(0);
    const restore = await service.previewRestore(op.id);
    service.execute(restore.id);
    await service.idle();
    expect(
      service.catalog.operation(restore.id).items[0].error,
    ).toBeUndefined();
    expect(tracks()[0].id).toBe(t.id);
    expect(await readFile(path.join(a.path, t.relativePath))).toEqual(original);
  });
  it("writes tags through verified copies, preserves audio, and restores original bytes", async () => {
    const lib = await library("Music");
    const t = tracks()[0];
    const file = path.join(lib.path, t.relativePath);
    const bytes = await readFile(file);
    const audio = await audioDigest(file);
    const op = await service.preview("tags", { trackIds: [t.id] }, undefined, {
      title: "Новое название",
      genres: ["Jazz", "Ambient"],
    });
    service.execute(op.id);
    await service.idle();
    expect(service.catalog.operation(op.id).items[0].error).toBeUndefined();
    expect((await parseFile(file)).common.title).toBe("Новое название");
    expect(await audioDigest(file)).toBe(audio);
    const restore = await service.previewRestore(op.id);
    service.execute(restore.id);
    await service.idle();
    expect(
      service.catalog.operation(restore.id).items[0].error,
    ).toBeUndefined();
    expect(await readFile(file)).toEqual(bytes);
  });
  it("serializes a tag batch in isolated processes and preserves every audio stream", async () => {
    const lib = await library("Music", "mp3");
    const folder = path.join(lib.path, "Album");
    for (let index = 1; index < 10; index++)
      await copyFile(
        path.join(fixtures, "sample.mp3"),
        path.join(folder, `track-${index}.mp3`),
      );
    service.scan(lib.id);
    await service.idle();
    const selected = tracks().filter((track) => track.libraryId === lib.id);
    const audio = new Map(
      await Promise.all(
        selected.map(
          async (track) =>
            [
              track.id,
              await audioDigest(path.join(lib.path, track.relativePath)),
            ] as const,
        ),
      ),
    );
    const op = await service.preview(
      "tags",
      { trackIds: selected.map((t) => t.id) },
      undefined,
      {
        genres: ["Isolated batch"],
      },
    );
    service.execute(op.id);
    await service.idle();
    expect(
      service.catalog
        .operation(op.id)
        .items.every((item) => item.phase === "done"),
    ).toBe(true);
    for (const track of selected)
      expect(await audioDigest(path.join(lib.path, track.relativePath))).toBe(
        audio.get(track.id),
      );
  });
  it("resumes copied tag replacements by reindexing without writing the file again", async () => {
    const lib = await library("Music", "mp3");
    const track = tracks()[0];
    const file = path.join(lib.path, track.relativePath);
    const audio = await audioDigest(file);
    const op = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { genres: ["Reconciled"] },
    );
    const upsert = service.catalog.upsert.bind(service.catalog);
    service.catalog.upsert = (() => {
      throw new Error("test catalog failure");
    }) as typeof service.catalog.upsert;
    service.execute(op.id);
    await service.idle();
    const interrupted = service.catalog.operation(op.id);
    expect(interrupted.items[0].phase).toBe("copied");
    expect(interrupted.items[0].error).toContain("Теги записаны");
    const bytesAfterWrite = await readFile(file);
    service.catalog.upsert = upsert;

    const retry = await service.retry(op.id);
    expect(retry.action).toBe("resume");
    await service.idle();
    const completed = service.catalog.operation(op.id);
    expect(completed.items[0].phase).toBe("done");
    expect(completed.items[0].error).toBeUndefined();
    expect(await readFile(file)).toEqual(bytesAfterWrite);
    expect(await audioDigest(file)).toBe(audio);
    expect(service.catalog.track(track.id)?.genres).toEqual(["Reconciled"]);
  });
  it("accepts a timestamp-only source change and creates a fresh retry preview", async () => {
    const lib = await library("Music");
    const track = tracks()[0];
    const file = path.join(lib.path, track.relativePath);
    const original = await readFile(file);
    const timestampOnly = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { title: "По времени" },
    );
    const info = await stat(file);
    await utimes(file, new Date(info.atimeMs), new Date(info.mtimeMs + 60_000));
    service.execute(timestampOnly.id);
    await service.idle();
    expect(service.catalog.operation(timestampOnly.id).items[0].phase).toBe(
      "done",
    );

    const stale = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { title: "Повтор" },
    );
    await writeFile(file, "external edit");
    service.execute(stale.id);
    await service.idle();
    expect(service.catalog.operation(stale.id).items[0].error).toContain(
      "изменился",
    );
    await writeFile(file, original);
    const retry = await service.previewRetry(stale.id);
    expect(retry.id).not.toBe(stale.id);
    expect(retry.items[0].error).toBeUndefined();
    service.execute(retry.id);
    await service.idle();
    expect(service.catalog.operation(retry.id).items[0].phase).toBe("done");
  });
  it("blocks unverified formats and preserves source after invalid tag write", async () => {
    const lib = await library("Music");
    const t = tracks()[0];
    service.capabilities.writableFormats = [];
    const blocked = await service.preview(
      "tags",
      { trackIds: [t.id] },
      undefined,
      { title: "No" },
    );
    expect(blocked.items[0].error).toContain("отключена");
    service.capabilities.writableFormats = ["flac"];
    const bytes = await readFile(path.join(lib.path, t.relativePath));
    const op = await service.preview("tags", { trackIds: [t.id] }, undefined, {
      cover: { data: "invalid", mime: "image/png" },
    });
    service.execute(op.id);
    await service.idle();
    // Either a strict writer rejects it or the independent parser rejects the resulting cover.
    expect(await readFile(path.join(lib.path, t.relativePath))).toEqual(bytes);
  });
  it("reconciles a verified copied destination after interruption", async () => {
    const lib = await library("Downloads");
    const t = tracks()[0];
    const destFolder = path.join(root, "Collection");
    await mkdir(destFolder);
    const dest = (await service.addLibrary("Collection", destFolder)).library;
    await service.idle();
    const op = await service.preview("move", { trackIds: [t.id] }, dest.id);
    await mkdir(path.dirname(op.items[0].destination), { recursive: true });
    await copyFile(op.items[0].source, op.items[0].destination);
    op.items[0].phase = "prepared";
    op.status = "running";
    service.catalog.saveOperation(op);
    await service.close();
    service = new MusicService(path.join(root, "data"));
    expect(service.catalog.operation(op.id).status).toBe("interrupted");
    service.execute(op.id);
    await service.idle();
    expect(service.catalog.operation(op.id).items[0].error).toBeUndefined();
    expect(service.catalog.track(t.id)?.libraryId).toBe(dest.id);
  });
  it("only moves shared artwork when every track in its folder is selected", async () => {
    const lib = await library("Downloads");
    await copyFile(
      path.join(fixtures, "sample.mp3"),
      path.join(lib.path, "Album", "second.mp3"),
    );
    await copyFile(
      path.join(fixtures, "cover.png"),
      path.join(lib.path, "Album", "cover.png"),
    );
    service.scan(lib.id);
    await service.idle();
    const folder = path.join(root, "Collection");
    await mkdir(folder);
    const target = (await service.addLibrary("Collection", folder)).library;
    await service.idle();
    const one = await service.preview(
      "move",
      { trackIds: [tracks()[0].id] },
      target.id,
      undefined,
      true,
    );
    expect(one.items).toHaveLength(1);
    const all = await service.preview(
      "move",
      { filter: emptyFilter },
      target.id,
      undefined,
      true,
    );
    expect(all.items.filter((i) => i.companion)).toHaveLength(1);
  });
  it("recovers tag replacement committed just before process interruption", async () => {
    const lib = await library("Music");
    const t = tracks()[0];
    const op = await service.preview("tags", { trackIds: [t.id] }, undefined, {
      title: "После сбоя",
    });
    service.execute(op.id);
    await service.idle();
    const completed = service.catalog.operation(op.id);
    expect(completed.items[0].phase).toBe("done");
    completed.items[0].phase = "prepared";
    completed.status = "running";
    service.catalog.saveOperation(completed);
    await service.close();
    service = new MusicService(path.join(root, "data"));
    service.execute(op.id);
    await service.idle();
    expect(service.catalog.operation(op.id).items[0].error).toBeUndefined();
    expect(service.catalog.track(t.id)?.title).toBe("После сбоя");
    const restore = await service.previewRestore(op.id);
    service.execute(restore.id);
    await service.idle();
    expect(
      (await parseFile(path.join(lib.path, t.relativePath))).common.title,
    ).toBe("Первый трек");
  });
  it("continues a batch after one source changes and refuses to restore over later edits", async () => {
    const a = await library("A");
    await library("B");
    const original = tracks();
    const op = await service.preview(
      "tags",
      { trackIds: original.map((t) => t.id) },
      undefined,
      { title: "Пакетное изменение" },
    );
    const changed = op.items.find((i) => i.source.startsWith(a.path))!;
    await writeFile(changed.source, "external edit");
    service.execute(op.id);
    await service.idle();
    const result = service.catalog.operation(op.id);
    expect(result.items.filter((i) => i.phase === "done")).toHaveLength(1);
    expect(result.items.filter((i) => i.error)).toHaveLength(1);
    const saved = result.items.find((i) => i.phase === "done")!;
    await writeFile(saved.source, "newer external edit");
    const restore = await service.previewRestore(op.id);
    service.execute(restore.id);
    await service.idle();
    expect(service.catalog.operation(restore.id).items[0].error).toContain(
      "изменились",
    );
    expect(await readFile(saved.source, "utf8")).toBe("newer external edit");
  });
});
