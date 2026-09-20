import { z } from "zod";

const coverArtIdSchema = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform(String);

const artistCreditSchema = z
  .object({
    name: z.string().optional(),
    artist: z.object({ name: z.string().optional() }).optional(),
  })
  .passthrough();
const genreSchema = z
  .object({ name: z.string().optional(), count: z.number().optional() })
  .passthrough();
const recordingSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    "artist-credit": z.array(artistCreditSchema).optional(),
    length: z.number().optional(),
  })
  .passthrough();
const remoteTrackSchema = z
  .object({
    position: z.number().optional(),
    title: z.string().optional(),
    length: z.number().optional(),
    recording: recordingSchema.optional(),
    "artist-credit": z.array(artistCreditSchema).optional(),
  })
  .passthrough();
const mediumSchema = z
  .object({
    position: z.number().optional(),
    format: z.string().optional(),
    "track-count": z.number().optional(),
    tracks: z.array(remoteTrackSchema).optional(),
  })
  .passthrough();
export const releaseSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    date: z.string().optional(),
    country: z.string().optional(),
    status: z.string().optional(),
    score: z.number().optional(),
    "track-count": z.number().optional(),
    "artist-credit": z.array(artistCreditSchema).optional(),
    "release-group": z
      .object({
        id: z.string().optional(),
        "first-release-date": z.string().optional(),
      })
      .passthrough()
      .optional(),
    genres: z.array(genreSchema).optional(),
    media: z.array(mediumSchema).optional(),
  })
  .passthrough();
export const musicBrainzSearchSchema = z
  .object({
    recordings: z
      .array(
        z
          .object({
            id: z.string().optional(),
            score: z.number().optional(),
            "first-release-date": z.string().optional(),
            "artist-credit": z.array(artistCreditSchema).optional(),
            releases: z.array(releaseSchema).optional(),
          })
          .passthrough(),
      )
      .optional(),
    releases: z.array(releaseSchema).optional(),
  })
  .passthrough();
export const releaseGroupSchema = z
  .object({
    genres: z.array(genreSchema).optional(),
    "first-release-date": z.string().optional(),
  })
  .passthrough();
export const coverArchiveSchema = z
  .object({
    images: z
      .array(
        z
          .object({
            id: coverArtIdSchema.optional(),
            front: z.boolean().optional(),
            approved: z.boolean().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type MusicBrainzSearchPayload = z.infer<typeof musicBrainzSearchSchema>;
export type MusicBrainzRelease = z.infer<typeof releaseSchema>;
