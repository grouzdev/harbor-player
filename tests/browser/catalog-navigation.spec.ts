import { expect, test, type Page } from "@playwright/test";
import {
  emptyFilter,
  type CatalogFilter,
  type Track,
} from "../../src/shared/contracts";

// A paginated catalog with enough rows to exercise virtualized navigation and
// restoration. Other app services (session, settings) use the real test server.
async function catalog(page: Page, { extraRockArtists = 0 } = {}) {
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
  ];
  const requests: {
    endpoint: string;
    filter: CatalogFilter;
    offset: number;
  }[] = [];
  const summaries: unknown[] = [];
  const mergeContexts: unknown[] = [];
  const mergePreviews: unknown[] = [];
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
    if (endpoint === "libraries")
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
    else if (endpoint === "genres")
      body = [...new Set(rows.flatMap((track) => track.genres))].map(
        (name) => ({ name, count: 1 }),
      );
    else if (endpoint === "artists")
      body = paginated(
        [...new Set(rows.flatMap((track) => track.albumArtists))].map(
          (name) => ({
            name,
            count:
              rows.filter((track) => track.albumArtists.includes(name)).length /
              3,
          }),
        ),
      );
    else if (endpoint === "albums")
      body = paginated([
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
      ]);
    else if (endpoint === "tracks") body = paginated(rows);
    else if (endpoint === "queue") {
      const request = route.request().postDataJSON() as {
        albumId?: string;
      };
      const track = tracks.find((item) => item.albumKey === request.albumId);
      if (!track) return route.fallback();
      body = {
        id: `queue-${request.albumId}`,
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
      body = {
        libraryIds: [...new Set(rows.map((track) => track.libraryId))],
        genres: [...new Set(rows.flatMap((track) => track.genres))],
        folders: [],
      };
    else if (endpoint === "bookmarks")
      body = [{ kind: "artist", id: "Queen", createdAt: "2026-01-01" }];
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
  await expect(count(page, "artists")).toHaveText(String(4 + extraRockArtists));
  return {
    requests,
    summaries,
    mergeContexts,
    mergePreviews,
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
  await album.locator(".album-main").click();
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
  await expect(
    page.locator(".artists-panel .panel-selection-chip"),
  ).toContainText("2/4");
  await expect(
    page.locator(".albums-panel .panel-selection-chip"),
  ).toContainText("1/133");
  await page.getByRole("button", { name: "Сбросить исполнителей" }).click();
  await expect(
    page.locator(".albums-panel .panel-selection-chip"),
  ).toContainText("1/139");
});

test("selecting an album keeps the album grid in place while another album plays", async ({
  page,
}) => {
  const data = await catalog(page);
  const playing = page.locator(
    '.album-card[data-selection-key="Queen-0"] .album-main',
  );
  await playing.click();
  await playing.click();
  await expect(
    page.locator('.album-card[data-selection-key="Queen-0"]'),
  ).toHaveClass(/playing/);

  await page.locator(".album-scroll").evaluate((node) => {
    node.scrollTop = node.scrollHeight / 2;
  });
  await expect
    .poll(() =>
      page.locator(".album-scroll").evaluate((node) => node.scrollTop),
    )
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

test("global search restores filters, selection, expanded folders and scroll positions", async ({
  page,
}) => {
  await catalog(page);
  await page
    .locator(".genres-panel .list-tile-main")
    .filter({ hasText: "Rock" })
    .click();
  await filterArtist(page, "Queen");
  await page
    .getByRole("button", { name: "Показать музыку из закладок", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Развернуть библиотеку «rock»" })
    .click();
  await page
    .locator(".library-folder-tile .list-tile-main")
    .filter({ hasText: "Queen" })
    .click();
  await expect(page.locator(".library-folder-tile.selected")).toHaveCount(1);
  await page
    .locator('.album-card[data-selection-key="Queen-0"] .album-main')
    .click();
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
  await expect(page.locator(".bookmarks-button")).toBeDisabled();
  await expect(page.locator(".bookmarks-button")).toHaveAttribute(
    "aria-pressed",
    "false",
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
  await expect(
    page.locator(".artists-panel .panel-selection-chip"),
  ).toContainText("1/1");
  await expect(
    page.locator(".genres-panel .panel-selection-chip"),
  ).toContainText("1/1");
  await expect(page.locator(".bookmarks-button")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Свернуть библиотеку «rock»" }),
  ).toBeVisible();
  await expect(page.locator(".library-folder-tile.selected")).toHaveCount(1);
  await expect(
    page.locator(".tracks-panel .panel-selection-chip"),
  ).toContainText("1/3");
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
  await expect(
    page.locator(".artists-panel .panel-selection-chip"),
  ).toContainText("1/4");
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
    .click();
  await page
    .locator('.album-card[data-selection-key="Bowie-1"] .album-main')
    .click({ modifiers: ["Control"] });
  await page
    .locator('.album-card[data-selection-key="Bowie-0"]')
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Фильтровать по выбранному", exact: true })
    .click();
  await expect(
    page.locator(".albums-panel .panel-selection-chip"),
  ).toContainText("2/136");
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
  await rockGenre.locator(".list-tile-main").click();
  await expect(count(page, "tracks")).toHaveText("408");
  await artist(page, "Queen").locator(".list-tile-main").click();
  await expect(count(page, "albums")).toHaveText("130");
  await expect(count(page, "tracks")).toHaveText("390");
  await page
    .locator('.album-card[data-selection-key="Queen-0"] .album-main')
    .click();
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
