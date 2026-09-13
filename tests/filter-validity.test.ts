import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { MusicService } from "../dist/server/service.js";
import { emptyFilter } from "../src/shared/contracts.js";

let root: string;
let service: MusicService;

beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "filter-validity-"));
  service = new MusicService(path.join(root, "data"));
});

afterEach(async () => {
  await service.close();
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});

describe("facet filter validity", () => {
  it("preserves compatible selections and removes only incompatible descendants", () => {
    const first = service.catalog.addLibrary("First", root);
    const second = service.catalog.addLibrary("Second", `${root}-second`);
    const addTrack = (
      id: string,
      libraryId: string,
      relativePath: string,
      albumKey: string,
      artist: string,
      genre: string,
    ) =>
      service.catalog.upsert({
        id,
        libraryId,
        relativePath,
        title: id,
        artists: [artist],
        albumTitle: albumKey,
        albumArtists: [artist],
        albumKey,
        genres: [genre],
        year: null,
        trackNumber: 1,
        discNumber: 1,
        duration: 1,
        format: "flac",
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available: true,
      });
    addTrack(
      "shared-rock",
      first.id,
      path.join("Collection", "Rock", "shared.flac"),
      "shared-rock",
      "Shared",
      "Rock",
    );
    addTrack(
      "first-jazz",
      first.id,
      path.join("Collection", "Jazz", "first.flac"),
      "first-jazz",
      "First only",
      "Jazz",
    );
    addTrack(
      "second-electronic",
      second.id,
      path.join("Collection", "Electronic", "second.flac"),
      "second-electronic",
      "Second only",
      "Electronic",
    );

    expect(
      service.catalog.filterValidity({
        ...emptyFilter,
        folders: [{ libraryId: first.id, relativePath: "Collection" }],
        genres: ["Rock", "Electronic"],
        artists: ["Shared", "Second only"],
        albumIds: ["shared-rock", "first-jazz", "second-electronic"],
      }),
    ).toEqual({
      genres: ["Rock"],
      artists: ["Shared"],
      albumIds: ["shared-rock"],
    });

    expect(
      service.catalog.filterValidity({
        ...emptyFilter,
        folders: [{ libraryId: first.id, relativePath: "Collection" }],
        genres: ["Rock"],
        artists: ["Shared"],
        albumIds: ["shared-rock"],
      }),
    ).toEqual({
      genres: ["Rock"],
      artists: ["Shared"],
      albumIds: ["shared-rock"],
    });
  });
});
