import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usesPortraitWorkspaceLayout } from "./workspace-layout";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AudioLines,
  Bookmark as BookmarkIcon,
  CircleUserRound,
  ChevronRight,
  Clock3,
  Combine,
  Copy,
  DiscAlbum,
  Disc3,
  FolderOpen,
  FolderInput,
  History,
  Settings,
  Maximize2,
  Minimize2,
  Music2,
  Music4,
  ListMusic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Eye,
  EyeOff,
  Star,
  SquareLibrary,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  emptyFilter,
  type Album,
  type AlbumPage,
  type ArtistPage,
  type FolderMoveRoot,
  type BookmarkKind,
  type Capabilities,
  type CatalogBookmark,
  type CatalogFilter,
  type CatalogUserStatePatch,
  type FacetRelevance,
  type FilterValidity,
  type Job,
  type Library,
  type LibraryFolder,
  type OperationPreview,
  type Page,
  type Selection,
  type Track,
} from "../shared/contracts";
import {
  albumArtistGroupKey,
  artistGroupKey,
  isMissingArtistName,
  startsNewArtistGroup,
} from "../shared/artist-grouping";
import {
  api,
  catalogUrl,
  count,
  duration,
  prepareCoverFile,
  setCsrf,
  reconnectSession,
} from "./api";
import { readMigratedStorageValue } from "./storage";
import {
  applyAppearance,
  cacheAppearance,
  normalizeAppearance,
  readCachedAppearance,
  type AppearanceSettings,
} from "./appearance";
import {
  defaultScanSettings,
  type ScanSettings,
} from "../shared/scan-settings";
import {
  AddLibraryDialog,
  RenameLibraryDialog,
  RemoveLibraryDialog,
} from "./LibraryDialogs";
import { CoverDropConfirmDialog } from "./CoverDropConfirmDialog";
import { Modal } from "./Modal";
import { ListTile } from "./ListTile";
import { buildTrackListRows } from "./track-grouping";
import { resolveContextSelection, usePanelSelection } from "./panel-selection";
import {
  filterForCatalogPanel,
  useCatalogBrowsing,
} from "./useCatalogBrowsing";
import {
  folderSelectionKey,
  librarySelectionKey,
  locationsFromSelectionKeys,
} from "./location-selection";
import { Player, usePlayer } from "./Player";
import { CoverMode, QuickSearchDialog } from "./CoverMode";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { UpdatePanel } from "./UpdatePanel";
import { BookmarkToggle, type BookmarkChange } from "./BookmarkToggle";
import { RatingPopover, type UserStateChange } from "./RatingControl";
import { CatalogUserFilters } from "./CatalogUserFilters";
import { GenrePanel, LibraryPanel } from "./LibraryGenrePanels";
import {
  ArtistList,
  AlbumGrid,
  TrackList,
  type CatalogContextMenuHandler,
} from "./CatalogVirtualViews";
import { useAppShellLayout } from "./useAppShellLayout";
import { useCatalogScrollTargets } from "./useCatalogScrollTargets";

const AppearanceSettingsDialog = lazy(() =>
  import("./AppearanceSettingsDialog").then((module) => ({
    default: module.AppearanceSettingsDialog,
  })),
);
const ActionDialog = lazy(() =>
  import("./TagOperationDialog").then((module) => ({
    default: module.ActionDialog,
  })),
);
const ArtistFolderDialog = lazy(() =>
  import("./TagOperationDialog").then((module) => ({
    default: module.ArtistFolderDialog,
  })),
);
const HistoryDialog = lazy(() =>
  import("./TagOperationDialog").then((module) => ({
    default: module.HistoryDialog,
  })),
);
const PreviewDialog = lazy(() =>
  import("./TagOperationDialog").then((module) => ({
    default: module.PreviewDialog,
  })),
);
const AlbumMergeDialog = lazy(() =>
  import("./AlbumMergeDialog").then((module) => ({
    default: module.AlbumMergeDialog,
  })),
);

function LazyDialogFallback() {
  return (
    <Modal title="Загрузка…" onClose={() => {}}>
      <p className="hint" role="status">
        Открываем диалог…
      </p>
    </Modal>
  );
}

type DroppedCover = {
  album: Album;
  name: string;
  cover: { data: string; mime: "image/jpeg" | "image/png" };
};

type PanelId = "libraries" | "genres" | "artists" | "albums" | "tracks";
type PanelVisibility = Record<PanelId, boolean>;

const panelVisibilityStorageKey = "harbor-player-panel-visibility-v1";
const legacyPanelVisibilityStorageKey = "mml-panel-visibility-v1";
const virtualPanelTopInset = 14;

function updateUserStateCache(
  value: unknown,
  kind: "album" | "track",
  ids: ReadonlySet<string>,
  patch: CatalogUserStatePatch,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => updateUserStateCache(item, kind, ids, patch));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  let next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record))
    next[key] = updateUserStateCache(child, kind, ids, patch);
  const isTrack =
    typeof record.id === "string" &&
    typeof record.albumKey === "string" &&
    "duration" in record;
  const isAlbum =
    typeof record.id === "string" && "trackCount" in record && !isTrack;
  if (kind === "track" && isTrack && ids.has(record.id as string)) {
    if (patch.rating !== undefined) next.rating = patch.rating;
  } else if (kind === "album") {
    if (isAlbum && ids.has(record.id as string)) {
      if (patch.rating !== undefined) next.rating = patch.rating;
      if (patch.viewed !== undefined) next.viewed = patch.viewed;
    }
    if (isTrack && ids.has(record.albumKey as string)) {
      if (patch.rating !== undefined) next.albumRating = patch.rating;
      if (patch.viewed !== undefined) next.albumViewed = patch.viewed;
    }
  }
  return next;
}

function cachedAlbumViewed(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
) {
  const stack = queryClient
    .getQueryCache()
    .findAll()
    .map((query) => query.state.data as unknown);
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (record.id === id && record.trackCount !== undefined)
      return Boolean(record.viewed);
    if (record.albumKey === id && record.duration !== undefined)
      return Boolean(record.albumViewed);
    stack.push(...Object.values(record));
  }
  return false;
}

function cachedUserRating(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: "album" | "track",
  id: string,
) {
  const stack = queryClient
    .getQueryCache()
    .findAll()
    .map((query) => query.state.data as unknown);
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (kind === "album" && record.id === id && record.trackCount !== undefined)
      return (record.rating ?? null) as number | null;
    if (
      kind === "album" &&
      record.albumKey === id &&
      record.duration !== undefined
    )
      return (record.albumRating ?? null) as number | null;
    if (kind === "track" && record.id === id && record.duration !== undefined)
      return (record.rating ?? null) as number | null;
    stack.push(...Object.values(record));
  }
  return null;
}
const defaultPanelVisibility: PanelVisibility = {
  libraries: true,
  genres: true,
  artists: true,
  albums: true,
  tracks: true,
};
const panelDefinitions = [
  {
    id: "libraries",
    label: "Библиотеки",
    Icon: FolderOpen,
    weightIndex: 0,
    minimumWidth: 110,
    group: "facets",
  },
  {
    id: "genres",
    label: "Жанры",
    Icon: Music4,
    weightIndex: 1,
    minimumWidth: 110,
    group: "facets",
  },
  {
    id: "artists",
    label: "Исполнители",
    Icon: CircleUserRound,
    weightIndex: 2,
    minimumWidth: 110,
    group: "facets",
  },
  {
    id: "albums",
    label: "Альбомы",
    Icon: Disc3,
    weightIndex: 3,
    minimumWidth: 150,
    group: "catalog",
  },
  {
    id: "tracks",
    label: "Треки",
    Icon: ListMusic,
    weightIndex: 4,
    minimumWidth: 180,
    group: "catalog",
  },
] as const;

function readPanelVisibility(): PanelVisibility {
  try {
    const value = JSON.parse(
      readMigratedStorageValue(
        panelVisibilityStorageKey,
        legacyPanelVisibilityStorageKey,
      ) || "null",
    );
    if (!value || typeof value !== "object") return defaultPanelVisibility;
    return Object.fromEntries(
      panelDefinitions.map(({ id }) => [
        id,
        typeof value[id] === "boolean" ? value[id] : true,
      ]),
    ) as PanelVisibility;
  } catch {
    return defaultPanelVisibility;
  }
}

function getPanelDefinition(id: PanelId) {
  return panelDefinitions.find((panel) => panel.id === id)!;
}

function panelGridTemplate(ids: PanelId[], weights: number[]) {
  if (ids.length === 1) return "minmax(0, 1fr)";
  return ids
    .map((id) => {
      const panel = getPanelDefinition(id);
      return `minmax(${panel.minimumWidth}px, ${weights[panel.weightIndex]}fr)`;
    })
    .join(" 4px ");
}

type FullscreenWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FullscreenWindowMode = "default" | "custom" | "maximized";
type SavedFullscreenWindowMode = Exclude<FullscreenWindowMode, "default">;
type FullscreenWindowState = {
  mode: SavedFullscreenWindowMode;
  bounds: FullscreenWindowBounds;
};
type FullscreenResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const fullscreenWindowStorageKey = "harbor-player-fullscreen-window-v1";
const legacyFullscreenWindowStorageKey = "mml-fullscreen-window-v1";
const fullscreenWindowMinWidth = 640;
const fullscreenWindowMinHeight = 520;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function fitFullscreenWindowBounds(
  bounds: FullscreenWindowBounds,
  roomWidth: number,
  roomHeight: number,
): FullscreenWindowBounds {
  const width = clamp(
    bounds.width,
    Math.min(fullscreenWindowMinWidth, roomWidth),
    roomWidth,
  );
  const height = clamp(
    bounds.height,
    Math.min(fullscreenWindowMinHeight, roomHeight),
    roomHeight,
  );
  return {
    x: clamp(bounds.x, 0, roomWidth - width),
    y: clamp(bounds.y, 0, roomHeight - height),
    width,
    height,
  };
}

function readFullscreenWindowState(): FullscreenWindowState | null {
  try {
    const value = JSON.parse(
      readMigratedStorageValue(
        fullscreenWindowStorageKey,
        legacyFullscreenWindowStorageKey,
      ) || "null",
    );
    const isBounds = (bounds: unknown): bounds is FullscreenWindowBounds =>
      !!bounds &&
      typeof bounds === "object" &&
      [
        (bounds as FullscreenWindowBounds).x,
        (bounds as FullscreenWindowBounds).y,
        (bounds as FullscreenWindowBounds).width,
        (bounds as FullscreenWindowBounds).height,
      ].every(
        (number) => typeof number === "number" && Number.isFinite(number),
      );
    if (isBounds(value)) return { mode: "custom", bounds: value };
    if (value?.mode !== "custom" && value?.mode !== "maximized") return null;
    return isBounds(value.bounds)
      ? { mode: value.mode, bounds: value.bounds }
      : null;
  } catch {
    return null;
  }
}

function trackCountLabel(trackCount: number) {
  const remainder = Math.abs(trackCount) % 100;
  const lastDigit = remainder % 10;
  const word =
    remainder >= 11 && remainder <= 14
      ? "треков"
      : lastDigit === 1
        ? "трек"
        : lastDigit >= 2 && lastDigit <= 4
          ? "трека"
          : "треков";
  return `${count(trackCount)} ${word}`;
}

function copyArtistLabel(artists: string[]) {
  return artists.join(", ") || "Неизвестный исполнитель";
}

function copyTrackLabel(track: Track) {
  return `${copyArtistLabel(track.artists)} — ${track.title}`;
}

function copyAlbumLabel(album: {
  artists: string[];
  title: string;
  year: number | null;
}) {
  const title = `${copyArtistLabel(album.artists)} — ${album.title || "Без альбома"}`;
  return album.year === null ? title : `${title} (${album.year})`;
}

function PanelSelectionIndicator({
  total,
  selected,
  active,
  resetLabel,
  onReset,
}: {
  total: number;
  selected: number;
  active: boolean;
  resetLabel: string;
  onReset: () => void;
}) {
  if (!active) return <span className="panel-count">{count(total)}</span>;
  return (
    <div className="panel-selection-chip">
      <span>{`${count(selected)}/${count(total)}`}</span>
      <button
        className="icon-button facet-reset"
        aria-label={resetLabel}
        title={resetLabel}
        onClick={onReset}
      >
        <X size={15} />
      </button>
    </div>
  );
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function updateBookmarkList(
  current: CatalogBookmark[] | undefined,
  kind: BookmarkKind,
  id: string,
  bookmarked: boolean,
) {
  const items = current || [];
  const exists = items.some((item) => item.kind === kind && item.id === id);
  if (bookmarked === exists) return items;
  return bookmarked
    ? [...items, { kind, id }]
    : items.filter((item) => item.kind !== kind || item.id !== id);
}

export function App() {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities>({
    writableFormats: [],
    verificationDate: null,
  });
  const {
    filter,
    setFilter,
    replaceFilter,
    search,
    setSearch,
    preservePanelPositions,
    isSearching,
    searchPending,
    filterBySelection,
    navigationEpoch,
    selectedArtists,
    setSelectedArtists,
    selectedAlbums,
    setSelectedAlbums,
    selected,
    setSelected,
    selectedAlbumId,
    setSelectedAlbumId,
    expandedLibraryIds,
    setExpandedLibraryIds,
    expandedFolderKeys,
    setExpandedFolderKeys,
  } = useCatalogBrowsing();
  const [panelVisibility, setPanelVisibility] =
    useState<PanelVisibility>(readPanelVisibility);
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => {
    const cached = readCachedAppearance();
    applyAppearance(cached);
    return cached;
  });
  const appearanceTouchedRef = useRef(false);
  const [scanSettings, setScanSettings] =
    useState<ScanSettings>(defaultScanSettings);
  const [modal, setModal] = useState<
    | "add"
    | "move"
    | "trash"
    | "tags"
    | "history"
    | "rename-library"
    | "remove-library"
    | "artist-folders"
    | "album-merge"
    | "settings"
    | null
  >(null);
  const [libraryToRename, setLibraryToRename] = useState<Library | null>(null);
  const [libraryToRemove, setLibraryToRemove] = useState<Library | null>(null);
  const [modalSelection, setModalSelection] = useState<Selection | null>(null);
  const [albumMergeSelection, setAlbumMergeSelection] = useState<{
    albumIds: string[];
    anchorAlbumId: string;
  } | null>(null);
  const [folderMoveRoots, setFolderMoveRoots] = useState<
    FolderMoveRoot[] | null
  >(null);
  const [artistMoveNames, setArtistMoveNames] = useState<string[]>([]);
  const [preview, setPreview] = useState<OperationPreview | null>(null);
  const [droppedCover, setDroppedCover] = useState<DroppedCover | null>(null);
  const [toast, setToast] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingBookmarkKeys, setPendingBookmarkKeys] = useState<Set<string>>(
    new Set(),
  );
  const pendingBookmarkKeysRef = useRef(new Set<string>());
  const bookmarkWriteChain = useRef(Promise.resolve());
  const bookmarkCatalogDirty = useRef(false);
  const [pendingUserStateKeys, setPendingUserStateKeys] = useState<Set<string>>(
    new Set(),
  );
  const pendingUserStateKeysRef = useRef(new Set<string>());
  const [ratingDialog, setRatingDialog] = useState<{
    kind: "album" | "track";
    ids: string[];
    rating: number | null;
    x: number;
    y: number;
  } | null>(null);
  const notify = useCallback((message: string) => setToast(message), []);
  const player = usePlayer(notify);
  const [isFullscreen, setIsFullscreen] = useState(
    () => document.fullscreenElement === document.documentElement,
  );
  const { appShellRef, appShellWidth, isPortraitLayout } = useAppShellLayout();
  const [fullscreenWindowMode, setFullscreenWindowMode] =
    useState<FullscreenWindowMode>("default");
  const [fullscreenWindowBounds, setFullscreenWindowBounds] =
    useState<FullscreenWindowBounds | null>(null);
  const [coverMode, setCoverMode] = useState(false);
  const [coverSearch, setCoverSearch] = useState("");
  const filterKey = `${navigationEpoch}:${JSON.stringify(filter)}`;
  const {
    filterKeyRef,
    artistScrollTarget,
    albumScrollTarget,
    trackScrollTarget,
    requestArtistScroll,
    requestAlbumScroll,
    requestTrackScroll,
  } = useCatalogScrollTargets(filterKey);
  const updateAppearance = useCallback((next: AppearanceSettings) => {
    const normalized = normalizeAppearance(next);
    appearanceTouchedRef.current = true;
    cacheAppearance(normalized);
    applyAppearance(normalized);
    setAppearance(normalized);
  }, []);
  const saveFullscreenWindowState = useCallback(
    (state: FullscreenWindowState) => {
      try {
        localStorage.setItem(fullscreenWindowStorageKey, JSON.stringify(state));
      } catch {
        // Geometry remains usable for the current fullscreen session.
      }
    },
    [],
  );
  useEffect(() => {
    if (!ready) return;
    void api<AppearanceSettings>("/appearance")
      .then((remote) => {
        if (appearanceTouchedRef.current) return;
        const normalized = normalizeAppearance(remote);
        cacheAppearance(normalized);
        applyAppearance(normalized);
        setAppearance(normalized);
      })
      .catch(() => {
        // Cached appearance remains available when the local server is restarting.
      });
  }, [ready, updateAppearance]);
  useEffect(() => {
    if (!ready) return;
    void api<ScanSettings>("/scan-settings")
      .then(setScanSettings)
      .catch(() => {
        // The server default remains active while it is restarting.
      });
  }, [ready]);
  useEffect(() => {
    const syncFullscreen = () => {
      const fullscreen =
        document.fullscreenElement === document.documentElement;
      setIsFullscreen(fullscreen);
      if (!fullscreen) return;
      window.requestAnimationFrame(() => {
        const room =
          appShellRef.current?.parentElement?.getBoundingClientRect();
        if (!room) {
          setFullscreenWindowMode("default");
          return;
        }
        const saved = readFullscreenWindowState();
        if (saved) {
          setFullscreenWindowBounds(
            fitFullscreenWindowBounds(saved.bounds, room.width, room.height),
          );
          setFullscreenWindowMode(saved.mode);
          return;
        }
        const shell = appShellRef.current?.getBoundingClientRect();
        if (!shell) return;
        const bounds = fitFullscreenWindowBounds(
          {
            x: shell.left - room.left,
            y: shell.top - room.top,
            width: shell.width,
            height: shell.height,
          },
          room.width,
          room.height,
        );
        saveFullscreenWindowState({ mode: "custom", bounds });
        setFullscreenWindowBounds(bounds);
        setFullscreenWindowMode("custom");
      });
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, [saveFullscreenWindowState]);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === document.documentElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen();
  }, []);
  const getFullscreenRoom = useCallback(() => {
    const room = appShellRef.current?.parentElement?.getBoundingClientRect();
    return room && room.width > 0 && room.height > 0 ? room : null;
  }, []);
  const getCurrentFullscreenBounds = useCallback(() => {
    const room = getFullscreenRoom();
    const shell = appShellRef.current?.getBoundingClientRect();
    if (!room || !shell) return null;
    return fitFullscreenWindowBounds(
      {
        x: shell.left - room.left,
        y: shell.top - room.top,
        width: shell.width,
        height: shell.height,
      },
      room.width,
      room.height,
    );
  }, [getFullscreenRoom]);
  const beginFullscreenWindowMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!isFullscreen || event.button !== 0) return;
      const target = event.target as Element;
      if (
        target.closest(
          "button, input, select, a, .search, .local-status, [data-window-control]",
        )
      )
        return;
      const initial = getCurrentFullscreenBounds();
      if (!initial) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      event.preventDefault();
      const move = (pointerEvent: PointerEvent) => {
        const room = getFullscreenRoom();
        if (!room) return;
        moved = true;
        setFullscreenWindowMode("custom");
        setFullscreenWindowBounds(
          fitFullscreenWindowBounds(
            {
              ...initial,
              x: initial.x + pointerEvent.clientX - startX,
              y: initial.y + pointerEvent.clientY - startY,
            },
            room.width,
            room.height,
          ),
        );
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        if (!moved) return;
        setFullscreenWindowBounds((current) => {
          if (current)
            saveFullscreenWindowState({ mode: "custom", bounds: current });
          return current;
        });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    },
    [
      getCurrentFullscreenBounds,
      getFullscreenRoom,
      isFullscreen,
      saveFullscreenWindowState,
    ],
  );
  const beginFullscreenWindowResize = useCallback(
    (edge: FullscreenResizeEdge, event: React.PointerEvent<HTMLDivElement>) => {
      if (!isFullscreen || event.button !== 0) return;
      const initial = getCurrentFullscreenBounds();
      if (!initial) return;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      event.preventDefault();
      event.stopPropagation();
      const move = (pointerEvent: PointerEvent) => {
        const room = getFullscreenRoom();
        if (!room) return;
        moved = true;
        setFullscreenWindowMode("custom");
        const deltaX = pointerEvent.clientX - startX;
        const deltaY = pointerEvent.clientY - startY;
        const minimumWidth = Math.min(fullscreenWindowMinWidth, room.width);
        const minimumHeight = Math.min(fullscreenWindowMinHeight, room.height);
        const next = { ...initial };
        if (edge.includes("e")) next.width += deltaX;
        if (edge.includes("s")) next.height += deltaY;
        if (edge.includes("w")) {
          next.x += deltaX;
          next.width -= deltaX;
          if (next.width < minimumWidth) {
            next.x = initial.x + initial.width - minimumWidth;
            next.width = minimumWidth;
          }
        }
        if (edge.includes("n")) {
          next.y += deltaY;
          next.height -= deltaY;
          if (next.height < minimumHeight) {
            next.y = initial.y + initial.height - minimumHeight;
            next.height = minimumHeight;
          }
        }
        setFullscreenWindowBounds(
          fitFullscreenWindowBounds(next, room.width, room.height),
        );
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        if (!moved) return;
        setFullscreenWindowBounds((current) => {
          if (current)
            saveFullscreenWindowState({ mode: "custom", bounds: current });
          return current;
        });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
    },
    [
      getCurrentFullscreenBounds,
      getFullscreenRoom,
      isFullscreen,
      saveFullscreenWindowState,
    ],
  );
  const toggleFullscreenWindowSize = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as Element;
      if (
        !isFullscreen ||
        target.closest(
          "button, input, select, a, .search, .local-status, [data-window-control]",
        )
      )
        return;
      const bounds = fullscreenWindowBounds || getCurrentFullscreenBounds();
      if (!bounds) return;
      if (fullscreenWindowMode === "maximized") {
        setFullscreenWindowBounds(bounds);
        setFullscreenWindowMode("custom");
        saveFullscreenWindowState({ mode: "custom", bounds });
        return;
      }
      setFullscreenWindowMode("maximized");
      saveFullscreenWindowState({ mode: "maximized", bounds });
    },
    [
      fullscreenWindowMode,
      fullscreenWindowBounds,
      getCurrentFullscreenBounds,
      isFullscreen,
      saveFullscreenWindowState,
    ],
  );
  useEffect(() => {
    if (!isFullscreen || fullscreenWindowMode !== "custom") return;
    const constrainToRoom = () => {
      const room = getFullscreenRoom();
      if (!room) return;
      setFullscreenWindowBounds((current) => {
        if (!current) return current;
        const next = fitFullscreenWindowBounds(
          current,
          room.width,
          room.height,
        );
        return next;
      });
    };
    window.addEventListener("resize", constrainToRoom);
    return () => window.removeEventListener("resize", constrainToRoom);
  }, [fullscreenWindowMode, getFullscreenRoom, isFullscreen]);
  const setPanelVisible = useCallback((id: PanelId, visible: boolean) => {
    setPanelVisibility((current) => {
      if (current[id] === visible) return current;
      const next = { ...current, [id]: visible };
      try {
        localStorage.setItem(panelVisibilityStorageKey, JSON.stringify(next));
      } catch {
        // Visibility remains usable for the current session.
      }
      return next;
    });
  }, []);
  const togglePanelVisibility = useCallback(
    (id: PanelId) => {
      const visible = !panelVisibility[id];
      setPanelVisible(id, visible);
      if (visible) return;
      if (id === "libraries") {
        setFilter((current) => ({
          ...current,
          libraryIds: [],
          folders: [],
        }));
      } else if (id === "genres") {
        setFilter((current) => ({ ...current, genres: [] }));
      } else if (id === "artists") {
        setSelectedArtists([]);
        setFilter((current) => ({ ...current, artists: [] }));
      } else if (id === "albums") {
        setSelectedAlbums([]);
        setFilter((current) => ({ ...current, albumIds: [] }));
      } else {
        setSelected(new Set());
        setSelectedAlbumId(null);
      }
    },
    [
      panelVisibility,
      setPanelVisible,
      setFilter,
      setSelectedArtists,
      setSelectedAlbums,
      setSelected,
      setSelectedAlbumId,
    ],
  );
  const workspaceRef = useRef<HTMLElement>(null);
  const [panelWeights, setPanelWeights] = useState<number[]>(() => {
    try {
      const weights = JSON.parse(
        readMigratedStorageValue(
          "harbor-player-panel-weights-v1",
          "mml-panel-weights-v1",
        ) || "[1.05,0.9,1,1.45,1.6]",
      );
      return Array.isArray(weights) &&
        weights.length === 5 &&
        weights.every(
          (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0,
        )
        ? weights
        : [1.05, 0.9, 1, 1.45, 1.6];
    } catch {
      return [1.05, 0.9, 1, 1.45, 1.6];
    }
  });
  const [rowWeights, setRowWeights] = useState<number[]>(() => {
    try {
      const weights = JSON.parse(
        readMigratedStorageValue(
          "harbor-player-panel-row-weights-v1",
          "mml-panel-row-weights-v1",
        ) || "[1,1]",
      );
      return Array.isArray(weights) &&
        weights.length === 2 &&
        weights.every((weight) => typeof weight === "number" && weight > 0)
        ? weights
        : [1, 1];
    } catch {
      return [1, 1];
    }
  });
  const visiblePanelIds = panelDefinitions
    .filter(({ id }) => panelVisibility[id])
    .map(({ id }) => id);
  const visibleFacetPanelIds = panelDefinitions
    .filter(({ id, group }) => group === "facets" && panelVisibility[id])
    .map(({ id }) => id);
  const visibleCatalogPanelIds = panelDefinitions
    .filter(({ id, group }) => group === "catalog" && panelVisibility[id])
    .map(({ id }) => id);
  const portraitWorkspaceLayout = usesPortraitWorkspaceLayout(
    isPortraitLayout,
    appShellWidth,
    visiblePanelIds.length,
  );
  const nextVisiblePanel = (id: PanelId) => {
    const index = visiblePanelIds.indexOf(id);
    return index >= 0 ? visiblePanelIds[index + 1] : undefined;
  };
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const watchedOperations = useRef(new Set<string>());
  useEffect(() => {
    api<{ csrf: string; capabilities: Capabilities }>("/session")
      .then((s) => {
        setCsrf(s.csrf);
        setCapabilities(s.capabilities);
        setReady(true);
      })
      .catch((e) => setStartupError(e.message));
  }, []);
  useEffect(() => {
    if (!player.queue?.track) {
      setCoverMode(false);
      setCoverSearch("");
    }
  }, [player.queue?.track]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 9000);
    return () => clearTimeout(timer);
  }, [toast]);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (q) =>
        [
          "libraries",
          "library-folders",
          "genres",
          "tag-genre-options",
          "artists",
          "albums",
          "tracks",
          "jobs",
          "history",
          "filter-validity",
          "facet-relevance",
          "selection-summary",
          "bookmarks",
        ].includes(String(q.queryKey[0])),
    });
  }, [queryClient]);
  const bookmarks = useQuery({
    queryKey: ["bookmarks"],
    queryFn: () => api<CatalogBookmark[]>("/bookmarks"),
    enabled: ready,
  });
  const bookmarkKeys = useMemo(
    () =>
      new Set((bookmarks.data || []).map((item) => `${item.kind}:${item.id}`)),
    [bookmarks.data],
  );
  const bookmarksUnavailable =
    bookmarks.isPending || bookmarks.isError || !bookmarks.data;
  const bookmarkErrorNotified = useRef<unknown>(null);
  useEffect(() => {
    if (!bookmarks.error || bookmarkErrorNotified.current === bookmarks.error)
      return;
    bookmarkErrorNotified.current = bookmarks.error;
    notify(`Не удалось загрузить закладки: ${bookmarks.error.message}`);
  }, [bookmarks.error, notify]);
  const changeBookmarks = useCallback(
    (kind: BookmarkKind, ids: readonly string[], bookmarked: boolean) => {
      const targets = [...new Set(ids)].filter(
        (id) => !pendingBookmarkKeysRef.current.has(`${kind}:${id}`),
      );
      if (bookmarksUnavailable || !targets.length) return;
      const previous = new Map(
        targets.map((id) => [id, bookmarkKeys.has(`${kind}:${id}`)]),
      );
      for (const id of targets)
        pendingBookmarkKeysRef.current.add(`${kind}:${id}`);
      setPendingBookmarkKeys(new Set(pendingBookmarkKeysRef.current));
      queryClient.setQueryData<CatalogBookmark[]>(["bookmarks"], (current) => {
        let next = current;
        for (const id of targets)
          next = updateBookmarkList(next, kind, id, bookmarked);
        return next;
      });

      bookmarkWriteChain.current = bookmarkWriteChain.current
        .catch(() => undefined)
        .then(async () => {
          let failed = 0;
          let firstError: unknown;
          for (const id of targets) {
            try {
              await api<CatalogBookmark[]>("/bookmarks", {
                kind,
                id,
                bookmarked,
              });
              bookmarkCatalogDirty.current = true;
            } catch (error) {
              failed += 1;
              firstError ||= error;
              queryClient.setQueryData<CatalogBookmark[]>(
                ["bookmarks"],
                (current) =>
                  updateBookmarkList(
                    current,
                    kind,
                    id,
                    previous.get(id) || false,
                  ),
              );
            } finally {
              pendingBookmarkKeysRef.current.delete(`${kind}:${id}`);
              setPendingBookmarkKeys(new Set(pendingBookmarkKeysRef.current));
            }
          }
          if (failed)
            notify(
              targets.length === 1
                ? firstError instanceof Error
                  ? firstError.message
                  : String(firstError)
                : `Не удалось изменить закладки: ${failed} из ${targets.length}`,
            );
          if (!pendingBookmarkKeysRef.current.size) {
            await queryClient.invalidateQueries({
              queryKey: ["bookmarks"],
            });
            if (bookmarkCatalogDirty.current) {
              bookmarkCatalogDirty.current = false;
              await queryClient.invalidateQueries({
                predicate: (query) => {
                  if (
                    ![
                      "genres",
                      "artists",
                      "albums",
                      "tracks",
                      "filter-validity",
                    ].includes(String(query.queryKey[0]))
                  )
                    return false;
                  const queryFilter = query.queryKey[1];
                  return Boolean(
                    queryFilter &&
                    typeof queryFilter === "object" &&
                    "bookmarksOnly" in queryFilter &&
                    queryFilter.bookmarksOnly,
                  );
                },
              });
            }
          }
        });
    },
    [bookmarkKeys, bookmarksUnavailable, notify, queryClient],
  );
  const changeBookmark = useCallback(
    (kind: BookmarkKind, id: string, bookmarked: boolean) =>
      changeBookmarks(kind, [id], bookmarked),
    [changeBookmarks],
  );
  const changeUserState = useCallback<UserStateChange>(
    (kind, ids, patch) => {
      const targets = [...new Set(ids)];
      if (
        !targets.length ||
        targets.some((id) =>
          pendingUserStateKeysRef.current.has(`${kind}:${id}`),
        )
      )
        return;
      const targetSet = new Set(targets);
      const snapshots = queryClient
        .getQueryCache()
        .findAll()
        .filter((query) => query.state.data !== undefined)
        .map((query) => ({ key: query.queryKey, data: query.state.data }));
      const previousPlayerTrack = player.queue?.track;
      for (const id of targets)
        pendingUserStateKeysRef.current.add(`${kind}:${id}`);
      setPendingUserStateKeys(new Set(pendingUserStateKeysRef.current));
      for (const snapshot of snapshots)
        queryClient.setQueryData(snapshot.key, (current: unknown) =>
          updateUserStateCache(current, kind, targetSet, patch),
        );
      player.updateTrack(
        (track) => updateUserStateCache(track, kind, targetSet, patch) as Track,
      );
      void api("/catalog-user-state", { kind, ids: targets, patch })
        .catch((error) => {
          for (const snapshot of snapshots)
            queryClient.setQueryData(snapshot.key, snapshot.data);
          if (previousPlayerTrack)
            player.updateTrack(() => previousPlayerTrack);
          notify(
            error instanceof Error
              ? error.message
              : "Не удалось сохранить оценку",
          );
        })
        .finally(async () => {
          for (const id of targets)
            pendingUserStateKeysRef.current.delete(`${kind}:${id}`);
          setPendingUserStateKeys(new Set(pendingUserStateKeysRef.current));
          await queryClient.invalidateQueries({
            predicate: (query) =>
              [
                "albums",
                "tracks",
                "quick-search",
                "cover-mode-tracks",
              ].includes(String(query.queryKey[0])),
          });
        });
    },
    [notify, player, queryClient],
  );
  const showCatalogMenu = useCallback(
    (
      event: React.MouseEvent,
      kind: BookmarkKind,
      id: string,
      selectedIds: string[],
      copyTexts?: string[],
    ) => {
      event.preventDefault();
      const ids = [...new Set(selectedIds)];
      const allBookmarked = ids.every((item) =>
        bookmarkKeys.has(`${kind}:${item}`),
      );
      const bookmarkPending = ids.some((item) =>
        pendingBookmarkKeys.has(`${kind}:${item}`),
      );
      const suffix = ids.length > 1 ? ` (${ids.length})` : "";
      const ratings =
        kind === "artist"
          ? []
          : ids.map((item) =>
              cachedUserRating(queryClient, kind as "album" | "track", item),
            );
      const sharedRating =
        ratings.length > 0 && ratings.every((rating) => rating === ratings[0])
          ? ratings[0]
          : null;
      const selection: Selection =
        kind === "album"
          ? {
              filter: {
                ...(isSearching ? filter : emptyFilter),
                albumIds: ids,
              },
            }
          : kind === "artist"
            ? { filter: { ...filter, artists: ids } }
            : { trackIds: ids };
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          ...(kind === "artist" || kind === "album"
            ? [
                {
                  label: "Фильтровать по выбранному",
                  onSelect: () => filterBySelection(kind, ids),
                },
              ]
            : []),
          {
            label: bookmarkPending
              ? "Сохраняем закладку…"
              : bookmarks.isPending
                ? "Закладки загружаются…"
                : bookmarks.isError
                  ? "Закладки недоступны"
                  : allBookmarked
                    ? `Удалить из закладок${suffix}`
                    : `Добавить в закладки${suffix}`,
            icon:
              bookmarkPending || bookmarks.isPending ? (
                <RefreshCw size={16} className="spinning" />
              ) : (
                <BookmarkIcon
                  size={16}
                  fill={allBookmarked ? "currentColor" : "none"}
                />
              ),
            disabled: bookmarksUnavailable || bookmarkPending,
            onSelect: () => changeBookmarks(kind, ids, !allBookmarked),
          },
          ...(kind !== "artist"
            ? [
                {
                  label: `Изменить оценку…${suffix}`,
                  icon: <Star size={16} />,
                  disabled: ids.some((item) =>
                    pendingUserStateKeys.has(`${kind}:${item}`),
                  ),
                  onSelect: () =>
                    setRatingDialog({
                      kind: kind as "album" | "track",
                      ids,
                      rating: sharedRating,
                      x: event.clientX,
                      y: event.clientY,
                    }),
                },
              ]
            : []),
          ...(kind === "album"
            ? [
                {
                  label: ids.every((item) =>
                    cachedAlbumViewed(queryClient, item),
                  )
                    ? `Отметить непросмотренными${suffix}`
                    : `Отметить просмотренными${suffix}`,
                  icon: ids.every((item) =>
                    cachedAlbumViewed(queryClient, item),
                  ) ? (
                    <Eye size={16} />
                  ) : (
                    <EyeOff size={16} />
                  ),
                  disabled: ids.some((item) =>
                    pendingUserStateKeys.has(`album:${item}`),
                  ),
                  onSelect: () => {
                    const viewed = !ids.every((item) =>
                      cachedAlbumViewed(queryClient, item),
                    );
                    changeUserState("album", ids, { viewed });
                  },
                },
              ]
            : []),
          ...(kind === "album" && ids.length > 1
            ? [
                {
                  label: `Объединить альбомы${suffix}`,
                  icon: <Combine size={16} />,
                  onSelect: () => {
                    setAlbumMergeSelection({
                      albumIds: ids,
                      anchorAlbumId: id,
                    });
                    setModal("album-merge");
                  },
                },
              ]
            : []),
          ...(kind === "artist"
            ? [
                {
                  label: `Редактировать теги${suffix}`,
                  icon: <Tag size={16} />,
                  onSelect: () => {
                    setModalSelection(selection);
                    setModal("tags");
                  },
                },
                {
                  label: `Перенести треки${suffix}`,
                  icon: <FolderInput size={16} />,
                  onSelect: () => {
                    setArtistMoveNames(ids);
                    setModal("artist-folders");
                  },
                },
              ]
            : [
                {
                  label: `Редактировать теги${suffix}`,
                  icon: <Tag size={16} />,
                  onSelect: () => {
                    setModalSelection(selection);
                    setModal("tags");
                  },
                },
                {
                  label: `Перенести треки${suffix}`,
                  icon: <FolderInput size={16} />,
                  onSelect: () => {
                    setModalSelection(selection);
                    setModal("move");
                  },
                },
                {
                  label: `Удалить треки${suffix}`,
                  icon: <Trash2 size={16} />,
                  onSelect: () => {
                    setModalSelection(selection);
                    setModal("trash");
                  },
                },
                ...(copyTexts?.length
                  ? [
                      {
                        label: `Копировать данные${suffix}`,
                        icon: <Copy size={16} />,
                        onSelect: async () => {
                          try {
                            await navigator.clipboard.writeText(
                              copyTexts.join("\n"),
                            );
                            notify("Данные скопированы");
                          } catch (error) {
                            notify(
                              error instanceof Error
                                ? `Не удалось скопировать данные: ${error.message}`
                                : "Не удалось скопировать данные",
                            );
                          }
                        },
                      },
                    ]
                  : []),
              ]),
          ...(kind !== "artist"
            ? [
                {
                  label: `Открыть в проводнике${suffix}`,
                  icon: <FolderOpen size={16} />,
                  onSelect: async () => {
                    try {
                      const results = await Promise.allSettled(
                        ids.map((item) => api("/explorer", { kind, id: item })),
                      );
                      const failed = results.filter(
                        (result) => result.status === "rejected",
                      ).length;
                      if (failed)
                        notify(
                          ids.length === 1
                            ? String(
                                (results[0] as PromiseRejectedResult).reason,
                              )
                            : `Не удалось открыть в проводнике: ${failed} из ${ids.length}`,
                        );
                    } catch (error) {
                      notify(
                        error instanceof Error ? error.message : String(error),
                      );
                    }
                  },
                },
              ]
            : []),
        ],
      });
    },
    [
      bookmarkKeys,
      bookmarks.isError,
      bookmarks.isPending,
      bookmarksUnavailable,
      changeBookmarks,
      changeUserState,
      filter,
      filterBySelection,
      isSearching,
      notify,
      pendingBookmarkKeys,
      pendingUserStateKeys,
      queryClient,
    ],
  );
  const showGenreMenu = useCallback(
    (event: React.MouseEvent, genre: string) => {
      event.preventDefault();
      const genres = resolveContextSelection(filter.genres, genre);
      if (!filter.genres.includes(genre))
        preservePanelPositions(() =>
          setFilter((current) => ({ ...current, genres })),
        );
      const suffix = genres.length > 1 ? ` (${genres.length})` : "";
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: `Редактировать теги${suffix}`,
            icon: <Tag size={16} />,
            onSelect: () => {
              setModalSelection({ filter: { ...filter, genres } });
              setModal("tags");
            },
          },
        ],
      });
    },
    [filter, preservePanelPositions, setFilter],
  );
  const showLibraryMenu = useCallback(
    (event: React.MouseEvent, library: Library) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: "Открыть в проводнике",
            icon: <FolderOpen size={16} />,
            onSelect: async () => {
              try {
                await api("/explorer", {
                  kind: "library",
                  libraryId: library.id,
                });
              } catch (error) {
                notify(error instanceof Error ? error.message : String(error));
              }
            },
          },
          {
            label: "Обновить",
            icon: <RefreshCw size={16} />,
            onSelect: async () => {
              try {
                await api(`/libraries/${library.id}/scan`, { force: true });
                refresh();
              } catch (error) {
                notify(error instanceof Error ? error.message : String(error));
              }
            },
          },
          {
            label: "Переименовать",
            icon: <Pencil size={16} />,
            onSelect: () => {
              setLibraryToRename(library);
              setModal("rename-library");
            },
          },
          {
            label: "Удалить",
            icon: <Trash2 size={16} />,
            onSelect: () => {
              setLibraryToRemove(library);
              setModal("remove-library");
            },
          },
        ],
      });
    },
    [notify, refresh],
  );
  const showFolderMenu = useCallback(
    (event: React.MouseEvent, libraryId: string, folder: LibraryFolder) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: "Открыть в проводнике",
            icon: <FolderOpen size={16} />,
            onSelect: async () => {
              try {
                await api("/explorer", {
                  kind: "folder",
                  libraryId,
                  relativePath: folder.relativePath,
                });
              } catch (error) {
                notify(error instanceof Error ? error.message : String(error));
              }
            },
          },
          {
            label: "Перенести треки",
            icon: <FolderInput size={16} />,
            onSelect: () => {
              const roots = [{ libraryId, relativePath: folder.relativePath }];
              setFolderMoveRoots(roots);
              setModalSelection({
                filter: { ...emptyFilter, folders: roots },
              });
              setModal("move");
            },
          },
        ],
      });
    },
    [notify],
  );
  const scheduleRefresh = useCallback(
    (immediate = false) => {
      if (pendingRefresh.current) {
        clearTimeout(pendingRefresh.current);
        pendingRefresh.current = undefined;
      }
      if (immediate) refresh();
      else
        pendingRefresh.current = setTimeout(() => {
          pendingRefresh.current = undefined;
          refresh();
        }, 500);
    },
    [refresh],
  );
  const watchOperation = useCallback(
    (id: string, initialJob?: Job) => {
      if (watchedOperations.current.has(id)) return;
      watchedOperations.current.add(id);
      if (initialJob)
        queryClient.setQueryData<Job[]>(["jobs"], (old) =>
          [
            initialJob,
            ...(old || []).filter((job) => job.id !== initialJob.id),
          ].slice(0, 30),
        );
      void (async () => {
        try {
          while (true) {
            const operation = await api<OperationPreview>(`/operations/${id}`);
            if (
              operation.status === "done" ||
              operation.status === "interrupted"
            ) {
              refresh();
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch {
          scheduleRefresh();
        } finally {
          watchedOperations.current.delete(id);
        }
      })();
    },
    [queryClient, refresh, scheduleRefresh],
  );
  const prepareDroppedCover = useCallback(
    async (album: Album, files: File[]) => {
      if (files.length !== 1) {
        notify("Перетащите один файл JPEG, PNG или WebP до 10 МБ");
        return;
      }
      const [file] = files;
      try {
        const cover = await prepareCoverFile(file);
        setDroppedCover({
          album,
          name: file.name,
          cover,
        });
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "Не удалось обработать обложку",
        );
      }
    },
    [notify],
  );
  const applyDroppedCover = useCallback(async () => {
    if (!droppedCover) return;
    const operation = await api<OperationPreview>("/operations/preview", {
      kind: "tags",
      selection: {
        filter: { ...emptyFilter, albumIds: [droppedCover.album.id] },
      },
      patch: { cover: droppedCover.cover },
    });
    const writable = operation.items.filter(
      (item) => !item.error && item.trackId,
    );
    if (!writable.length)
      throw new Error("В альбоме нет треков, доступных для записи обложки");
    const job = await api<Job>(`/operations/${operation.id}/execute`, {});
    watchOperation(operation.id, job);
    setDroppedCover(null);
  }, [droppedCover, notify, watchOperation]);
  useEffect(() => {
    if (!ready) return;
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data);
      player.events.current(event);
      if (event.type === "job") {
        queryClient.setQueryData<Job[]>(["jobs"], (old) =>
          [
            event.job,
            ...(old || []).filter((j) => j.id !== event.job.id),
          ].slice(0, 30),
        );
        if (event.job.status === "error")
          notify(
            `${event.job.label}: ${event.job.errors[0] || "часть файлов не обработана"}`,
          );
      }
      if (event.type === "operation-finished") scheduleRefresh(true);
      else if (
        event.type === "catalog" ||
        (event.type === "job" &&
          event.job.completed > 0 &&
          event.job.completed % 100 === 0)
      )
        scheduleRefresh();
    };
    source.onerror = () => {
      void reconnectSession()
        .then(refresh)
        .catch(() => {});
    };
    return () => {
      source.close();
      clearTimeout(pendingRefresh.current);
      pendingRefresh.current = undefined;
    };
  }, [ready, queryClient, notify, refresh, scheduleRefresh]);
  const libraryFilter = filterForCatalogPanel(filter, "libraries");
  const genreFilter = filterForCatalogPanel(filter, "genres");
  const artistFilter = filterForCatalogPanel(filter, "artists");
  const albumFilter = filterForCatalogPanel(filter, "albums");
  const libraries = useQuery({
    queryKey: ["libraries", libraryFilter],
    queryFn: () => api<Library[]>(catalogUrl("libraries", libraryFilter)),
    enabled: ready && !searchPending,
  });
  const folderKey = (libraryId: string, relativePath: string | null) =>
    `${libraryId}\u0000${relativePath || ""}`;
  const folderParent = (relativePath: string) => {
    const separator = Math.max(
      relativePath.lastIndexOf("\\"),
      relativePath.lastIndexOf("/"),
    );
    return separator < 0 ? null : relativePath.slice(0, separator);
  };
  const folderQueryTargets = useMemo(() => {
    const targets = new Map<
      string,
      { libraryId: string; parent: string | null }
    >();
    for (const libraryId of expandedLibraryIds)
      targets.set(folderKey(libraryId, null), { libraryId, parent: null });
    for (const key of expandedFolderKeys) {
      const [libraryId, parent] = key.split("\u0000");
      if (libraryId && parent) targets.set(key, { libraryId, parent });
    }
    for (const folder of filter.folders) {
      const parent = folderParent(folder.relativePath);
      targets.set(folderKey(folder.libraryId, parent), {
        libraryId: folder.libraryId,
        parent,
      });
    }
    return [...targets.values()];
  }, [expandedFolderKeys, expandedLibraryIds, filter.folders]);
  const folderLevels = useQueries({
    queries: folderQueryTargets.map(({ libraryId, parent }) => ({
      queryKey: ["library-folders", libraryId, parent, libraryFilter],
      queryFn: () => {
        const query = new URLSearchParams({
          filter: JSON.stringify(libraryFilter),
        });
        if (parent) query.set("parent", parent);
        return api<LibraryFolder[]>(
          `/libraries/${libraryId}/folders?${query.toString()}`,
        );
      },
      enabled: ready && !searchPending,
    })),
  });
  const folderQueryByParent = useMemo(
    () =>
      new Map(
        folderQueryTargets.map((target, index) => [
          folderKey(target.libraryId, target.parent),
          folderLevels[index],
        ]),
      ),
    [folderLevels, folderQueryTargets],
  );
  const missingSelectedFolders = filter.folders.filter((folder) => {
    if (
      filter.search.trim() ||
      filter.genres.length ||
      filter.artists.length ||
      filter.albumIds.length ||
      filter.bookmarksOnly
    )
      return false;
    const query = folderQueryByParent.get(
      folderKey(folder.libraryId, folderParent(folder.relativePath)),
    );
    return (
      query?.isSuccess &&
      !query.data?.some((item) => item.relativePath === folder.relativePath)
    );
  });
  useEffect(() => {
    if (!missingSelectedFolders.length) return;
    const missing = new Set(
      missingSelectedFolders.map((folder) =>
        folderKey(folder.libraryId, folder.relativePath),
      ),
    );
    setFilter((current) => ({
      ...current,
      folders: current.folders.filter(
        (folder) =>
          !missing.has(folderKey(folder.libraryId, folder.relativePath)),
      ),
    }));
    notify("Выбранная папка больше не найдена; фильтр обновлён");
  }, [missingSelectedFolders, notify, setFilter]);
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<Job[]>("/jobs"),
    enabled: ready,
  });
  const genres = useQuery({
    queryKey: ["genres", genreFilter],
    queryFn: () =>
      api<{ name: string; count: number }[]>(catalogUrl("genres", genreFilter)),
    enabled: ready && !searchPending,
  });
  const artists = useInfiniteQuery({
    queryKey: ["artists", artistFilter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<ArtistPage>(catalogUrl("artists", artistFilter, pageParam)),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total
        ? last.offset + last.items.length
        : undefined,
    enabled: ready && !searchPending,
  });
  const artistItems = useMemo(
    () => artists.data?.pages.flatMap((p) => p.items) || [],
    [artists.data],
  );
  const currentPlayerTrack = player.queue?.track;
  const currentPlayerArtists = useMemo(() => {
    if (!currentPlayerTrack) return new Set<string>();
    return new Set(
      currentPlayerTrack.albumArtists.length
        ? currentPlayerTrack.albumArtists
        : currentPlayerTrack.artists,
    );
  }, [currentPlayerTrack]);
  const currentPlayerGenres = useMemo(
    () =>
      new Set(
        currentPlayerTrack
          ? currentPlayerTrack.genres.length
            ? currentPlayerTrack.genres
            : [""]
          : [],
      ),
    [currentPlayerTrack],
  );
  const applyArtistSelection = useCallback(
    (artists: string[]) => {
      if (isSearching) {
        setSelectedArtists(artists);
        return;
      }
      const next = { ...filter, artists };
      preservePanelPositions(() => {
        setSelectedArtists(artists);
        setFilter(next);
      });
    },
    [
      filter,
      isSearching,
      preservePanelPositions,
      setFilter,
      setSelectedArtists,
    ],
  );
  const applyAlbumSelection = useCallback(
    (albumIds: string[]) => {
      if (isSearching) {
        setSelectedAlbums(albumIds);
        return;
      }
      // Album selection only narrows the tracks panel. The album grid and all
      // higher-priority facets keep the same query, so restoring their context
      // would unnecessarily move them to the currently playing album.
      setSelectedAlbums(albumIds);
      setFilter((current) => ({ ...current, albumIds }));
    },
    [isSearching, setFilter, setSelectedAlbums],
  );
  const applyGenreSelection = useCallback(
    (genres: string[]) => {
      if (isSearching) return;
      const next = { ...filter, genres };
      preservePanelPositions(() => setFilter(next));
    },
    [filter, isSearching, preservePanelPositions, setFilter],
  );
  const valid = useQuery({
    queryKey: ["filter-validity", filter],
    queryFn: () =>
      api<FilterValidity>(
        catalogUrl("filter-validity", { ...filter, search: "" }),
      ),
    enabled:
      ready &&
      !isSearching &&
      (filter.genres.length > 0 ||
        filter.artists.length > 0 ||
        filter.albumIds.length > 0),
  });
  const relevanceFilter = useMemo(
    () => ({
      ...emptyFilter,
      genres: filter.genres,
      artists: filter.artists,
      albumIds: filter.albumIds,
    }),
    [filter.genres, filter.artists, filter.albumIds],
  );
  const facetRelevance = useQuery({
    queryKey: ["facet-relevance", relevanceFilter],
    queryFn: () =>
      api<FacetRelevance>(catalogUrl("facet-relevance", relevanceFilter)),
    enabled:
      ready &&
      (relevanceFilter.genres.length > 0 ||
        relevanceFilter.artists.length > 0 ||
        relevanceFilter.albumIds.length > 0),
  });
  const hasFacetRelevance =
    relevanceFilter.genres.length > 0 ||
    relevanceFilter.artists.length > 0 ||
    relevanceFilter.albumIds.length > 0;
  useEffect(() => {
    if (isSearching || !valid.data) return;
    setFilter((current) => {
      return sameStringArray(current.genres, valid.data.genres) &&
        sameStringArray(current.artists, valid.data.artists) &&
        sameStringArray(current.albumIds, valid.data.albumIds)
        ? current
        : {
            ...current,
            genres: valid.data.genres,
            artists: valid.data.artists,
            albumIds: valid.data.albumIds,
          };
    });
    setSelectedArtists(valid.data.artists);
    setSelectedAlbums(valid.data.albumIds);
  }, [
    valid.data,
    isSearching,
    setFilter,
    setSelectedArtists,
    setSelectedAlbums,
  ]);
  const navigateFromPlayer = useCallback(
    async (
      target: "album" | "artist",
      value: string,
      albumArtists: string[] = [],
      trackId?: string,
    ) => {
      const navigationFilterKey = filterKey;
      setCoverMode(false);
      setCoverSearch("");
      const artists =
        target === "album"
          ? albumArtists.length
            ? albumArtists
            : [""]
          : [value];
      const targetFilter =
        target === "album"
          ? { ...albumFilter, albumIds: [value] }
          : { ...artistFilter, artists };
      try {
        const { trackIds } = await api<{ trackIds: string[] }>(
          "/track-ids",
          targetFilter,
        );
        if (filterKeyRef.current !== navigationFilterKey) return;
        if (trackIds.length) {
          if (target === "artist") {
            requestArtistScroll(value);
            return;
          }
          const [artistResult, trackResult] = await Promise.all([
            api<{ trackIds: string[] }>("/track-ids", {
              ...artistFilter,
              artists: [artists[0]],
            }),
            trackId
              ? api<{ trackIds: string[] }>("/track-ids", filter)
              : Promise.resolve({ trackIds: [] }),
          ]);
          if (filterKeyRef.current !== navigationFilterKey) return;
          if (artistResult.trackIds.length) requestArtistScroll(artists[0]);
          requestAlbumScroll(value);
          if (trackId && trackResult.trackIds.includes(trackId))
            requestTrackScroll(trackId);
          return;
        }
      } catch {
        // Fall back to the established navigation when the presence check fails.
      }
      if (filterKeyRef.current !== navigationFilterKey) return;
      setPanelVisible(target === "album" ? "albums" : "artists", true);
      setExpandedLibraryIds(new Set());
      setExpandedFolderKeys(new Set());
      const fallbackFilter = {
        ...emptyFilter,
        artists,
        ...(target === "album" ? { albumIds: [value] } : {}),
      };
      replaceFilter(fallbackFilter);
      requestArtistScroll(
        artists[0],
        `${navigationEpoch + 1}:${JSON.stringify(fallbackFilter)}`,
      );
    },
    [
      albumFilter,
      artistFilter,
      filter,
      requestAlbumScroll,
      requestArtistScroll,
      requestTrackScroll,
      setPanelVisible,
      filterKey,
      navigationEpoch,
      replaceFilter,
      filterKeyRef,
      setExpandedFolderKeys,
      setExpandedLibraryIds,
    ],
  );
  const navigationRequest = useRef(0);
  const navigateCatalog = useCallback(
    async (
      facet: Partial<CatalogFilter>,
      target: "album" | "track" = "album",
    ) => {
      const key = filterKey;
      const request = ++navigationRequest.current;
      if (searchPending) return;
      try {
        const current = () =>
          filterKeyRef.current === key && request === navigationRequest.current;
        if (target === "track") {
          const result = await api<Page<Track>>(
            catalogUrl("tracks", { ...filter, ...facet }, 0, 1),
          );
          if (current() && result.items[0])
            requestTrackScroll(result.items[0].id);
        } else if (facet.artists && filter.artists.length) {
          // A co-artist can be visible inside another artist's filter. Search only
          // the visible albums so navigation cannot point outside the current set.
          for (let offset = 0; current(); offset += 100) {
            const result = await api<Page<Album>>(
              catalogUrl("albums", filter, offset, 100),
            );
            if (!current()) return;
            const album = result.items.find((item) =>
              facet.artists!.some(
                (name) =>
                  item.artists.includes(name) ||
                  (!name && !item.artists.length),
              ),
            );
            if (album) {
              requestAlbumScroll(album.id);
              return;
            }
            if (
              offset + result.items.length >= result.total ||
              !result.items.length
            )
              return;
          }
        } else {
          const result = await api<Page<Album>>(
            catalogUrl("albums", { ...filter, ...facet }, 0, 1),
          );
          if (current() && result.items[0])
            requestAlbumScroll(result.items[0].id);
        }
      } catch (error) {
        if (
          filterKeyRef.current === key &&
          request === navigationRequest.current
        )
          notify(
            error instanceof Error
              ? error.message
              : "Не удалось перейти к музыке",
          );
      }
    },
    [
      filter,
      filterKey,
      filterKeyRef,
      searchPending,
      requestTrackScroll,
      requestAlbumScroll,
      notify,
    ],
  );
  const selectAlbumArtist = useCallback(
    (artist: string) => {
      applyArtistSelection([artist]);
      requestArtistScroll(artist);
      void navigateCatalog({ artists: [artist] });
    },
    [applyArtistSelection, requestArtistScroll, navigateCatalog],
  );
  const selectCatalogAlbum = useCallback(
    (albumId: string) => {
      if (selectedAlbumId === albumId) {
        void player.startAlbum(albumId);
        return;
      }
      setSelectedAlbumId(albumId);
      setSelected(new Set());
      applyAlbumSelection([albumId]);
      requestAlbumScroll(albumId);
      void navigateCatalog({ albumIds: [albumId] }, "track");
    },
    [
      selectedAlbumId,
      player,
      setSelectedAlbumId,
      setSelected,
      applyAlbumSelection,
      requestAlbumScroll,
      navigateCatalog,
    ],
  );
  const albums = useInfiniteQuery({
    queryKey: ["albums", albumFilter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<AlbumPage>(catalogUrl("albums", albumFilter, pageParam, 100)),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total
        ? last.offset + last.items.length
        : undefined,
    enabled: ready && !searchPending,
  });
  const tracks = useInfiniteQuery({
    queryKey: ["tracks", filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<Page<Track>>(catalogUrl("tracks", filter, pageParam, 200)),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total
        ? last.offset + last.items.length
        : undefined,
    enabled: ready && !searchPending,
  });
  const albumItems = useMemo(
    () => albums.data?.pages.flatMap((p) => p.items) || [],
    [albums.data],
  );
  const trackItems = useMemo(
    () => tracks.data?.pages.flatMap((p) => p.items) || [],
    [tracks.data],
  );
  const total = tracks.data?.pages[0]?.total || 0;
  const albumTotal = albums.data?.pages[0]?.total || 0;
  const operationSelection: Selection = selected.size
    ? { trackIds: [...selected] }
    : { filter };
  const activeJobs =
    jobs.data?.filter((j) => ["queued", "running"].includes(j.status)) || [];
  const showPreview = (p: OperationPreview) => {
    setModal(null);
    setModalSelection(null);
    setAlbumMergeSelection(null);
    setFolderMoveRoots(null);
    setPreview(p);
  };
  const resize = (
    leftId: PanelId,
    rightId: PanelId,
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    const start = e.clientX;
    const initial = panelWeights;
    const leftPanel = getPanelDefinition(leftId);
    const rightPanel = getPanelDefinition(rightId);
    const leftIndex = leftPanel.weightIndex;
    const rightIndex = rightPanel.weightIndex;
    const leftElement = workspaceRef.current?.querySelector<HTMLElement>(
      `[data-panel-id="${leftId}"]`,
    );
    const rightElement = workspaceRef.current?.querySelector<HTMLElement>(
      `[data-panel-id="${rightId}"]`,
    );
    if (!leftElement || !rightElement) return;
    const initialLeftPixels = leftElement.getBoundingClientRect().width;
    const pairPixels =
      initialLeftPixels + rightElement.getBoundingClientRect().width;
    const pairWeight = initial[leftIndex] + initial[rightIndex];
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      const leftPixels = Math.max(
        leftPanel.minimumWidth,
        Math.min(
          pairPixels - rightPanel.minimumWidth,
          initialLeftPixels + event.clientX - start,
        ),
      );
      setPanelWeights(
        initial.map((weight, currentIndex) => {
          if (currentIndex === leftIndex)
            return (leftPixels / pairPixels) * pairWeight;
          if (currentIndex === rightIndex)
            return ((pairPixels - leftPixels) / pairPixels) * pairWeight;
          return weight;
        }),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setPanelWeights((current) => {
        localStorage.setItem(
          "harbor-player-panel-weights-v1",
          JSON.stringify(current),
        );
        return current;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const resizeRows = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = e.clientY;
    const initial = rowWeights;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      const available = Math.max(
        1,
        (workspaceRef.current?.getBoundingClientRect().height || 1) - 4,
      );
      const total = initial[0] + initial[1];
      const topPixels = Math.max(
        160,
        Math.min(
          available - 160,
          (initial[0] / total) * available + event.clientY - start,
        ),
      );
      setRowWeights([
        (topPixels / available) * total,
        ((available - topPixels) / available) * total,
      ]);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setRowWeights((current) => {
        localStorage.setItem(
          "harbor-player-panel-row-weights-v1",
          JSON.stringify(current),
        );
        return current;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const libraryListRef = useRef<HTMLDivElement>(null);
  const genreListRef = useRef<HTMLDivElement>(null);
  const locationSelectionKeys = useMemo(
    () => [
      ...filter.libraryIds.map(librarySelectionKey),
      ...filter.folders.map((folder) =>
        folderSelectionKey(folder.libraryId, folder.relativePath),
      ),
    ],
    [filter.libraryIds, filter.folders],
  );
  const applyLocationSelection = useCallback(
    (keys: string[]) => {
      if (isSearching) return;
      const locations = locationsFromSelectionKeys(keys);
      const next = { ...filter, ...locations };
      preservePanelPositions(() => setFilter(next));
    },
    [filter, isSearching, preservePanelPositions, setFilter],
  );
  const selectLocation = (event: React.MouseEvent, key: string) => {
    if (isSearching) {
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey)
        void navigateCatalog(locationsFromSelectionKeys([key]));
    } else librarySelection.selectFromClick(event, key);
  };
  const librarySelection = usePanelSelection({
    scrollRef: libraryListRef,
    selectedKeys: locationSelectionKeys,
    onChange: applyLocationSelection,
  });
  const genreSelection = usePanelSelection({
    scrollRef: genreListRef,
    selectedKeys: filter.genres,
    onChange: applyGenreSelection,
  });
  const highlightedLocations =
    librarySelection.previewKeys || new Set(locationSelectionKeys);
  const highlightedGenres =
    genreSelection.previewKeys || new Set(filter.genres);
  const queryError =
    libraries.error ||
    genres.error ||
    artists.error ||
    albums.error ||
    tracks.error;
  const toggleExpandedFolder = (libraryId: string, relativePath: string) => {
    const key = folderKey(libraryId, relativePath);
    setExpandedFolderKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const renderFolderLevel = (
    libraryId: string,
    parent: string | null = null,
    depth = 0,
  ): ReactNode => {
    const query = folderQueryByParent.get(folderKey(libraryId, parent));
    if (!query) return null;
    if (query.isPending)
      return (
        <div
          className="folder-level-status"
          style={{ "--folder-depth": depth + 1 } as CSSProperties}
        >
          <RefreshCw size={13} className="spinning" />
          <span>Загружаем папки…</span>
        </div>
      );
    if (query.isError)
      return (
        <button
          type="button"
          className="folder-level-status error"
          style={{ "--folder-depth": depth + 1 } as CSSProperties}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={13} />
          <span>Повторить загрузку</span>
        </button>
      );
    return query.data?.map((folder) => {
      const expanded = expandedFolderKeys.has(
        folderKey(libraryId, folder.relativePath),
      );
      const selectionKey = folderSelectionKey(libraryId, folder.relativePath);
      const selected = highlightedLocations.has(selectionKey);
      const related =
        hasFacetRelevance &&
        facetRelevance.data &&
        facetRelevance.data.folders.some(
          (item) =>
            item.libraryId === libraryId &&
            item.relativePath === folder.relativePath,
        );
      return (
        <div key={folder.relativePath} className="library-folder-node">
          <ListTile
            className="library-folder-tile"
            related={related}
            selected={selected}
            current={expanded && !selected}
            expanded={folder.hasChildren ? expanded : undefined}
            title={folder.relativePath}
            value={folder.name}
            selectionKey={selectionKey}
            startAction={
              folder.hasChildren ? (
                <button
                  type="button"
                  className="tree-toggle"
                  data-selection-ignore
                  aria-label={`${expanded ? "Свернуть" : "Развернуть"} папку «${folder.name}»`}
                  aria-expanded={expanded}
                  onClick={() =>
                    toggleExpandedFolder(libraryId, folder.relativePath)
                  }
                >
                  <ChevronRight
                    size={14}
                    className={`folder-chevron ${expanded ? "expanded" : ""}`}
                  />
                </button>
              ) : (
                <span className="tree-toggle-spacer" aria-hidden="true" />
              )
            }
            suffix={count(folder.trackCount)}
            style={{ "--folder-depth": depth + 1 } as CSSProperties}
            onSelect={(event) => selectLocation(event, selectionKey)}
            onContextMenu={(event) => showFolderMenu(event, libraryId, folder)}
          />
          {expanded &&
            renderFolderLevel(libraryId, folder.relativePath, depth + 1)}
        </div>
      );
    });
  };
  if (startupError)
    return (
      <main className="startup-error">
        <AudioLines size={40} />
        <h1>Не удалось открыть медиатеку</h1>
        <p>{startupError}</p>
        <button className="button primary" onClick={() => location.reload()}>
          Попробовать ещё раз
        </button>
      </main>
    );
  const fullscreenWindowStyle = {
    ...(isFullscreen &&
    fullscreenWindowMode === "custom" &&
    fullscreenWindowBounds
      ? {
          "--fullscreen-window-x": `${fullscreenWindowBounds.x}px`,
          "--fullscreen-window-y": `${fullscreenWindowBounds.y}px`,
          "--fullscreen-window-width": `${fullscreenWindowBounds.width}px`,
          "--fullscreen-window-height": `${fullscreenWindowBounds.height}px`,
        }
      : {}),
  } as CSSProperties;
  const renderPanelResizer = (leftId: PanelId) => {
    const rightId = nextVisiblePanel(leftId);
    if (!rightId) return null;
    const leftPanel = getPanelDefinition(leftId);
    const rightPanel = getPanelDefinition(rightId);
    const crossesPortraitRows = leftPanel.group !== rightPanel.group;
    return (
      <div
        className={`resizer ${crossesPortraitRows ? "cross-row-resizer" : ""}`}
        role="separator"
        aria-label={`Ширина: ${leftPanel.label} — ${rightPanel.label}`}
        onPointerDown={(event) => resize(leftId, rightId, event)}
      />
    );
  };
  return (
    <div
      ref={appShellRef}
      className={`app-shell fullscreen-window--${fullscreenWindowMode}${
        coverMode ? " app-shell--cover-mode" : ""
      }${isPortraitLayout ? " layout--portrait" : ""}${
        visiblePanelIds.length ? "" : " app-shell--empty-workspace"
      }`}
      style={fullscreenWindowStyle}
    >
      {isFullscreen && (
        <>
          {(["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const).map(
            (edge) => (
              <div
                key={edge}
                aria-hidden="true"
                className={`fullscreen-window-resize fullscreen-window-resize--${edge}`}
                data-window-control
                onPointerDown={(event) =>
                  beginFullscreenWindowResize(edge, event)
                }
              />
            ),
          )}
        </>
      )}
      <header
        className="topbar"
        onPointerDown={beginFullscreenWindowMove}
        onDoubleClick={toggleFullscreenWindowSize}
      >
        {!coverMode && (
          <div
            className="panel-visibility-controls"
            role="group"
            aria-label="Видимость панелей каталога"
          >
            {panelDefinitions.map(({ id, label, Icon }) => {
              const visible = panelVisibility[id];
              const action = visible ? "Скрыть" : "Показать";
              return (
                <button
                  key={id}
                  type="button"
                  className={`icon-button panel-visibility-button ${visible ? "" : "is-hidden"}`}
                  aria-label={`${action} панель «${label}»`}
                  aria-pressed={visible}
                  title={`${action} панель «${label}»`}
                  onClick={() => togglePanelVisibility(id)}
                >
                  <Icon size={19} />
                </button>
              );
            })}
          </div>
        )}
        {coverMode ? (
          <div className="cover-search">
            <label className="search">
              <Search size={18} />
              <input
                aria-label="Поиск музыки"
                placeholder="Треки, артисты, альбомы"
                value={coverSearch}
                onChange={(event) => setCoverSearch(event.target.value)}
              />
              {coverSearch && (
                <button
                  className="icon-button"
                  aria-label="Очистить поиск"
                  onClick={() => setCoverSearch("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>
            {coverSearch.trim() && (
              <QuickSearchDialog
                query={coverSearch}
                onClose={() => setCoverSearch("")}
                onPlayFilter={player.startFilter}
                onPlayAlbum={(albumId) => player.startAlbum(albumId)}
              />
            )}
          </div>
        ) : (
          <label className="search">
            <Search size={18} />
            <input
              aria-label="Поиск музыки"
              placeholder="Треки, артисты, альбомы"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="Очистить поиск"
                onClick={() => setSearch("")}
              >
                <X size={15} />
              </button>
            )}
          </label>
        )}
        {!coverMode && (
          <div className="catalog-actions">
            <button
              className={`icon-button bookmarks-button ${filter.bookmarksOnly ? "active" : ""} ${bookmarks.isError ? "error" : ""}`}
              aria-label={
                bookmarks.isError
                  ? "Не удалось загрузить закладки. Повторить"
                  : filter.bookmarksOnly
                    ? "Отключить фильтр закладок"
                    : "Показать музыку из закладок"
              }
              aria-pressed={filter.bookmarksOnly}
              title={
                bookmarks.isError
                  ? "Не удалось загрузить закладки. Нажмите, чтобы повторить"
                  : filter.bookmarksOnly
                    ? "Отключить фильтр закладок"
                    : "Показать музыку из закладок"
              }
              disabled={
                isSearching ||
                bookmarks.isFetching ||
                pendingBookmarkKeys.size > 0
              }
              onClick={() => {
                if (bookmarks.isError) {
                  void bookmarks.refetch();
                  return;
                }
                setFilter((current) => ({
                  ...current,
                  bookmarksOnly: !current.bookmarksOnly,
                }));
              }}
            >
              {bookmarks.isFetching || pendingBookmarkKeys.size > 0 ? (
                <RefreshCw size={18} className="spinning" />
              ) : (
                <BookmarkIcon size={19} fill="none" />
              )}
            </button>
            <CatalogUserFilters
              filter={filter}
              disabled={isSearching}
              onChange={setFilter}
            />
          </div>
        )}
        {!coverMode && (
          <button
            className="icon-button history-button"
            aria-label="Журнал операций"
            title="Журнал операций"
            onClick={() => setModal("history")}
          >
            <History size={21} />
          </button>
        )}
        <button
          type="button"
          className="icon-button settings-button"
          aria-label="Открыть настройки"
          title="Настройки"
          onClick={() => setModal("settings")}
        >
          <Settings size={20} />
        </button>
        <button
          type="button"
          className="icon-button cover-mode-toggle"
          aria-label={
            coverMode ? "Вернуться в каталог" : "Открыть режим обложки"
          }
          aria-pressed={coverMode}
          title={coverMode ? "Вернуться в каталог" : "Открыть режим обложки"}
          disabled={!player.queue?.track}
          onClick={() => {
            if (!player.queue?.track) return;
            setCoverSearch("");
            setCoverMode((current) => !current);
          }}
        >
          {coverMode ? <SquareLibrary size={21} /> : <DiscAlbum size={21} />}
        </button>
        <button
          type="button"
          className="icon-button fullscreen-button"
          aria-label={
            isFullscreen
              ? "Свернуть окно из полноэкранного режима"
              : "Развернуть окно на весь экран"
          }
          aria-pressed={isFullscreen}
          title={
            isFullscreen
              ? "Свернуть окно из полноэкранного режима"
              : "Развернуть окно на весь экран"
          }
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
        </button>
        <div className="local-status">
          <span />
          На этом компьютере
        </div>
      </header>
      <main
        ref={workspaceRef}
        className={`workspace ${portraitWorkspaceLayout ? "workspace--portrait" : ""} ${coverMode ? "workspace-hidden" : ""} ${visiblePanelIds.length ? "" : "workspace-empty"}`}
        style={
          {
            "--library-weight": `${panelWeights[0]}fr`,
            "--genre-weight": `${panelWeights[1]}fr`,
            "--artist-weight": `${panelWeights[2]}fr`,
            "--album-weight": `${panelWeights[3]}fr`,
            "--track-weight": `${panelWeights[4]}fr`,
            "--facet-row-weight": `${rowWeights[0]}fr`,
            "--catalog-row-weight": `${rowWeights[1]}fr`,
            "--workspace-columns": panelGridTemplate(
              visiblePanelIds,
              panelWeights,
            ),
            "--facet-columns": panelGridTemplate(
              visibleFacetPanelIds,
              panelWeights,
            ),
            "--catalog-columns": panelGridTemplate(
              visibleCatalogPanelIds,
              panelWeights,
            ),
            "--workspace-rows":
              visibleFacetPanelIds.length && visibleCatalogPanelIds.length
                ? `minmax(160px, ${rowWeights[0]}fr) 4px minmax(160px, ${rowWeights[1]}fr)`
                : "minmax(0, 1fr)",
          } as CSSProperties
        }
      >
        <div
          className={`workspace-row workspace-facets ${visibleFacetPanelIds.length ? "" : "workspace-row-hidden"}`}
        >
          {panelVisibility.libraries && (
            <LibraryPanel
              libraries={libraries.data || []}
              filter={filter}
              facetRelevance={facetRelevance.data}
              hasFacetRelevance={hasFacetRelevance}
              currentLibraryId={currentPlayerTrack?.libraryId}
              highlightedLocations={highlightedLocations}
              expandedLibraryIds={expandedLibraryIds}
              activeJobs={activeJobs}
              listRef={libraryListRef}
              surfaceProps={librarySelection.surfaceProps}
              marquee={librarySelection.marquee}
              renderFolderLevel={renderFolderLevel}
              onReset={() =>
                preservePanelPositions(() =>
                  setFilter((f) => ({
                    ...f,
                    libraryIds: [],
                    folders: [],
                  })),
                )
              }
              onToggleExpanded={(libraryId) =>
                setExpandedLibraryIds((current) => {
                  const next = new Set(current);
                  if (next.has(libraryId)) next.delete(libraryId);
                  else next.add(libraryId);
                  return next;
                })
              }
              onSelect={(event, key) => selectLocation(event, key)}
              onContextMenu={showLibraryMenu}
              onAdd={() => setModal("add")}
            />
          )}
          {panelVisibility.libraries && renderPanelResizer("libraries")}
          {panelVisibility.genres && (
            <GenrePanel
              genres={genres.data || []}
              filter={filter}
              facetRelevance={facetRelevance.data}
              hasFacetRelevance={hasFacetRelevance}
              currentPlayerGenres={currentPlayerGenres}
              highlightedGenres={highlightedGenres}
              listRef={genreListRef}
              surfaceProps={genreSelection.surfaceProps}
              marquee={genreSelection.marquee}
              onReset={() =>
                preservePanelPositions(() =>
                  setFilter((f) => ({ ...f, genres: [] })),
                )
              }
              onSelect={(event, genre) => {
                if (isSearching) {
                  if (!event.ctrlKey && !event.metaKey && !event.shiftKey)
                    void navigateCatalog({ genres: [genre] });
                  return;
                }
                genreSelection.selectFromClick(
                  event,
                  genre,
                  genres.data?.map((item) => item.name) || [],
                );
              }}
              onContextMenu={showGenreMenu}
            />
          )}
          {panelVisibility.genres && renderPanelResizer("genres")}
          <section
            className={`panel artists-panel ${panelVisibility.artists ? "" : "panel-hidden"}`}
            data-panel-id="artists"
          >
            <div className="panel-heading">
              <h2>Исполнители</h2>
              <PanelSelectionIndicator
                total={artists.data?.pages[0]?.total || 0}
                selected={filter.artists.length}
                active={filter.artists.length > 0}
                resetLabel="Сбросить исполнителей"
                onReset={() => {
                  preservePanelPositions(() => {
                    setSelectedArtists([]);
                    setFilter((f) => ({ ...f, artists: [] }));
                  });
                }}
              />
            </div>
            <ArtistList
              items={artistItems}
              total={artists.data?.pages[0]?.total || 0}
              averageGroupSize={artists.data?.pages[0]?.averageGroupSize}
              selected={selectedArtists}
              loading={artists.isFetching || searchPending}
              onSelectionChange={applyArtistSelection}
              onNavigate={(artist) =>
                void navigateCatalog({ artists: [artist] })
              }
              onMore={() => {
                if (
                  !searchPending &&
                  artists.hasNextPage &&
                  !artists.isFetchingNextPage
                )
                  void artists.fetchNextPage();
              }}
              onContextMenu={showCatalogMenu}
              onPlayArtist={(artist) =>
                void player.startFilter({ ...filter, artists: [artist] })
              }
              bookmarkKeys={bookmarkKeys}
              bookmarksUnavailable={bookmarksUnavailable}
              pendingBookmarkKeys={pendingBookmarkKeys}
              onBookmarkChange={changeBookmark}
              currentArtists={currentPlayerArtists}
              scrollTarget={
                artistScrollTarget?.filterKey === filterKey
                  ? artistScrollTarget
                  : null
              }
            />
          </section>
          {panelVisibility.artists && renderPanelResizer("artists")}
        </div>
        <div
          className={`row-resizer ${visibleFacetPanelIds.length && visibleCatalogPanelIds.length ? "" : "row-resizer-hidden"}`}
          role="separator"
          aria-label="Высота строк"
          onPointerDown={resizeRows}
        />
        <div
          className={`workspace-row workspace-catalog ${visibleCatalogPanelIds.length ? "" : "workspace-row-hidden"}`}
        >
          <section
            className={`panel albums-panel ${panelVisibility.albums ? "" : "panel-hidden"}`}
            data-panel-id="albums"
          >
            <div className="panel-heading">
              <h2>Альбомы</h2>
              <PanelSelectionIndicator
                total={albumTotal}
                selected={filter.albumIds.length}
                active={filter.albumIds.length > 0}
                resetLabel="Сбросить альбомы"
                onReset={() => {
                  preservePanelPositions(() => {
                    setSelectedAlbums([]);
                    setFilter((f) => ({ ...f, albumIds: [] }));
                  });
                }}
              />
            </div>
            <AlbumGrid
              albums={albumItems}
              total={albumTotal}
              averageGroupSize={albums.data?.pages[0]?.averageGroupSize}
              selected={selectedAlbums}
              currentAlbumId={currentPlayerTrack?.albumKey ?? null}
              onSelectionChange={applyAlbumSelection}
              onNavigate={(albumId) =>
                void navigateCatalog({ albumIds: [albumId] }, "track")
              }
              onMore={() => {
                if (
                  !searchPending &&
                  albums.hasNextPage &&
                  !albums.isFetchingNextPage
                )
                  void albums.fetchNextPage();
              }}
              loading={albums.isFetching || searchPending}
              onContextMenu={showCatalogMenu}
              onPlay={(id) => void player.startAlbum(id)}
              onSelectArtist={selectAlbumArtist}
              onCoverDrop={prepareDroppedCover}
              bookmarkKeys={bookmarkKeys}
              bookmarksUnavailable={bookmarksUnavailable}
              pendingBookmarkKeys={pendingBookmarkKeys}
              onBookmarkChange={changeBookmark}
              pendingUserStateKeys={pendingUserStateKeys}
              onUserStateChange={changeUserState}
              scrollTarget={
                albumScrollTarget?.filterKey === filterKey
                  ? albumScrollTarget
                  : null
              }
            />
          </section>
          {panelVisibility.albums && renderPanelResizer("albums")}
          <section
            className={`panel tracks-panel ${panelVisibility.tracks ? "" : "panel-hidden"}`}
            data-panel-id="tracks"
          >
            <div className="panel-heading tracks-heading">
              <h2>Треки</h2>
              <PanelSelectionIndicator
                total={total}
                selected={selected.size}
                active={selected.size > 0}
                resetLabel="Сбросить выбор треков"
                onReset={() => {
                  setSelected(new Set());
                  setSelectedAlbumId(null);
                }}
              />
            </div>
            {queryError && (
              <p className="error-text inline-error" role="alert">
                {queryError.message}
              </p>
            )}
            {!libraries.data?.length &&
            libraries.isSuccess &&
            !isSearching &&
            !filter.bookmarksOnly &&
            !filter.libraryIds.length &&
            !filter.folders.length &&
            !filter.genres.length &&
            !filter.artists.length &&
            !filter.albumIds.length ? (
              <div className="welcome">
                <div className="welcome-art">
                  <div className="record">
                    <div />
                  </div>
                  <div className="welcome-note">
                    <Music2 size={29} />
                  </div>
                </div>
                <span className="eyebrow">МЕСТО ДЛЯ ВАШЕЙ МУЗЫКИ</span>
                <h2>
                  Соберите свою
                  <br />
                  коллекцию
                </h2>
                <p>
                  Подключите папку с музыкой.
                  <br />
                  Альбомы, жанры и любимые треки
                  <br />
                  появятся здесь.
                </p>
                <button
                  className="button primary"
                  onClick={() => setModal("add")}
                >
                  <Plus size={17} />
                  Подключить папку
                </button>
                <small>MP3 · FLAC · M4A · AAC · OGG · OPUS · WAV</small>
              </div>
            ) : (
              <TrackList
                tracks={trackItems}
                total={total}
                selected={selected}
                currentId={player.queue?.track?.id}
                loading={tracks.isFetching || searchPending}
                onPlay={(track) => void player.start(track, filter)}
                selectedAlbumId={selectedAlbumId}
                onSelectAlbum={selectCatalogAlbum}
                onSelectionChange={(ids) => {
                  setSelectedAlbumId(null);
                  setSelected(new Set(ids));
                }}
                onMore={() => {
                  if (
                    !searchPending &&
                    tracks.hasNextPage &&
                    !tracks.isFetchingNextPage
                  )
                    void tracks.fetchNextPage();
                }}
                onContextMenu={showCatalogMenu}
                bookmarkKeys={bookmarkKeys}
                bookmarksUnavailable={bookmarksUnavailable}
                pendingBookmarkKeys={pendingBookmarkKeys}
                onBookmarkChange={changeBookmark}
                pendingUserStateKeys={pendingUserStateKeys}
                onUserStateChange={changeUserState}
                bookmarksOnly={filter.bookmarksOnly}
                bookmarkCount={bookmarks.data?.length || 0}
                hasOtherFilters={
                  filter.libraryIds.length > 0 ||
                  filter.folders.length > 0 ||
                  filter.genres.length > 0 ||
                  filter.artists.length > 0 ||
                  filter.albumIds.length > 0 ||
                  Boolean(search)
                }
                onDisableBookmarks={() =>
                  setFilter((current) => ({
                    ...current,
                    bookmarksOnly: false,
                  }))
                }
                onResetBookmarkFilters={() => {
                  setSearch("");
                  setExpandedLibraryIds(new Set());
                  setExpandedFolderKeys(new Set());
                  setFilter({ ...emptyFilter, bookmarksOnly: true });
                }}
                scrollTarget={
                  trackScrollTarget?.filterKey === filterKey
                    ? trackScrollTarget
                    : null
                }
              />
            )}
          </section>
        </div>
      </main>
      {coverMode && player.queue?.track && (
        <CoverMode
          track={player.queue.track}
          playing={player.playing}
          onClose={() => setCoverMode(false)}
          onPlayTrack={(track) => player.startAlbum(track.albumKey, track.id)}
          onUserStateChange={changeUserState}
          pendingUserStateKeys={pendingUserStateKeys}
        />
      )}
      <Player
        player={player}
        onNavigateToAlbum={(albumId, albumArtists) =>
          void navigateFromPlayer(
            "album",
            albumId,
            albumArtists,
            player.queue?.track?.id,
          )
        }
        onNavigateToArtist={(artist) =>
          void navigateFromPlayer("artist", artist)
        }
        coverMode={coverMode}
        onToggleCoverMode={() => {
          if (!player.queue?.track) return;
          setCoverSearch("");
          setCoverMode((current) => !current);
        }}
        onUserStateChange={changeUserState}
        pendingUserStateKeys={pendingUserStateKeys}
      />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <UpdatePanel />
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "add" && (
        <AddLibraryDialog onClose={() => setModal(null)} onAdded={refresh} />
      )}
      {ratingDialog && (
        <RatingPopover
          anchor={{ x: ratingDialog.x, y: ratingDialog.y }}
          rating={ratingDialog.rating}
          pending={ratingDialog.ids.some((id) =>
            pendingUserStateKeys.has(`${ratingDialog.kind}:${id}`),
          )}
          onChoose={(rating) => {
            changeUserState(ratingDialog.kind, ratingDialog.ids, { rating });
            setRatingDialog(null);
          }}
          onClose={() => setRatingDialog(null)}
        />
      )}
      {modal === "rename-library" && libraryToRename && (
        <RenameLibraryDialog
          library={libraryToRename}
          onClose={() => {
            setModal(null);
            setLibraryToRename(null);
          }}
          onRename={async (name) => {
            await api(`/libraries/${libraryToRename.id}/rename`, { name });
            refresh();
          }}
        />
      )}
      {modal === "remove-library" && libraryToRemove && (
        <RemoveLibraryDialog
          library={libraryToRemove}
          onClose={() => {
            setModal(null);
            setLibraryToRemove(null);
          }}
          onRemove={async () => {
            await api(`/libraries/${libraryToRemove.id}/remove`, {});
            setFilter((current) => ({
              ...current,
              libraryIds: current.libraryIds.filter(
                (id) => id !== libraryToRemove.id,
              ),
              folders: current.folders.filter(
                (folder) => folder.libraryId !== libraryToRemove.id,
              ),
            }));
            setExpandedLibraryIds((current) => {
              const next = new Set(current);
              next.delete(libraryToRemove.id);
              return next;
            });
            setExpandedFolderKeys(
              (current) =>
                new Set(
                  [...current].filter(
                    (key) => !key.startsWith(`${libraryToRemove.id}\u0000`),
                  ),
                ),
            );
            refresh();
            notify(`Библиотека «${libraryToRemove.name}» отключается`);
          }}
        />
      )}
      {modal && ["move", "trash", "tags"].includes(modal) && (
        <Suspense fallback={<LazyDialogFallback />}>
          <ActionDialog
            kind={modal as "move" | "trash" | "tags"}
            selection={modalSelection || operationSelection}
            libraries={libraries.data || []}
            capabilities={capabilities}
            folderRoots={folderMoveRoots || undefined}
            onClose={() => {
              setModal(null);
              setModalSelection(null);
              setFolderMoveRoots(null);
            }}
            onPreview={showPreview}
          />
        </Suspense>
      )}
      {modal === "album-merge" && albumMergeSelection && (
        <Suspense fallback={<LazyDialogFallback />}>
          <AlbumMergeDialog
            albumIds={albumMergeSelection.albumIds}
            anchorAlbumId={albumMergeSelection.anchorAlbumId}
            capabilities={capabilities}
            onClose={() => {
              setModal(null);
              setAlbumMergeSelection(null);
            }}
            onPreview={showPreview}
          />
        </Suspense>
      )}
      {modal === "artist-folders" && (
        <Suspense fallback={<LazyDialogFallback />}>
          <ArtistFolderDialog
            artists={artistMoveNames}
            libraries={libraries.data || []}
            onClose={() => {
              setModal(null);
              setArtistMoveNames([]);
            }}
            onContinue={(roots) => {
              setFolderMoveRoots(roots);
              setModalSelection({ filter: { ...emptyFilter, folders: roots } });
              setModal("move");
            }}
          />
        </Suspense>
      )}
      {modal === "history" && (
        <Suspense fallback={<LazyDialogFallback />}>
          <HistoryDialog
            onClose={() => setModal(null)}
            onPreview={showPreview}
            onOperationStarted={watchOperation}
          />
        </Suspense>
      )}
      {modal === "settings" && (
        <Suspense fallback={<LazyDialogFallback />}>
          <AppearanceSettingsDialog
            settings={appearance}
            onChange={updateAppearance}
            scanSettings={scanSettings}
            onScanSettingsChange={setScanSettings}
            onClose={() => setModal(null)}
          />
        </Suspense>
      )}
      {preview && (
        <Suspense fallback={<LazyDialogFallback />}>
          <PreviewDialog
            preview={preview}
            onClose={() => setPreview(null)}
            onExecute={async (id) => {
              const job = await api<Job>(`/operations/${id}/execute`, {});
              watchOperation(id, job);
              setPreview(null);
              setSelected(new Set());
              setSelectedAlbumId(null);
            }}
          />
        </Suspense>
      )}
      {droppedCover && (
        <CoverDropConfirmDialog
          albumTitle={droppedCover.album.title}
          coverName={droppedCover.name}
          trackCount={droppedCover.album.trackCount}
          onClose={() => setDroppedCover(null)}
          onConfirm={applyDroppedCover}
        />
      )}
    </div>
  );
}
