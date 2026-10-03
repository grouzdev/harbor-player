import { describe, expect, it } from "vitest";
import type { Track } from "../src/shared/contracts";
import type {
  PlaylistEntry,
  ResolvedPlaylistTrack,
} from "../src/shared/playlists";
import {
  buildPlaylistRows,
  findPlaylistOccurrence,
  playlistTrackKey,
  visiblePlaylistRows,
} from "../src/client/playlist-grouping";

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

function entry(
  id: string,
  kind: PlaylistEntry["kind"] = "album",
  targetId = "album",
): PlaylistEntry {
  return {
    id,
    playlistId: "playlist",
    kind,
    targetId,
    position: 0,
    snapshot: { title: id, subtitle: "", coverId: null },
    resolvedCount: 0,
    unavailableCount: 0,
  };
}

function item(
  entryId: string,
  track: Track,
  position = 0,
): ResolvedPlaylistTrack {
  return { entryId, track, position };
}

describe("playlist grouping", () => {
  it("preserves album collapse keys when an earlier album is added to a live group", () => {
    const folder = entry("folder", "folder");
    const original = [item(folder.id, track("existing", 1, 1, "existing"))];
    const before = buildPlaylistRows([folder], original);
    const existingKey = before.find((row) => row.type === "album")!.key;
    const after = buildPlaylistRows(
      [folder],
      [item(folder.id, track("new", 1, 1, "earlier")), ...original],
    );
    const existingAlbum = after.find(
      (row) => row.type === "album" && row.album.track.albumKey === "existing",
    )!;
    expect(existingAlbum.key).toBe(existingKey);
    expect(
      visiblePlaylistRows(after, new Set([existingKey])).some(
        (row) => row.type === "track" && row.item.track.id === "existing",
      ),
    ).toBe(false);
    expect(
      visiblePlaylistRows(after, new Set([existingKey])).some(
        (row) => row.type === "track" && row.item.track.id === "new",
      ),
    ).toBe(true);
  });

  it("keeps repeated albums and track IDs separate across entry boundaries", () => {
    const first = entry("first");
    const second = entry("second");
    const items = [
      item(first.id, track("shared", 1), 0),
      item(first.id, track("end", 2), 1),
      item(second.id, track("shared", 1), 2),
      item(second.id, track("end", 2), 3),
    ];
    const rows = buildPlaylistRows([first, second], items);
    expect(rows.map((row) => row.type)).toEqual([
      "entry",
      "track",
      "track",
      "entry",
      "track",
      "track",
    ]);
    expect(
      rows.filter((row) => row.type === "track").map((row) => row.item),
    ).toEqual(items);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(playlistTrackKey(items[0])).not.toBe(playlistTrackKey(items[2]));
    expect(rows[1]).toMatchObject({
      entry: first,
      parents: ["entry:first"],
      depth: 1,
    });
    expect(rows[4]).toMatchObject({
      entry: second,
      parents: ["entry:second"],
      depth: 1,
    });
  });

  it.each(["folder", "genre", "artist"] as const)(
    "nests albums and discs under a %s without changing playback order",
    (kind) => {
      const outer = entry("outer", kind);
      const items = [
        item(outer.id, track("disc-one", 1), 0),
        item(outer.id, track("disc-two", 1, 2), 1),
        item(outer.id, track("other", 1, 1, "other-album"), 2),
      ];
      const rows = buildPlaylistRows([outer], items);
      expect(rows.map((row) => row.type)).toEqual([
        "entry",
        "album",
        "disc",
        "track",
        "disc",
        "track",
        "album",
        "track",
      ]);
      const firstAlbum = rows[1];
      const secondAlbum = rows[6];
      expect(firstAlbum).toMatchObject({
        entry: outer,
        parents: ["entry:outer"],
        depth: 1,
        album: { duration: 2 },
        firstTrack: items[0],
      });
      expect(secondAlbum).toMatchObject({
        parents: ["entry:outer"],
        depth: 1,
        album: { duration: 1 },
        firstTrack: items[2],
      });
      expect(rows[2]).toMatchObject({
        discNumber: 1,
        parents: ["entry:outer", firstAlbum.key],
        depth: 2,
      });
      expect(rows[4]).toMatchObject({
        discNumber: 2,
        parents: ["entry:outer", firstAlbum.key],
        depth: 2,
      });
      expect(rows[7].parents).toEqual(["entry:outer", secondAlbum.key]);
      expect(
        rows.filter((row) => row.type === "track").map((row) => row.item),
      ).toEqual(items);
    },
  );

  it("keeps individually added tracks as non-collapsible entry rows only", () => {
    const entries = [
      entry("first", "track", "shared"),
      entry("second", "track", "shared"),
    ];
    const items = entries.map((value, position) =>
      item(value.id, track("shared", 1), position),
    );
    const rows = buildPlaylistRows(entries, items);
    expect(rows).toHaveLength(2);
    rows.forEach((row, index) => {
      expect(row).toMatchObject({
        type: "entry",
        entry: entries[index],
        firstTrack: items[index],
        collapsible: false,
        depth: 0,
        parents: [],
        duration: 1,
      });
      expect(findPlaylistOccurrence(rows, entries[index].id, "shared")).toBe(
        row,
      );
    });
  });

  it("summarizes only each entry's resolved subset and skips unavailable first tracks", () => {
    const album = entry("subset");
    const folder = entry("folder", "folder");
    const missing = { ...track("missing", 1), available: false, duration: 61 };
    const available = { ...track("available", 2), duration: 122 };
    const items = [
      item(album.id, missing),
      item(album.id, available, 1),
      item(
        folder.id,
        {
          ...track("other-missing", 1, 1, "other"),
          available: false,
          duration: 10,
        },
        2,
      ),
      item(
        folder.id,
        { ...track("other-available", 2, 1, "other"), duration: 20 },
        3,
      ),
      item(folder.id, track("next", 1, 1, "next"), 4),
    ];
    const rows = buildPlaylistRows([album, folder], items);
    expect(rows[0]).toMatchObject({
      duration: 183,
      album: { duration: 183 },
      firstTrack: items[1],
    });
    expect(
      rows.find((row) => row.type === "entry" && row.entry.id === folder.id),
    ).toMatchObject({ duration: 31, firstTrack: items[3] });
    expect(rows.filter((row) => row.type === "album")).toEqual([
      expect.objectContaining({
        album: expect.objectContaining({ duration: 30 }),
        firstTrack: items[3],
      }),
      expect.objectContaining({
        album: expect.objectContaining({ duration: 1 }),
        firstTrack: items[4],
      }),
    ]);
  });

  it("retains empty and unavailable entry cards without a playable first track", () => {
    const empty = entry("empty", "folder");
    const unavailable = entry("unavailable");
    const rows = buildPlaylistRows(
      [empty, unavailable],
      [item(unavailable.id, { ...track("missing", 1), available: false })],
    );
    expect(rows.filter((row) => row.type === "entry")).toEqual([
      expect.objectContaining({
        entry: empty,
        duration: 0,
        firstTrack: undefined,
      }),
      expect.objectContaining({
        entry: unavailable,
        duration: 1,
        firstTrack: undefined,
      }),
    ]);
  });

  it("collapses external and nested blocks independently and finds exact hidden occurrences", () => {
    const entries = [entry("first", "folder"), entry("second", "genre")];
    const items = entries.flatMap((value, index) => [
      item(value.id, track("shared", 1), index * 2),
      item(value.id, track("other", 1, 1, "other-album"), index * 2 + 1),
    ]);
    const rows = buildPlaylistRows(entries, items);
    const albums = rows.filter((row) => row.type === "album");
    const first = findPlaylistOccurrence(rows, "first", "shared");
    const second = findPlaylistOccurrence(rows, "second", "shared");
    expect(first).toMatchObject({
      type: "track",
      item: items[0],
      parents: ["entry:first", albums[0].key],
    });
    expect(second).toMatchObject({
      type: "track",
      item: items[2],
      parents: ["entry:second", albums[2].key],
    });
    expect(first).not.toBe(second);
    expect(visiblePlaylistRows(rows, new Set())).toEqual(rows);
    const nestedCollapsed = visiblePlaylistRows(rows, new Set([albums[0].key]));
    expect(nestedCollapsed).toContain(albums[0]);
    expect(nestedCollapsed).not.toContain(first);
    expect(nestedCollapsed).toContain(second);
    expect(nestedCollapsed).toContain(
      findPlaylistOccurrence(rows, "first", "other"),
    );
    const outerCollapsed = visiblePlaylistRows(
      rows,
      new Set(["entry:first", albums[0].key]),
    );
    expect(outerCollapsed).toEqual(
      rows.filter((row) => row.entry.id !== "first" || row.type === "entry"),
    );
    expect(findPlaylistOccurrence(rows, "first", "shared")).toBe(first);
    const collapsed = new Set([
      "entry:first",
      albums[0].key,
      "entry:second",
      albums[2].key,
    ]);
    for (const parent of second!.parents) collapsed.delete(parent);
    expect(visiblePlaylistRows(rows, collapsed)).toContain(second);
    expect(visiblePlaylistRows(rows, collapsed)).not.toContain(first);
    expect(findPlaylistOccurrence(rows, undefined, "shared")).toBeUndefined();
    expect(findPlaylistOccurrence(rows, "first", undefined)).toBeUndefined();
    expect(
      findPlaylistOccurrence(rows, "missing-entry", "shared"),
    ).toBeUndefined();
    expect(
      findPlaylistOccurrence(rows, "first", "missing-track"),
    ).toBeUndefined();
  });
});
