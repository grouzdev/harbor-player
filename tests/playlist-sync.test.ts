import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
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
});
