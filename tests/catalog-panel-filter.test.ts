import { describe, expect, it } from "vitest";
import { emptyFilter } from "../src/shared/contracts";
import {
  catalogFilterForSelection,
  filterForCatalogPanel,
} from "../src/client/useCatalogBrowsing";

describe("catalog panel filters", () => {
  const filter = {
    ...emptyFilter,
    libraryIds: ["library"],
    folders: [{ libraryId: "library", relativePath: "Artist" }],
    genres: ["Rock"],
    artists: ["Artist"],
    albumIds: ["album"],
    bookmarksOnly: true,
    recentlyAddedDays: 7 as const,
    albumRatingMin: 4,
    trackRatingMin: 4,
    albumViewed: "unviewed" as const,
  };

  it("keeps user filters while removing each panel's own selections", () => {
    expect(filterForCatalogPanel(filter, "libraries")).toEqual({
      ...filter,
      libraryIds: [],
      folders: [],
      genres: [],
      artists: [],
      albumIds: [],
    });
    expect(filterForCatalogPanel(filter, "genres")).toEqual({
      ...filter,
      genres: [],
      artists: [],
      albumIds: [],
    });
    expect(filterForCatalogPanel(filter, "artists")).toEqual({
      ...filter,
      artists: [],
      albumIds: [],
    });
    expect(filterForCatalogPanel(filter, "albums")).toEqual({
      ...filter,
      albumIds: [],
    });
    expect(filterForCatalogPanel(filter, "tracks")).toEqual(filter);
  });

  it("uses the global search result for every panel", () => {
    const search = { ...filter, search: "needle" };
    expect(filterForCatalogPanel(search, "libraries")).toEqual(search);
    expect(filterForCatalogPanel(search, "albums")).toEqual(search);
  });

  describe("selection filter base", () => {
    const selectedFilter = {
      ...filter,
      search: "needle",
      albumRatingMax: 5,
      trackRatingMax: 5,
      albumUnrated: true,
      trackUnrated: true,
    };

    it("preserves all filters by default and when reset is explicitly false", () => {
      const original = structuredClone(selectedFilter);

      expect(catalogFilterForSelection(selectedFilter)).toEqual(original);
      expect(catalogFilterForSelection(selectedFilter, false)).toEqual(
        original,
      );
      expect(selectedFilter).toEqual(original);
    });

    it("clears all panel selections including locations, but keeps user filters", () => {
      const original = structuredClone(selectedFilter);
      const base = catalogFilterForSelection(selectedFilter, true);

      expect(base).toEqual({
        ...original,
        libraryIds: [],
        folders: [],
        genres: [],
        artists: [],
        albumIds: [],
      });
      expect(selectedFilter).toEqual(original);
    });

    it("allows the new panel selection to be applied after resetting other panels", () => {
      const original = structuredClone(selectedFilter);
      const next = {
        ...catalogFilterForSelection(selectedFilter, true),
        genres: ["Jazz"],
      };

      expect(next).toEqual({
        ...original,
        libraryIds: [],
        folders: [],
        genres: ["Jazz"],
        artists: [],
        albumIds: [],
      });
      expect(selectedFilter).toEqual(original);
    });
  });
});
