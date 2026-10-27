import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  acceptsPlaylistDrop,
  catalogDragType,
  playlistDragType,
  readCatalogDrag,
  resolveDragIds,
} from "../src/client/catalog-drag";
import { PlaylistEntityCopy } from "../src/client/PlaylistEntityCopy";

describe("catalog drag snapshot", () => {
  it("uses panel order, including unmounted rows, not Ctrl-click order", () => {
    expect(resolveDragIds(["a", "b", "c", "d"], ["d", "b"], "d")).toEqual([
      "b",
      "d",
    ]);
  });
  it("drags an unselected source alone and does not mutate selection", () => {
    const selected = ["a", "b"];
    expect(resolveDragIds(["a", "b", "c"], selected, "c")).toEqual(["c"]);
    expect(selected).toEqual(["a", "b"]);
  });
  it("preserves the empty genre identifier and eliminates duplicate source ids", () => {
    expect(resolveDragIds(["", "Rock", "Rock"], ["Rock", ""], "")).toEqual([
      "",
      "Rock",
    ]);
  });
  it.each(["track", "album", "artist", "genre"])(
    "reads only the serialized %s snapshot",
    (kind) => {
      const payload = { kind, ids: ["one", "two"] };
      expect(
        readCatalogDrag({
          getData: (type) =>
            type === catalogDragType ? JSON.stringify(payload) : "",
        }),
      ).toEqual(payload);
    },
  );
  it.each([
    "",
    "track",
    "{}",
    '{"kind":"track","ids":[]}',
    '{"kind":"folder","ids":["x"]}',
    '{"kind":"track","ids":[1]}',
  ])("rejects malformed payload %s", (data) => {
    expect(readCatalogDrag({ getData: () => data })).toBeNull();
  });
  it("accepts only catalog copies and playlist moves", () => {
    expect(acceptsPlaylistDrop({ types: ["Files", "text/plain"] })).toBe(false);
    expect(acceptsPlaylistDrop({ types: [catalogDragType] })).toBe(true);
    expect(acceptsPlaylistDrop({ types: [playlistDragType] })).toBe(true);
  });
  it("shares entity icons and labels without inventing unknown durations", () => {
    const track = renderToStaticMarkup(
      createElement(PlaylistEntityCopy, {
        kind: "track",
        title: "Song",
        subtitle: "Artist",
        seconds: 180,
      }),
    );
    expect(track).toContain("lucide-music");
    expect(track).toContain("Artist");
    expect(track).toContain("3:00");
    const genre = renderToStaticMarkup(
      createElement(PlaylistEntityCopy, { kind: "genre", title: "Rock" }),
    );
    expect(genre).toContain("lucide-drama");
    expect(genre).not.toContain("playlist-entity-duration");
  });
});
