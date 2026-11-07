import { z } from "zod";
import { emptyFilter, filterSchema } from "./contracts.js";

const key = z.string().max(4096);
const keys = z.array(key).max(100000);
const offset = z.number().finite().nonnegative();
export const panelPositionSchema = z.object({
  id: z.enum([
    "libraries",
    "genres",
    "artists",
    "albums",
    "tracks",
    "playlists",
  ]),
  top: offset,
  left: offset,
  anchorKey: key.optional(),
  anchorY: z.number().finite().optional(),
});
const catalogSelectionSchema = z.object({
  selectedArtists: keys,
  selectedAlbums: keys,
  selected: keys,
  selectedAlbumId: key.nullable(),
  expandedLibraryIds: keys,
  expandedFolderKeys: keys,
  positions: z.array(panelPositionSchema).max(6),
});
export const catalogSessionSchema = catalogSelectionSchema.extend({
  savedFilter: filterSchema,
  search: z.string().max(10000),
  beforeSearch: catalogSelectionSchema
    .extend({
      searchSelectedArtists: keys.nullable(),
      searchSelectedAlbums: keys.nullable(),
      searchSelectedTracks: keys.nullable(),
    })
    .nullable(),
});
export const pulseSessionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  offset,
  atEnd: z.boolean().optional(),
  generation: z.union([z.string(), z.number()]).optional(),
  selectedAlbumId: key.optional(),
  selectedDay: z.string().optional(),
});
export const playerSessionSchema = z.object({
  queueId: key,
  queuePosition: z.number().int().nonnegative(),
  trackId: key.nullable(),
  seconds: offset,
  volume: z.number().min(0).max(1),
  shuffle: z.boolean(),
  repeat: z.enum(["off", "all", "one"]),
});
export const workspaceSessionSchema = z.object({
  version: z.literal(1),
  catalog: catalogSessionSchema.optional().catch(undefined),
  workspace: z
    .object({
      mode: z.enum(["panels", "cover", "pulse"]),
      activePlaylistId: key.nullable(),
    })
    .optional()
    .catch(undefined),
  pulse: pulseSessionSchema.optional().catch(undefined),
  player: playerSessionSchema.optional().catch(undefined),
  playlists: z.record(key, keys).optional().catch(undefined),
});
export type WorkspaceSession = z.infer<typeof workspaceSessionSchema>;
export type CatalogSession = z.infer<typeof catalogSessionSchema>;
export type PanelPosition = z.infer<typeof panelPositionSchema>;

export function normalizeWorkspaceSession(value: unknown): WorkspaceSession {
  const parsed = workspaceSessionSchema.safeParse(value);
  return parsed.success ? parsed.data : { version: 1 };
}

export function emptyCatalogSession(): CatalogSession {
  return {
    savedFilter: filterSchema.parse(emptyFilter),
    search: "",
    selectedArtists: [],
    selectedAlbums: [],
    selected: [],
    selectedAlbumId: null,
    expandedLibraryIds: [],
    expandedFolderKeys: [],
    positions: [],
    beforeSearch: null,
  };
}
