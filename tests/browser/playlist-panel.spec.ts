import { expect, test, type Page } from "@playwright/test";
import { emptyFilter, type Track } from "../../src/shared/contracts";
import type {
  PlaylistEntry,
  ResolvedPlaylistTrack,
} from "../../src/shared/playlists";

// Keep session/settings on the local test server, but make duplicate occurrences,
// multi-disc metadata and a long virtualized playlist deterministic.
async function playlistFixture(page: Page, long = false, allKinds = false) {
  const tracks: Track[] = Array.from({ length: long ? 60 : 4 }, (_, index) => ({
    id: `song-${index}`,
    libraryId: "library",
    relativePath: `Music/${index}.flac`,
    title: `Song ${index}`,
    artists: ["Artist"],
    albumArtists: ["Artist"],
    albumKey: index < 2 ? "double" : `album-${index}`,
    albumTitle: index < 2 ? "Double album" : `Album ${index}`,
    genres: ["Rock"],
    year: 2025,
    trackNumber: 1,
    discNumber: index === 1 ? 2 : 1,
    duration: 180,
    format: "FLAC",
    size: 1000,
    mtimeMs: 0,
    coverId: null,
    available: true,
  }));
  let entries: PlaylistEntry[] = (
    allKinds
      ? ["folder", "genre", "track", "album", "artist"]
      : ["folder", "genre", "track"]
  ).map((kind, index) => ({
    id: `entry-${kind}`,
    playlistId: "redesign",
    kind: kind as PlaylistEntry["kind"],
    targetId: kind === "track" ? tracks[0].id : kind,
    position: index,
    snapshot: { title: `${kind} entry`, subtitle: "Artist", coverId: null },
    resolvedCount: kind === "track" ? 1 : tracks.length,
    unavailableCount: 0,
  }));
  const items = (): ResolvedPlaylistTrack[] =>
    entries
      .flatMap((entry) =>
        (entry.kind === "track"
          ? [tracks[0]]
          : entry.kind === "album"
            ? tracks.slice(0, 2)
            : tracks
        ).map((track) => ({
          entryId: entry.id,
          track,
          position: 0,
        })),
      )
      .map((item, position) => ({ ...item, position }));
  const requests: Record<string, unknown>[] = [];
  let queueItems: ResolvedPlaylistTrack[] = [];
  let playlistQueue = true;
  const summary = () => ({
    id: "redesign",
    name: "Playlist redesign",
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
    entryCount: entries.length,
    trackCount: items().length,
    unavailableCount: 0,
  });
  const queue = (position: number) => ({
    id: "redesign-queue",
    position,
    total: queueItems.length,
    ...(playlistQueue
      ? { playlistId: "redesign", entryId: queueItems[position].entryId }
      : {}),
    track: queueItems[position].track,
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.slice(5);
    let body: unknown;
    if (endpoint === "playlists") body = [summary()];
    else if (endpoint === "playlists/redesign")
      body = { playlist: summary(), entries };
    else if (endpoint === "playlists/redesign/tracks")
      body = {
        items: items(),
        total: items().length,
        offset: 0,
        unavailableCount: 0,
        totalDuration: items().length * 180,
      };
    else if (endpoint === "playlists/redesign/reorder") {
      const ids = route.request().postDataJSON().entryIds as string[];
      requests.push({ entryIds: ids });
      entries = ids.map((id, position) => ({
        ...entries.find((entry) => entry.id === id)!,
        position,
      }));
      body = { playlist: summary(), entries };
    } else if (endpoint.startsWith("playlists/redesign/entries/")) {
      const id = endpoint.split("/").at(-1);
      requests.push({ removed: id });
      entries = entries.filter((entry) => entry.id !== id);
      body = { playlist: summary(), entries };
    } else if (endpoint === "queue") {
      const request = route.request().postDataJSON();
      requests.push(request);
      playlistQueue = Boolean(request.playlistId);
      queueItems = items();
      const position = playlistQueue
        ? queueItems.findIndex(
            (item) =>
              (!request.startEntryId ||
                item.entryId === request.startEntryId) &&
              (!request.startId || item.track.id === request.startId),
          )
        : 0;
      body = queue(position);
    } else if (endpoint === "queue/redesign-queue") {
      body = queue(Number(url.searchParams.get("position")));
    } else if (endpoint === "libraries")
      body = [
        {
          id: "library",
          name: "Library",
          path: "/Music",
          available: true,
          lastScan: null,
          trackCount: tracks.length,
        },
      ];
    else if (endpoint === "genres") body = [];
    else if (endpoint === "tracks")
      body = { items: [tracks[0]], total: 1, offset: 0 };
    else if (endpoint === "artists" || endpoint === "albums")
      body = { items: [], total: 0, offset: 0 };
    else return route.fallback();
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Playlist redesign / }).click();
  const panel = page.locator('[data-panel-id="playlists"]');
  await expect(panel.getByTestId("playlist-entry").first()).toBeVisible();
  return { panel, requests, tracks };
}

test("catalog playback does not page through a different filtered track result", async ({
  page,
}) => {
  const { tracks } = await playlistFixture(page);
  const offsets: number[] = [];
  const unrelated = Array.from({ length: 200 }, (_, index) => ({
    ...tracks[0],
    id: `unrelated-${index}`,
    title: `Unrelated ${index}`,
    albumKey: "unrelated",
    trackNumber: index + 1,
  }));
  await page.route("**/api/tracks?**", async (route) => {
    offsets.push(
      Number(new URL(route.request().url()).searchParams.get("offset")),
    );
    await route.fulfill({
      json: { items: unrelated, offset: 0, total: 100000 },
    });
  });
  await page.route("**/api/queue/redesign-queue?**", async (route) => {
    const position = Number(
      new URL(route.request().url()).searchParams.get("position"),
    );
    await route.fulfill({
      json: {
        id: "redesign-queue",
        position,
        total: tracks.length,
        track: tracks[position],
        filter: { ...emptyFilter, albumIds: ["different-source"] },
      },
    });
  });
  await page.evaluate(() =>
    localStorage.setItem(
      "harbor-player-queue",
      JSON.stringify({
        id: "redesign-queue",
        position: 0,
      }),
    ),
  );
  await page.reload();
  await expect(page.getByTestId("track-row").first()).toContainText(
    "Unrelated 0",
  );
  await expect(page.locator(".now-copy")).toContainText("Song 0");
  await page
    .getByRole("button", { name: "Следующий трек", exact: true })
    .click();
  await expect(page.locator(".now-copy")).toContainText("Song 1");
  // Wait for React's follow effect and the browser's next render, not a fixed delay.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(offsets).toEqual([0]);
});

test("top-level entries are compact, keep type icons and put album year beside artist", async ({
  page,
}) => {
  const { panel } = await playlistFixture(page, false, true);
  // Collapse the outer groups so all five types fit in the virtual viewport.
  for (const id of ["folder", "genre", "album", "artist"]) {
    const row = panel.locator(
      `[data-testid="playlist-entry"][data-entry-id="entry-${id}"]`,
    );
    await row.locator(".playlist-entity-main").click();
  }
  const entries = panel.getByTestId("playlist-entry");
  await expect(entries).toHaveCount(5);
  const catalogDuration = await page
    .getByTestId("track-row")
    .first()
    .locator(".list-tile-suffix")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontFamily, style.fontSize, style.fontWeight, style.color];
    });
  for (const [kind, icon] of Object.entries({
    folder: "folder-open",
    genre: "drama",
    track: "music",
    album: "disc-album",
    artist: "circle-user-round",
  })) {
    const row = panel.locator(
      `[data-testid="playlist-entry"][data-entry-id="entry-${kind}"]`,
    );
    await expect(
      row.locator(`.playlist-entity-icon.lucide-${icon}`),
    ).toBeVisible();
    expect((await row.boundingBox())?.height).toBe(36);
    await expect(
      row.locator("img, .tiny-cover, .collapse-toggle, .icon-button"),
    ).toHaveCount(0);
    await expect(row.locator(".playlist-entity-duration")).toBeVisible();
    await row.hover();
    await expect(row.locator(".playlist-entity-icon")).toBeVisible();
    const bounds = await row.evaluate((element) => {
      const content = element.closest(".playlist-content")!;
      const main = element.querySelector(".playlist-entity-main")!;
      return {
        left:
          main.getBoundingClientRect().left -
          content.getBoundingClientRect().left,
        width: main.getBoundingClientRect().width,
        panelWidth: content.clientWidth,
        background: getComputedStyle(main).backgroundColor,
      };
    });
    expect(bounds.left).toBe(0);
    expect(bounds.width).toBe(bounds.panelWidth);
    expect(bounds.background).not.toBe("rgba(0, 0, 0, 0)");
    if (kind === "track") {
      const durationStyle = await row
        .locator(".playlist-entity-duration")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return [
            style.fontFamily,
            style.fontSize,
            style.fontWeight,
            style.color,
          ];
        });
      expect(durationStyle).toEqual(catalogDuration);
    }
  }
  const album = panel.locator(
    '[data-entry-id="entry-album"][data-testid="playlist-entry"]',
  );
  await expect(album.locator(".playlist-entity-subtitle")).toHaveText(
    "Artist2025",
  );
  await expect(album.locator(".playlist-entity-title")).toHaveText(
    "Double album",
  );
  for (const kind of ["artist", "genre"])
    await expect(
      panel.locator(
        `[data-entry-id="entry-${kind}"] .playlist-entity-subtitle`,
      ),
    ).toHaveCount(0);
  const track = panel.locator(
    '[data-entry-id="entry-track"][data-testid="playlist-entry"]',
  );
  await expect(track.locator(".playlist-entity-main")).not.toHaveAttribute(
    "aria-expanded",
  );
  await track.locator(".playlist-entity-main").dblclick();
  await expect(track).toHaveClass(/current-queue-item/);
  await expect(
    track.locator(".playlist-entity-icon.lucide-music"),
  ).toBeVisible();
});

test("playlist entities show nested albums/discs, durations and entry-only actions", async ({
  page,
}) => {
  const { panel } = await playlistFixture(page);
  const folder = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-folder"]',
  );
  await expect(folder.locator(".playlist-entity-duration")).toHaveText("12:00");
  const album = panel.getByTestId("playlist-album").first();
  await expect(album).toContainText("Double album");
  await expect(album.locator(".track-album-duration")).toHaveText("6:00");
  await expect(panel.locator(".track-disc-header").first()).toHaveText(
    "Диск 1",
  );
  await expect(panel.locator(".track-disc-header").nth(1)).toHaveText("Диск 2");
  await expect(
    album.getByRole("button", { name: "Удалить из плейлиста" }),
  ).toHaveCount(0);
  await expect(
    panel
      .getByTestId("playlist-track-row")
      .first()
      .getByRole("button", { name: "Переместить вверх" }),
  ).toHaveCount(0);
  await folder.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Переместить вверх" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  if (process.env.HARBOR_PLAYLIST_SCREENSHOT) {
    await folder.click({ button: "right" });
    await page.screenshot({ path: process.env.HARBOR_PLAYLIST_SCREENSHOT });
  }
  await album.getByRole("button", { name: "Свернуть", exact: true }).click();
  await expect(
    album.getByRole("button", { name: "Развернуть" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByTestId("playlist-track-row")).toHaveCount(6);
  await folder.locator(".playlist-entity-main").click();
  await expect(
    panel.locator(
      '[data-testid="playlist-album"][data-entry-id="entry-folder"]',
    ),
  ).toHaveCount(0);
  const genre = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-genre"]',
  );
  await expect(genre).toBeVisible();
  await expect(genre.locator(".playlist-entity-duration")).toHaveText("12:00");
  await expect(
    panel
      .locator('[data-testid="playlist-album"][data-entry-id="entry-genre"]')
      .first(),
  ).toContainText("Double album");
});

test("up/down/remove mutate only added entries and retain whole nested groups", async ({
  page,
}) => {
  const { panel, requests } = await playlistFixture(page);
  // Collapse both groups to keep every added entry mounted by the virtualizer.
  for (const id of ["entry-folder", "entry-genre"])
    await panel
      .locator(`[data-testid="playlist-entry"][data-entry-id="${id}"]`)
      .locator(".playlist-entity-main")
      .click();
  const ids = () =>
    panel
      .getByTestId("playlist-entry")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-entry-id")),
      );
  const folder = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-folder"]',
  );
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Переместить вниз" }).click();
  await expect
    .poll(ids)
    .toEqual(["entry-genre", "entry-folder", "entry-track"]);
  expect(requests.at(-1)).toEqual({
    entryIds: ["entry-genre", "entry-folder", "entry-track"],
  });
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Переместить вверх" }).click();
  await expect
    .poll(ids)
    .toEqual(["entry-folder", "entry-genre", "entry-track"]);
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Удалить из плейлиста" }).click();
  await expect.poll(ids).toEqual(["entry-genre", "entry-track"]);
  expect(requests.at(-1)).toEqual({ removed: "entry-folder" });
});

test("dropping an added entity onto a nested track moves it before the owning entry", async ({
  page,
}) => {
  const { panel, requests } = await playlistFixture(page);
  const folder = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-folder"]',
  );
  const genre = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-genre"]',
  );
  await folder.locator(".playlist-entity-main").click();
  await genre.locator(".playlist-entity-main").click();
  const addedTrack = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-track"]',
  );
  await folder.locator(".playlist-entity-main").click();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await addedTrack.dispatchEvent("dragstart", { dataTransfer: transfer });
  await panel
    .getByTestId("playlist-track-row")
    .first()
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect
    .poll(() => requests.at(-1))
    .toEqual({
      entryIds: ["entry-track", "entry-folder", "entry-genre"],
    });
  await expect(panel.getByTestId("playlist-entry").first()).toHaveAttribute(
    "data-entry-id",
    "entry-track",
  );
  await expect(folder).toBeVisible();
  await transfer.dispose();
});

test("catalog insertion shares the mutation lock and clears cancelled drop markers", async ({
  page,
}) => {
  const { panel, requests } = await playlistFixture(page);
  const folder = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-folder"]',
  );
  const nested = panel.getByTestId("playlist-track-row").first();
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData(
      "application/x-harbor-catalog-selection",
      JSON.stringify({ kind: "track", ids: ["song-0"] }),
    );
    return data;
  });
  await nested.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(folder).toHaveClass(/playlist-drop-before/);
  await page
    .locator("body")
    .dispatchEvent("dragend", { dataTransfer: transfer });
  await expect(folder).not.toHaveClass(/playlist-drop-before/);
  const foreign = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "not a playlist item");
    return data;
  });
  await nested.dispatchEvent("dragover", { dataTransfer: foreign });
  await expect(folder).not.toHaveClass(/playlist-drop-before/);
  await nested.dispatchEvent("drop", { dataTransfer: foreign });
  const writes: unknown[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/playlists/redesign/entries", async (route) => {
    writes.push(route.request().postDataJSON());
    await pending;
    await route.fulfill({ json: {} });
  });
  await nested.dispatchEvent("drop", { dataTransfer: transfer });
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    kind: "track",
    selection: { trackIds: ["song-0"] },
    beforeEntryId: "entry-folder",
  });
  try {
    await expect(folder).toHaveAttribute("draggable", "false");
    await folder.click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "Удалить из плейлиста" }),
    ).toBeDisabled();
    await panel.dispatchEvent("drop", { dataTransfer: transfer });
    await page.keyboard.press("Escape");
  } finally {
    release();
  }
  await expect(folder).toHaveAttribute("draggable", "true");
  expect(writes).toHaveLength(1);
  expect(requests).toHaveLength(0);
  await transfer.dispose();
  await foreign.dispose();
});

test("management actions remain disabled until reorder and refresh finish", async ({
  page,
}) => {
  const { panel } = await playlistFixture(page);
  const folder = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-folder"]',
  );
  let release!: () => void;
  let arrived!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route("**/api/playlists/redesign/reorder", async (route) => {
    arrived();
    await pending;
    await route.fallback();
  });
  await folder.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Переместить вниз" }).click();
  await received;
  await folder.click({ button: "right" });
  try {
    await expect(
      page.getByRole("menuitem", { name: "Переместить вниз" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("menuitem", { name: "Удалить из плейлиста" }),
    ).toBeDisabled();
    await expect(folder).toHaveAttribute("draggable", "false");
  } finally {
    release();
  }
  await expect(
    page.getByRole("menuitem", { name: "Переместить вверх" }),
  ).toBeEnabled();
  await expect(folder).toHaveAttribute("draggable", "true");
});

test("entity double click selects exact duplicate occurrence and catalog playback clears playlist marker", async ({
  page,
}) => {
  const { panel, requests } = await playlistFixture(page);
  await panel
    .locator('[data-testid="playlist-entry"][data-entry-id="entry-folder"]')
    .locator(".playlist-entity-main")
    .click();
  const genre = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-genre"]',
  );
  await genre.locator(".playlist-entity-main").click();
  expect(requests).toHaveLength(0);
  await genre.locator(".playlist-entity-main").dblclick();
  await expect
    .poll(() => requests.at(-1))
    .toEqual({
      playlistId: "redesign",
      startId: "song-0",
      startEntryId: "entry-genre",
    });
  await expect(panel.locator(".current")).toHaveCount(1);
  await expect(
    panel
      .getByTestId("playlist-track-row")
      .filter({ hasText: "Song 0" })
      .first(),
  ).toHaveClass(/current/);
  const nestedAlbum = panel
    .locator('[data-testid="playlist-album"][data-entry-id="entry-genre"]')
    .first();
  await nestedAlbum.locator(".track-album-copy").dblclick();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.at(-1)).toEqual({
    playlistId: "redesign",
    startId: "song-0",
    startEntryId: "entry-genre",
  });
  await genre.locator(".playlist-entity-main").click();
  const trackEntry = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-track"]',
  );
  await trackEntry.locator(".playlist-entity-main").dblclick();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests.at(-1)).toEqual({
    playlistId: "redesign",
    startId: "song-0",
    startEntryId: "entry-track",
  });
  await expect(trackEntry).toHaveClass(/current/);
  await expect(panel.locator(".current")).toHaveCount(1);
  await page.getByTestId("track-row").filter({ hasText: "Song 0" }).dblclick();
  await expect.poll(() => requests.length).toBe(4);
  expect(requests.at(-1)).not.toHaveProperty("playlistId");
  await expect(panel.locator(".current")).toHaveCount(0);
});

test("automatic next opens collapsed ancestors and scrolls to the exact occurrence", async ({
  page,
}) => {
  const { panel } = await playlistFixture(page, true);
  const folder = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-folder"]',
  );
  const firstAlbum = panel.getByTestId("playlist-album").first();
  await firstAlbum.dblclick();
  await expect(panel.locator(".current")).toHaveCount(1);
  await firstAlbum
    .getByRole("button", { name: "Свернуть", exact: true })
    .click();
  await folder.locator(".playlist-entity-main").click();
  await page
    .locator("audio")
    .evaluate((audio) => audio.dispatchEvent(new Event("ended")));
  const current = panel
    .getByTestId("playlist-track-row")
    .filter({ has: page.getByText("Song 1", { exact: true }) })
    // The folder occurrence precedes the intentional duplicate in the genre entry.
    .first();
  await expect(current).toHaveClass(/current/);
  await expect(current).toBeInViewport();
  await expect(folder.locator(".playlist-entity-main")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // Advance to a distant queue position using real ended transitions.
  for (let position = 2; position <= 40; position++) {
    const response = page.waitForResponse((response) =>
      response.url().includes(`/api/queue/redesign-queue?position=${position}`),
    );
    await page
      .locator("audio")
      .evaluate((audio) => audio.dispatchEvent(new Event("ended")));
    await response;
    await expect(page.locator(".now-playing")).toContainText(
      `Song ${position}`,
    );
  }
  await expect(
    panel.locator('[data-testid="playlist-track-row"].current'),
  ).toContainText("Song 40");
  await expect(
    panel.locator('[data-testid="playlist-track-row"].current'),
  ).toBeInViewport();
});

test("playlist header keeps only hide control in landscape, portrait and empty state", async ({
  page,
}) => {
  const { panel } = await playlistFixture(page);
  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 800, height: 1200 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(panel.locator(".panel-heading button")).toHaveCount(1);
    await expect(
      panel.getByRole("button", { name: "Закрыть панель «Плейлист»" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: "Playlist redesign" }),
    ).toBeVisible();
  }
  await page.reload();
  await expect(panel.getByText("Выберите или создайте плейлист")).toBeVisible();
  await expect(panel.locator(".panel-heading button")).toHaveCount(1);
  await panel
    .getByRole("button", { name: "Закрыть панель «Плейлист»" })
    .click();
  await expect(panel).toHaveCount(0);
});

async function playlistManagementFixture(page: Page) {
  const { panel } = await playlistFixture(page);
  let otherName = "Other playlist";
  let removed = false;
  const writes: { method: string; name?: string; cleanup?: string | null }[] =
    [];
  await page.route("**/api/playlists", async (route) =>
    route.fulfill({
      json: [
        {
          id: "redesign",
          name: "Playlist redesign",
          createdAt: "2025-01-01",
          updatedAt: "2025-01-01",
          entryCount: 3,
          trackCount: 9,
          unavailableCount: 0,
        },
        ...(removed
          ? []
          : [
              {
                id: "other",
                name: otherName,
                createdAt: "2025-01-01",
                updatedAt: "2025-01-01",
                entryCount: 0,
                trackCount: 0,
                unavailableCount: 0,
              },
            ]),
      ],
    }),
  );
  await page.route("**/api/playlists/other?*", async (route) => {
    removed = true;
    writes.push({
      method: route.request().method(),
      cleanup: new URL(route.request().url()).searchParams.get("cleanup"),
    });
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/playlists/other", async (route) => {
    otherName = route.request().postDataJSON().name;
    writes.push({ method: route.request().method(), name: otherName });
    await route.fulfill({
      json: {
        playlist: {
          id: "other",
          name: otherName,
          createdAt: "2025-01-01",
          updatedAt: "2025-01-01",
          entryCount: 0,
          trackCount: 0,
          unavailableCount: 0,
        },
        entries: [],
      },
    });
  });
  await page.route("**/api/playlists/other/sync", async (route) =>
    route.fulfill({
      json: {
        playlistId: "other",
        targetPath: null,
        templateId: "default-album-artist",
        autoSync: false,
        state: "idle",
        lastSyncedAt: null,
        message: "Not synced",
      },
    }),
  );
  await page.route("**/api/path-templates", async (route) =>
    route.fulfill({ json: [] }),
  );
  await page.reload();
  await page
    .locator(".playlist-library-tile")
    .filter({ hasText: "Playlist redesign" })
    .click();
  await expect(panel.getByTestId("playlist-entry").first()).toBeVisible();
  return {
    panel,
    writes,
    other: page
      .locator(".playlist-library-tile")
      .filter({ hasText: "Other playlist" }),
  };
}

test("playlist context menu targets inactive row and opens settings with panel hidden", async ({
  page,
}) => {
  const { panel, other } = await playlistManagementFixture(page);
  const menu = page.getByRole("menu", {
    name: "Контекстное меню",
    exact: true,
  });
  await other.click({ button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Переименовать",
    "Настройки",
    "Удалить",
  ]);
  await expect(
    panel.getByRole("heading", { name: "Playlist redesign" }),
  ).toBeVisible();
  await expect(other).not.toHaveClass(/selected/);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await other.click({ button: "right" });
  await panel.getByRole("heading").click();
  await expect(menu).toHaveCount(0);
  for (const hidePanel of [false, true]) {
    if (hidePanel)
      await panel
        .getByRole("button", { name: "Закрыть панель «Плейлист»" })
        .click();
    await other.click({ button: "right" });
    await menu
      .getByRole("menuitem", { name: "Настройки", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Сборка и экспорт" });
    await expect(dialog.locator(".modal-header p")).toHaveText(
      "Other playlist",
    );
    await expect(dialog.getByLabel("Папка сборки")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("playlist menu renames and deletes inactive playlist without clearing active selection", async ({
  page,
}) => {
  const { panel, other, writes } = await playlistManagementFixture(page);
  const menu = page.getByRole("menu", {
    name: "Контекстное меню",
    exact: true,
  });
  await other.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept("Renamed playlist"));
  await menu
    .getByRole("menuitem", { name: "Переименовать", exact: true })
    .click();
  const renamed = page
    .locator(".playlist-library-tile")
    .filter({ hasText: "Renamed playlist" });
  await expect(renamed).toBeVisible();
  expect(writes).toEqual([{ method: "POST", name: "Renamed playlist" }]);
  await renamed.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.dismiss());
  await menu.getByRole("menuitem", { name: "Удалить", exact: true }).click();
  await expect(renamed).toBeVisible();
  expect(writes).toHaveLength(1);
  await renamed.click({ button: "right" });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Renamed playlist");
    page.once("dialog", (cleanup) => cleanup.dismiss());
    await dialog.accept();
  });
  await menu.getByRole("menuitem", { name: "Удалить", exact: true }).click();
  await expect(renamed).toHaveCount(0);
  expect(writes.at(-1)).toEqual({ method: "DELETE", cleanup: "false" });
  await expect(
    panel.getByRole("heading", { name: "Playlist redesign" }),
  ).toBeVisible();
  await expect(page.locator(".playlist-library-tile.selected")).toContainText(
    "Playlist redesign",
  );
});
