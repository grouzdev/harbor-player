import { describe, expect, it } from "vitest";
import type { Track } from "../src/shared/contracts";
import { buildTrackListRows } from "../src/client/track-grouping";

function track(
  id: string,
  trackNumber: number | null,
  discNumber = 1,
  albumKey = "album",
): Track {
  return {
    id,
    libraryId: "library",
    relativePath: `${id}.flac`,
    title: id,
    artists: ["Artist"],
    albumTitle: "Album",
    albumArtists: ["Artist"],
    albumKey,
    genres: [],
    year: 2025,
    trackNumber,
    discNumber,
    duration: 1,
    format: "flac",
    size: 1,
    mtimeMs: 1,
    coverId: null,
    available: true,
  };
}

describe("track list grouping", () => {
  it("does not add a disc row for a single-disc album", () => {
    expect(buildTrackListRows([track("1", 1), track("2", 2)])).toEqual([
      expect.objectContaining({ type: "album" }),
      expect.objectContaining({
        type: "track",
        track: expect.objectContaining({ id: "1" }),
      }),
      expect.objectContaining({
        type: "track",
        track: expect.objectContaining({ id: "2" }),
      }),
    ]);
  });

  it("adds the total duration to the album row", () => {
    const first = { ...track("1", 1), duration: 61 };
    const second = { ...track("2", 1, 2), duration: 122 };
    expect(buildTrackListRows([first, second])[0]).toEqual(
      expect.objectContaining({ type: "album", duration: 183 }),
    );
  });

  it("splits an album when track numbers reset even if discNumber stays 1", () => {
    const rows = buildTrackListRows([
      track("1-1", 1),
      track("1-2", 2),
      track("2-1", 1),
      track("2-2", 2),
    ]);
    expect(rows.filter((row) => row.type === "disc")).toEqual([
      { type: "disc", albumKey: "album", discNumber: 1 },
      { type: "disc", albumKey: "album", discNumber: 2 },
    ]);
  });

  it("keeps explicit disc numbers", () => {
    const rows = buildTrackListRows([track("1-1", 1, 1), track("2-1", 1, 2)]);
    expect(rows.filter((row) => row.type === "disc")).toEqual([
      { type: "disc", albumKey: "album", discNumber: 1 },
      { type: "disc", albumKey: "album", discNumber: 2 },
    ]);
  });

  it("does not infer a boundary when track numbers are missing", () => {
    expect(
      buildTrackListRows([track("a", null), track("b", null)]).filter(
        (row) => row.type === "disc",
      ),
    ).toHaveLength(0);
  });
});
