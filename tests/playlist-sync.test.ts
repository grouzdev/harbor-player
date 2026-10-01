import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  copyFile,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { MusicService } from "../dist/server/service.js";
import type { Track } from "../src/shared/contracts.js";

let root: string;
let service: MusicService;

beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "playlist-sync-"));
  service = new MusicService(path.join(root, "data"));
});

afterEach(async () => {
  await service.close();
  await rm(root, { recursive: true, force: true });
});

describe("playlist folder sync", () => {
  async function autoSyncPlaylistFor(
    name: string,
    trackId: string,
  ): Promise<string> {
    const playlist = service.catalog.createPlaylist(name).playlist;
    service.catalog.addPlaylistEntries(playlist.id, "track", [trackId]);
    service.catalog.updatePlaylistSyncSettings(playlist.id, {
      targetPath: path.join(root, name),
      templateId: "default-album-artist",
      autoSync: true,
    });
    return playlist.id;
  }

  async function scannedTrack(source: string) {
    const sourceRoot = path.dirname(path.dirname(path.dirname(source)));
    await mkdir(path.dirname(source), { recursive: true });
    await copyFile(path.resolve(".fixtures", "sample.flac"), source);
    const library = service.catalog.addLibrary("Music", sourceRoot);
    service.scan(library.id);
    await service.idle();
    return { library, track: service.catalog.knownTracks()[0]! };
  }

  it("does not queue auto-sync after an unchanged scan", async () => {
    const source = path.join(root, "music", "Artist", "Album", "song.flac");
    const { library, track } = await scannedTrack(source);
    await autoSyncPlaylistFor("Device", track.id);
    const schedule = vi.spyOn(service, "schedulePlaylistSync");

    service.scan(library.id);
    await service.idle();

    expect(schedule).not.toHaveBeenCalled();
  });

  it("queues only auto-sync playlists affected by a scan", async () => {
    const source = path.join(root, "music", "Artist", "Album", "song.flac");
    const { library, track } = await scannedTrack(source);
    const affectedId = await autoSyncPlaylistFor("Affected", track.id);
    const unrelated = service.catalog.createPlaylist("Unrelated").playlist;
    service.catalog.updatePlaylistSyncSettings(unrelated.id, {
      targetPath: path.join(root, "Unrelated"),
      templateId: "default-album-artist",
      autoSync: true,
    });
    const schedule = vi.spyOn(service, "schedulePlaylistSync");

    const changedAt = new Date(Date.now() + 2_000);
    await utimes(source, changedAt, changedAt);
    service.scan(library.id);
    await service.idle();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(affectedId);
  });

  it("queues only affected auto-sync playlists after disconnecting a library", async () => {
    const source = path.join(root, "music", "Artist", "Album", "song.flac");
    const { library, track } = await scannedTrack(source);
    const affectedId = await autoSyncPlaylistFor("Affected", track.id);
    const unrelated = service.catalog.createPlaylist("Unrelated").playlist;
    service.catalog.updatePlaylistSyncSettings(unrelated.id, {
      targetPath: path.join(root, "Unrelated"),
      templateId: "default-album-artist",
      autoSync: true,
    });
    const schedule = vi.spyOn(service, "schedulePlaylistSync");

    service.removeLibrary(library.id);
    await service.idle();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(affectedId);
  });

  it("does not queue auto-sync solely because the service starts", async () => {
    const playlist = service.catalog.createPlaylist("Device").playlist;
    service.catalog.updatePlaylistSyncSettings(playlist.id, {
      targetPath: path.join(root, "Device"),
      templateId: "default-album-artist",
      autoSync: true,
    });
    const schedule = vi.spyOn(service, "schedulePlaylistSync");

    await service.initialize();

    expect(schedule).not.toHaveBeenCalled();
  });

  it("copies incrementally and removes only manifest-owned files", async () => {
    const sourceRoot = path.join(root, "music");
    const source = path.join(sourceRoot, "Artist", "Album", "song.flac");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "audio-one");
    const library = service.catalog.addLibrary("Music", sourceRoot);
    const sourceStat = await stat(source);
    const track: Track = {
      id: "track",
      libraryId: library.id,
      relativePath: path.relative(sourceRoot, source),
      title: "Song",
      artists: ["Artist"],
      albumTitle: "Album",
      albumArtists: ["Artist"],
      albumKey: "album",
      rating: null,
      albumRating: null,
      albumViewed: false,
      genres: [],
      year: null,
      trackNumber: 1,
      discNumber: null,
      duration: 1,
      format: "flac",
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
      coverId: null,
      available: true,
    };
    service.catalog.upsert(track);
    const playlist = service.catalog.createPlaylist("Device").playlist;
    service.catalog.addPlaylistEntries(playlist.id, "track", [track.id]);
    const target = path.join(root, "device");
    service.updatePlaylistSyncSettings(playlist.id, {
      targetPath: target,
      templateId: "default-album-artist",
      autoSync: false,
    });

    const first = service.syncPlaylist(playlist.id);
    await service.idle();
    expect(first.status).toBe("done");
    const copied = path.join(target, "Artist", "Album", "song.flac");
    await expect(readFile(copied, "utf8")).resolves.toBe("audio-one");

    const foreign = path.join(target, "keep.txt");
    await writeFile(foreign, "keep");
    service.catalog.removePlaylistEntry(
      playlist.id,
      service.catalog.playlist(playlist.id).entries[0].id,
    );
    const second = service.syncPlaylist(playlist.id);
    await service.idle();
    expect(second.status).toBe("done");
    await expect(stat(copied)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(foreign, "utf8")).resolves.toBe("keep");
  });

  it("rejects targets that overlap a connected library", async () => {
    const sourceRoot = path.join(root, "music");
    await mkdir(sourceRoot, { recursive: true });
    service.catalog.addLibrary("Music", sourceRoot);
    const playlist = service.catalog.createPlaylist("Unsafe").playlist;
    service.updatePlaylistSyncSettings(playlist.id, {
      targetPath: path.join(sourceRoot, "device"),
      templateId: "default-album-artist",
      autoSync: false,
    });
    const job = service.syncPlaylist(playlist.id);
    await service.idle();
    expect(job.status).toBe("error");
    expect(job.errors.join(" ")).toContain("не должна пересекаться");
  });

  it("keeps the first track when the template produces duplicate paths", async () => {
    const sourceRoot = path.join(root, "music");
    const firstSource = path.join(sourceRoot, "Disc 1", "01 - Song.mp3");
    const secondSource = path.join(sourceRoot, "Disc 2", "01 - Song.mp3");
    await mkdir(path.dirname(firstSource), { recursive: true });
    await mkdir(path.dirname(secondSource), { recursive: true });
    await writeFile(firstSource, "first");
    await writeFile(secondSource, "second");
    const library = service.catalog.addLibrary("Music", sourceRoot);
    const sourceStat = await stat(firstSource);
    const secondSourceStat = await stat(secondSource);
    const common = {
      libraryId: library.id,
      artists: ["Artist"],
      albumTitle: "Album",
      albumArtists: ["Artist"],
      albumKey: "album",
      rating: null,
      albumRating: null,
      albumViewed: false,
      genres: [],
      year: null,
      trackNumber: 1,
      discNumber: null,
      duration: 1,
      format: "mp3",
      coverId: null,
      available: true,
    } satisfies Omit<
      Track,
      "id" | "relativePath" | "title" | "size" | "mtimeMs"
    >;
    const firstTrack: Track = {
      ...common,
      id: "first",
      relativePath: path.relative(sourceRoot, firstSource),
      title: "Song",
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
    };
    const secondTrack: Track = {
      ...common,
      id: "second",
      relativePath: path.relative(sourceRoot, secondSource),
      title: "Song",
      size: secondSourceStat.size,
      mtimeMs: secondSourceStat.mtimeMs,
    };
    service.catalog.upsert(firstTrack);
    service.catalog.upsert(secondTrack);
    const playlist = service.catalog.createPlaylist("Device").playlist;
    service.catalog.addPlaylistEntries(playlist.id, "track", [
      firstTrack.id,
      secondTrack.id,
    ]);
    const target = path.join(root, "device");
    service.updatePlaylistSyncSettings(playlist.id, {
      targetPath: target,
      templateId: "default-album-artist",
      autoSync: false,
    });

    const job = service.syncPlaylist(playlist.id);
    await service.idle();

    expect(job.status).toBe("done");
    expect(job.total).toBe(1);
    await expect(
      readFile(path.join(target, "Artist", "Album", "01 - Song.mp3"), "utf8"),
    ).resolves.toBe("first");
    expect(service.catalog.playlistSyncSettings(playlist.id)).toMatchObject({
      state: "warning",
      message: "Синхронизировано, пропущено из-за совпадений путей: 1",
    });
  });
});
