import { z } from "zod";
import {
  jobSchema,
  operationPreviewSchema,
  type CatalogBookmark,
  type Album,
  type AlbumPage,
  type ArtistPage,
  type Library,
  type LibraryFolder,
  type Page,
  type Track,
} from "./contracts.js";
import { scanSettingsSchema } from "./scan-settings.js";

const stringArray = z.array(z.string());

export const librarySchema: z.ZodType<Library> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  available: z.boolean(),
  lastScan: z.string().nullable(),
  trackCount: z.number(),
});

export const libraryFolderSchema: z.ZodType<LibraryFolder> = z.object({
  relativePath: z.string(),
  name: z.string(),
  trackCount: z.number(),
  hasChildren: z.boolean(),
});

export const trackSchema: z.ZodType<Track> = z.object({
  id: z.string(),
  libraryId: z.string(),
  relativePath: z.string(),
  title: z.string(),
  artists: stringArray,
  albumTitle: z.string(),
  albumArtists: stringArray,
  albumKey: z.string(),
  albumFormats: stringArray.optional(),
  albumGenres: stringArray.optional(),
  genres: stringArray,
  year: z.number().nullable(),
  trackNumber: z.number().nullable(),
  discNumber: z.number().nullable(),
  duration: z.number(),
  format: z.string(),
  size: z.number(),
  mtimeMs: z.number(),
  coverId: z.string().nullable(),
  missingTagFields: stringArray.optional(),
  musicBrainzRecordingId: z.string().nullable().optional(),
  musicBrainzReleaseId: z.string().nullable().optional(),
  musicBrainzReleaseGroupId: z.string().nullable().optional(),
  available: z.boolean(),
  rating: z.number().int().min(1).max(5).nullable().default(null),
  albumRating: z.number().int().min(1).max(5).nullable().default(null),
  albumViewed: z.boolean().default(false),
}) as z.ZodType<Track>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number(),
    offset: z.number(),
  }) as z.ZodType<Page<z.infer<T>>>;

export const appearanceSchema = z.object({
  theme: z.enum(["dark", "light"]),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  backgroundRevision: z.number().int().nonnegative(),
});
export const bookmarkSchema: z.ZodType<CatalogBookmark> = z.object({
  kind: z.enum(["artist", "album", "track"]),
  id: z.string(),
});
export const capabilitiesSchema = z.object({
  writableFormats: stringArray,
  verificationDate: z.string().nullable(),
});
export const trackIdResultSchema = z.object({
  trackIds: stringArray,
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
const facetSchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
});
const artistPageSchema: z.ZodType<ArtistPage> = z.object({
  items: z.array(facetSchema),
  total: z.number(),
  offset: z.number(),
  averageGroupSize: z.number().nonnegative().optional(),
});
const albumSchema: z.ZodType<Album> = z.object({
  id: z.string(),
  title: z.string(),
  artists: stringArray,
  year: z.number().nullable(),
  coverId: z.string().nullable(),
  trackCount: z.number().int().nonnegative(),
  rating: z.number().int().min(1).max(5).nullable().default(null),
  viewed: z.boolean().default(false),
});
const albumPageSchema: z.ZodType<AlbumPage> = z.object({
  items: z.array(albumSchema),
  total: z.number(),
  offset: z.number(),
  averageGroupSize: z.number().nonnegative().optional(),
});
const albumMergeContextSchema = z.object({
  compatible: z.boolean(),
  blockers: stringArray,
  library: z.object({ id: z.string(), name: z.string() }).nullable(),
  relativeFolder: z.string().nullable(),
  trackCount: z.number().int().nonnegative(),
  sources: z.array(
    z.object({
      albumId: z.string(),
      title: z.string(),
      albumArtists: stringArray,
      year: z.number().nullable(),
      coverId: z.string().nullable(),
      trackCount: z.number().int().nonnegative(),
      formats: stringArray,
      musicBrainzReleaseIds: stringArray,
    }),
  ),
});
const artistFolderSchema = z.object({
  libraryId: z.string(),
  relativePath: z.string(),
  trackCount: z.number().int().nonnegative(),
});
const musicBrainzContextSchema = z.object({
  supported: z.boolean(),
  mode: z.enum(["track", "album"]).nullable(),
  title: z.string(),
  artist: z.string(),
  reason: z.string().optional(),
});
const musicBrainzCandidateSchema = z.object({
  id: z.string(),
  releaseId: z.string(),
  recordingId: z.string().optional(),
  title: z.string(),
  artists: stringArray,
  date: z.string().nullable(),
  country: z.string().nullable(),
  status: z.string().nullable(),
  formats: stringArray,
  discCount: z.number(),
  trackCount: z.number(),
  score: z.number(),
  thumbnailUrl: z.string(),
});
const metadataProposalSchema = z.object({
  releaseId: z.string(),
  recordingId: z.string().optional(),
  releaseTitle: z.string(),
  items: z.array(
    z.object({
      trackId: z.string(),
      title: z.string(),
      patch: z.unknown().optional(),
      missingFields: stringArray,
      changedFields: stringArray,
      match: z.enum([
        "position",
        "title-duration",
        "order",
        "recording",
        "none",
      ]),
      warning: z.string().optional(),
    }),
  ),
  cover: z
    .object({
      id: z.string(),
      source: z.enum(["release", "release-group"]),
      warning: z.string().optional(),
    })
    .optional(),
});
const operationSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(["move", "trash", "tags", "restore"]),
  createdAt: z.string(),
  status: z.enum(["preview", "running", "done", "interrupted"]),
  total: z.number(),
  completed: z.number(),
  errors: stringArray,
  recoverable: z.boolean().optional(),
  intent: z.enum(["album-merge"]).optional(),
});
export const okSchema = z.object({ ok: z.literal(true) });
export const queueSchema = z.object({
  id: z.string(),
  position: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  sourceTotal: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  track: trackSchema.nullable(),
});
export const maintenanceResultSchema = z.object({
  operations: z.number().int().nonnegative(),
  jobs: z.number().int().nonnegative(),
  cache: z.number().int().nonnegative(),
});
export const addLibraryResponseSchema = z.object({
  library: librarySchema,
  job: jobSchema,
});

export const sessionResponseSchema = z.object({
  csrf: z.string(),
  capabilities: capabilitiesSchema,
});
export const apiResponseSchemas = {
  session: sessionResponseSchema,
  libraries: z.array(librarySchema),
  addLibrary: addLibraryResponseSchema,
  library: librarySchema,
  folders: z.array(libraryFolderSchema),
  bookmarks: z.array(bookmarkSchema),
  appearance: appearanceSchema,
  tracks: pageSchema(trackSchema),
  track: trackSchema,
  trackIds: trackIdResultSchema,
  jobs: z.array(jobSchema),
  operation: operationPreviewSchema,
  queue: queueSchema,
  albums: albumPageSchema,
  artists: artistPageSchema,
  albumMergeContext: albumMergeContextSchema,
  facets: pageSchema(facetSchema),
  quickSearch: z.object({
    genres: z.array(facetSchema),
    artists: z.array(facetSchema),
    albums: z.array(albumSchema),
    tracks: z.array(trackSchema),
  }),
  artistFolders: z.array(artistFolderSchema),
  filterValidity: z.object({
    genres: stringArray,
    artists: stringArray,
    albumIds: stringArray,
  }),
  facetRelevance: z.object({
    libraryIds: stringArray,
    genres: stringArray,
    folders: z.array(
      z.object({ libraryId: z.string(), relativePath: z.string() }),
    ),
  }),
  selectionSummary: z.object({
    count: z.number(),
    formats: stringArray,
    fields: z.record(
      z.string(),
      z.object({
        mixed: z.boolean(),
        value: z.union([z.string(), stringArray, z.number(), z.null()]),
      }),
    ),
    musicBrainz: musicBrainzContextSchema,
  }),
  musicBrainzSearch: z.object({
    context: musicBrainzContextSchema,
    candidates: z.array(musicBrainzCandidateSchema),
  }),
  metadataProposal: metadataProposalSchema,
  operations: z.array(operationSummarySchema),
} as const;

/** Returns the JSON contract for a successful client API response. */
export function apiResponseContract(method: string, pathname: string) {
  if (pathname === "/api/session") return sessionResponseSchema;
  if (pathname === "/api/libraries")
    return method === "GET"
      ? apiResponseSchemas.libraries
      : apiResponseSchemas.addLibrary;
  if (/^\/api\/libraries\/[^/]+\/folders$/.test(pathname))
    return apiResponseSchemas.folders;
  if (/^\/api\/libraries\/[^/]+\/rename$/.test(pathname)) return librarySchema;
  if (/^\/api\/libraries\/[^/]+\/(remove|scan)$/.test(pathname))
    return jobSchema;
  if (pathname === "/api/bookmarks") return apiResponseSchemas.bookmarks;
  if (pathname === "/api/catalog-user-state") return okSchema;
  if (
    pathname === "/api/appearance" ||
    pathname === "/api/appearance/background"
  )
    return appearanceSchema;
  if (pathname === "/api/scan-settings") return scanSettingsSchema;
  if (pathname === "/api/tracks") return apiResponseSchemas.tracks;
  if (/^\/api\/tracks\/[^/]+$/.test(pathname)) return trackSchema;
  if (pathname === "/api/track-ids") return trackIdResultSchema;
  if (pathname === "/api/albums") return apiResponseSchemas.albums;
  if (pathname === "/api/albums/merge-context")
    return apiResponseSchemas.albumMergeContext;
  if (pathname === "/api/genres") return z.array(facetSchema);
  if (pathname === "/api/artists") return apiResponseSchemas.artists;
  if (pathname === "/api/quick-search") return apiResponseSchemas.quickSearch;
  if (pathname === "/api/artist-folders")
    return apiResponseSchemas.artistFolders;
  if (pathname === "/api/filter-validity")
    return apiResponseSchemas.filterValidity;
  if (pathname === "/api/facet-relevance")
    return apiResponseSchemas.facetRelevance;
  if (pathname === "/api/jobs") return apiResponseSchemas.jobs;
  if (pathname === "/api/selection-summary")
    return apiResponseSchemas.selectionSummary;
  if (pathname === "/api/metadata/musicbrainz/search")
    return apiResponseSchemas.musicBrainzSearch;
  if (pathname === "/api/metadata/musicbrainz/proposal")
    return apiResponseSchemas.metadataProposal;
  if (pathname === "/api/operations") return apiResponseSchemas.operations;
  if (pathname === "/api/operations/history") return maintenanceResultSchema;
  if (/^\/api\/operations\/[^/]+\/(execute|retry|restore)$/.test(pathname))
    return z.unknown();
  if (pathname === "/api/operations/preview") return operationPreviewSchema;
  if (/^\/api\/operations\/[^/]+$/.test(pathname))
    return operationPreviewSchema;
  if (pathname === "/api/queue" || /^\/api\/queue\/[^/]+$/.test(pathname))
    return queueSchema;
  if (pathname === "/api/explorer") return okSchema;
  return undefined;
}
