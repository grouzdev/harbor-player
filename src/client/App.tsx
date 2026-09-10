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
  Check,
  ChevronRight,
  Clock3,
  Disc3,
  Folder,
  FolderInput,
  History,
  LibraryBig,
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
  type Capabilities,
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
  HistoryDialog,
  PreviewDialog,
} from "./Dialogs";
import { Player, usePlayer } from "./Player";

function toggle(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
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
    "add" | "move" | "trash" | "tags" | "history" | null
  >(null);
  const [preview, setPreview] = useState<OperationPreview | null>(null);
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => setToast(message), []);
  const player = usePlayer(notify);
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const w = JSON.parse(
        localStorage.getItem("mml-widths-v2") || "[200,160,170,500]",
      );
      return Array.isArray(w) &&
        w.length === 4 &&
        w.every(
          (n: unknown) =>
            typeof n === "number" && Number.isFinite(n) && n >= 150 && n <= 600,
        )
        ? w
        : [200, 160, 170, 500];
    } catch {
      return [200, 160, 170, 500];
    }
  });
  const pendingRefresh = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
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
        ].includes(String(q.queryKey[0])),
    });
  }, [queryClient]);
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
      if (
        event.type === "catalog" ||
        (event.type === "job" && event.job.completed % 100 === 0)
      ) {
        if (!pendingRefresh.current)
          pendingRefresh.current = setTimeout(() => {
            pendingRefresh.current = undefined;
            refresh();
          }, 500);
      }
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
  }, [ready, queryClient, notify, refresh]);
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
    () => ({ ...emptyFilter, libraryIds: filter.libraryIds }),
    [filter.libraryIds],
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
    }),
    [filter.libraryIds, filter.genres],
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
    [filter.libraryIds, filter.genres, filter.artists, filter.search],
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
    setPreview(p);
  };
  const resize = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    const start = e.clientX;
    const initial = widths[index];
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) =>
      setWidths((current) =>
        current.map((n, i) =>
          i === index
            ? Math.max(
                index === 3 ? 400 : 150,
                Math.min(
                  index === 3 ? 750 : 320,
                  initial + event.clientX - start,
                ),
              )
            : n,
        ),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setWidths((current) => {
        localStorage.setItem("mml-widths-v2", JSON.stringify(current));
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
  const chooseGenre = (genre: string) =>
    setFilter((f) => ({
      ...f,
      genres: toggle(f.genres, genre),
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
        <a className="brand" href="/" aria-label="MyMusicLib">
          <span className="brand-icon">
            <AudioLines size={24} />
          </span>
          <span>
            my<span className="brand-light">music</span>lib
            <span className="brand-dot">.</span>
          </span>
        </a>
        <div className="page-heading">
          <div className="eyebrow">ВАША ЛИЧНАЯ КОЛЛЕКЦИЯ</div>
          <h1>Медиатека</h1>
        </div>
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Поиск музыки"
            placeholder="Треки, исполнители, альбомы"
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
        className="workspace"
        style={
          {
            "--library-width": `${widths[0]}px`,
            "--genre-width": `${widths[1]}px`,
            "--artist-width": `${widths[2]}px`,
            "--album-width": `${widths[3]}px`,
          } as CSSProperties
        }
      >
        <aside className="panel libraries-panel">
          <div className="panel-heading">
            <h2>Библиотеки</h2>
            <button
              className="icon-button"
              aria-label="Добавить библиотеку"
              title="Добавить библиотеку"
              onClick={() => setModal("add")}
            >
              <Plus size={17} />
            </button>
          </div>
          <button
            className={`library-row all-libraries ${filter.libraryIds.length === 0 ? "selected" : ""}`}
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
            <LibraryBig size={19} />
            <span>Вся музыка</span>
            <small>
              {count(
                libraries.data?.reduce((n, l) => n + l.trackCount, 0) || 0,
              )}
            </small>
          </button>
          <div className="section-label">ПОДКЛЮЧЁННЫЕ ПАПКИ</div>
          <div className="library-list">
            {libraries.data?.map((library) => (
              <div key={library.id} className="library-container">
                <button
                  className={`library-row ${filter.libraryIds.includes(library.id) ? "selected" : ""} ${!library.available ? "offline" : ""}`}
                  aria-pressed={filter.libraryIds.includes(library.id)}
                  title={library.path}
                  onClick={() => chooseLibrary(library.id)}
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
                <button
                  className="rescan icon-button"
                  aria-label={`Обновить ${library.name}`}
                  title="Перечитать файлы и обложки"
                  onClick={() =>
                    api(`/libraries/${library.id}/scan`, { force: true })
                      .then(refresh)
                      .catch((e) => notify(e.message))
                  }
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            ))}
          </div>
          <button className="add-library" onClick={() => setModal("add")}>
            <Plus size={16} />
            Подключить папку
          </button>
          <div className="sidebar-bottom">
            {activeJobs.length ? (
              activeJobs.slice(0, 3).map((job) => (
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
              ))
            ) : (
              <>
                <span className="offline-label">
                  <span />
                  Всё хранится у вас
                </span>
                <p>
                  Музыка и теги остаются
                  <br />
                  на вашем компьютере.
                </p>
              </>
            )}
          </div>
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
            className={`genre-row ${!filter.genres.length ? "selected" : ""}`}
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
            {genres.data?.map((g) => (
              <button
                key={g.name}
                className={`genre-row ${filter.genres.includes(g.name) ? "selected" : ""}`}
                aria-pressed={filter.genres.includes(g.name)}
                onClick={() => chooseGenre(g.name)}
              >
                <span>{g.name || "Без жанра"}</span>
                <small>{count(g.count)}</small>
              </button>
            ))}
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
            <h2>Исполнители</h2>
            <span className="panel-count">
              {count(artists.data?.pages[0]?.total || 0)}
            </span>
          </div>
          <button
            className={`genre-row ${!filter.artists.length ? "selected" : ""}`}
            onClick={() =>
              setFilter((f) => ({ ...f, artists: [], albumIds: [] }))
            }
          >
            Все исполнители
          </button>
          <ArtistList
            items={artistItems}
            total={artists.data?.pages[0]?.total || 0}
            selected={filter.artists}
            loading={artists.isFetching}
            onSelect={(name) =>
              setFilter((f) => ({
                ...f,
                artists: toggle(f.artists, name),
                albumIds: [],
              }))
            }
            onMore={() => {
              if (artists.hasNextPage && !artists.isFetchingNextPage)
                void artists.fetchNextPage();
            }}
          />
        </section>
        <div
          className="resizer"
          role="separator"
          aria-label="Ширина исполнителей"
          onPointerDown={(e) => resize(2, e)}
        />
        <section className="panel albums-panel">
          <div className="panel-heading">
            <h2>Альбомы</h2>
            <span className="panel-count">{count(albumTotal)}</span>
          </div>
          <button
            className={`all-albums ${!filter.albumIds.length ? "selected" : ""}`}
            onClick={() => setFilter((f) => ({ ...f, albumIds: [] }))}
          >
            <Disc3 size={16} />
            <span>Все альбомы</span>
            {!filter.albumIds.length && <Check size={14} />}
          </button>
          <AlbumGrid
            albums={albumItems}
            total={albumTotal}
            selected={filter.albumIds}
            onSelect={(id) =>
              setFilter((f) => ({ ...f, albumIds: toggle(f.albumIds, id) }))
            }
            onMore={() => {
              if (albums.hasNextPage && !albums.isFetchingNextPage)
                void albums.fetchNextPage();
            }}
            loading={albums.isFetching}
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
            <label className="select-all">
              <input
                type="checkbox"
                aria-label="Выбрать все треки"
                checked={allSelected && !selected.size && total > 0}
                disabled={!total}
                onChange={(e) => {
                  setAllSelected(e.target.checked);
                  setSelected(new Set());
                }}
              />
              <span>
                {selectionCount
                  ? `${count(selectionCount)} выбрано`
                  : "Выбрать все"}
              </span>
            </label>
            <div className="toolbar-actions">
              <button
                className="icon-button"
                aria-label="Редактировать теги"
                title="Редактировать теги"
                disabled={!selectionCount}
                onClick={() => setModal("tags")}
              >
                <Tag size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Перенести треки"
                title="Перенести в библиотеку"
                disabled={!selectionCount}
                onClick={() => setModal("move")}
              >
                <FolderInput size={17} />
              </button>
              <button
                className="icon-button danger"
                aria-label="Удалить треки"
                title="Удалить с возможностью восстановления"
                disabled={!selectionCount}
                onClick={() => setModal("trash")}
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
      {modal && ["move", "trash", "tags"].includes(modal) && (
        <ActionDialog
          kind={modal as "move" | "trash" | "tags"}
          selection={selection}
          libraries={libraries.data || []}
          capabilities={capabilities}
          onClose={() => setModal(null)}
          onPreview={showPreview}
        />
      )}
      {modal === "history" && (
        <HistoryDialog onClose={() => setModal(null)} onPreview={showPreview} />
      )}
      {preview && (
        <PreviewDialog
          preview={preview}
          onClose={() => setPreview(null)}
          onExecute={async (id) => {
            await api(`/operations/${id}/execute`, {});
            setPreview(null);
            setSelected(new Set());
            setAllSelected(false);
            refresh();
            notify("Операция запущена. Результат появится в журнале.");
          }}
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
}: {
  items: { name: string; count: number }[];
  total: number;
  selected: string[];
  loading: boolean;
  onSelect: (name: string) => void;
  onMore: () => void;
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
          return item ? (
            <button
              key={item.name}
              className={`genre-row artist-row ${selected.includes(item.name) ? "selected" : ""}`}
              aria-pressed={selected.includes(item.name)}
              title={item.name || "Без исполнителя"}
              style={{
                position: "absolute",
                top: 0,
                transform: `translateY(${row.start}px)`,
                height: 44,
              }}
              onClick={() => onSelect(item.name)}
            >
              <span>{item.name || "Без исполнителя"}</span>
              <small>{count(item.count)}</small>
            </button>
          ) : null;
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
}: {
  albums: Album[];
  total: number;
  selected: string[];
  onSelect: (id: string) => void;
  onMore: () => void;
  loading: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(330);
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
                  <button
                    key={album.id}
                    className={`album-card ${selected.includes(album.id) ? "selected" : ""}`}
                    aria-pressed={selected.includes(album.id)}
                    title={`${album.title || "Без альбома"} · ${album.artists.join(", ")}`}
                    onClick={() => onSelect(album.id)}
                  >
                    <div
                      className="album-cover"
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
                      <span className="album-selection">
                        {selected.includes(album.id) ? (
                          <Check size={13} />
                        ) : (
                          <Plus size={13} />
                        )}
                      </span>
                      <span className="album-track-count">
                        {album.trackCount} тр.
                      </span>
                    </div>
                    <strong>{album.title || "Без альбома"}</strong>
                    <small>
                      {album.artists.join(", ") || "Неизвестный исполнитель"}
                    </small>
                  </button>
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
          <Search size={30} />
          <h3>{loading ? "Загружаем музыку…" : "Треки не найдены"}</h3>
          <p>
            {loading
              ? "Каталог появится по мере сканирования."
              : "Выберите другие фильтры или обновите библиотеку."}
          </p>
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
                  <small className="album-formats">
                    {(track.albumFormats || [track.format])
                      .join(" · ")
                      .toUpperCase()}
                  </small>
                </div>
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
