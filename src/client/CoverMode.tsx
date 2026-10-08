import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronLeft,
  ChevronRight,
  DiscAlbum,
  ListMusic,
  Music2,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  emptyFilter,
  type Album,
  type CatalogFilter,
  type Page,
  type QuickSearchResults,
  type Track,
} from "../shared/contracts";
import { api, catalogUrl, duration } from "./api";
import {
  RatingControl,
  ViewedToggle,
  type UserStateChange,
} from "./RatingControl";

type SearchItem =
  | { kind: "track"; value: Track }
  | { kind: "album"; value: Album }
  | { kind: "artist" | "genre"; value: { name: string; count: number } };

const groupLabels: Record<SearchItem["kind"], string> = {
  track: "Треки",
  album: "Альбомы",
  artist: "Исполнители",
  genre: "Жанры",
};

type Queue = {
  id: string;
  position: number;
  total: number;
  track: Track | null;
};

type QueueAlbumBlock = {
  id: string;
  position: number;
  totalBlocks: number;
  blocks: { position: number; albumKey: string; title: string }[];
  previousPosition: number | null;
  nextPosition: number | null;
  tracks: Track[];
};

export function CoverMode({
  track,
  queue,
  playing,
  onClose,
  onPlayTrack,
  onUserStateChange,
  pendingUserStateKeys,
}: {
  track: Track;
  queue: Queue;
  playing: boolean;
  onClose: () => void;
  onPlayTrack: (track: Track) => Promise<boolean>;
  onUserStateChange: UserStateChange;
  pendingUserStateKeys: Set<string>;
}) {
  const [artworkOpen, setArtworkOpen] = useState(false);
  const [viewedBlock, setViewedBlock] = useState<{
    queueId: string;
    position: number;
    albumKey: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLElement>(null);
  const focusDot = useRef(false);
  const isSameQueue = viewedBlock?.queueId === queue.id;
  const blockRequest = isSameQueue
    ? { position: viewedBlock.position }
    : viewedBlock
      ? { albumKey: viewedBlock.albumKey, fallbackPosition: queue.position }
      : { position: queue.position };
  const albumBlock = useQuery({
    queryKey: ["cover-mode-album-block", queue.id, blockRequest],
    placeholderData: (previous) =>
      previous?.id === queue.id ? previous : undefined,
    queryFn: () =>
      api<QueueAlbumBlock>(
        `/queue/${queue.id}/album-block?${new URLSearchParams(
          Object.entries(blockRequest).map(([key, value]) => [
            key,
            String(value),
          ]),
        )}`,
      ),
  });
  const block =
    albumBlock.data?.id === queue.id &&
    (!isSameQueue || albumBlock.data.position === viewedBlock?.position)
      ? albumBlock.data
      : null;
  const navigationBlock =
    albumBlock.data?.id === queue.id ? albumBlock.data : null;
  const navigationPosition = isSameQueue
    ? viewedBlock.position
    : navigationBlock?.position;
  const dotVirtualizer = useVirtualizer({
    count:
      navigationBlock && navigationBlock.totalBlocks > 1
        ? navigationBlock.blocks.length
        : 0,
    getScrollElement: () => dotsRef.current,
    horizontal: true,
    estimateSize: () => 28,
    overscan: 6,
  });
  const visibleDots = dotVirtualizer.getVirtualItems();
  const displayTrack =
    block?.tracks.find((item) => item.id === track.id) ||
    block?.tracks[0] ||
    track;
  const albumTracks = useInfiniteQuery({
    queryKey: ["cover-mode-tracks", displayTrack.albumKey],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<Page<Track>>(
        catalogUrl(
          "tracks",
          { ...emptyFilter, albumIds: [displayTrack.albumKey] },
          pageParam,
          200,
        ),
      ),
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total
        ? last.offset + last.items.length
        : undefined,
  });
  const tracks = albumTracks.data?.pages.flatMap((page) => page.items) || [];
  const showsPlayingTrack = Boolean(
    block &&
    queue.position >= block.position &&
    queue.position <
      (block.blocks.find((item) => item.position > block.position)?.position ??
        queue.total) &&
    block.tracks.some((item) => item.id === track.id),
  );
  useEffect(() => {
    const index = navigationBlock?.blocks.findIndex(
      (item) => item.position === navigationPosition,
    );
    if (index !== undefined && index >= 0)
      dotVirtualizer.scrollToIndex(index, { align: "auto" });
  }, [navigationBlock, navigationPosition, dotVirtualizer]);
  useEffect(() => {
    if (!focusDot.current) return;
    const target = dotsRef.current?.querySelector<HTMLButtonElement>(
      `[data-block-position="${navigationPosition}"]`,
    );
    if (target) {
      target.focus({ preventScroll: true });
      focusDot.current = false;
    }
  }, [navigationPosition, visibleDots]);
  useEffect(() => {
    if (!block) return;
    setViewedBlock((current) =>
      current?.queueId === block.id && current.position === block.position
        ? current
        : {
            queueId: block.id,
            position: block.position,
            albumKey: block.tracks[0].albumKey,
          },
    );
  }, [block]);
  useEffect(() => setArtworkOpen(false), [block?.id, block?.position]);
  useEffect(() => {
    const current = scrollRef.current?.querySelector<HTMLElement>(
      `[data-cover-track-id="${CSS.escape(track.id)}"]`,
    );
    current?.scrollIntoView({ block: "nearest" });
  }, [track.id, tracks.length, block?.position]);

  return (
    <main
      className="cover-mode"
      aria-label="Режим обложки"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="cover-mode-layout">
        <section className="cover-mode-album-panel">
          <div className="cover-mode-album-caption">
            <h1>{displayTrack.albumTitle || "Без альбома"}</h1>
            {displayTrack.year && <p>{displayTrack.year}</p>}
          </div>
          <div className="cover-mode-artwork-area">
            {block && block.totalBlocks > 1 && (
              <button
                type="button"
                className="cover-album-navigation"
                aria-label="Предыдущий альбом"
                onClick={() =>
                  block.previousPosition !== null &&
                  setViewedBlock({
                    queueId: queue.id,
                    position: block.previousPosition,
                    albumKey: displayTrack.albumKey,
                  })
                }
              >
                <ChevronLeft size={28} />
              </button>
            )}
            <button
              type="button"
              className="cover-mode-artwork"
              aria-label={
                displayTrack.coverId
                  ? "Открыть обложку в оригинальном размере"
                  : "Обложка отсутствует"
              }
              disabled={!displayTrack.coverId}
              onClick={() => setArtworkOpen(true)}
            >
              {displayTrack.coverId ? (
                <img
                  src={`/api/covers/${displayTrack.coverId}`}
                  alt={`Обложка альбома «${displayTrack.albumTitle || "Без альбома"}»`}
                />
              ) : (
                <Music2 size={72} />
              )}
            </button>
            {block && block.totalBlocks > 1 && (
              <button
                type="button"
                className="cover-album-navigation"
                aria-label="Следующий альбом"
                onClick={() =>
                  block.nextPosition !== null &&
                  setViewedBlock({
                    queueId: queue.id,
                    position: block.nextPosition,
                    albumKey: displayTrack.albumKey,
                  })
                }
              >
                <ChevronRight size={28} />
              </button>
            )}
          </div>
          {navigationBlock && navigationBlock.totalBlocks > 1 && (
            <nav
              ref={dotsRef}
              className="cover-album-dots"
              aria-label="Альбомы плейлиста"
            >
              <div
                className="cover-album-dot-strip"
                style={{ width: dotVirtualizer.getTotalSize() }}
              >
                {visibleDots.map(({ index, start }) => {
                  const item = navigationBlock.blocks[index];
                  return (
                    <button
                      key={item.position}
                      type="button"
                      className="cover-album-dot"
                      style={{ left: start }}
                      data-block-position={item.position}
                      tabIndex={item.position === navigationPosition ? 0 : -1}
                      aria-label={`Альбом ${index + 1}: ${item.title}`}
                      aria-current={
                        item.position === navigationPosition
                          ? "true"
                          : undefined
                      }
                      onClick={() =>
                        setViewedBlock({
                          queueId: queue.id,
                          position: item.position,
                          albumKey: item.albumKey,
                        })
                      }
                      onKeyDown={(event) => {
                        const count = navigationBlock.blocks.length;
                        const next =
                          event.key === "ArrowRight"
                            ? (index + 1) % count
                            : event.key === "ArrowLeft"
                              ? (index - 1 + count) % count
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? count - 1
                                  : null;
                        if (next === null) return;
                        event.preventDefault();
                        focusDot.current = true;
                        const selected = navigationBlock.blocks[next];
                        setViewedBlock({
                          queueId: queue.id,
                          position: selected.position,
                          albumKey: selected.albumKey,
                        });
                      }}
                    />
                  );
                })}
              </div>
            </nav>
          )}
        </section>
        <section
          className="cover-mode-details"
          aria-label="Треки и действия альбома"
        >
          {showsPlayingTrack && (
            <div className="cover-mode-copy">
              <p className="cover-mode-artist">
                {track.artists.join(", ") || "Неизвестный исполнитель"}
              </p>
              <h2>{track.title || "Без названия"}</h2>
            </div>
          )}
          <div className="cover-mode-album-state">
            <RatingControl
              kind="album"
              id={displayTrack.albumKey}
              rating={displayTrack.albumRating}
              pending={pendingUserStateKeys.has(
                `album:${displayTrack.albumKey}`,
              )}
              onChange={onUserStateChange}
            />
            <ViewedToggle
              id={displayTrack.albumKey}
              viewed={displayTrack.albumViewed}
              pending={pendingUserStateKeys.has(
                `album:${displayTrack.albumKey}`,
              )}
              onChange={onUserStateChange}
            />
          </div>
          <div
            className="cover-tracklist"
            ref={scrollRef}
            aria-label={`Треклист альбома «${displayTrack.albumTitle || "Без альбома"}»`}
            onScroll={(event) => {
              const element = event.currentTarget;
              if (
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                  120 &&
                albumTracks.hasNextPage &&
                !albumTracks.isFetchingNextPage
              )
                void albumTracks.fetchNextPage();
            }}
          >
            {albumBlock.isError || albumTracks.isError ? (
              <div className="cover-tracklist-state">
                <span>Не удалось загрузить треклист.</span>
                <button
                  className="text-button"
                  onClick={() => {
                    void albumBlock.refetch();
                    void albumTracks.refetch();
                  }}
                >
                  Повторить
                </button>
              </div>
            ) : !block || albumTracks.isPending ? (
              <div className="cover-tracklist-state">Загружаем треклист…</div>
            ) : (
              tracks.map((item) => {
                const current = item.id === track.id;
                const number =
                  (item.discNumber || 0) > 1
                    ? `${item.discNumber}.${item.trackNumber || "—"}`
                    : item.trackNumber || "—";
                return (
                  <div
                    key={item.id}
                    data-cover-track-id={item.id}
                    className={`cover-track-row ${current ? "current" : ""}`}
                    aria-current={current ? "true" : undefined}
                  >
                    <button
                      type="button"
                      className="cover-track-play"
                      onClick={() => void onPlayTrack(item)}
                      aria-label={`Воспроизвести «${item.title || "Без названия"}»`}
                    >
                      <span className="cover-track-number">
                        {current && playing ? (
                          <span
                            className="playing-bars"
                            aria-label="Воспроизводится"
                          />
                        ) : (
                          number
                        )}
                      </span>
                      <span className="cover-track-title">
                        {item.title || "Без названия"}
                      </span>
                      <span>{duration(item.duration)}</span>
                    </button>
                    {item.rating !== null && (
                      <RatingControl
                        kind="track"
                        id={item.id}
                        rating={item.rating}
                        pending={pendingUserStateKeys.has(`track:${item.id}`)}
                        onChange={onUserStateChange}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
      {artworkOpen && displayTrack.coverId && (
        <ArtworkViewer
          src={`/api/covers/${displayTrack.coverId}`}
          alt={`Обложка альбома «${displayTrack.albumTitle || "Без альбома"}»`}
          onClose={() => setArtworkOpen(false)}
        />
      )}
    </main>
  );
}

function ArtworkViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [fit, setFit] = useState(true);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // This listener runs before the cover-mode handler. Without the modal
      // boundary, the same key also closed the whole cover mode.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);
  return (
    <div
      className="artwork-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр обложки"
    >
      <div
        className="artwork-viewer-scroll"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <img
          className={fit ? "fit" : "original"}
          src={src}
          alt={alt}
          onClick={() => setFit((current) => !current)}
        />
      </div>
    </div>
  );
}

export function QuickSearchDialog({
  query,
  onClose,
  onPlayFilter,
  onPlayAlbum,
}: {
  query: string;
  onClose: () => void;
  onPlayFilter: (filter: CatalogFilter, startId?: string) => Promise<boolean>;
  onPlayAlbum: (albumId: string) => Promise<boolean>;
}) {
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false);
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 160);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: ["quick-search", debounced],
    queryFn: () =>
      api<QuickSearchResults>(
        `/quick-search?${new URLSearchParams({ query: debounced, limit: "6" })}`,
      ),
    enabled: Boolean(debounced),
  });
  const items = useMemo<SearchItem[]>(() => {
    if (!results.data) return [];
    return [
      ...results.data.tracks.map((value) => ({
        kind: "track" as const,
        value,
      })),
      ...results.data.albums.map((value) => ({
        kind: "album" as const,
        value,
      })),
      ...results.data.artists.map((value) => ({
        kind: "artist" as const,
        value,
      })),
      ...results.data.genres.map((value) => ({
        kind: "genre" as const,
        value,
      })),
    ];
  }, [results.data]);
  const isQueryPending = query.trim() !== debounced || results.isPending;
  useEffect(() => setActive(0), [items.length, debounced]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (
        items.length &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        setActive((current) =>
          event.key === "ArrowDown"
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length,
        );
      } else if (items.length && event.key === "Enter") {
        event.preventDefault();
        void activate(items[active]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, items, onClose]);
  useEffect(
    () => activeRef.current?.scrollIntoView({ block: "nearest" }),
    [active],
  );
  const activate = async (item: SearchItem) => {
    if (pending) return;
    setPending(true);
    let success = false;
    if (item.kind === "album") success = await onPlayAlbum(item.value.id);
    else if (item.kind === "track")
      success = await onPlayFilter(
        { ...emptyFilter, search: debounced },
        item.value.id,
      );
    else if (item.kind === "artist")
      success = await onPlayFilter({
        ...emptyFilter,
        artists: [item.value.name],
      });
    else
      success = await onPlayFilter({
        ...emptyFilter,
        genres: [item.value.name],
      });
    setPending(false);
    if (success) onClose();
  };
  return (
    <section
      className="quick-search-dialog"
      role="dialog"
      aria-label="Результаты поиска"
    >
      <div className="quick-search-results" aria-live="polite">
        {isQueryPending ? (
          <div className="quick-search-state">Ищем в медиатеке…</div>
        ) : results.isError ? (
          <div className="quick-search-state">
            <span>Не удалось выполнить поиск.</span>
            <button
              className="text-button"
              onClick={() => void results.refetch()}
            >
              Повторить
            </button>
          </div>
        ) : !items.length ? (
          <div className="quick-search-state">Ничего не найдено</div>
        ) : (
          items.map((item, index) => {
            const previousKind = items[index - 1]?.kind;
            const title =
              item.kind === "track" || item.kind === "album"
                ? item.value.title
                : item.value.name;
            const subtitle =
              item.kind === "track"
                ? `${item.value.artists.join(", ") || "Неизвестный исполнитель"} · ${item.value.albumTitle || "Без альбома"}`
                : item.kind === "album"
                  ? `${item.value.artists.join(", ") || "Неизвестный исполнитель"}${item.value.year ? ` · ${item.value.year}` : ""}`
                  : item.kind === "artist"
                    ? `${item.value.count} альб.`
                    : `${item.value.count} тр.`;
            return (
              <div
                className="quick-search-entry"
                key={`${item.kind}-${item.kind === "track" || item.kind === "album" ? item.value.id : item.value.name}`}
              >
                {item.kind !== previousKind && (
                  <h2>{groupLabels[item.kind]}</h2>
                )}
                <button
                  ref={index === active ? activeRef : undefined}
                  className={`quick-search-result ${index === active ? "active" : ""}`}
                  disabled={pending}
                  onClick={() => void activate(item)}
                >
                  <span className="quick-search-icon">
                    {item.kind === "track" || item.kind === "album" ? (
                      item.value.coverId ? (
                        <img src={`/api/covers/${item.value.coverId}`} alt="" />
                      ) : (
                        <DiscAlbum size={20} />
                      )
                    ) : item.kind === "artist" ? (
                      <UserRound size={20} />
                    ) : (
                      <ListMusic size={20} />
                    )}
                  </span>
                  <span className="quick-search-copy">
                    <strong>
                      {title ||
                        (item.kind === "artist"
                          ? "Неизвестный исполнитель"
                          : "Без названия")}
                    </strong>
                    <small>{subtitle}</small>
                  </span>
                  {item.kind === "track" && (
                    <span className="quick-search-duration">
                      {duration(item.value.duration)}
                    </span>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
