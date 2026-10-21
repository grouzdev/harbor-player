import { z } from "zod";
import type { PerTrackTagPatch } from "./contracts.js";

export const encodingFields = [
  "title",
  "artists",
  "albumTitle",
  "albumArtists",
  "genres",
] as const;
export type EncodingField = (typeof encodingFields)[number];
export const encodingCandidateSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export const encodingRowSchema = z.object({
  trackId: z.string(),
  title: z.string(),
  path: z.string(),
  field: z.enum(encodingFields),
  index: z.number().int().nonnegative().optional(),
  original: z.string(),
  candidates: z.array(encodingCandidateSchema),
  recommended: z.number().int().nonnegative().optional(),
  warning: z.string().optional(),
});
export const encodingAnalysisSchema = z.object({
  tracks: z.array(
    z.object({
      trackId: z.string(),
      values: z.object({
        title: z.string(),
        artists: z.array(z.string()),
        albumTitle: z.string(),
        albumArtists: z.array(z.string()),
        genres: z.array(z.string()),
      }),
    }),
  ),
  rows: z.array(encodingRowSchema),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type EncodingRow = z.infer<typeof encodingRowSchema>;
export type EncodingAnalysis = z.infer<typeof encodingAnalysisSchema>;
export type EncodingChoice = { row: EncodingRow; value: string };

/** Only changed array elements are replaced; their order and neighbours survive. */
export function encodingPatches(
  analysis: EncodingAnalysis,
  choices: EncodingChoice[],
): Record<string, PerTrackTagPatch> {
  const tracks = new Map(
    analysis.tracks.map((track) => [track.trackId, track.values]),
  );
  const patches: Record<string, PerTrackTagPatch> = {};
  for (const { row, value } of choices) {
    if (value === row.original) continue;
    const original = tracks.get(row.trackId);
    if (!original) continue;
    const patch = (patches[row.trackId] ||= {});
    if (row.field === "title" || row.field === "albumTitle") {
      patch[row.field] = value;
    } else if (row.index !== undefined) {
      const values = (patch[row.field] ||= [...original[row.field]]);
      values[row.index] = value;
    }
  }
  return patches;
}

export function mergeEncodingPatches(
  metadata: Record<string, PerTrackTagPatch>,
  encoding: Record<string, PerTrackTagPatch>,
  manual: Set<string>,
) {
  const result: Record<string, PerTrackTagPatch> = {};
  for (const id of new Set([
    ...Object.keys(metadata),
    ...Object.keys(encoding),
  ])) {
    const patch = { ...metadata[id], ...encoding[id] };
    for (const field of manual) delete patch[field as keyof PerTrackTagPatch];
    if (Object.keys(patch).length) result[id] = patch;
  }
  return result;
}
