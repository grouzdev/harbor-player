import type { PlaylistEntry, ResolvedPlaylistTrack } from "../shared/playlists";
import type { Track } from "../shared/contracts";
import { buildTrackListRows, type TrackListRow } from "./track-grouping";

type AlbumSummary = Extract<TrackListRow, { type: "album" }>;
type RowBase = {
  key: string;
  entry: PlaylistEntry;
  parents: string[];
  depth: number;
};

export type PlaylistRow =
  | (RowBase & {
      type: "entry";
      duration: number;
      firstTrack?: ResolvedPlaylistTrack;
      track?: Track;
      album?: AlbumSummary;
      collapsible: boolean;
    })
  | (RowBase & {
      type: "album";
      album: AlbumSummary;
      firstTrack: ResolvedPlaylistTrack;
    })
  | (RowBase & { type: "disc"; discNumber: number })
  | (RowBase & { type: "track"; item: ResolvedPlaylistTrack });

export function playlistTrackKey(item: ResolvedPlaylistTrack) {
  return `track:${item.entryId}:${item.track.id}`;
}

/** Keep entry boundaries and the playback order, including repeated albums. */
export function buildPlaylistRows(
  entries: PlaylistEntry[],
  items: ResolvedPlaylistTrack[],
): PlaylistRow[] {
  const byEntry = new Map<string, ResolvedPlaylistTrack[]>();
  for (const item of items) {
    const group = byEntry.get(item.entryId) ?? [];
    group.push(item);
    byEntry.set(item.entryId, group);
  }
  const result: PlaylistRow[] = [];
  for (const entry of entries) {
    const nested = byEntry.get(entry.id) ?? [];
    const entryKey = `entry:${entry.id}`;
    const grouped = buildTrackListRows(nested.map((item) => item.track));
    const first = nested.find((item) => item.track.available);
    const summary = grouped.find((row) => row.type === "album");
    result.push({
      key: entryKey,
      entry,
      parents: [],
      depth: 0,
      type: "entry",
      duration: nested.reduce((sum, item) => sum + item.track.duration, 0),
      firstTrack: first,
      track: entry.kind === "track" ? nested[0]?.track : undefined,
      album: entry.kind === "album" ? summary : undefined,
      collapsible: entry.kind !== "track",
    });
    if (entry.kind === "track") continue;

    const occurrenceById = new Map(nested.map((item) => [item.track.id, item]));
    let albumKey = entryKey;
    const albumOccurrences = new Map<string, number>();
    let trackIndex = 0;
    for (const row of grouped) {
      if (row.type === "album") {
        if (entry.kind === "album") continue;
        const occurrence = albumOccurrences.get(row.track.albumKey) ?? 0;
        albumOccurrences.set(row.track.albumKey, occurrence + 1);
        albumKey = `album:${entry.id}:${row.track.albumKey}:${occurrence}`;
        // The first available track must belong to this particular album block.
        let firstTrack: ResolvedPlaylistTrack | undefined;
        for (let index = trackIndex; index < nested.length; index++) {
          const item = nested[index];
          if (item.track.albumKey !== row.track.albumKey) break;
          if (item.track.available) {
            firstTrack = item;
            break;
          }
        }
        result.push({
          key: albumKey,
          entry,
          parents: [entryKey],
          depth: 1,
          type: "album",
          album: row,
          firstTrack: firstTrack ?? occurrenceById.get(row.track.id)!,
        });
      } else {
        const parents =
          entry.kind === "album" ? [entryKey] : [entryKey, albumKey];
        const base = { entry, parents, depth: parents.length };
        result.push(
          row.type === "disc"
            ? {
                ...base,
                key: `disc:${albumKey}:${result.length}`,
                type: "disc",
                discNumber: row.discNumber,
              }
            : {
                ...base,
                key: playlistTrackKey(occurrenceById.get(row.track.id)!),
                type: "track",
                item: occurrenceById.get(row.track.id)!,
              },
        );
        if (row.type === "track") trackIndex++;
      }
    }
  }
  return result;
}

export function visiblePlaylistRows(
  rows: PlaylistRow[],
  collapsed: Set<string>,
) {
  return rows.filter((row) => !row.parents.some((key) => collapsed.has(key)));
}

export function findPlaylistOccurrence(
  rows: PlaylistRow[],
  entryId: string | undefined,
  trackId: string | undefined,
) {
  if (!entryId || !trackId) return undefined;
  return rows.find(
    (row) =>
      row.entry.id === entryId &&
      ((row.type === "track" && row.item.track.id === trackId) ||
        (row.type === "entry" &&
          row.entry.kind === "track" &&
          row.entry.targetId === trackId)),
  );
}
