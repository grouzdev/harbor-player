import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { emptyFilter, type CatalogFilter } from "../shared/contracts";

const panelIds = ["libraries", "genres", "artists", "albums", "tracks"];
const catalogQueries = new Set([
  "libraries",
  "library-folders",
  "genres",
  "artists",
  "albums",
  "tracks",
]);
const panelSurface = (id: string) =>
  document.querySelector<HTMLElement>(
    `[data-panel-id="${id}"] .selection-surface`,
  );
type PanelPosition = {
  id: string;
  top: number;
  left: number;
  anchorKey?: string;
};

export type CatalogPanelId =
  "libraries" | "genres" | "artists" | "albums" | "tracks";

export function filterForCatalogPanel(
  filter: CatalogFilter,
  panel: CatalogPanelId,
): CatalogFilter {
  if (filter.search.trim()) return filter;
  const withoutPersonal = {
    ...filter,
    albumRatingMin: null,
    albumRatingMax: null,
    albumUnrated: false,
    albumViewed: "all" as const,
    trackRatingMin: null,
    trackRatingMax: null,
    trackUnrated: false,
  };
  if (panel === "libraries") return emptyFilter;
  if (panel === "genres")
    return { ...withoutPersonal, genres: [], artists: [], albumIds: [] };
  if (panel === "artists")
    return { ...withoutPersonal, artists: [], albumIds: [] };
  if (panel === "albums")
    return {
      ...filter,
      albumIds: [],
      trackRatingMin: null,
      trackRatingMax: null,
      trackUnrated: false,
    };
  return {
    ...filter,
    albumRatingMin: null,
    albumRatingMax: null,
    albumUnrated: false,
    albumViewed: "all",
  };
}

export function effectiveCatalogFilter(
  saved: CatalogFilter,
  search: string,
): CatalogFilter {
  return search.trim() ? { ...emptyFilter, search: search.trim() } : saved;
}

export function useCatalogBrowsing() {
  const queryClient = useQueryClient();
  const [savedFilter, setSavedFilter] = useState<CatalogFilter>(emptyFilter);
  const [search, setSearchText] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [selectedAlbums, setSelectedAlbums] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [expandedLibraryIds, setExpandedLibraryIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<Set<string>>(
    new Set(),
  );
  const isSearching = Boolean(search.trim());
  const searchPending = isSearching && settledSearch !== search.trim();
  const filter = useMemo(
    () => effectiveCatalogFilter(savedFilter, search),
    [savedFilter, search],
  );
  const snapshot = useRef<{
    selectedArtists: string[];
    selectedAlbums: string[];
    selected: Set<string>;
    selectedAlbumId: string | null;
    expandedLibraryIds: Set<string>;
    expandedFolderKeys: Set<string>;
    positions: PanelPosition[];
    queries: { key: QueryKey; data: unknown; updatedAt: number }[];
  } | null>(null);
  const restorePositions = useRef<
    NonNullable<typeof snapshot.current>["positions"] | null
  >(null);
  const [navigationEpoch, setNavigationEpoch] = useState(0);
  const panelPositions = useCallback(
    (anchors: Partial<Record<CatalogPanelId, string>> = {}) =>
      panelIds.flatMap((id) => {
        const node = panelSurface(id);
        return node
          ? [
              {
                id,
                top: node.scrollTop,
                left: node.scrollLeft,
                anchorKey: anchors[id as CatalogPanelId],
              },
            ]
          : [];
      }),
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setSelected(new Set());
  }, [savedFilter]);

  const replaceFilter = useCallback((next: CatalogFilter) => {
    snapshot.current = null;
    restorePositions.current = null;
    setSearchText("");
    setSettledSearch("");
    setSavedFilter(next);
    setSelectedArtists(next.artists);
    setSelectedAlbums(next.albumIds);
    setNavigationEpoch((value) => value + 1);
  }, []);

  const setFilter = useCallback(
    (update: SetStateAction<CatalogFilter>) => {
      if (!isSearching) setSavedFilter(update);
    },
    [isSearching],
  );

  const setSearch = useCallback(
    (text: string) => {
      const nextSearching = Boolean(text.trim());
      if (nextSearching && !isSearching) {
        snapshot.current = {
          selectedArtists,
          selectedAlbums,
          selected,
          selectedAlbumId,
          expandedLibraryIds,
          expandedFolderKeys,
          positions: panelPositions(),
          queries: queryClient
            .getQueryCache()
            .findAll()
            .filter(
              (query) =>
                catalogQueries.has(String(query.queryKey[0])) &&
                query.getObserversCount() > 0 &&
                query.state.data !== undefined,
            )
            .map((query) => ({
              key: query.queryKey,
              data: query.state.data,
              updatedAt: query.state.dataUpdatedAt,
            })),
        };
        setSelectedArtists([]);
        setSelectedAlbums([]);
        setSelected(new Set());
        setSelectedAlbumId(null);
      } else if (!nextSearching && isSearching && snapshot.current) {
        const saved = snapshot.current;
        for (const query of saved.queries) {
          if (queryClient.getQueryData(query.key) === undefined)
            queryClient.setQueryData(query.key, query.data, {
              updatedAt: query.updatedAt,
            });
        }
        setSelectedArtists(saved.selectedArtists);
        setSelectedAlbums(saved.selectedAlbums);
        setSelected(saved.selected);
        setSelectedAlbumId(saved.selectedAlbumId);
        setExpandedLibraryIds(saved.expandedLibraryIds);
        setExpandedFolderKeys(saved.expandedFolderKeys);
        restorePositions.current = saved.positions;
        snapshot.current = null;
      } else if (nextSearching && text.trim() !== search.trim()) {
        setSelectedArtists([]);
        setSelectedAlbums([]);
        setSelected(new Set());
        setSelectedAlbumId(null);
      }
      if (nextSearching) restorePositions.current = null;
      setNavigationEpoch((value) => value + 1);
      setSearchText(text);
    },
    [
      isSearching,
      search,
      selectedArtists,
      selectedAlbums,
      selected,
      selectedAlbumId,
      expandedLibraryIds,
      expandedFolderKeys,
      queryClient,
      panelPositions,
    ],
  );

  // Cached pages are retained in the snapshot even if a long search lets them expire.
  // Allow the virtualizers and folder queries to lay out before restoring offsets.
  useEffect(() => {
    if (!restorePositions.current) return;
    let frame = 0;
    let stableFrames = 0;
    let settledFrames = 0;
    const restore = () => {
      const positions = restorePositions.current;
      if (!positions) return;
      let complete = true;
      for (const position of positions) {
        const node = panelSurface(position.id);
        if (!node) continue;
        const anchor = position.anchorKey
          ? [
              ...node.querySelectorAll<HTMLElement>("[data-selection-key]"),
            ].find((item) => item.dataset.selectionKey === position.anchorKey)
          : undefined;
        if (anchor) {
          const box = node.getBoundingClientRect();
          const item = anchor.getBoundingClientRect();
          node.scrollTo({
            top:
              node.scrollTop +
              item.top -
              box.top -
              (node.clientHeight - item.height) / 2,
            left: position.left,
            behavior: "instant",
          });
        } else
          node.scrollTo({
            top: position.top,
            left: position.left,
            behavior: "instant",
          });
        if (!anchor && Math.abs(node.scrollTop - position.top) > 1)
          complete = false;
      }
      const fetching = queryClient.isFetching({
        predicate: (query) => catalogQueries.has(String(query.queryKey[0])),
      });
      settledFrames = fetching ? 0 : settledFrames + 1;
      // A rescan or a resized viewport may make the old offset unreachable.
      if (settledFrames >= 10) complete = true;
      stableFrames = complete ? stableFrames + 1 : 0;
      if (stableFrames >= 3) restorePositions.current = null;
      else frame = requestAnimationFrame(restore);
    };
    frame = requestAnimationFrame(restore);
    const cancel = () => {
      restorePositions.current = null;
    };
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("wheel", cancel, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("wheel", cancel, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, [navigationEpoch, queryClient]);

  const filterBySelection = useCallback(
    (kind: "artist" | "album", ids: string[]) => {
      snapshot.current = null;
      restorePositions.current = null;
      setSearchText("");
      setSettledSearch("");
      setSavedFilter((current) => ({
        ...(isSearching ? emptyFilter : current),
        [kind === "artist" ? "artists" : "albumIds"]: ids,
      }));
      if (kind === "artist") setSelectedArtists(ids);
      else setSelectedAlbums(ids);
      if (isSearching) {
        setExpandedLibraryIds(new Set());
        setExpandedFolderKeys(new Set());
      }
      setSelected(new Set());
      setSelectedAlbumId(null);
      setNavigationEpoch((value) => value + 1);
    },
    [isSearching],
  );

  const preservePanelPositions = useCallback(
    (
      update: () => void,
      anchors: Partial<Record<CatalogPanelId, string>> = {},
    ) => {
      restorePositions.current = panelPositions(anchors);
      update();
      setNavigationEpoch((value) => value + 1);
    },
    [panelPositions],
  );

  return {
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
  };
}
