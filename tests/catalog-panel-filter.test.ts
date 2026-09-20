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
  };

  it("keeps only higher-priority selections for each panel", () => {
    expect(filterForCatalogPanel(filter, "libraries")).toEqual(emptyFilter);
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
