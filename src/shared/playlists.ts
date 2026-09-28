import { z } from "zod";
import { selectionSchema, type Track } from "./contracts.js";

export const playlistEntryKindSchema = z.enum([
  "genre",
  "artist",
  "album",
  "track",
  "folder",
]);
export type PlaylistEntryKind = z.infer<typeof playlistEntryKindSchema>;

export const playlistSnapshotSchema = z
  .object({
    title: z.string(),
    subtitle: z.string().default(""),
    coverId: z.string().nullable().default(null),
  })
  .strict();
export type PlaylistSnapshot = z.infer<typeof playlistSnapshotSchema>;

export const playlistSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    entryCount: z.number().int().nonnegative(),
    trackCount: z.number().int().nonnegative(),
    unavailableCount: z.number().int().nonnegative(),
  })
  .strict();
export type Playlist = z.infer<typeof playlistSchema>;

export const playlistEntrySchema = z
  .object({
    id: z.string(),
    playlistId: z.string(),
    kind: playlistEntryKindSchema,
    targetId: z.string(),
    position: z.number().int().nonnegative(),
    snapshot: playlistSnapshotSchema,
    resolvedCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    unavailableCount: z.number().int().nonnegative(),
  })
  .strict();
export type PlaylistEntry = z.infer<typeof playlistEntrySchema>;

export const playlistDetailSchema = z
  .object({ playlist: playlistSchema, entries: z.array(playlistEntrySchema) })
  .strict();
export type PlaylistDetail = z.infer<typeof playlistDetailSchema>;

export const resolvedPlaylistTrackSchema = z
  .object({
    position: z.number().int().nonnegative(),
    entryId: z.string(),
    track: z.custom<Track>(),
  })
  .strict();
export type ResolvedPlaylistTrack = z.infer<typeof resolvedPlaylistTrackSchema>;

export const playlistTrackPageSchema = z
  .object({
    items: z.array(resolvedPlaylistTrackSchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    unavailableCount: z.number().int().nonnegative(),
    totalDuration: z.number().nonnegative(),
  })
  .strict();
export type PlaylistTrackPage = z.infer<typeof playlistTrackPageSchema>;

export const playlistEntryInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("genre"),
      ids: z.array(z.string()).min(1).max(500),
      beforeEntryId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("artist"),
      ids: z.array(z.string()).min(1).max(500),
      beforeEntryId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("album"),
      ids: z.array(z.string()).min(1).max(10000),
      beforeEntryId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("track"),
      selection: selectionSchema,
      beforeEntryId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("folder"),
      folders: z
        .array(
          z
            .object({
              libraryId: z.string().min(1).max(100),
              relativePath: z.string().max(32000),
            })
            .strict(),
        )
        .min(1)
        .max(100),
      beforeEntryId: z.string().optional(),
    })
    .strict(),
]);
export type PlaylistEntryInput = z.infer<typeof playlistEntryInputSchema>;

export const pathTemplateFieldSchema = z.enum([
  "albumArtist",
  "trackArtist",
  "album",
  "year",
  "discNumber",
  "trackNumber",
  "title",
  "originalName",
  "extension",
]);
export type PathTemplateField = z.infer<typeof pathTemplateFieldSchema>;
export const pathTemplatePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.string().max(100) }).strict(),
  z
    .object({
      kind: z.literal("field"),
      field: pathTemplateFieldSchema,
      fallback: z.string().max(100).default(""),
      prefix: z.string().max(20).default(""),
      suffix: z.string().max(20).default(""),
      pad: z.number().int().min(0).max(8).default(0),
    })
    .strict(),
]);
export type PathTemplatePart = z.infer<typeof pathTemplatePartSchema>;
export const pathTemplatePatternSchema = z
  .array(pathTemplatePartSchema)
  .min(1)
  .max(30);
export const pathTemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    directories: z.array(pathTemplatePatternSchema).min(1).max(8),
    fileName: pathTemplatePatternSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type PathTemplate = z.infer<typeof pathTemplateSchema>;

export const playlistSyncSettingsSchema = z
  .object({
    playlistId: z.string(),
    targetPath: z.string().nullable(),
    templateId: z.string(),
    autoSync: z.boolean(),
    state: z.enum(["idle", "pending", "syncing", "synced", "warning", "error"]),
    lastSyncedAt: z.string().nullable(),
    message: z.string(),
  })
  .strict();
export type PlaylistSyncSettings = z.infer<typeof playlistSyncSettingsSchema>;

export const playlistImportPreviewSchema = z
  .object({
    path: z.string(),
    suggestedName: z.string(),
    matchedTrackIds: z.array(z.string()),
    unmatched: z.array(z.string()),
  })
  .strict();
export type PlaylistImportPreview = z.infer<typeof playlistImportPreviewSchema>;

export const playlistExportFormatSchema = z.enum(["m3u8", "xspf"]);
export type PlaylistExportFormat = z.infer<typeof playlistExportFormatSchema>;
