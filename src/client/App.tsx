import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AudioLines,
  Bookmark as BookmarkIcon,
  Check,
  ChevronRight,
  Clock3,
  Disc3,
  Folder,
  FolderOpen,
  FolderInput,
  History,
  ListMusic,
  Music2,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  X,
  Play,
} from "lucide-react";
import {
  emptyFilter,
  type Album,
  type BookmarkKind,
  type Capabilities,
  type CatalogBookmark,
  type CatalogFilter,
  type Job,
  type Library,
  type OperationPreview,
  type Page,
  type Selection,
  type Track,
} from "../shared/contracts";
import {
  api,
  catalogUrl,
  count,
  duration,
  setCsrf,
  reconnectSession,
} from "./api";
import {
  ActionDialog,
  AddLibraryDialog,
  CoverDropConfirmDialog,
  HistoryDialog,
  PreviewDialog,
  RemoveLibraryDialog,
} from "./Dialogs";
import { selectFacetValue } from "./facet-selection";
import { Player, usePlayer } from "./Player";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";

type DroppedCover = {
  album: Album;
  name: string;
  cover: { data: string; mime: "image/jpeg" | "image/png" };
};

function toggle(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

type BookmarkChange = (
  kind: BookmarkKind,
  id: string,
  bookmarked: boolean,
) => void;

const bookmarkEntityLabels: Record<BookmarkKind, string> = {
  artist: "исполнителя",
  album: "альбом",
  track: "трек",
};

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

function BookmarkToggle({
  kind,
  id,
  label,
  bookmarked,
  unavailable,
  pending,
  onChange,
  className = "",
}: {
  kind: BookmarkKind;
  id: string;
  label: string;
  bookmarked: boolean;
  unavailable: boolean;
  pending: boolean;
  onChange: BookmarkChange;
  className?: string;
}) {
  const entity = bookmarkEntityLabels[kind];
  const action = bookmarked
    ? `Удалить ${entity} «${label}» из закладок`
    : `Добавить ${entity} «${label}» в закладки`;
  return (
    <button
      type="button"
      className={`bookmark-toggle ${bookmarked ? "bookmarked" : ""} ${className}`}
      aria-label={action}
      aria-pressed={bookmarked}
      aria-busy={pending || undefined}
      title={action}
      disabled={unavailable || pending}
      onClick={(event) => {
        event.stopPropagation();
        onChange(kind, id, !bookmarked);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {pending ? (
        <RefreshCw size={15} className="spinning" />
      ) : (
        <BookmarkIcon size={16} fill={bookmarked ? "currentColor" : "none"} />
      )}
    </button>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities>({
    writableFormats: [],
    verificationDate: null,
  });
  const [filter, setFilter] = useState<CatalogFilter>(emptyFilter);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allSelected, setAllSelected] = useState(false);
  const [modal, setModal] = useState<
    "add" | "move" | "trash" | "tags" | "history" | "remove-library" | null
  >(null);
  const [libraryToRemove, setLibraryToRemove] = useState<Library | null>(null);
  const [modalSelection, setModalSelection] = useState<Selection | null>(null);
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
  const notify = useCallback((message: string) => setToast(message), []);
  const player = usePlayer(notify);
  const workspaceRef = useRef<HTMLElement>(null);
  const [panelWeights, setPanelWeights] = useState<number[]>(() => {
    try {
      const weights = JSON.parse(
        localStorage.getItem("mml-panel-weights-v1") || "[1.05,0.9,1,1.45,1.6]",
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
    const timer = setTimeout(() => setFilter((f) => ({ ...f, search })), 200);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 9000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setSelected(new Set());
    setAllSelected(false);
  }, [filter]);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (q) =>
        [
          "libraries",
          "genres",
          "artists",
          "albums",
          "tracks",
          "jobs",
          "history",
          "filter-validity",
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
  const changeBookmark = useCallback(
    (kind: BookmarkKind, id: string, bookmarked: boolean) => {
      const key = `${kind}:${id}`;
      if (bookmarksUnavailable || pendingBookmarkKeysRef.current.has(key))
        return;
      const previous = bookmarkKeys.has(key);
      pendingBookmarkKeysRef.current.add(key);
      setPendingBookmarkKeys(new Set(pendingBookmarkKeysRef.current));
      queryClient.setQueryData<CatalogBookmark[]>(["bookmarks"], (current) =>
        updateBookmarkList(current, kind, id, bookmarked),
      );

      bookmarkWriteChain.current = bookmarkWriteChain.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await api<CatalogBookmark[]>("/bookmarks", {
              kind,
              id,
              bookmarked,
            });
            bookmarkCatalogDirty.current = true;
          } catch (error) {
            queryClient.setQueryData<CatalogBookmark[]>(
              ["bookmarks"],
              (current) => updateBookmarkList(current, kind, id, previous),
            );
            notify(error instanceof Error ? error.message : String(error));
          } finally {
            pendingBookmarkKeysRef.current.delete(key);
            setPendingBookmarkKeys(new Set(pendingBookmarkKeysRef.current));
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
          }
        });
    },
    [bookmarkKeys, bookmarksUnavailable, notify, queryClient],
  );
  const showCatalogMenu = useCallback(
    (event: React.MouseEvent, kind: BookmarkKind, id: string) => {
      event.preventDefault();
      const bookmarked = bookmarkKeys.has(`${kind}:${id}`);
      const bookmarkPending = pendingBookmarkKeys.has(`${kind}:${id}`);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: bookmarkPending
              ? "Сохраняем закладку…"
              : bookmarks.isPending
                ? "Закладки загружаются…"
                : bookmarks.isError
                  ? "Закладки недоступны"
                  : bookmarked
                    ? "Удалить из закладок"
                    : "Добавить в закладки",
            icon:
              bookmarkPending || bookmarks.isPending ? (
                <RefreshCw size={16} className="spinning" />
              ) : (
                <BookmarkIcon
                  size={16}
                  fill={bookmarked ? "currentColor" : "none"}
                />
              ),
            disabled: bookmarksUnavailable || bookmarkPending,
            onSelect: () => changeBookmark(kind, id, !bookmarked),
          },
          ...(kind === "album"
            ? [
                {
                  label: "Редактировать теги",
                  icon: <Tag size={16} />,
                  onSelect: () => {
                    setModalSelection({
                      filter: { ...emptyFilter, albumIds: [id] },
                    });
                    setModal("tags");
                  },
                },
              ]
            : []),
          ...(kind !== "artist"
            ? [
                {
                  label: "Открыть в проводнике",
                  icon: <FolderOpen size={16} />,
                  onSelect: async () => {
                    try {
                      await api("/explorer", { kind, id });
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
      changeBookmark,
      notify,
      pendingBookmarkKeys,
    ],
  );
  const showLibraryMenu = useCallback(
    (event: React.MouseEvent, library: Library) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
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
    (id: string) => {
      if (watchedOperations.current.has(id)) return;
      watchedOperations.current.add(id);
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
    [refresh, scheduleRefresh],
  );
  const prepareDroppedCover = useCallback(
    (album: Album, files: File[]) => {
      if (files.length !== 1) {
        notify("Перетащите один файл JPEG или PNG до 10 МБ");
        return;
      }
      const [file] = files;
      if (
        file.size > 10 * 1024 * 1024 ||
        !["image/jpeg", "image/png"].includes(file.type)
      ) {
        notify("Выберите JPEG или PNG до 10 МБ");
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => notify("Не удалось прочитать файл обложки");
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        const data = result.split(",")[1];
        if (!data) {
          notify("Не удалось прочитать файл обложки");
          return;
        }
        setDroppedCover({
          album,
          name: file.name,
          cover: {
            data,
            mime: file.type as "image/jpeg" | "image/png",
          },
        });
      };
      reader.readAsDataURL(file);
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
    await api(`/operations/${operation.id}/execute`, {});
    watchOperation(operation.id);
    setDroppedCover(null);
    notify(
      writable.length === operation.items.length
        ? "Запись обложки запущена. Результат появится в журнале."
        : `Запись обложки запущена для ${count(writable.length)} из ${count(operation.items.length)} треков. Подробности появятся в журнале.`,
    );
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
  const libraries = useQuery({
    queryKey: ["libraries"],
    queryFn: () => api<Library[]>("/libraries"),
    enabled: ready,
  });
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<Job[]>("/jobs"),
    enabled: ready,
  });
  const genreFilter = useMemo(
    () => ({
      ...emptyFilter,
      libraryIds: filter.libraryIds,
      bookmarksOnly: filter.bookmarksOnly,
    }),
    [filter.libraryIds, filter.bookmarksOnly],
  );
  const genres = useQuery({
    queryKey: ["genres", genreFilter],
    queryFn: () =>
      api<{ name: string; count: number }[]>(catalogUrl("genres", genreFilter)),
    enabled: ready,
  });
  const artistFilter = useMemo(
    () => ({
      ...emptyFilter,
      libraryIds: filter.libraryIds,
      genres: filter.genres,
      bookmarksOnly: filter.bookmarksOnly,
    }),
    [filter.libraryIds, filter.genres, filter.bookmarksOnly],
  );
  const artists = useInfiniteQuery({
    queryKey: ["artists", artistFilter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<Page<{ name: string; count: number }>>(
        catalogUrl("artists", artistFilter, pageParam),
      ),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total
        ? last.offset + last.items.length
        : undefined,
    enabled: ready,
  });
  const artistItems = useMemo(
    () => artists.data?.pages.flatMap((p) => p.items) || [],
    [artists.data],
  );
  const valid = useQuery({
    queryKey: ["filter-validity", filter],
    queryFn: () =>
      api<{ albumIds: string[]; artists: string[] }>(
        catalogUrl("filter-validity", filter),
      ),
    enabled: ready && (filter.albumIds.length > 0 || filter.artists.length > 0),
  });
  useEffect(() => {
    if (!genres.data) return;
    const available = new Set(genres.data.map((g) => g.name));
    setFilter((f) => {
      const next = f.genres.filter((g) => available.has(g));
      return next.length === f.genres.length
        ? f
        : { ...f, genres: next, artists: [], albumIds: [] };
    });
  }, [genres.data]);
  useEffect(() => {
    if (!valid.data) return;
    const available = new Set(valid.data.albumIds);
    setFilter((f) => {
      const next = f.albumIds.filter((id) => available.has(id));
      const artists = f.artists.filter((a) => valid.data.artists.includes(a));
      return next.length === f.albumIds.length &&
        artists.length === f.artists.length
        ? f
        : { ...f, albumIds: next, artists };
    });
  }, [valid.data]);
  const albumFilter = useMemo(
    () => ({ ...filter, albumIds: [] }),
    [
      filter.libraryIds,
      filter.genres,
      filter.artists,
      filter.search,
      filter.bookmarksOnly,
    ],
  );
  const albums = useInfiniteQuery({
    queryKey: ["albums", albumFilter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<Page<Album>>(catalogUrl("albums", albumFilter, pageParam, 100)),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total
        ? last.offset + last.items.length
        : undefined,
    enabled: ready,
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
    enabled: ready,
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
  const selection: Selection = allSelected
    ? { filter, excludeTrackIds: [...selected] }
    : { trackIds: [...selected] };
  const selectionCount = allSelected ? total - selected.size : selected.size;
  const activeJobs =
    jobs.data?.filter((j) => ["queued", "running"].includes(j.status)) || [];
  const showPreview = (p: OperationPreview) => {
    setModal(null);
    setModalSelection(null);
    setPreview(p);
  };
  const resize = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    const start = e.clientX;
    const initial = panelWeights;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => {
      const available = Math.max(
        1,
        (workspaceRef.current?.getBoundingClientRect().width || 1) - 16,
      );
      const total = initial.reduce((sum, weight) => sum + weight, 0);
      const pairWeight = initial[index] + initial[index + 1];
      const pairPixels = (pairWeight / total) * available;
      const leftPixels = Math.max(
        110,
        Math.min(
          pairPixels - 110,
          (initial[index] / total) * available + event.clientX - start,
        ),
      );
      setPanelWeights(
        initial.map((weight, currentIndex) => {
          if (currentIndex === index) return (leftPixels / available) * total;
          if (currentIndex === index + 1)
            return ((pairPixels - leftPixels) / available) * total;
          return weight;
        }),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setPanelWeights((current) => {
        localStorage.setItem("mml-panel-weights-v1", JSON.stringify(current));
        return current;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const chooseLibrary = (id: string) =>
    setFilter((f) => ({
      ...f,
      libraryIds: toggle(f.libraryIds, id),
      genres: [],
      artists: [],
      albumIds: [],
    }));
  const chooseGenre = (genre: string, additive: boolean) =>
    setFilter((f) => ({
      ...f,
      genres: selectFacetValue(f.genres, genre, additive),
      artists: [],
      albumIds: [],
    }));
  const queryError =
    libraries.error ||
    genres.error ||
    artists.error ||
    albums.error ||
    tracks.error;
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
  return (
    <div className="app-shell">
      <header className="topbar">
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
          disabled={bookmarks.isFetching || pendingBookmarkKeys.size > 0}
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
            <BookmarkIcon
              size={19}
              fill={filter.bookmarksOnly ? "currentColor" : "none"}
            />
          )}
          <span>Закладки</span>
        </button>
        <button
          className="icon-button history-button"
          aria-label="Журнал операций"
          title="Журнал операций"
          onClick={() => setModal("history")}
        >
          <History size={21} />
        </button>
        <div className="local-status">
          <span />
          На этом компьютере
        </div>
      </header>
      <main
        ref={workspaceRef}
        className="workspace"
        style={
          {
            "--library-weight": `${panelWeights[0]}fr`,
            "--genre-weight": `${panelWeights[1]}fr`,
            "--artist-weight": `${panelWeights[2]}fr`,
            "--album-weight": `${panelWeights[3]}fr`,
            "--track-weight": `${panelWeights[4]}fr`,
          } as CSSProperties
        }
      >
        <aside className="panel libraries-panel">
          <div className="panel-heading">
            <h2>Библиотеки</h2>
          </div>
          <button
            className={`list-all-action ${filter.libraryIds.length === 0 ? "selected" : ""}`}
            onClick={() =>
              setFilter((f) => ({
                ...f,
                libraryIds: [],
                genres: [],
                artists: [],
                albumIds: [],
              }))
            }
          >
            <span>Вся музыка</span>
          </button>
          <div className="library-list">
            {libraries.data?.map((library) => (
              <div key={library.id} className="library-container">
                <button
                  className={`library-row ${filter.libraryIds.includes(library.id) ? "selected" : ""} ${!library.available ? "offline" : ""}`}
                  aria-pressed={filter.libraryIds.includes(library.id)}
                  title={library.path}
                  onClick={() => chooseLibrary(library.id)}
                  onContextMenu={(event) => showLibraryMenu(event, library)}
                >
                  <Folder size={18} />
                  <span>
                    {library.name}
                    <small>
                      {library.available
                        ? `${count(library.trackCount)} треков`
                        : "Папка недоступна"}
                    </small>
                  </span>
                  {filter.libraryIds.includes(library.id) && (
                    <Check size={14} />
                  )}
                </button>
              </div>
            ))}
          </div>
          <button className="add-library" onClick={() => setModal("add")}>
            <Plus size={16} />
            Подключить папку
          </button>
          {activeJobs.length > 0 && (
            <div className="sidebar-bottom">
              {activeJobs.slice(0, 3).map((job) => (
                <div className="scan-status" key={job.id}>
                  <RefreshCw size={14} className="spinning" />
                  <div>
                    <strong>{job.label}</strong>
                    <small>
                      {job.status === "queued"
                        ? "В очереди"
                        : `${count(job.completed)} обработано`}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
        <div
          className="resizer"
          role="separator"
          aria-label="Ширина библиотек"
          onPointerDown={(e) => resize(0, e)}
        />
        <section className="panel genres-panel">
          <div className="panel-heading">
            <h2>Жанры</h2>
            <span className="panel-count">{genres.data?.length || 0}</span>
          </div>
          <button
            className={`list-all-action ${!filter.genres.length ? "selected" : ""}`}
            onClick={() =>
              setFilter((f) => ({
                ...f,
                genres: [],
                artists: [],
                albumIds: [],
              }))
            }
          >
            <span>Все жанры</span>
          </button>
          <div className="genre-list">
            {genres.data?.map((g) => {
              const label = g.name || "Без жанра";
              const checked = filter.genres.includes(g.name);
              return (
                <div
                  key={g.name}
                  className={`genre-row facet-row ${checked ? "selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => chooseGenre(g.name, event.ctrlKey)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      chooseGenre(g.name, event.ctrlKey);
                    }
                  }}
                >
                  <div className="facet-checkbox-zone">
                    <input
                      className="facet-checkbox"
                      type="checkbox"
                      aria-label={`Выбрать жанр: ${label}`}
                      checked={checked}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => chooseGenre(g.name, true)}
                    />
                  </div>
                  <button
                    className="facet-main"
                    aria-pressed={checked}
                    onClick={(event) => {
                      event.stopPropagation();
                      chooseGenre(g.name, event.ctrlKey);
                    }}
                  >
                    <span>{label}</span>
                    <small>{count(g.count)}</small>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <div
          className="resizer"
          role="separator"
          aria-label="Ширина жанров"
          onPointerDown={(e) => resize(1, e)}
        />
        <section className="panel artists-panel">
          <div className="panel-heading">
            <h2>Исполнители альбома</h2>
            <span className="panel-count">
              {count(artists.data?.pages[0]?.total || 0)}
            </span>
          </div>
          <button
            className={`list-all-action ${!filter.artists.length ? "selected" : ""}`}
            onClick={() =>
              setFilter((f) => ({ ...f, artists: [], albumIds: [] }))
            }
          >
            Все исполнители альбома
          </button>
          <ArtistList
            items={artistItems}
            total={artists.data?.pages[0]?.total || 0}
            selected={filter.artists}
            loading={artists.isFetching}
            onSelect={(name, additive) =>
              setFilter((f) => ({
                ...f,
                artists: selectFacetValue(f.artists, name, additive),
                albumIds: [],
              }))
            }
            onMore={() => {
              if (artists.hasNextPage && !artists.isFetchingNextPage)
                void artists.fetchNextPage();
            }}
            onContextMenu={showCatalogMenu}
            bookmarkKeys={bookmarkKeys}
            bookmarksUnavailable={bookmarksUnavailable}
            pendingBookmarkKeys={pendingBookmarkKeys}
            onBookmarkChange={changeBookmark}
          />
        </section>
        <div
          className="resizer"
          role="separator"
          aria-label="Ширина исполнителей альбома"
          onPointerDown={(e) => resize(2, e)}
        />
        <section className="panel albums-panel">
          <div className="panel-heading">
            <h2>Альбомы</h2>
            <span className="panel-count">{count(albumTotal)}</span>
          </div>
          <button
            className={`list-all-action ${!filter.albumIds.length ? "selected" : ""}`}
            onClick={() => setFilter((f) => ({ ...f, albumIds: [] }))}
          >
            <span>Все альбомы</span>
          </button>
          <AlbumGrid
            albums={albumItems}
            total={albumTotal}
            selected={filter.albumIds}
            onSelect={(id, additive) =>
              setFilter((f) => ({
                ...f,
                albumIds: selectFacetValue(f.albumIds, id, additive),
              }))
            }
            onMore={() => {
              if (albums.hasNextPage && !albums.isFetchingNextPage)
                void albums.fetchNextPage();
            }}
            loading={albums.isFetching}
            onContextMenu={showCatalogMenu}
            onPlay={(id) => void player.startAlbum(id)}
            onCoverDrop={prepareDroppedCover}
            bookmarkKeys={bookmarkKeys}
            bookmarksUnavailable={bookmarksUnavailable}
            pendingBookmarkKeys={pendingBookmarkKeys}
            onBookmarkChange={changeBookmark}
          />
        </section>
        <div
          className="resizer"
          role="separator"
          aria-label="Ширина альбомов"
          onPointerDown={(e) => resize(3, e)}
        />
        <section className="panel tracks-panel">
          <div className="panel-heading tracks-heading">
            <div>
              <h2>
                {selectionCount ? `Выбрано: ${count(selectionCount)}` : "Треки"}
              </h2>
              <span className="panel-count">{count(total)}</span>
            </div>
            <button
              className="button primary small"
              disabled={!trackItems.length}
              onClick={() => void player.start(trackItems[0], filter)}
            >
              <Play size={13} fill="currentColor" />
              Слушать
            </button>
          </div>
          <div className="track-toolbar">
            <button
              className={`list-all-action ${allSelected && !selected.size ? "selected" : ""}`}
              aria-label="Выбрать все треки"
              aria-pressed={allSelected && !selected.size}
              disabled={!total}
              onClick={() => {
                setAllSelected((current) => !current);
                setSelected(new Set());
              }}
            >
              Выбрать все
            </button>
            <div className="toolbar-actions">
              <button
                className="icon-button"
                aria-label="Редактировать теги"
                title="Редактировать теги"
                disabled={!selectionCount}
                onClick={() => {
                  setModalSelection(null);
                  setModal("tags");
                }}
              >
                <Tag size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Перенести треки"
                title="Перенести в библиотеку"
                disabled={!selectionCount}
                onClick={() => {
                  setModalSelection(null);
                  setModal("move");
                }}
              >
                <FolderInput size={17} />
              </button>
              <button
                className="icon-button danger"
                aria-label="Удалить треки"
                title="Удалить с возможностью восстановления"
                disabled={!selectionCount}
                onClick={() => {
                  setModalSelection(null);
                  setModal("trash");
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          {queryError && (
            <p className="error-text inline-error" role="alert">
              {queryError.message}
            </p>
          )}
          {!libraries.data?.length && ready ? (
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
              allSelected={allSelected}
              currentId={player.queue?.track?.id}
              playing={player.playing}
              loading={tracks.isFetching}
              onPlay={(track) => void player.start(track, filter)}
              onSelect={(id) =>
                setSelected((s) => {
                  const next = new Set(s);
                  next.has(id) ? next.delete(id) : next.add(id);
                  return next;
                })
              }
              onMore={() => {
                if (tracks.hasNextPage && !tracks.isFetchingNextPage)
                  void tracks.fetchNextPage();
              }}
              onContextMenu={showCatalogMenu}
              bookmarkKeys={bookmarkKeys}
              bookmarksUnavailable={bookmarksUnavailable}
              pendingBookmarkKeys={pendingBookmarkKeys}
              onBookmarkChange={changeBookmark}
              bookmarksOnly={filter.bookmarksOnly}
              bookmarkCount={bookmarks.data?.length || 0}
              hasOtherFilters={
                filter.libraryIds.length > 0 ||
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
                setFilter({ ...emptyFilter, bookmarksOnly: true });
              }}
            />
          )}
          <div className="catalog-footer">
            <ListMusic size={13} />
            <span>{count(total)} треков</span>
            <span className="footer-dot">·</span>
            <span>{count(albumTotal)} альбомов</span>
            {(filter.libraryIds.length > 0 ||
              filter.genres.length > 0 ||
              filter.artists.length > 0 ||
              filter.albumIds.length > 0 ||
              filter.bookmarksOnly ||
              search) && (
              <button
                className="text-button"
                onClick={() => {
                  setFilter(emptyFilter);
                  setSearch("");
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        </section>
      </main>
      <Player player={player} />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
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
              genres: [],
              artists: [],
              albumIds: [],
            }));
            refresh();
            notify(`Библиотека «${libraryToRemove.name}» отключается`);
          }}
        />
      )}
      {modal && ["move", "trash", "tags"].includes(modal) && (
        <ActionDialog
          kind={modal as "move" | "trash" | "tags"}
          selection={modalSelection || selection}
          libraries={libraries.data || []}
          capabilities={capabilities}
          onClose={() => {
            setModal(null);
            setModalSelection(null);
          }}
          onPreview={showPreview}
        />
      )}
      {modal === "history" && (
        <HistoryDialog
          onClose={() => setModal(null)}
          onPreview={showPreview}
          onOperationStarted={watchOperation}
        />
      )}
      {preview && (
        <PreviewDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onExecute={async (id) => {
            await api(`/operations/${id}/execute`, {});
            watchOperation(id);
            setPreview(null);
            setSelected(new Set());
            setAllSelected(false);
            notify("Операция запущена. Результат появится в журнале.");
          }}
        />
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

function ArtistList({
  items,
  total,
  selected,
  loading,
  onSelect,
  onMore,
  onContextMenu,
  bookmarkKeys,
  bookmarksUnavailable,
  pendingBookmarkKeys,
  onBookmarkChange,
}: {
  items: { name: string; count: number }[];
  total: number;
  selected: string[];
  loading: boolean;
  onSelect: (name: string, additive: boolean) => void;
  onMore: () => void;
  onContextMenu: (
    event: React.MouseEvent,
    kind: BookmarkKind,
    id: string,
  ) => void;
  bookmarkKeys: Set<string>;
  bookmarksUnavailable: boolean;
  pendingBookmarkKeys: Set<string>;
  onBookmarkChange: BookmarkChange;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: items.length + (items.length < total ? 1 : 0),
    getScrollElement: () => ref.current,
    estimateSize: () => 48,
    overscan: 6,
  });
  const visible = virtual.getVirtualItems();
  const last = visible.at(-1)?.index ?? 0;
  useEffect(() => {
    if (last >= items.length - 5 && items.length < total && !loading) onMore();
  }, [last, items.length, total, loading, onMore]);
  return (
    <div className="artist-scroll" ref={ref}>
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {visible.map((row) => {
          const item = items[row.index];
          if (!item) return null;
          const label = item.name || "Без исполнителя";
          const checked = selected.includes(item.name);
          return (
            <div
              key={item.name}
              className={`genre-row facet-row artist-row ${checked ? "selected" : ""}`}
              title={label}
              role="button"
              tabIndex={0}
              onClick={(event) => onSelect(item.name, event.ctrlKey)}
              onContextMenu={(event) =>
                onContextMenu(event, "artist", item.name)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(item.name, event.ctrlKey);
                }
              }}
              style={{
                position: "absolute",
                top: 0,
                transform: `translateY(${row.start}px)`,
                height: 44,
              }}
            >
              <div className="facet-checkbox-zone">
                <input
                  className="facet-checkbox"
                  type="checkbox"
                  aria-label={`Выбрать исполнителя альбома: ${label}`}
                  checked={checked}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => onSelect(item.name, true)}
                />
              </div>
              <button
                className="facet-main"
                aria-pressed={checked}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(item.name, event.ctrlKey);
                }}
              >
                <span>{label}</span>
                <small>{count(item.count)}</small>
              </button>
              <BookmarkToggle
                kind="artist"
                id={item.name}
                label={label}
                bookmarked={bookmarkKeys.has(`artist:${item.name}`)}
                unavailable={bookmarksUnavailable}
                pending={pendingBookmarkKeys.has(`artist:${item.name}`)}
                onChange={onBookmarkChange}
                className="artist-bookmark-toggle"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlbumGrid({
  albums,
  total,
  selected,
  onSelect,
  onMore,
  loading,
  onContextMenu,
  onPlay,
  onCoverDrop,
  bookmarkKeys,
  bookmarksUnavailable,
  pendingBookmarkKeys,
  onBookmarkChange,
}: {
  albums: Album[];
  total: number;
  selected: string[];
  onSelect: (id: string, additive: boolean) => void;
  onMore: () => void;
  loading: boolean;
  onContextMenu: (
    event: React.MouseEvent,
    kind: BookmarkKind,
    id: string,
  ) => void;
  onPlay: (id: string) => void;
  onCoverDrop: (album: Album, files: File[]) => void;
  bookmarkKeys: Set<string>;
  bookmarksUnavailable: boolean;
  pendingBookmarkKeys: Set<string>;
  onBookmarkChange: BookmarkChange;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(330);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(1, Math.floor((width - 20) / 144));
  const cellWidth = (width - 28 - (columns - 1) * 14) / columns;
  const rows = Math.ceil(albums.length / columns);
  const virtual = useVirtualizer({
    count: rows + (albums.length < total ? 1 : 0),
    getScrollElement: () => ref.current,
    estimateSize: () => cellWidth + 88,
    overscan: 3,
  });
  const visible = virtual.getVirtualItems();
  const last = visible.at(-1)?.index ?? 0;
  useEffect(() => {
    if (last >= rows - 3 && albums.length < total && !loading) onMore();
  }, [last, rows, albums.length, total, loading, onMore]);
  useEffect(() => {
    virtual.measure();
  }, [cellWidth]);
  return (
    <div ref={ref} className="album-scroll">
      {!albums.length ? (
        <div className="empty-small">
          <Disc3 size={30} />
          <p>{loading ? "Загружаем альбомы…" : "Альбомов пока нет"}</p>
        </div>
      ) : (
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {visible.map((row) => (
            <div
              key={row.key}
              className="album-grid-row"
              style={{
                position: "absolute",
                width: "100%",
                transform: `translateY(${row.start}px)`,
                gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
              }}
            >
              {albums
                .slice(row.index * columns, (row.index + 1) * columns)
                .map((album) => (
                  <div
                    key={album.id}
                    className={`album-card ${selected.includes(album.id) ? "selected" : ""}`}
                    title={`${album.title || "Без альбома"} · ${album.artists.join(", ")}`}
                    onContextMenu={(event) =>
                      onContextMenu(event, "album", album.id)
                    }
                  >
                    <BookmarkToggle
                      kind="album"
                      id={album.id}
                      label={album.title || "Без альбома"}
                      bookmarked={bookmarkKeys.has(`album:${album.id}`)}
                      unavailable={bookmarksUnavailable}
                      pending={pendingBookmarkKeys.has(`album:${album.id}`)}
                      onChange={onBookmarkChange}
                      className="album-bookmark-toggle"
                    />
                    <button
                      className="album-main"
                      aria-pressed={selected.includes(album.id)}
                      onClick={(event) => onSelect(album.id, event.ctrlKey)}
                    >
                      <div
                        className={`album-cover ${dropTarget === album.id ? "drop-target" : ""}`}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          setDropTarget(album.id);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDragLeave={(event) => {
                          if (
                            !event.currentTarget.contains(
                              event.relatedTarget as Node,
                            )
                          )
                            setDropTarget(null);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          setDropTarget(null);
                          onCoverDrop(
                            album,
                            Array.from(event.dataTransfer.files),
                          );
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          onPlay(album.id);
                        }}
                        style={
                          {
                            "--cover-hue":
                              parseInt(album.id.slice(0, 4), 16) % 360,
                          } as CSSProperties
                        }
                      >
                        {album.coverId ? (
                          <img
                            loading="lazy"
                            src={`/api/covers/${album.coverId}`}
                            alt=""
                          />
                        ) : (
                          <div className="cover-placeholder">
                            <Disc3 strokeWidth={0.6} />
                            <span>{album.title?.slice(0, 1) || "♪"}</span>
                          </div>
                        )}
                        <span className="album-track-count">
                          {album.trackCount} тр.
                        </span>
                        {dropTarget === album.id && (
                          <span className="album-cover-drop-hint">
                            Отпустите обложку
                          </span>
                        )}
                      </div>
                      <strong>{album.title || "Без альбома"}</strong>
                      <small>
                        {album.artists.join(", ") || "Неизвестный исполнитель"}
                      </small>
                      {album.year && (
                        <small className="album-year">{album.year}</small>
                      )}
                    </button>
                    <label className="album-selection">
                      <input
                        type="checkbox"
                        aria-label={`Выбрать альбом: ${album.title || "Без альбома"}`}
                        checked={selected.includes(album.id)}
                        onChange={() => onSelect(album.id, true)}
                      />
                    </label>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrackList({
  tracks,
  total,
  selected,
  allSelected,
  currentId,
  playing,
  loading,
  onPlay,
  onSelect,
  onMore,
  onContextMenu,
  bookmarkKeys,
  bookmarksUnavailable,
  pendingBookmarkKeys,
  onBookmarkChange,
  bookmarksOnly,
  bookmarkCount,
  hasOtherFilters,
  onDisableBookmarks,
  onResetBookmarkFilters,
}: {
  tracks: Track[];
  total: number;
  selected: Set<string>;
  allSelected: boolean;
  currentId?: string;
  playing: boolean;
  loading: boolean;
  onPlay: (track: Track) => void;
  onSelect: (id: string) => void;
  onMore: () => void;
  onContextMenu: (
    event: React.MouseEvent,
    kind: BookmarkKind,
    id: string,
  ) => void;
  bookmarkKeys: Set<string>;
  bookmarksUnavailable: boolean;
  pendingBookmarkKeys: Set<string>;
  onBookmarkChange: BookmarkChange;
  bookmarksOnly: boolean;
  bookmarkCount: number;
  hasOtherFilters: boolean;
  onDisableBookmarks: () => void;
  onResetBookmarkFilters: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const result: (
      { type: "album"; track: Track } | { type: "track"; track: Track }
    )[] = [];
    let last = "";
    for (const track of tracks) {
      if (last !== track.albumKey) result.push({ type: "album", track });
      result.push({ type: "track", track });
      last = track.albumKey;
    }
    return result;
  }, [tracks]);
  const virtual = useVirtualizer({
    count: rows.length + (tracks.length < total ? 1 : 0),
    getScrollElement: () => ref.current,
    estimateSize: (index) => (rows[index]?.type === "album" ? 98 : 52),
    overscan: 8,
  });
  const visible = virtual.getVirtualItems();
  const last = visible.at(-1)?.index ?? 0;
  useEffect(() => {
    if (last >= rows.length - 10 && tracks.length < total && !loading) onMore();
  }, [last, rows.length, tracks.length, total, loading, onMore]);
  return (
    <div ref={ref} className="track-scroll" aria-label="Список треков">
      {!tracks.length ? (
        <div className="empty-small track-empty">
          {bookmarksOnly && !loading ? (
            <BookmarkIcon size={30} />
          ) : (
            <Search size={30} />
          )}
          <h3>
            {loading
              ? "Загружаем музыку…"
              : bookmarksOnly && bookmarkCount === 0
                ? "В закладках пока пусто"
                : bookmarksOnly
                  ? "В закладках ничего не найдено"
                  : "Треки не найдены"}
          </h3>
          <p>
            {loading
              ? "Каталог появится по мере сканирования."
              : bookmarksOnly && bookmarkCount === 0
                ? "Отключите фильтр и добавьте артиста, альбом или трек с помощью значка закладки."
                : bookmarksOnly
                  ? hasOtherFilters
                    ? "Текущие фильтры скрывают сохранённую музыку."
                    : "Сохранённая музыка сейчас недоступна в каталоге."
                  : "Выберите другие фильтры или обновите библиотеку."}
          </p>
          {!loading && bookmarksOnly && (
            <button
              className="button secondary small"
              onClick={
                bookmarkCount === 0 || !hasOtherFilters
                  ? onDisableBookmarks
                  : onResetBookmarkFilters
              }
            >
              {bookmarkCount === 0 || !hasOtherFilters
                ? "Показать всю музыку"
                : "Сбросить остальные фильтры"}
            </button>
          )}
        </div>
      ) : (
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {visible.map((row) => {
            const entry = rows[row.index];
            if (!entry)
              return (
                <div
                  key="loading"
                  style={{
                    position: "absolute",
                    transform: `translateY(${row.start}px)`,
                  }}
                  className="loading-row"
                >
                  Загружаем…
                </div>
              );
            const track = entry.track;
            return entry.type === "album" ? (
              <div
                key={`album-${track.albumKey}`}
                className="track-album-header"
                onContextMenu={(event) =>
                  onContextMenu(event, "album", track.albumKey)
                }
                style={{
                  position: "absolute",
                  width: "100%",
                  height: row.size,
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <div className="tiny-cover">
                  {track.coverId ? (
                    <img src={`/api/covers/${track.coverId}`} alt="" />
                  ) : (
                    <Disc3 size={20} />
                  )}
                </div>
                <div>
                  <strong>{track.albumTitle || "Без альбома"}</strong>
                  <small>
                    {track.albumArtists.join(", ") || "Неизвестный исполнитель"}
                    {track.year ? ` · ${track.year}` : ""}
                  </small>
                </div>
                <BookmarkToggle
                  kind="album"
                  id={track.albumKey}
                  label={track.albumTitle || "Без альбома"}
                  bookmarked={bookmarkKeys.has(`album:${track.albumKey}`)}
                  unavailable={bookmarksUnavailable}
                  pending={pendingBookmarkKeys.has(`album:${track.albumKey}`)}
                  onChange={onBookmarkChange}
                  className="track-album-bookmark-toggle"
                />
                <ChevronRight size={15} />
              </div>
            ) : (
              <div
                key={track.id}
                data-testid="track-row"
                data-format={track.format}
                className={`track-row ${(allSelected ? !selected.has(track.id) : selected.has(track.id)) ? "selected" : ""} ${currentId === track.id ? "current" : ""}`}
                style={{
                  position: "absolute",
                  width: "100%",
                  height: row.size,
                  transform: `translateY(${row.start}px)`,
                }}
                onDoubleClick={() => onPlay(track)}
                onContextMenu={(event) =>
                  onContextMenu(event, "track", track.id)
                }
              >
                <input
                  type="checkbox"
                  aria-label={`Выбрать ${track.title}`}
                  checked={
                    allSelected
                      ? !selected.has(track.id)
                      : selected.has(track.id)
                  }
                  onChange={() => onSelect(track.id)}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
                <button
                  className="track-number"
                  aria-label={`Слушать ${track.title}`}
                  onClick={() => onPlay(track)}
                >
                  {currentId === track.id && playing ? (
                    <AudioLines size={15} />
                  ) : (
                    <>
                      <span>{track.trackNumber || "—"}</span>
                      <Play
                        size={13}
                        className="row-play"
                        fill="currentColor"
                      />
                    </>
                  )}
                </button>
                <div className="track-copy">
                  <strong title={track.title}>{track.title}</strong>
                </div>
                <BookmarkToggle
                  kind="track"
                  id={track.id}
                  label={track.title}
                  bookmarked={bookmarkKeys.has(`track:${track.id}`)}
                  unavailable={bookmarksUnavailable}
                  pending={pendingBookmarkKeys.has(`track:${track.id}`)}
                  onChange={onBookmarkChange}
                  className="track-bookmark-toggle"
                />
                <span className="track-duration">
                  {duration(track.duration)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
