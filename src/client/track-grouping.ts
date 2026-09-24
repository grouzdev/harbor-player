import type { Track } from "../shared/contracts";
import { compareArtistNames } from "../shared/artist-grouping";

export type TrackListRow =
  | {
      type: "album";
      track: Track;
      artists: string[];
      genres: string[];
      duration: number;
    }
  | { type: "disc"; albumKey: string; discNumber: number }
  | { type: "track"; track: Track };

function splitAlbumTracks(tracks: Track[]) {
  const groups: Array<{ tracks: Track[]; discNumber?: number }> = [];
  let current: Track[] = [];
  let previous: Track | undefined;

  for (const track of tracks) {
    const explicitDiscChanged =
      previous?.discNumber != null &&
      track.discNumber != null &&
      previous.discNumber !== track.discNumber;
    const trackNumberReset =
      previous?.trackNumber != null &&
      track.trackNumber != null &&
      track.trackNumber <= previous.trackNumber;

    if (current.length && (explicitDiscChanged || trackNumberReset)) {
      groups.push({
        tracks: current,
        discNumber: current[0].discNumber ?? undefined,
      });
      current = [];
    }
    current.push(track);
    previous = track;
  }
  if (current.length)
    groups.push({
      tracks: current,
      discNumber: current[0].discNumber ?? undefined,
    });

  return groups;
}

export function buildTrackListRows(tracks: Track[]): TrackListRow[] {
  const result: TrackListRow[] = [];
  for (let index = 0; index < tracks.length;) {
    const albumTracks: Track[] = [];
    const albumKey = tracks[index].albumKey;
    while (index < tracks.length && tracks[index].albumKey === albumKey)
      albumTracks.push(tracks[index++]);

    const [track] = albumTracks;
    const artists = [
      ...new Set(
        albumTracks.flatMap((item) =>
          item.albumArtists.length ? item.albumArtists : item.artists,
        ),
      ),
    ].sort(compareArtistNames);
    result.push({
      type: "album",
      track,
      artists,
      genres: track.albumGenres || [],
      duration: albumTracks.reduce((total, item) => total + item.duration, 0),
    });

    const discs = splitAlbumTracks(albumTracks);
    const hasExplicitDiscNumbers =
      new Set(
        albumTracks
          .map((item) => item.discNumber)
          .filter((value) => value != null),
      ).size > 1;
    if (discs.length === 1) {
      result.push(
        ...discs[0].tracks.map((item) => ({
          type: "track" as const,
          track: item,
        })),
      );
      continue;
    }
    discs.forEach((disc, discIndex) => {
      result.push({
        type: "disc",
        albumKey,
        discNumber: hasExplicitDiscNumbers
          ? (disc.discNumber ?? discIndex + 1)
          : discIndex + 1,
      });
      result.push(
        ...disc.tracks.map((item) => ({ type: "track" as const, track: item })),
      );
    });
  }
  return result;
}
