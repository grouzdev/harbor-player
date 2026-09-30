import { describe, expect, it } from "vitest";
import { emptyFilter } from "../src/shared/contracts";
import { filterForCatalogPanel } from "../src/client/useCatalogBrowsing";

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
});
