import { z } from "zod";

export const lyricsTextSchema = z.string().max(100_000);
export const lyricsSearchSchema = z
  .object({
    artist: z.string().trim().min(1).max(500),
    title: z.string().trim().min(1).max(1000),
  })
  .strict();
export const lyricsCandidateSchema = z.object({
  id: z.number().int().positive(),
  trackName: z.string().max(2000),
  artistName: z.string().max(2000),
  albumName: z.string().max(2000),
  duration: z.number().finite().nonnegative(),
  instrumental: z.boolean(),
  plainLyrics: lyricsTextSchema.nullable(),
});
export const lyricsCandidatesSchema = z.array(lyricsCandidateSchema).max(20);
export const trackLyricsSchema = z.object({
  local: lyricsTextSchema.nullable(),
  embedded: lyricsTextSchema.nullable(),
  writable: z.boolean(),
});
export type LyricsCandidate = z.infer<typeof lyricsCandidateSchema>;
export type TrackLyrics = z.infer<typeof trackLyricsSchema>;

export const automaticLyricsSchema = z.object({
  text: lyricsTextSchema.nullable(),
  candidates: lyricsCandidatesSchema,
  saved: z.boolean(),
});
export type AutomaticLyrics = z.infer<typeof automaticLyricsSchema>;

/** Require the exact version, not just a similar title or the first search hit. */
export function selectAutomaticLyrics(
  track: {
    title: string;
    artists: string[];
    albumTitle: string;
    duration: number;
  },
  candidates: LyricsCandidate[],
): LyricsCandidate | null {
  const key = (value: string) =>
    value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (
    !key(track.title) ||
    !key(track.artists.join(", ")) ||
    !key(track.albumTitle) ||
    !(track.duration > 0)
  )
    return null;
  const matches = candidates.filter(
    (item) =>
      !item.instrumental &&
      item.plainLyrics?.trim() &&
      key(item.trackName) === key(track.title) &&
      key(item.artistName) === key(track.artists.join(", ")) &&
      key(item.albumName) === key(track.albumTitle) &&
      Math.abs(item.duration - track.duration) <= 2,
  );
  if (!matches.length) return null;
  const text = matches[0].plainLyrics!.replace(/\r\n?/g, "\n").trim();
  return matches.every(
    (item) => item.plainLyrics!.replace(/\r\n?/g, "\n").trim() === text,
  )
    ? matches[0]
    : null;
}
