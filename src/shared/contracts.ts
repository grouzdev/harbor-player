import { z } from "zod";

export interface Library {
  id: string;
  name: string;
  path: string;
  available: boolean;
  lastScan: string | null;
  trackCount: number;
}
export interface LibraryFolder {
  relativePath: string;
  name: string;
  trackCount: number;
  hasChildren: boolean;
}
export interface Track {
  id: string;
  libraryId: string;
  relativePath: string;
  title: string;
  artists: string[];
  albumTitle: string;
  albumArtists: string[];
  albumKey: string;
  albumFormats?: string[];
  genres: string[];
  year: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  duration: number;
  format: string;
  size: number;
  mtimeMs: number;
  coverId: string | null;
  missingTagFields?: TagField[];
  musicBrainzRecordingId?: string | null;
  musicBrainzReleaseId?: string | null;
  musicBrainzReleaseGroupId?: string | null;
  available: boolean;
}
export interface Album {
  id: string;
  title: string;
  artists: string[];
  year: number | null;
  coverId: string | null;
  trackCount: number;
}
export interface QuickSearchFacet {
  name: string;
  count: number;
}
export interface QuickSearchResults {
  genres: QuickSearchFacet[];
  artists: QuickSearchFacet[];
  albums: Album[];
  tracks: Track[];
}
export type BookmarkKind = "artist" | "album" | "track";
export interface CatalogBookmark {
  kind: BookmarkKind;
  id: string;
}
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
}
export interface FacetRelevance {
  libraryIds: string[];
  genres: string[];
}
export interface FilterValidity {
  genres: string[];
  artists: string[];
  albumIds: string[];
}
export const filterSchema = z.object({
  libraryIds: z.array(z.string()).max(100).default([]),
  folders: z
    .array(
      z
        .object({
          libraryId: z.string().min(1).max(100),
          relativePath: z.string().min(1).max(32000),
        })
        .strict(),
    )
    .max(100)
    .default([]),
  genres: z.array(z.string()).max(500).default([]),
  artists: z.array(z.string()).max(500).default([]),
  albumIds: z.array(z.string()).max(10000).default([]),
  search: z.string().max(300).default(""),
  bookmarksOnly: z.boolean().default(false),
});
export type CatalogFilter = z.infer<typeof filterSchema>;
export const tagPatchSchema = z
  .object({
    title: z.string().max(1000).optional(),
    artists: z.array(z.string().max(500)).max(100).optional(),
    albumTitle: z.string().max(1000).optional(),
    albumArtists: z.array(z.string().max(500)).max(100).optional(),
    genres: z.array(z.string().max(200)).max(100).optional(),
    year: z.number().int().min(0).max(9999).nullable().optional(),
    trackNumber: z.number().int().min(0).max(99999).nullable().optional(),
    discNumber: z.number().int().min(0).max(9999).nullable().optional(),
    cover: z
      .object({
        data: z.string().max(14_000_000),
        mime: z.enum(["image/jpeg", "image/png"]),
      })
      .nullable()
      .optional(),
  })
  .strict();
export type TagPatch = z.infer<typeof tagPatchSchema>;
export type TagField = keyof TagPatch;
export const perTrackTagPatchSchema = tagPatchSchema.omit({ cover: true });
export type PerTrackTagPatch = z.infer<typeof perTrackTagPatchSchema>;
export const selectionSchema = z.union([
  z.object({ trackIds: z.array(z.string()).min(1).max(100000) }).strict(),
  z
    .object({
      filter: filterSchema,
      excludeTrackIds: z.array(z.string()).max(100000).optional(),
    })
    .strict(),
]);
export type Selection = z.infer<typeof selectionSchema>;
export type OperationKind = "move" | "trash" | "tags" | "restore";
export interface OperationItem {
  id: string;
  trackId: string | null;
  source: string;
  destination: string;
  size: number;
  mtimeMs: number;
  hash: string;
  title: string;
  error?: string;
  phase: "preview" | "prepared" | "copied" | "done" | "error" | "interrupted";
  companion?: boolean;
  result?: string;
  before?: Partial<TagPatch>;
  patch?: PerTrackTagPatch;
}
export interface OperationPreview {
  id: string;
  kind: OperationKind;
  createdAt: string;
  status: "preview" | "running" | "done" | "interrupted";
  items: OperationItem[];
  patch?: TagPatch;
  coverTrackIds?: string[];
  targetLibraryId?: string;
  restoreOf?: string;
}
export interface Job {
  id: string;
  kind: "scan" | "operation" | "library";
  label: string;
  status: "queued" | "running" | "done" | "error";
  completed: number;
  total: number;
  errors: string[];
  createdAt: string;
  operationId?: string;
}
export type OperationRetryResult =
  | { action: "resume"; job: Job }
  | { action: "preview"; preview: OperationPreview };
export interface Capabilities {
  writableFormats: string[];
  verificationDate: string | null;
}
export interface SelectionSummary {
  count: number;
  formats: string[];
  fields: Record<
    string,
    { mixed: boolean; value: string | string[] | number | null }
  >;
  musicBrainz: MusicBrainzSearchContext;
}

export interface MusicBrainzSearchContext {
  supported: boolean;
  mode: "track" | "album" | null;
  title: string;
  artist: string;
  reason?: string;
}
export interface MusicBrainzCandidate {
  id: string;
  releaseId: string;
  recordingId?: string;
  title: string;
  artists: string[];
  date: string | null;
  country: string | null;
  status: string | null;
  formats: string[];
  discCount: number;
  trackCount: number;
  score: number;
  thumbnailUrl: string;
}
export interface MetadataProposalItem {
  trackId: string;
  title: string;
  patch?: PerTrackTagPatch;
  missingFields: TagField[];
  changedFields: TagField[];
  match: "position" | "title-duration" | "order" | "recording" | "none";
  warning?: string;
}
export interface MetadataProposal {
  releaseId: string;
  recordingId?: string;
  releaseTitle: string;
  items: MetadataProposalItem[];
  cover?: {
    id: string;
    source: "release" | "release-group";
    warning?: string;
  };
}
export interface OperationSummary {
  id: string;
  kind: OperationKind;
  createdAt: string;
  status: OperationPreview["status"];
  total: number;
  completed: number;
  errors: string[];
}
export const emptyFilter: CatalogFilter = {
  libraryIds: [],
  folders: [],
  genres: [],
  artists: [],
  albumIds: [],
  search: "",
  bookmarksOnly: false,
};
