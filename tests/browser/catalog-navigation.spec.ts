import { addCatalogFilter } from "./catalog-filter-helpers";
import { expect, test, type Page } from "@playwright/test";
import {
  emptyFilter,
  type CatalogFilter,
  type Track,
} from "../../src/shared/contracts";

// A paginated catalog with enough rows to exercise virtualized navigation and
// restoration. Other app services (session, settings) use the real test server.
async function catalog(
  page: Page,
  {
    extraRockArtists = 0,
    extraJazzArtists = 0,
    extraGenres = 0,
    sortFacets = false,
  } = {},
) {
  const tracks: Track[] = [
    ...[
      ["Bowie", 3, "Rock"],
      ["Miles", 3, "Jazz"],
      ["Queen", 130, "Rock"],
      ["Zebra", 3, "Rock"],
    ].flatMap(([name, count, genre]) =>
      Array.from({ length: Number(count) }, (_, album) =>
        Array.from({ length: 3 }, (_, index): Track => ({
          id: `${name}-${album}-${index}`,
          libraryId: genre === "Jazz" ? "jazz" : "rock",
          relativePath: `${name}/${album}/${index}.flac`,
          title: `${name} song ${index}`,
          artists: [String(name)],
          albumArtists: [String(name)],
          albumKey: `${name}-${album}`,
          albumTitle: `${name} album ${String(album).padStart(3, "0")}`,
          genres: [String(genre)],
          year: 2025 - album,
          trackNumber: index + 1,
          discNumber: 1,
          duration: 180,
          format: "FLAC",
          size: 1000,
          mtimeMs: 0,
          coverId: null,
          available: true,
        })),
      ).flat(),
    ),
    ...Array.from({ length: extraRockArtists }, (_, artist) =>
      Array.from({ length: 3 }, (_, index): Track => ({
        id: `Rock artist ${artist}-${index}`,
        libraryId: "rock",
        relativePath: `Rock artist ${artist}/0/${index}.flac`,
        title: `Rock artist ${artist} song ${index}`,
        artists: [`Rock artist ${artist}`],
        albumArtists: [`Rock artist ${artist}`],
        albumKey: `Rock artist ${artist}-0`,
        albumTitle: `Rock artist ${artist} album`,
        genres: ["Rock"],
        year: 2025,
        trackNumber: index + 1,
        discNumber: 1,
        duration: 180,
        format: "FLAC",
        size: 1000,
        mtimeMs: 0,
        coverId: null,
        available: true,
      })),
    ).flat(),
    ...Array.from({ length: extraJazzArtists }, (_, artist) =>
      Array.from({ length: 3 }, (_, index): Track => ({
        id: `Jazz artist ${artist}-${index}`,
        libraryId: "jazz",
        relativePath: `Jazz artist ${artist}/0/${index}.flac`,
        title: `Jazz artist ${artist} song ${index}`,
        artists: [`Jazz artist ${artist}`],
        albumArtists: [`Jazz artist ${artist}`],
        albumKey: `Jazz artist ${artist}-0`,
        albumTitle: `Jazz artist ${artist} album`,
        genres: ["Jazz"],
        year: 2025,
        trackNumber: index + 1,
        discNumber: 1,
        duration: 180,
        format: "FLAC",
        size: 1000,
        mtimeMs: 0,
        coverId: null,
        available: true,
      })),
    ).flat(),
  ];
  const requests: {
    endpoint: string;
    filter: CatalogFilter;
    offset: number;
  }[] = [];
  const summaries: unknown[] = [];
  const mergeContexts: unknown[] = [];
  const mergePreviews: unknown[] = [];
  const queueRequests: {
    albumId?: string;
    filter?: CatalogFilter;
    playlistId?: string;
  }[] = [];
  const playlist = {
    id: "road-trip",
    name: "В дорогу",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    entryCount: 1,
    trackCount: 3,
    unavailableCount: 0,
  };
  let delayed = "";
  let releaseDelay: (() => void) | undefined;
  const matches = (filter: CatalogFilter) =>
    tracks.filter(
      (track) =>
        (!filter.libraryIds.length ||
          filter.libraryIds.includes(track.libraryId)) &&
        (!filter.folders.length ||
          filter.folders.some(
            (folder) =>
              folder.libraryId === track.libraryId &&
              track.relativePath.startsWith(folder.relativePath + "/"),
          )) &&
        (!filter.genres.length ||
          filter.genres.some((genre) => track.genres.includes(genre))) &&
        (!filter.artists.length ||
          filter.artists.some((artist) =>
            track.albumArtists.includes(artist),
          )) &&
        (!filter.albumIds.length || filter.albumIds.includes(track.albumKey)) &&
        (!filter.bookmarksOnly || track.albumArtists.includes("Queen")) &&
        (!filter.search ||
          `${track.title} ${track.albumTitle} ${track.albumArtists} ${track.genres}`
            .toLowerCase()
            .includes(filter.search.toLowerCase())),
    );
  const relevanceRows = (
    filter: CatalogFilter,
    sources: { genres?: boolean; artists?: boolean; albums?: boolean },
  ) =>
    tracks.filter(
      (track) =>
        (sources.genres &&
          filter.genres.some((genre) => track.genres.includes(genre))) ||
        (sources.artists &&
          filter.artists.some((artist) =>
            track.albumArtists.includes(artist),
          )) ||
        (sources.albums && filter.albumIds.includes(track.albumKey)),
    );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.slice(5);
    const filter: CatalogFilter = JSON.parse(
      url.searchParams.get("filter") || JSON.stringify(emptyFilter),
    );
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 200);
    const rows = matches(filter);
    const paginated = (items: unknown[]) => ({
      items: items.slice(offset, offset + limit),
      total: items.length,
      offset,
    });
    let body: unknown;
    if (
      ["libraries", "genres", "artists", "albums", "tracks"].includes(endpoint)
    ) {
      requests.push({ endpoint, filter, offset });
      if (endpoint === "tracks" && filter.search === delayed && delayed) {
        await new Promise<void>((resolve) => {
          releaseDelay = resolve;
        });
      }
    }
    if (endpoint === "playlists") body = [playlist];
    else if (endpoint === "playlists/road-trip")
      body = {
        playlist,
        entries: [
          {
            id: "road-trip-album",
            playlistId: playlist.id,
            kind: "album",
            targetId: "Queen-0",
            position: 0,
            snapshot: {
              title: "Queen album 000",
              subtitle: "Queen",
              coverId: null,
            },
            resolvedCount: 3,
            unavailableCount: 0,
          },
        ],
      };
    else if (endpoint === "playlists/road-trip/tracks")
      body = {
        items: tracks
          .filter((track) => track.albumKey === "Queen-0")
          .map((track, position) => ({
            position,
            entryId: "road-trip-album",
            track,
          })),
        total: 3,
        offset: 0,
        unavailableCount: 0,
        totalDuration: 540,
      };
    else if (endpoint === "libraries")
      body = ["rock", "jazz"]
        .filter((id) => rows.some((track) => track.libraryId === id))
        .map((id) => ({
          id,
          name: id,
          path: `C:/Music/${id}`,
          available: true,
          lastScan: null,
          trackCount: rows.filter((track) => track.libraryId === id).length,
        }));
    else if (/^libraries\/.+\/folders$/.test(endpoint))
      body = [
        ...new Set(
          rows
            .filter((track) => endpoint.includes(track.libraryId))
            .map((track) => track.albumArtists[0]),
        ),
      ].map((name) => ({
        name,
        relativePath: name,
        hasChildren: false,
        trackCount: rows.filter((track) => track.albumArtists.includes(name))
          .length,
      }));
    else if (endpoint === "genres") {
      body = [...new Set(rows.flatMap((track) => track.genres))].map(
        (name) => ({ name, count: 1 }),
      );
      if (extraGenres) {
        const genres = body as { name: string; count: number }[];
        const expanded = Array.from({ length: extraGenres }, (_, index) => ({
          name: `Unrelated genre ${index}`,
          count: 1,
        }));
        for (const [index, genre] of genres.entries())
          expanded.splice(
            Math.floor((extraGenres * (index + 1)) / 3),
            0,
            genre,
          );
        body = expanded;
      }
    } else if (endpoint === "artists")
      body = paginated(
        [...new Set(rows.flatMap((track) => track.albumArtists))]
          .sort((a, b) => (sortFacets ? a.localeCompare(b) : 0))
          .map((name) => ({
            name,
            count:
              rows.filter((track) => track.albumArtists.includes(name)).length /
              3,
          })),
      );
    else if (endpoint === "albums")
      body = paginated(
        [
          ...new Map(
            rows.map((track) => [
              track.albumKey,
              {
                id: track.albumKey,
                title: track.albumTitle,
                artists: track.albumArtists,
                year: track.year,
                coverId: null,
                trackCount: 3,
              },
            ]),
          ).values(),
        ].sort((a, b) =>
          sortFacets ? a.artists[0]!.localeCompare(b.artists[0]!) : 0,
        ),
      );
    else if (endpoint === "tracks") body = paginated(rows);
    else if (endpoint === "queue") {
      const request = route.request().postDataJSON() as {
        albumId?: string;
        filter?: CatalogFilter;
        playlistId?: string;
      };
      queueRequests.push(request);
      const track = request.albumId
        ? tracks.find((item) => item.albumKey === request.albumId)
        : request.playlistId
          ? tracks.find((item) => item.albumKey === "Queen-0")
          : request.filter
            ? matches(request.filter)[0]
            : undefined;
      if (!track) return route.fallback();
      body = {
        id: `queue-${request.albumId || request.playlistId || track.id}`,
        position: 0,
        total: 3,
        track,
      };
    } else if (endpoint === "filter-validity")
      body = {
        genres: filter.genres,
        artists: filter.artists,
        albumIds: filter.albumIds,
      };
    else if (endpoint === "facet-relevance")
      body = (() => {
        const libraryRows = relevanceRows(filter, {
          genres: true,
          artists: true,
          albums: true,
        });
        const genreRows = relevanceRows(filter, {
          artists: true,
          albums: true,
        });
        const artistRows = relevanceRows(filter, { albums: true });
        return {
          libraryIds: [...new Set(libraryRows.map((track) => track.libraryId))],
          genres: [...new Set(genreRows.flatMap((track) => track.genres))],
          artists: [
            ...new Set(artistRows.flatMap((track) => track.albumArtists)),
          ],
          folders: [],
        };
      })();
    else if (endpoint === "bookmarks")
      body = [{ kind: "artist", id: "Queen", createdAt: "2026-01-01" }];
    else if (endpoint === "artist-folders")
      body = [{ libraryId: "rock", relativePath: "Queen", trackCount: 390 }];
    else if (endpoint === "selection-summary") {
      summaries.push(route.request().postDataJSON());
      body = {
        count: 3,
        formats: ["FLAC"],
        fields: {},
        musicBrainz: { supported: false, mode: null, title: "", artist: "" },
      };
    } else if (endpoint === "albums/merge-context") {
      const request = route.request().postDataJSON() as { albumIds: string[] };
      mergeContexts.push(request);
      body = {
        compatible: true,
        blockers: [],
        library: { id: "rock", name: "rock" },
        relativeFolder: "Queen/Albums",
        trackCount: request.albumIds.length * 3,
        sources: request.albumIds.map((albumId, index) => ({
          albumId,
          title: `${albumId} title`,
          albumArtists: ["Queen"],
          year: 2025 - index,
          coverId: null,
          trackCount: 3,
          formats: ["flac"],
          musicBrainzReleaseIds: [`release-${index + 1}`],
        })),
      };
    } else if (endpoint === "operations/preview") {
      const request = route.request().postDataJSON();
      mergePreviews.push(request);
      body = {
        id: "merge-preview",
        kind: "tags",
        status: "preview",
        createdAt: "2026-01-01T00:00:00.000Z",
        intent: "album-merge",
        patch: request.patch,
        items: [
          {
            id: "preview-error",
            trackId: "Queen-0-0",
            source: "Queen/Albums/01.flac",
            destination: "Queen/Albums/01.flac",
            size: 1,
            mtimeMs: 1,
            hash: "hash",
            title: "Queen song 0",
            phase: "preview",
            error: "Файл больше недоступен",
          },
        ],
      };
    } else return route.fallback();
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await expect(count(page, "artists")).toHaveText(
    String(4 + extraRockArtists + extraJazzArtists),
  );
  return {
    requests,
    summaries,
    mergeContexts,
    mergePreviews,
    queueRequests,
    delay: (query: string) => {
      delayed = query;
    },
    release: () => {
      delayed = "";
      releaseDelay?.();
    },
    waiting: () => Boolean(releaseDelay),
  };
}

const artist = (page: Page, name: string) =>
  page.locator(`.artists-panel .artist-row[data-selection-key="${name}"]`);
async function filterArtist(page: Page, name: string) {
  await artist(page, name).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Фильтровать по выбранному", exact: true })
    .click();
}
const count = (page: Page, panel: string) =>
  page.locator(`.${panel}-panel .panel-heading .panel-count`);

test("artist selection minimally reveals its first genre without selecting it or moving the artist", async ({
  page,
}) => {
  const data = await catalog(page, { extraGenres: 80 });
  const queen = artist(page, "Queen");
  const before = await queen.boundingBox();
  expect(before).not.toBeNull();
  const genre = page.locator('.genres-panel [data-selection-key="Rock"]');
  const surface = page.locator(".genre-list");
  await expect(genre).not.toBeInViewport();
  await queen.locator(".list-tile-main").click();
  await expect(genre).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".genres-panel .list-tile.selected")).toHaveCount(
    0,
  );
  await expect
    .poll(
      () =>
        data.requests.filter((item) => item.endpoint === "tracks").at(-1)
          ?.filter,
    )
    .toMatchObject({ artists: ["Queen"], genres: [] });
  const [genreBox, surfaceBox, after] = await Promise.all([
    genre.boundingBox(),
    surface.boundingBox(),
    queen.boundingBox(),
  ]);
  expect(genreBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  expect(after).not.toBeNull();
  // Reveal at the nearest edge, not in the center.
  expect(
    surfaceBox!.y + surfaceBox!.height - genreBox!.y - genreBox!.height,
  ).toBeLessThanOrEqual(20);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(2);
});

test("adding an artist leaves a visible first matching genre in place and removing an artist does not seek", async ({
  page,
}) => {
  await catalog(page, { extraGenres: 80 });
  const surface = page.locator(".genre-list");
  const rock = page.locator('.genres-panel [data-selection-key="Rock"]');
  await artist(page, "Queen").locator(".list-tile-main").click();
  await expect(rock).toBeInViewport({ ratio: 1 });
  const top = await surface.evaluate((node) => node.scrollTop);
  await artist(page, "Miles")
    .locator(".list-tile-main")
    .click({
      modifiers: ["Control"],
    });
  await expect(count(page, "artists")).toHaveText("2/4");
  await expect(rock).toBeInViewport({ ratio: 1 });
  expect(await surface.evaluate((node) => node.scrollTop)).toBe(top);
  await surface.hover();
  await page.mouse.wheel(0, -5000);
  await expect.poll(() => surface.evaluate((node) => node.scrollTop)).toBe(0);
  await artist(page, "Queen")
    .locator(".list-tile-main")
    .click({
      modifiers: ["Control"],
    });
  await expect(count(page, "artists")).toHaveText("1/4");
  await page.waitForLoadState("networkidle");
  expect(await surface.evaluate((node) => node.scrollTop)).toBe(0);
});

test("manual genre scrolling cancels a pending artist genre reveal", async ({
  page,
}) => {
  await catalog(page, { extraGenres: 80 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = 0;
  await page.route("**/api/facet-relevance?**", async (route) => {
    const filter = JSON.parse(
      new URL(route.request().url()).searchParams.get("filter")!,
    ) as CatalogFilter;
    if (filter.artists.includes("Queen")) {
      pending++;
      await gate;
    }
    await route.fallback();
  });
  await artist(page, "Queen").locator(".list-tile-main").click();
  await expect.poll(() => pending).toBeGreaterThan(0);
  const surface = page.locator(".genre-list");
  await surface.hover();
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => surface.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  const top = await surface.evaluate((node) => node.scrollTop);
  release();
  await page.waitForLoadState("networkidle");
  expect(await surface.evaluate((node) => node.scrollTop)).toBe(top);
});

test("a late genre response from a previous artist does not override the current reveal", async ({
  page,
}) => {
  await catalog(page, { extraGenres: 80 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = 0;
  await page.route("**/api/facet-relevance?**", async (route) => {
    const filter = JSON.parse(
      new URL(route.request().url()).searchParams.get("filter")!,
    ) as CatalogFilter;
    if (filter.artists.includes("Queen")) {
      pending++;
      await gate;
    }
    await route.fallback();
  });
  await artist(page, "Queen").locator(".list-tile-main").click();
  await expect.poll(() => pending).toBeGreaterThan(0);
  await artist(page, "Miles").locator(".list-tile-main").click();
  const jazz = page.locator('.genres-panel [data-selection-key="Jazz"]');
  await expect(jazz).toBeInViewport({ ratio: 1 });
  const surface = page.locator(".genre-list");
  const top = await surface.evaluate((node) => node.scrollTop);
  release();
  await page.waitForLoadState("networkidle");
  await expect(jazz).toBeInViewport({ ratio: 1 });
  expect(await surface.evaluate((node) => node.scrollTop)).toBe(top);
});

test("plain artist click keeps its genre context and viewport position", async ({
  page,
}) => {
  await catalog(page, {
    extraJazzArtists: 140,
    extraRockArtists: 40,
    sortFacets: true,
  });
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Rock" })
    .click();
  await expect(count(page, "artists")).toHaveText("43");
  const queen = artist(page, "Queen");
  await expect(queen).toBeInViewport();
  const before = await queen.boundingBox();
  expect(before).not.toBeNull();
  await queen.locator(".list-tile-main").click();
  await expect(count(page, "artists")).toHaveText("1/43");
  await expect(page.locator(".genres-panel .list-tile.selected")).toHaveCount(
    1,
  );
  await expect(queen).toHaveClass(/selected/);
  await expect(queen).toBeInViewport();
  await expect
    .poll(async () => {
      const after = await queen.boundingBox();
      return after && Math.abs(after.y - before!.y);
    })
    .toBeLessThanOrEqual(2);
});

test("plain album click retains its genre context and viewport position", async ({
  page,
}) => {
  await catalog(page, { extraJazzArtists: 140, sortFacets: true });
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Rock" })
    .click();
  const album = page.locator('.album-card[data-selection-key="Queen-0"]');
  await expect(album).toBeInViewport();
  const before = await album.boundingBox();
  expect(before).not.toBeNull();
  await album.locator(".album-main").click();
  await expect(page.locator(".genres-panel .list-tile.selected")).toHaveCount(
    1,
  );
  await expect(album).toHaveClass(/selected/);
  await expect(album).toBeInViewport();
  await expect
    .poll(async () => {
      const after = await album.boundingBox();
      return after && Math.abs(after.y - before!.y);
    })
    .toBeLessThanOrEqual(2);
});

async function combinedPanelFilters(
  page: Page,
  location: "library" | "folder",
) {
  const data = await catalog(page);
  const library = page.locator(
    '.library-container > .list-tile[data-selection-key="library:rock"]',
  );
  await page
    .getByRole("button", { name: "Развернуть библиотеку «rock»" })
    .click();
  const folder = page
    .locator(".library-folder-tile")
    .filter({ has: page.locator(".list-tile-main", { hasText: "Queen" }) });
  const genre = page
    .locator(".genres-panel .list-tile")
    .filter({ hasText: "Rock" });
  const queen = artist(page, "Queen");
  const album = page.locator('.album-card[data-selection-key="Queen-0"]');
  const items = { library, folder, genre, artist: queen, album };
  for (const item of [items[location], genre, queen, album]) {
    await item.click({ modifiers: ["Control"] });
    await expect(item).toHaveClass(/selected/);
  }
  const panelFilter = () => {
    const filter = data.requests
      .filter((request) => request.endpoint === "tracks")
      .at(-1)?.filter;
    return (
      filter && {
        libraryIds: filter.libraryIds,
        folders: filter.folders,
        genres: filter.genres,
        artists: filter.artists,
        albumIds: filter.albumIds,
        bookmarksOnly: filter.bookmarksOnly,
      }
    );
  };
  return { items, panelFilter };
}

for (const location of ["library", "folder"] as const) {
  for (const target of [
    "library",
    "folder",
    "genre",
    "artist",
    "album",
  ] as const) {
    test(`plain ${target} click preserves upstream and clears downstream with a ${location} filter, even when already selected`, async ({
      page,
    }) => {
      const { items, panelFilter } = await combinedPanelFilters(page, location);
      await addCatalogFilter(page, "Закладки");
      await expect.poll(panelFilter).toMatchObject({ bookmarksOnly: true });
      if (target === "album") {
        await page
          .locator('.album-card[data-selection-key="Queen-1"]')
          .click({ modifiers: ["Control"] });
        await expect(page.locator(".album-card.selected")).toHaveCount(2);
      }
      await items[target].click();

      const priority = ["library", "folder", "genre", "artist", "album"];
      const keepsLocation = target !== "library" && target !== "folder";
      const expected = {
        libraryIds:
          target === "library" || (keepsLocation && location === "library")
            ? ["rock"]
            : [],
        folders:
          target === "folder" || (keepsLocation && location === "folder")
            ? [{ libraryId: "rock", relativePath: "Queen" }]
            : [],
        genres: priority.indexOf(target) >= 2 ? ["Rock"] : [],
        artists: priority.indexOf(target) >= 3 ? ["Queen"] : [],
        albumIds: target === "album" ? ["Queen-0"] : [],
        bookmarksOnly: true,
      };
      await expect.poll(panelFilter).toEqual(expected);
      for (const [name, item] of Object.entries(items)) {
        const selected =
          name === target ||
          (keepsLocation && name === location) ||
          (name === "genre" && priority.indexOf(target) > 2) ||
          (name === "artist" && target === "album");
        if (selected) await expect(item).toHaveClass(/selected/);
        else await expect(item).not.toHaveClass(/selected/);
      }
      await expect(
        page.locator(".libraries-panel .list-tile.selected"),
      ).toHaveCount(1);
      await expect(page.locator(".album-card.selected")).toHaveCount(
        target === "album" ? 1 : 0,
      );
      await expect(page.locator('[data-filter="bookmarks"]')).toHaveText(
        "Закладки",
      );
    });
  }
}

test("genre then artist then album preserves context, album list and position, and track clicks keep filters", async ({
  page,
}) => {
  const data = await catalog(page);
  const rock = page
    .locator(".genres-panel .list-tile")
    .filter({ hasText: "Rock" });
  const queen = artist(page, "Queen");
  await rock.locator(".list-tile-main").click();
  await queen.locator(".list-tile-main").click();
  await expect(count(page, "albums")).toHaveText("130");
  const album = page.locator('.album-card[data-selection-key="Queen-0"]');
  const before = await album.boundingBox();
  expect(before).not.toBeNull();
  const albumKeys = () =>
    page
      .locator(".album-card")
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-selection-key")),
      );
  const keys = await albumKeys();
  await album.locator(".album-main").click();
  const filter = () =>
    data.requests.filter((request) => request.endpoint === "tracks").at(-1)
      ?.filter;
  await expect.poll(filter).toMatchObject({
    genres: ["Rock"],
    artists: ["Queen"],
    albumIds: ["Queen-0"],
  });
  await expect(rock).toHaveClass(/selected/);
  await expect(queen).toHaveClass(/selected/);
  await expect(count(page, "albums")).toHaveText("1/130");
  await expect.poll(albumKeys).toEqual(keys);
  await expect
    .poll(async () => {
      const after = await album.boundingBox();
      return after && Math.abs(after.y - before!.y);
    })
    .toBeLessThanOrEqual(2);
  await page
    .locator('[data-testid="track-row"][data-selection-key="Queen-0-0"]')
    .click();
  await expect(rock).toHaveClass(/selected/);
  await expect(queen).toHaveClass(/selected/);
  await expect(album).toHaveClass(/selected/);
  await expect.poll(filter).toMatchObject({
    genres: ["Rock"],
    artists: ["Queen"],
    albumIds: ["Queen-0"],
  });
  await artist(page, "Bowie").locator(".list-tile-main").click();
  await expect.poll(filter).toMatchObject({
    genres: ["Rock"],
    artists: ["Bowie"],
    albumIds: [],
  });
  await expect(page.locator(".album-card.selected")).toHaveCount(0);
  await expect(count(page, "albums")).toHaveText("3");
});

for (const modifier of ["Control", "Shift"] as const) {
  test(`${modifier} artist selection keeps upstream and clears albums, but empty artist selection retains albums`, async ({
    page,
  }) => {
    const { items, panelFilter } = await combinedPanelFilters(page, "library");
    await items.artist
      .locator(".list-tile-main")
      .click({ modifiers: [modifier] });
    await expect.poll(panelFilter).toMatchObject({
      libraryIds: ["rock"],
      genres: ["Rock"],
      artists: modifier === "Control" ? [] : ["Queen"],
      albumIds: modifier === "Control" ? ["Queen-0"] : [],
    });
    if (modifier === "Control") {
      await items.artist
        .locator(".list-tile-main")
        .click({ modifiers: [modifier] });
      await expect.poll(panelFilter).toMatchObject({
        libraryIds: ["rock"],
        genres: ["Rock"],
        artists: ["Queen"],
        albumIds: [],
      });
    }
    await items.album.click();
    await page.getByRole("button", { name: "Сбросить исполнителей" }).click();
    await expect.poll(panelFilter).toMatchObject({
      libraryIds: ["rock"],
      genres: ["Rock"],
      artists: [],
      albumIds: ["Queen-0"],
    });
  });
}

for (const modifier of ["Control", "Meta"] as const) {
  test(`${modifier} click toggles albums and preserves all other panel filters`, async ({
    page,
  }) => {
    const { items, panelFilter } = await combinedPanelFilters(page, "folder");
    const before = panelFilter();
    const second = page.locator('.album-card[data-selection-key="Queen-1"]');
    await second.click({ modifiers: [modifier] });
    await expect
      .poll(panelFilter)
      .toEqual({ ...before, albumIds: ["Queen-0", "Queen-1"] });
    await expect(items.album).toHaveClass(/selected/);
    await expect(second).toHaveClass(/selected/);
    await second.click({ modifiers: [modifier] });
    await expect.poll(panelFilter).toEqual(before);
    await expect(second).not.toHaveClass(/selected/);
    for (const item of [items.folder, items.genre, items.artist, items.album])
      await expect(item).toHaveClass(/selected/);
  });
}

for (const modifiers of [["Shift"], ["Control", "Shift"], ["Alt"]] as const) {
  test(`${modifiers.join("+")} click preserves cross-panel combinations`, async ({
    page,
  }) => {
    const { items, panelFilter } = await combinedPanelFilters(page, "library");
    const before = panelFilter();
    const third = page.locator('.album-card[data-selection-key="Queen-2"]');
    await third.click({ modifiers: [...modifiers] });
    const albumIds =
      modifiers[0] === "Alt" ? ["Queen-2"] : ["Queen-0", "Queen-1", "Queen-2"];
    await expect.poll(panelFilter).toEqual({ ...before, albumIds });
    await expect(third).toHaveClass(/selected/);
    for (const item of [items.library, items.genre, items.artist])
      await expect(item).toHaveClass(/selected/);
  });
}

test("catalog names use one primary style", async ({ page }) => {
  await catalog(page);

  const album = page.locator('.album-card[data-selection-key="Queen-0"]');
  const primaryNames = [
    page.locator(".libraries-panel .list-tile-main").first(),
    page.locator(".genres-panel .list-tile-main").first(),
    artist(page, "Queen").locator(".list-tile-main"),
    album.locator(".album-main > strong"),
    page.locator(".track-album-header strong").first(),
    page.locator(".track-row .list-tile-main").first(),
  ];
  for (const name of primaryNames) {
    await expect(name).toHaveCSS("font-size", "14px");
    await expect(name).toHaveCSS("font-weight", "400");
    await expect(name).toHaveCSS("color", "rgb(162, 174, 181)");
  }
  await expect(album.locator(".album-details")).toHaveCSS("font-size", "14px");
  await expect(
    page
      .locator(".albums-panel .album-artist-label")
      .filter({ hasText: "Queen" })
      .first(),
  ).toHaveCSS("font-size", "14px");
});

test("panel headings reflect selection state without a count chip", async ({
  page,
}) => {
  await catalog(page);

  const artistHeading = page.locator(".artists-panel .panel-heading");
  const artistTitle = artistHeading.getByRole("heading", {
    name: "Исполнители",
  });
  const artistClose = artistHeading.getByRole("button", {
    name: "Закрыть панель «Исполнители»",
  });

  await expect(artistHeading).toHaveClass(/panel-heading--idle/);
  await expect(artistClose).not.toHaveClass(/is-active/);
  await expect(artistClose).toHaveCSS("color", "rgb(116, 129, 138)");
  await expect(artistTitle).toHaveCSS("color", "rgb(116, 129, 138)");
  await expect(page.locator(".panel-selection-chip")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Сбросить исполнителей" }),
  ).toHaveCount(0);

  await artist(page, "Zebra").locator(".list-tile-main").click();

  await expect(artistHeading).not.toHaveClass(/panel-heading--idle/);
  await expect(artistClose).toHaveClass(/is-active/);
  await expect(artistHeading.locator(".panel-count")).toHaveText("1/4");
  await expect(
    page.getByRole("button", { name: "Сбросить исполнителей" }),
  ).toBeVisible();
});

test("playlists live in the libraries panel and open a permanent composition panel", async ({
  page,
}) => {
  await catalog(page);

  const libraries = page.locator(".libraries-panel");
  await expect(libraries.getByText("ПЛЕЙЛИСТЫ", { exact: true })).toBeVisible();
  await libraries.getByText("В дорогу", { exact: true }).click();

  const panel = page.locator(".playlist-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "В дорогу" })).toBeVisible();
  await expect(
    panel.locator(".playlist-heading-actions .icon-button"),
  ).toHaveCount(5);
  await expect(
    panel.getByText("Queen album 000", { exact: true }),
  ).toBeVisible();
});

test("artist and album selection cascades to lower-priority panels", async ({
  page,
}) => {
  const data = await catalog(page);
  await artist(page, "Zebra").locator(".list-tile-main").click();
  await expect(count(page, "albums")).toHaveText("3");
  await expect(count(page, "tracks")).toHaveText("9");
  await expect(
    page.getByRole("button", { name: "Сбросить исполнителей" }),
  ).toBeVisible();
  expect(
    data.requests.some(
      (request) =>
        request.endpoint === "albums" &&
        request.filter.artists.includes("Zebra") &&
        !request.filter.albumIds.length,
    ),
  ).toBe(true);
  await artist(page, "Queen")
    .locator(".list-tile-main")
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".artist-row.selected")).toHaveCount(2);
  await expect(count(page, "albums")).toHaveText("133");
  await expect(count(page, "tracks")).toHaveText("399");
  const album = page.locator('.album-card[data-selection-key="Queen-0"]');
  await expect(album).toBeInViewport();
  await album.locator(".album-main").click({ modifiers: ["Control"] });
  await expect(
    page.locator('[data-testid="track-row"][data-selection-key="Queen-0-0"]'),
  ).toBeInViewport();
  await expect(count(page, "tracks")).toHaveText("3");
  expect(
    data.requests.some(
      (request) =>
        request.endpoint === "tracks" &&
        request.filter.albumIds.includes("Queen-0"),
    ),
  ).toBe(true);
  await filterArtist(page, "Zebra");
  await expect(page.locator(".artists-panel .panel-count")).toContainText(
    "2/4",
  );
  await expect(page.locator(".albums-panel .panel-count")).toContainText(
    "1/133",
  );
  await page.getByRole("button", { name: "Сбросить исполнителей" }).click();
  await expect(page.locator(".albums-panel .panel-count")).toContainText(
    "1/139",
  );
});

test("selecting an album keeps the album grid in place while another album plays", async ({
  page,
}) => {
  const data = await catalog(page);
  const playing = page.locator(
    '.album-card[data-selection-key="Queen-0"] .album-main',
  );
  await playing.click();
  await playing.dblclick();
  await expect(
    page.locator('.album-card[data-selection-key="Queen-0"]'),
  ).not.toHaveClass(/playing/);

  await page.locator(".album-scroll").evaluate((node) => {
    node.scrollTop = node.scrollHeight / 2;
  });
  await expect
    .poll(() =>
      page.locator(".album-scroll").evaluate((node) => node.scrollTop),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator(".album-card").count())
    .toBeGreaterThan(0);
  const albumId = await page.locator(".album-card").evaluateAll((cards) => {
    const scroll = document.querySelector(".album-scroll")!;
    const bounds = scroll.getBoundingClientRect();
    const target = cards
      .map((card) => {
        const box = card.getBoundingClientRect();
        return {
          card,
          visible: box.top < bounds.bottom && box.bottom > bounds.top,
          distance: Math.abs(
            (box.top + box.bottom) / 2 - (bounds.top + bounds.bottom) / 2,
          ),
        };
      })
      .filter((item) => item.visible)
      .sort((left, right) => left.distance - right.distance)[0];
    return target?.card.getAttribute("data-selection-key") || null;
  });
  expect(albumId).toBeTruthy();
  expect(albumId).not.toBe("Queen-0");
  const selected = page.locator(`.album-card[data-selection-key="${albumId}"]`);
  const before = await page
    .locator(".album-scroll")
    .evaluate((node) => node.scrollTop);
  const requestCount = data.requests.length;

  await selected.locator(".album-main").click();
  await expect(selected).toHaveClass(/selected/);
  await expect(
    page.locator(
      `[data-testid="track-row"][data-selection-key="${albumId}-0"]`,
    ),
  ).toBeInViewport();
  await expect
    .poll(() =>
      page
        .locator(".album-scroll")
        .evaluate((node) => Math.round(node.scrollTop)),
    )
    .toBe(Math.round(before));
  expect(
    data.requests
      .slice(requestCount)
      .every((request) => request.endpoint === "tracks"),
  ).toBe(true);

  const beforeReset = await page
    .locator(".album-scroll")
    .evaluate((node) => node.scrollTop);
  await page.getByRole("button", { name: "Сбросить альбомы" }).click();
  await expect(count(page, "tracks")).toHaveText("417");
  await expect
    .poll(() =>
      page
        .locator(".album-scroll")
        .evaluate((node) => Math.round(node.scrollTop)),
    )
    .toBe(Math.round(beforeReset));
});

test("facet and playlist rows launch only on double click", async ({
  page,
}) => {
  const data = await catalog(page);
  const expectQueueCount = (count: number) =>
    expect.poll(() => data.queueRequests.length).toBe(count);
  const lastQueue = () => data.queueRequests.at(-1);

  const queen = artist(page, "Queen").locator(".list-tile-main");
  await queen.click();
  expect(data.queueRequests).toHaveLength(0);
  await queen.dblclick();
  await expectQueueCount(1);
  expect(lastQueue()?.filter?.artists).toEqual(["Queen"]);

  const rock = page
    .locator('.genres-panel [data-selection-key="Rock"] .list-tile-main')
    .first();
  await rock.click();
  expect(data.queueRequests).toHaveLength(1);
  await rock.dblclick();
  await expectQueueCount(2);
  expect(lastQueue()?.filter?.genres).toEqual(["Rock"]);

  const library = page
    .locator(
      '.libraries-panel [data-selection-key="library:rock"] .list-tile-main',
    )
    .first();
  await library.click();
  expect(data.queueRequests).toHaveLength(2);
  await library.dblclick();
  await expectQueueCount(3);
  expect(lastQueue()?.filter).toMatchObject({
    libraryIds: ["rock"],
    folders: [],
  });

  await page
    .locator(
      '.libraries-panel [data-selection-key="library:rock"] .tree-toggle',
    )
    .click();
  const folderTile = page.locator(".library-folder-tile").first();
  const folderKey = await folderTile.getAttribute("data-selection-key");
  expect(folderKey).toMatch(/^folder:/);
  const [folderLibraryId, folderPath] = JSON.parse(
    folderKey!.slice("folder:".length),
  ) as [string, string];
  const folder = folderTile.locator(".list-tile-main");
  await expect(folder).toBeVisible();
  await folder.click();
  expect(data.queueRequests).toHaveLength(3);
  await folder.dblclick();
  await expectQueueCount(4);
  expect(lastQueue()?.filter).toMatchObject({
    libraryIds: [],
    folders: [{ libraryId: folderLibraryId, relativePath: folderPath }],
  });

  const playlist = page.locator(".playlist-library-tile .list-tile-main");
  await playlist.click();
  expect(data.queueRequests).toHaveLength(4);
  await playlist.dblclick();
  await expectQueueCount(5);
  expect(lastQueue()).toMatchObject({ playlistId: "road-trip" });
});

test("clearing a genre filter keeps the last selected album in view", async ({
  page,
}) => {
  await catalog(page);
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Rock" })
    .click();
  await expect(page.locator(".artists-panel .artist-row.related")).toHaveCount(
    0,
  );

  const selected = page.locator('.album-card[data-selection-key="Queen-0"]');
  await selected.locator(".album-main").click({ modifiers: ["Control"] });
  await expect(selected).toHaveClass(/selected/);
  await expect(selected).toBeInViewport();
  await expect(artist(page, "Queen")).toHaveClass(/related/);

  await page.getByRole("button", { name: "Сбросить жанры" }).click();
  await expect(selected).toHaveClass(/selected/);
  await expect(selected).toBeInViewport();
  await expect(artist(page, "Queen")).toBeInViewport();
  await expect(artist(page, "Queen")).not.toHaveClass(/selected/);
  await expect(artist(page, "Queen")).toHaveClass(/related/);
});

test("a manual genre filter does not seek an excluded playing album", async ({
  page,
}) => {
  const data = await catalog(page, { extraJazzArtists: 120 });
  const playing = page.locator(
    '.album-card[data-selection-key="Queen-0"] .album-main',
  );
  await playing.click();
  await playing.dblclick();
  await expect(
    page.locator('.album-card[data-selection-key="Queen-0"]'),
  ).not.toHaveClass(/playing/);

  await page.getByRole("button", { name: "Сбросить альбомы" }).click();
  await expect(count(page, "tracks")).toHaveText("777");
  const requestCount = data.requests.length;
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Jazz" })
    .click();
  await expect(count(page, "albums")).toHaveText("123");
  await expect(count(page, "tracks")).toHaveText("369");
  await page.waitForTimeout(250);
  expect(
    data.requests
      .slice(requestCount)
      .some(
        (request) =>
          request.endpoint === "albums" &&
          request.filter.genres.includes("Jazz") &&
          request.offset === 100,
      ),
  ).toBe(false);
});

test("album merge uses the multi-selection anchor and blocks an errored preview", async ({
  page,
}) => {
  const data = await catalog(page);
  await artist(page, "Queen").locator(".list-tile-main").click();
  const first = page.locator('.album-card[data-selection-key="Queen-0"]');
  const second = page.locator('.album-card[data-selection-key="Queen-1"]');
  await first.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: /Объединить альбомы/ }),
  ).not.toBeVisible();
  await page.keyboard.press("Escape");
  await second.locator(".album-main").click({ modifiers: ["Control"] });
  await first.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Объединить альбомы (2)" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Объединить альбомы (2)" }).click();

  await expect(
    page.getByRole("heading", { name: "Объединить 2 альбома" }),
  ).toBeVisible();
  await expect(page.getByLabel("Название альбома")).toHaveValue(
    "Queen-0 title",
  );
  await page.getByLabel("Название альбома").fill("Единый альбом");
  await page.getByRole("button", { name: "Далее" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Объединение альбомов: предварительный просмотр",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Применить к 0 файлам/ }),
  ).toBeDisabled();
  expect(data.mergeContexts).toEqual([{ albumIds: ["Queen-0", "Queen-1"] }]);
  expect(data.mergePreviews).toEqual([
    expect.objectContaining({
      kind: "tags",
      intent: "album-merge",
      selection: {
        filter: { ...emptyFilter, albumIds: ["Queen-0", "Queen-1"] },
      },
      patch: expect.objectContaining({
        albumTitle: "Единый альбом",
        albumArtists: ["Queen"],
        year: 2025,
      }),
    }),
  ]);
});

test("artist folder transfer omits UI-only track counts from the preview request", async ({
  page,
}) => {
  const data = await catalog(page);
  await artist(page, "Queen").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Перенести треки", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Выберите папки для переноса" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();
  await page.getByLabel("Куда перенести").selectOption("jazz");
  await page.getByRole("button", { name: "Далее" }).click();

  await expect.poll(() => data.mergePreviews.length).toBe(1);
  expect(data.mergePreviews[0]).toEqual(
    expect.objectContaining({
      folderRoots: [{ libraryId: "rock", relativePath: "Queen" }],
      selection: {
        filter: {
          ...emptyFilter,
          folders: [{ libraryId: "rock", relativePath: "Queen" }],
        },
      },
    }),
  );
});

test("global search restores filters, selection, expanded folders and scroll positions", async ({
  page,
}) => {
  await catalog(page);
  await addCatalogFilter(page, "Закладки");
  await page
    .getByRole("button", { name: "Развернуть библиотеку «rock»" })
    .click();
  await page
    .locator(".library-folder-tile .list-tile-main")
    .filter({ hasText: "Queen" })
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".library-folder-tile.selected")).toHaveCount(1);
  // Build the saved context upstream to downstream before entering search.
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Rock" })
    .click();
  await filterArtist(page, "Queen");
  await page
    .locator('.album-card[data-selection-key="Queen-0"] .album-main')
    .click({ modifiers: ["Control"] });
  await page
    .locator(
      '[data-testid="track-row"][data-selection-key="Queen-0-0"] .list-tile-main',
    )
    .click();
  await page.locator(".album-scroll").evaluate((node) => {
    node.scrollTop = 700;
  });
  await page.locator(".track-scroll").evaluate((node) => {
    node.scrollTop = 900;
  });
  const positions = await page
    .locator(".album-scroll, .track-scroll")
    .evaluateAll((nodes) => nodes.map((node) => node.scrollTop));
  const search = page.getByLabel("Поиск музыки");
  await search.fill("Miles");
  await expect(artist(page, "Miles")).toBeVisible();
  await expect(count(page, "tracks")).toHaveText("9");
  await expect(
    page.getByRole("button", { name: "Удалить фильтр «Закладки»" }),
  ).toBeDisabled();
  await expect(page.locator('[data-filter="bookmarks"]')).toHaveText(
    "Закладки",
  );
  await expect(page.locator(".facet-reset")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("global-search.png") });
  await page
    .getByRole("button", { name: "Развернуть библиотеку «jazz»" })
    .click();
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Jazz" })
    .click();
  await expect(search).toHaveValue("Miles");
  await search.fill("not-present-anywhere");
  await expect(
    page.getByRole("heading", { name: "Треки не найдены" }),
  ).toBeVisible();
  await search.fill("   ");
  await expect(page.locator(".artists-panel .panel-count")).toContainText(
    "1/1",
  );
  await expect(page.locator(".genres-panel .panel-count")).toContainText("1/1");
  await expect(
    page.getByRole("button", { name: "Удалить фильтр «Закладки»" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Свернуть библиотеку «rock»" }),
  ).toBeVisible();
  await expect(page.locator(".library-folder-tile.selected")).toHaveCount(1);
  await expect(page.locator(".tracks-panel .panel-count")).toContainText("1/3");
  await expect
    .poll(() =>
      page
        .locator(".album-scroll, .track-scroll")
        .evaluateAll((nodes) =>
          nodes.map((node) => Math.round(node.scrollTop)),
        ),
    )
    .toEqual(positions.map(Math.round));
});

test("clearing global search retains its panel choices and reveals them", async ({
  page,
}) => {
  await catalog(page, { extraRockArtists: 80 });
  await page
    .locator(".libraries-panel .list-tile-main")
    .filter({ hasText: "jazz" })
    .click();
  await expect(
    page.getByRole("button", { name: "Сбросить библиотеки" }),
  ).toBeVisible();

  const targetArtist = "Rock artist 75";
  const targetAlbum = `${targetArtist}-0`;
  const targetTrack = `${targetArtist}-0`;
  const search = page.getByLabel("Поиск музыки");
  await search.fill(targetArtist);

  const artistResult = artist(page, targetArtist);
  const albumResult = page.locator(
    `.album-card[data-selection-key="${targetAlbum}"]`,
  );
  const trackResult = page.locator(
    `[data-testid="track-row"][data-selection-key="${targetTrack}"]`,
  );
  await expect(artistResult).toBeVisible();
  await expect(albumResult).toBeVisible();
  await expect(trackResult).toBeVisible();
  await artistResult.locator(".list-tile-main").click();
  await albumResult.locator(".album-main").click();
  await trackResult.locator(".list-tile-main").click();

  await search.fill("");

  const restoredArtist = artist(page, targetArtist);
  const restoredAlbum = page.locator(
    `.album-card[data-selection-key="${targetAlbum}"]`,
  );
  const restoredTrack = page.locator(
    `[data-testid="track-row"][data-selection-key="${targetTrack}"]`,
  );
  await expect(restoredArtist).toHaveClass(/selected/);
  await expect(restoredAlbum).toHaveClass(/selected/);
  await expect(restoredTrack).toHaveClass(/selected/);
  await expect(
    page.getByRole("button", { name: "Сбросить исполнителей" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сбросить альбомы" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сбросить библиотеки" }),
  ).toHaveCount(0);
  await expect(count(page, "tracks")).toHaveText("1/3");
  await expect(restoredArtist).toBeInViewport();
  await expect(restoredAlbum).toBeInViewport();
  await expect(restoredTrack).toBeInViewport();
  await expect(page.locator(".track-row.selected")).toHaveCount(1);
});

test("resetting a library filter restores the artist panel scroll position", async ({
  page,
}) => {
  await catalog(page, { extraRockArtists: 40 });
  await page
    .locator(".libraries-panel .list-tile-main")
    .filter({ hasText: "rock" })
    .click();
  await expect(count(page, "artists")).toHaveText("43");
  await page.locator(".artist-scroll").evaluate((node) => {
    node.scrollTop = 700;
  });
  const position = await page
    .locator(".artist-scroll")
    .evaluate((node) => node.scrollTop);
  expect(position).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Сбросить библиотеки" }).click();

  await expect(count(page, "artists")).toHaveText("44");
  await expect
    .poll(() =>
      page
        .locator(".artist-scroll")
        .evaluate((node) => Math.round(node.scrollTop)),
    )
    .toBe(Math.round(position));
  await expect(
    page.locator('[data-selection-key="Rock artist 15"]'),
  ).toBeInViewport();
});

test("filtering a search result replaces old restrictions and operations use the search selection", async ({
  page,
}) => {
  const data = await catalog(page);
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Rock" })
    .click();
  await filterArtist(page, "Queen");
  const search = page.getByLabel("Поиск музыки");
  await search.fill("Miles");
  await expect(artist(page, "Miles")).toBeVisible();
  await artist(page, "Miles").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Редактировать теги", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => data.summaries.length).toBeGreaterThan(0);
  expect(data.summaries.at(-1)).toEqual({
    filter: { ...emptyFilter, search: "Miles", artists: ["Miles"] },
  });
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await filterArtist(page, "Miles");
  await expect(search).toHaveValue("");
  await expect(artist(page, "Miles")).toBeVisible();
  await expect(count(page, "tracks")).toHaveText("9");
  await expect(
    page.getByRole("button", { name: "Сбросить жанры" }),
  ).toHaveCount(0);
  await search.fill("Queen");
  await expect(artist(page, "Queen")).toBeVisible();
  await search.fill("");
  await expect(artist(page, "Miles")).toBeVisible();
});

test("clearing a pending search ignores its late response and quick input does not leak filters", async ({
  page,
}) => {
  const data = await catalog(page);
  await filterArtist(page, "Queen");
  const search = page.getByLabel("Поиск музыки");
  data.delay("Miles");
  await search.fill("Miles");
  await expect.poll(data.waiting).toBe(true);
  await search.fill("");
  data.release();
  await expect(count(page, "tracks")).toHaveText("390");
  await expect(artist(page, "Queen")).toBeVisible();
  await search.fill("zz-quick");
  await search.fill("");
  await expect(page.locator(".artists-panel .panel-count")).toContainText(
    "1/4",
  );
  expect(
    data.requests
      .filter((request) => request.filter.search)
      .every(
        (request) =>
          !request.filter.artists.length &&
          !request.filter.genres.length &&
          !request.filter.bookmarksOnly,
      ),
  ).toBe(true);
});

test("selection changes do not leak into a new global search", async ({
  page,
}) => {
  await catalog(page);
  await artist(page, "Zebra").locator(".list-tile-main").click();
  await expect(count(page, "albums")).toHaveText("3");
  await page.getByLabel("Поиск музыки").fill("Miles");
  await expect(count(page, "albums")).toHaveText("3");
  await expect(
    page.locator('.album-card[data-selection-key="Miles-0"]'),
  ).toBeInViewport();
  await expect(count(page, "albums")).toHaveText("3");
});

test("album context filtering supports a union and search album operations stay within results", async ({
  page,
}) => {
  const data = await catalog(page);
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Rock" })
    .click();
  await page
    .locator('.album-card[data-selection-key="Bowie-0"] .album-main')
    .click({ modifiers: ["Control"] });
  await page
    .locator('.album-card[data-selection-key="Bowie-1"] .album-main')
    .click({ modifiers: ["Control"] });
  await page
    .locator('.album-card[data-selection-key="Bowie-0"]')
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Фильтровать по выбранному", exact: true })
    .click();
  await expect(page.locator(".albums-panel .panel-count")).toContainText(
    "2/136",
  );
  await expect(count(page, "tracks")).toHaveText("6");
  await expect(
    page.getByRole("button", { name: "Сбросить жанры" }),
  ).toBeVisible();
  await page.getByLabel("Поиск музыки").fill("Miles song 1");
  const album = page.locator('.album-card[data-selection-key="Miles-0"]');
  await album.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Редактировать теги", exact: true })
    .click();
  await expect.poll(() => data.summaries.length).toBeGreaterThan(0);
  expect(data.summaries.at(-1)).toEqual({
    filter: { ...emptyFilter, search: "Miles song 1", albumIds: ["Miles-0"] },
  });
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await album.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Фильтровать по выбранному", exact: true })
    .click();
  await expect(page.getByLabel("Поиск музыки")).toHaveValue("");
  await expect(count(page, "tracks")).toHaveText("3");
  await expect(
    page.getByRole("button", { name: "Сбросить жанры" }),
  ).toHaveCount(0);
});

test("higher-priority panels cascade without narrowing their predecessors", async ({
  page,
}) => {
  await catalog(page);
  const libraries = page.locator(
    ".libraries-panel .library-container > .list-tile",
  );
  const genres = page.locator(".genres-panel .list-tile");
  const rock = libraries.filter({
    has: page.locator('.list-tile-main[title="C:/Music/rock"]'),
  });
  const rockGenre = genres.filter({ hasText: "Rock" });
  await rock.locator(".list-tile-main").click();
  await expect(libraries).toHaveCount(2);
  await expect(genres).toHaveCount(1);
  await expect(page.locator(".artists-panel .artist-row")).toHaveCount(3);
  await expect(count(page, "albums")).toHaveText("136");
  await expect(count(page, "tracks")).toHaveText("408");
  await expect(rock).toHaveClass(/selected/);
  await rockGenre.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(count(page, "tracks")).toHaveText("408");
  await artist(page, "Queen")
    .locator(".list-tile-main")
    .click({ modifiers: ["Control"] });
  await expect(count(page, "albums")).toHaveText("130");
  await expect(count(page, "tracks")).toHaveText("390");
  await page
    .locator('.album-card[data-selection-key="Queen-0"] .album-main')
    .click({ modifiers: ["Control"] });
  await expect(count(page, "tracks")).toHaveText("3");
  await expect(libraries).toHaveCount(2);
  await expect(genres).toHaveCount(1);
});

test("marquee selects neighbouring library and genre options without shrinking either panel", async ({
  page,
}) => {
  await catalog(page);
  for (const selector of [
    ".libraries-panel .library-container > .list-tile",
    ".genres-panel .list-tile",
  ]) {
    const rows = page.locator(selector);
    const first = (await rows.nth(0).boundingBox())!;
    const second = (await rows.nth(1).boundingBox())!;
    await page.mouse.move(first.x + 45, first.y + 4);
    await page.mouse.down();
    await page.mouse.move(
      second.x + second.width - 8,
      second.y + second.height - 4,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(page.locator(`${selector}.selected`)).toHaveCount(2);
    await expect(rows).toHaveCount(2);
    await expect(count(page, "tracks")).toHaveText("417");
  }
});

test("empty panel space starts marquee selection and clears it on click", async ({
  page,
}) => {
  await catalog(page);
  for (const [surfaceSelector, rowSelector, selectedSelector] of [
    [
      ".libraries-panel .library-list",
      ".library-container > .list-tile",
      ".library-container > .list-tile.selected",
    ],
    [".genres-panel .genre-list", ".list-tile", ".list-tile.selected"],
  ] as const) {
    const surface = page.locator(surfaceSelector);
    const rows = surface.locator(rowSelector);
    const last = await rows.last().boundingBox();
    const surfaceBox = await surface.boundingBox();
    expect(last).not.toBeNull();
    expect(surfaceBox).not.toBeNull();
    const emptyAreaY = surfaceBox!.y + surfaceBox!.height - 6;
    expect(emptyAreaY).toBeGreaterThan(last!.y + last!.height + 4);

    await page.mouse.move(last!.x + last!.width - 4, emptyAreaY);
    await page.mouse.down();
    await page.mouse.move(last!.x + last!.width - 4, last!.y + 4, {
      steps: 4,
    });
    await expect(page.getByTestId("selection-marquee")).toBeVisible();
    await page.mouse.up();
    await expect(surface.locator(selectedSelector)).toHaveCount(1);
    await page.mouse.click(last!.x + last!.width - 4, emptyAreaY);
    await expect(surface.locator(selectedSelector)).toHaveCount(0);
  }
});
