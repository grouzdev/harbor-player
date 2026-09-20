import { expect, test, type Page } from "@playwright/test";
import {
  emptyFilter,
  type CatalogFilter,
  type Track,
} from "../../src/shared/contracts";

// A paginated catalog with enough rows to exercise virtualized navigation and
// restoration. Other app services (session, settings) use the real test server.
async function catalog(page: Page) {
  const tracks: Track[] = [
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
  );
  const requests: {
    endpoint: string;
    filter: CatalogFilter;
    offset: number;
  }[] = [];
  const summaries: unknown[] = [];
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
    else if (endpoint === "filter-validity")
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
    } else return route.fallback();
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await expect(page.locator(".artists-panel .artist-row")).toHaveCount(4);
  return {
    requests,
    summaries,
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

test("ordinary navigation loads distant albums and tracks without filtering; Ctrl only selects", async ({
  page,
}) => {
  const data = await catalog(page);
  await artist(page, "Zebra").locator(".list-tile-main").click();
  await expect(count(page, "albums")).toHaveText("139");
  await expect(
    page.getByRole("button", { name: "Сбросить исполнителей" }),
  ).toHaveCount(0);
  const album = page.locator('.album-card[data-selection-key="Zebra-0"]');
  await expect(album).toBeInViewport();
  expect(
    data.requests.some(
      (request) =>
        request.endpoint === "albums" &&
        request.offset >= 100 &&
        !request.filter.artists.length,
    ),
  ).toBe(true);
  const top = await page
    .locator(".album-scroll")
    .evaluate((node) => node.scrollTop);
  await artist(page, "Queen")
    .locator(".list-tile-main")
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".artist-row.selected")).toHaveCount(2);
  expect(
    await page.locator(".album-scroll").evaluate((node) => node.scrollTop),
  ).toBe(top);
  await album.locator(".album-main").click();
  await expect(
    page.locator('[data-testid="track-row"][data-selection-key="Zebra-0-0"]'),
  ).toBeInViewport();
  await expect(count(page, "tracks")).toHaveText("417");
  expect(
    data.requests.some(
      (request) =>
        request.endpoint === "tracks" &&
        request.offset >= 200 &&
        !request.filter.albumIds.length,
    ),
  ).toBe(true);
  await filterArtist(page, "Zebra");
  await expect(
    page.locator(".artists-panel .panel-selection-chip"),
  ).toContainText("2/2");
  await expect(count(page, "albums")).toHaveText("133");
  await page.getByRole("button", { name: "Сбросить исполнителей" }).click();
  await expect(count(page, "albums")).toHaveText("139");
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
  ).toContainText("1/2");
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
  ).toContainText("1/390");
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
  ).toContainText("1/1");
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

test("a late navigation result cannot move a new search", async ({ page }) => {
  await catalog(page);
  let release: (() => void) | undefined;
  await page.route("**/api/albums?**", async (route) => {
    const url = new URL(route.request().url());
    const filter = JSON.parse(url.searchParams.get("filter")!);
    if (
      url.searchParams.get("limit") === "1" &&
      filter.artists.includes("Zebra")
    ) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.fallback();
  });
  await artist(page, "Zebra").locator(".list-tile-main").click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByLabel("Поиск музыки").fill("Miles");
  await expect(count(page, "albums")).toHaveText("3");
  const lateResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/albums?") &&
      new URL(response.url()).searchParams.get("limit") === "1",
  );
  release!();
  await lateResponse;
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
  ).toContainText("2/2");
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

test("library, folder and genre options remain complete under manual filters", async ({
  page,
}) => {
  const data = await catalog(page);
  const libraries = page.locator(
    ".libraries-panel .library-container > .list-tile",
  );
  const genres = page.locator(".genres-panel .list-tile");
  const rock = libraries.filter({
    has: page.locator('.list-tile-main[title="C:/Music/rock"]'),
  });
  const jazz = libraries.filter({
    has: page.locator('.list-tile-main[title="C:/Music/jazz"]'),
  });
  const rockGenre = genres.filter({ hasText: "Rock" });
  const jazzGenre = genres.filter({ hasText: "Jazz" });
  await rock.locator(".list-tile-main").click();
  await expect(libraries).toHaveCount(2);
  await expect(genres).toHaveCount(2);
  await expect(count(page, "tracks")).toHaveText("408");
  await jazzGenre.locator(".list-tile-main").click();
  await expect(count(page, "tracks")).toHaveText("0");
  await expect(rock).toHaveClass(/selected/);
  await expect(jazzGenre).toHaveClass(/selected/);
  await expect(libraries).toHaveCount(2);
  await expect(genres).toHaveCount(2);
  await rockGenre.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(count(page, "tracks")).toHaveText("408");
  await jazz.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(count(page, "tracks")).toHaveText("417");
  await rockGenre.locator(".list-tile-main").click();
  await expect(page.locator(".genres-panel .list-tile.selected")).toHaveCount(
    1,
  );
  await expect(count(page, "tracks")).toHaveText("408");
  await jazzGenre.locator(".list-tile-main").click({ modifiers: ["Control"] });
  await expect(count(page, "tracks")).toHaveText("417");
  await expect(
    page.locator(".libraries-panel .panel-selection-chip"),
  ).toContainText("2/2");
  await page
    .getByRole("button", { name: "Развернуть библиотеку «rock»" })
    .click();
  const folders = page.locator(".library-folder-tile");
  await folders.filter({ hasText: "Queen" }).locator(".list-tile-main").click();
  await expect(folders).toHaveCount(3);
  await folders
    .filter({ hasText: "Bowie" })
    .locator(".list-tile-main")
    .click({ modifiers: ["Control"] });
  await expect(count(page, "tracks")).toHaveText("399");
  await filterArtist(page, "Queen");
  await page
    .getByRole("button", { name: "Показать музыку из закладок", exact: true })
    .click();
  await page
    .locator('.album-card[data-selection-key="Queen-0"]')
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Фильтровать по выбранному", exact: true })
    .click();
  await expect(count(page, "tracks")).toHaveText("3");
  await expect(libraries).toHaveCount(2);
  await expect(genres).toHaveCount(2);
  await expect(folders).toHaveCount(3);
  await expect(rock.locator(".list-tile-suffix")).toHaveText("408");
  await expect(jazz.locator(".list-tile-suffix")).toHaveText("9");
  expect(
    data.requests
      .filter((request) => ["libraries", "genres"].includes(request.endpoint))
      .every(
        (request) =>
          JSON.stringify(request.filter) === JSON.stringify(emptyFilter),
      ),
  ).toBe(true);
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
