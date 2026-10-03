import { expect, test, type Page } from "@playwright/test";
import { emptyFilter, type Track } from "../../src/shared/contracts";
import type {
  PlaylistEntry,
  ResolvedPlaylistTrack,
} from "../../src/shared/playlists";

// Keep session/settings on the local test server, but make duplicate occurrences,
// multi-disc metadata and a long virtualized playlist deterministic.
async function playlistFixture(page: Page, long = false) {
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
  let entries: PlaylistEntry[] = ["folder", "genre", "track"].map(
    (kind, index) => ({
      id: `entry-${kind}`,
      playlistId: "redesign",
      kind: kind as PlaylistEntry["kind"],
      targetId: kind === "track" ? tracks[0].id : kind,
      position: index,
      snapshot: { title: `${kind} entry`, subtitle: "Artist", coverId: null },
      resolvedCount: kind === "track" ? 1 : tracks.length,
      unavailableCount: 0,
    }),
  );
  const items = (): ResolvedPlaylistTrack[] =>
    entries
      .flatMap((entry) =>
        (entry.kind === "track" ? [tracks[0]] : tracks).map((track) => ({
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

test("playlist entities show nested albums/discs, durations and entry-only actions", async ({
  page,
}) => {
  const { panel } = await playlistFixture(page);
  const folder = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-folder"]',
  );
  await expect(folder.locator(".track-album-duration")).toHaveText("12:00");
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
  await expect(
    folder.getByRole("button", { name: "Переместить вверх" }),
  ).toBeDisabled();
  if (process.env.HARBOR_PLAYLIST_SCREENSHOT) {
    await folder.hover();
    await page.screenshot({ path: process.env.HARBOR_PLAYLIST_SCREENSHOT });
  }
  await album.getByRole("button", { name: "Свернуть", exact: true }).click();
  await expect(
    album.getByRole("button", { name: "Развернуть" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByTestId("playlist-track-row")).toHaveCount(6);
  await folder.getByRole("button", { name: "Свернуть", exact: true }).click();
  await expect(
    panel.locator(
      '[data-testid="playlist-album"][data-entry-id="entry-folder"]',
    ),
  ).toHaveCount(0);
  const genre = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-genre"]',
  );
  await expect(genre).toBeVisible();
  await expect(genre.locator(".track-album-duration")).toHaveText("12:00");
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
      .getByRole("button", { name: "Свернуть", exact: true })
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
  await folder.hover();
  await folder.getByRole("button", { name: "Переместить вниз" }).click();
  await expect
    .poll(ids)
    .toEqual(["entry-genre", "entry-folder", "entry-track"]);
  expect(requests.at(-1)).toEqual({
    entryIds: ["entry-genre", "entry-folder", "entry-track"],
  });
  await folder.hover();
  await folder.getByRole("button", { name: "Переместить вверх" }).click();
  await expect
    .poll(ids)
    .toEqual(["entry-folder", "entry-genre", "entry-track"]);
  await folder.hover();
  await folder.getByRole("button", { name: "Удалить из плейлиста" }).click();
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
  await folder.getByRole("button", { name: "Свернуть", exact: true }).click();
  await genre.getByRole("button", { name: "Свернуть", exact: true }).click();
  const addedTrack = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-track"]',
  );
  await folder.getByRole("button", { name: "Развернуть", exact: true }).click();
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
  await folder.hover();
  await folder.getByRole("button", { name: "Переместить вниз" }).click();
  await received;
  try {
    await expect(
      folder.getByRole("button", { name: "Переместить вниз" }),
    ).toBeDisabled();
    await expect(
      folder.getByRole("button", { name: "Удалить из плейлиста" }),
    ).toBeDisabled();
    await expect(folder).toHaveAttribute("draggable", "false");
  } finally {
    release();
  }
  await expect(
    folder.getByRole("button", { name: "Переместить вверх" }),
  ).toBeEnabled();
  await expect(folder).toHaveAttribute("draggable", "true");
});

test("entity double click selects exact duplicate occurrence and catalog playback clears playlist marker", async ({
  page,
}) => {
  const { panel, requests } = await playlistFixture(page);
  await panel
    .locator('[data-testid="playlist-entry"][data-entry-id="entry-folder"]')
    .getByRole("button", { name: "Свернуть", exact: true })
    .click();
  const genre = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-genre"]',
  );
  await genre.locator(".track-album-copy").click();
  expect(requests).toHaveLength(0);
  await genre.locator(".track-album-copy").dblclick();
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
  await genre.getByRole("button", { name: "Свернуть", exact: true }).click();
  const trackEntry = panel.locator(
    '[data-testid="playlist-entry"][data-entry-id="entry-track"]',
  );
  await trackEntry.locator(".track-album-copy").dblclick();
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
  await folder.getByRole("button", { name: "Свернуть", exact: true }).click();
  await page
    .locator("audio")
    .evaluate((audio) => audio.dispatchEvent(new Event("ended")));
  const current = panel
    .getByTestId("playlist-track-row")
    .filter({ hasText: "Song 1" });
  await expect(current).toHaveClass(/current/);
  await expect(current).toBeInViewport();
  await expect(
    folder.getByRole("button", { name: "Свернуть", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
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
