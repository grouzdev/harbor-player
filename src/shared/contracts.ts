import { z } from "zod";

export interface Library {
  id: string;
  name: string;
  path: string;
  available: boolean;
  lastScan: string | null;
  trackCount: number;
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
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
}
export const filterSchema = z.object({
  libraryIds: z.array(z.string()).max(100).default([]),
  genres: z.array(z.string()).max(500).default([]),
  artists: z.array(z.string()).max(500).default([]),
  albumIds: z.array(z.string()).max(10000).default([]),
  search: z.string().max(300).default(""),
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
}
export interface OperationPreview {
  id: string;
  kind: OperationKind;
  createdAt: string;
  status: "preview" | "running" | "done" | "interrupted";
  items: OperationItem[];
  patch?: TagPatch;
  targetLibraryId?: string;
  restoreOf?: string;
}
export interface Job {
  id: string;
  kind: "scan" | "operation";
  label: string;
  status: "queued" | "running" | "done" | "error";
  completed: number;
  total: number;
  errors: string[];
  createdAt: string;
  operationId?: string;
}
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
  genres: [],
  artists: [],
  albumIds: [],
  search: "",
};
