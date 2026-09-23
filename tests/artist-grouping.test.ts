import { describe, expect, it } from "vitest";
import {
  albumArtistGroupStats,
  artistGroupKey,
  artistGroupStats,
  compareArtistNames,
  isMissingArtistName,
  shouldGroupArtists,
  shouldGroupAlbums,
  startsNewArtistGroup,
} from "../src/shared/artist-grouping.js";

describe("artist grouping", () => {
  it("normalizes case and diacritics for Unicode letters", () => {
    expect(artistGroupKey("  Éclair")).toBe("E");
    expect(artistGroupKey("электроника")).toBe("Э");
    expect(artistGroupKey("東京事変")).toBe("東");
  });

  it("puts missing and non-letter names before letter groups", () => {
    expect(artistGroupKey("7 Seconds")).toBeNull();
    expect(artistGroupKey("🎵 Artist")).toBeNull();
    expect(artistGroupKey("")).toBeNull();
    expect(
      ["7 Seconds", "Éclair", "электроника", ""].sort(compareArtistNames),
    ).toEqual(["", "7 Seconds", "электроника", "Éclair"]);
    expect(isMissingArtistName("   ")).toBe(true);
  });

  it("starts an interval only when the normalized group changes", () => {
    expect(startsNewArtistGroup("écho", "Eels")).toBe(false);
    expect(startsNewArtistGroup("Би-2", "Eels")).toBe(true);
    expect(startsNewArtistGroup("🎵 Artist", "7 Seconds")).toBe(false);
    expect(startsNewArtistGroup("7 Seconds", "")).toBe(true);
  });

  it("provides a compact visible label for every group", () => {
    expect(artistGroupKey("Éclair") || "#").toBe("E");
    expect(artistGroupKey("🎵 Artist") || "#").toBe("#");
  });

  it("counts only headed groups, including the # section", () => {
    expect(artistGroupStats(["", "7 Seconds", "🎵 Artist", "Eels", "Écho", "Би-2"])).toEqual({
      groupCount: 3,
      artistCount: 5,
      averageSize: 5 / 3,
    });
  });

  it("groups only sufficiently large lists with average group size at least three", () => {
    expect(shouldGroupArtists(10, 10)).toBe(false);
    expect(shouldGroupArtists(11, 2.99)).toBe(false);
    expect(shouldGroupArtists(11, 3)).toBe(true);
  });

  it("groups albums solely by their average album-artist group size", () => {
    expect(albumArtistGroupStats([["Alpha"], ["Alpha"], ["Beta"]])).toEqual({
      groupCount: 2,
      albumCount: 3,
      averageSize: 1.5,
    });
    expect(shouldGroupAlbums(2.99)).toBe(false);
    expect(shouldGroupAlbums(3)).toBe(true);
  });
});
