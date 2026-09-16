import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Disc3, ListMusic, Music2, Search, UserRound, X } from "lucide-react";
import {
  emptyFilter,
  type Album,
  type CatalogFilter,
  type Page,
  type QuickSearchResults,
  type Track,
} from "../shared/contracts";
import { api, catalogUrl, duration } from "./api";

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

export function CoverMode({
  track,
  playing,
  onClose,
  onPlayTrack,
}: {
  track: Track;
  playing: boolean;
  onClose: () => void;
  onPlayTrack: (track: Track) => Promise<boolean>;
}) {
  const [artworkOpen, setArtworkOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const albumTracks = useInfiniteQuery({
    queryKey: ["cover-mode-tracks", track.albumKey],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<Page<Track>>(
        catalogUrl(
          "tracks",
          { ...emptyFilter, albumIds: [track.albumKey] },
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
  useEffect(() => {
    const current = scrollRef.current?.querySelector<HTMLElement>(
      `[data-cover-track-id="${CSS.escape(track.id)}"]`,
    );
    current?.scrollIntoView({ block: "nearest" });
  }, [track.id, tracks.length]);

  return (
    <main
      className="cover-mode"
      aria-label="Режим обложки"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="cover-mode-layout">
        <button
          type="button"
          className="cover-mode-artwork"
          aria-label={
            track.coverId
              ? "Открыть обложку в оригинальном размере"
              : "Обложка отсутствует"
          }
          disabled={!track.coverId}
          onClick={() => setArtworkOpen(true)}
        >
          {track.coverId ? (
            <img
              src={`/api/covers/${track.coverId}`}
              alt={`Обложка альбома «${track.albumTitle || "Без альбома"}»`}
            />
          ) : (
            <Music2 size={72} />
          )}
        </button>
        <section className="cover-mode-details">
          <div className="cover-mode-copy">
            <p className="cover-mode-artist">
              {track.artists.join(", ") || "Неизвестный исполнитель"}
            </p>
            <h1>{track.title || "Без названия"}</h1>
            <p className="cover-mode-album">
              {track.albumTitle || "Без альбома"}
              {track.year ? ` · ${track.year}` : ""}
            </p>
          </div>
          <div
            className="cover-tracklist"
            ref={scrollRef}
            aria-label={`Треклист альбома «${track.albumTitle || "Без альбома"}»`}
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
            {albumTracks.isPending ? (
              <div className="cover-tracklist-state">Загружаем треклист…</div>
            ) : albumTracks.isError ? (
              <div className="cover-tracklist-state">
                <span>Не удалось загрузить треклист.</span>
                <button
                  className="text-button"
                  onClick={() => void albumTracks.refetch()}
                >
                  Повторить
                </button>
              </div>
            ) : (
              tracks.map((item) => {
                const current = item.id === track.id;
                const number =
                  (item.discNumber || 0) > 1
                    ? `${item.discNumber}.${item.trackNumber || "—"}`
                    : item.trackNumber || "—";
                return (
                  <button
                    type="button"
                    key={item.id}
                    data-cover-track-id={item.id}
                    className={`cover-track-row ${current ? "current" : ""}`}
                    aria-current={current ? "true" : undefined}
                    onClick={() => void onPlayTrack(item)}
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
                );
              })
            )}
          </div>
        </section>
      </div>
      {artworkOpen && track.coverId && (
        <ArtworkViewer
          src={`/api/covers/${track.coverId}`}
          alt={`Обложка альбома «${track.albumTitle || "Без альбома"}»`}
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
  const [canFit, setCanFit] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    const measure = () => {
      const image = imageRef.current;
      if (!image) return;
      setCanFit(
        image.naturalWidth > window.innerWidth - 64 ||
          image.naturalHeight > window.innerHeight - 64,
      );
    };
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return (
    <div
      className="artwork-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр обложки"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="artwork-viewer-scroll"
        onClick={(event) => {
          if (!fit && event.target === event.currentTarget) setFit(true);
        }}
      >
        <img
          ref={imageRef}
          className={`${fit ? "fit" : "original"} ${canFit ? "zoomable" : ""}`}
          src={src}
          alt={alt}
          onLoad={(event) => {
            const image = event.currentTarget;
            setCanFit(
              image.naturalWidth > window.innerWidth - 64 ||
                image.naturalHeight > window.innerHeight - 64,
            );
          }}
          onClick={() => canFit && setFit((current) => !current)}
        />
      </div>
    </div>
  );
}

export function QuickSearchDialog({
  onClose,
  onPlayFilter,
  onPlayAlbum,
}: {
  onClose: () => void;
  onPlayFilter: (filter: CatalogFilter, startId?: string) => Promise<boolean>;
  onPlayAlbum: (albumId: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false);
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 160);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
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
  useEffect(() => setActive(0), [items.length, debounced]);
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
    <div
      className="quick-search-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Быстрый поиск"
    >
      <section
        className="quick-search-dialog"
        onKeyDown={(event) => {
          if (!items.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) =>
              event.key === "ArrowDown"
                ? (current + 1) % items.length
                : (current - 1 + items.length) % items.length,
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            void activate(items[active]);
          }
        }}
      >
        <div className="quick-search-input">
          <Search size={21} />
          <input
            autoFocus
            aria-label="Быстрый поиск музыки"
            placeholder="Жанры, исполнители, альбомы, треки"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="icon-button"
            aria-label="Закрыть быстрый поиск"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="quick-search-results" aria-live="polite">
          {!debounced ? (
            <div className="quick-search-state">
              <Search size={32} />
              <span>Начните вводить название</span>
            </div>
          ) : results.isPending ? (
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
                    onMouseEnter={() => setActive(index)}
                    onClick={() => void activate(item)}
                  >
                    <span className="quick-search-icon">
                      {item.kind === "track" || item.kind === "album" ? (
                        item.value.coverId ? (
                          <img
                            src={`/api/covers/${item.value.coverId}`}
                            alt=""
                          />
                        ) : (
                          <Disc3 size={20} />
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
    </div>
  );
}
