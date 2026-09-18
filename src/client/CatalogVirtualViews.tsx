import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Bookmark as BookmarkIcon, Disc3, Play, Search } from "lucide-react";
import type { Album, BookmarkKind, Track } from "../shared/contracts";
import {
  albumArtistGroupKey,
  artistGroupKey,
  isMissingArtistName,
  startsNewArtistGroup,
} from "../shared/artist-grouping";
import { count, duration } from "./api";
import { BookmarkToggle, type BookmarkChange } from "./BookmarkToggle";
import { ListTile } from "./ListTile";
import { resolveContextSelection, usePanelSelection } from "./panel-selection";
import { buildTrackListRows } from "./track-grouping";

const virtualPanelTopInset = 14;

export type CatalogContextMenuHandler = (
  event: React.MouseEvent,
  kind: BookmarkKind,
  id: string,
  selectedIds: string[],
  copyTexts?: string[],
) => void;

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

export function ArtistList({
  items,
  total,
  selected,
  loading,
  onSelectionChange,
  onMore,
  onContextMenu,
  onPlayArtist,
  bookmarkKeys,
  bookmarksUnavailable,
  pendingBookmarkKeys,
  onBookmarkChange,
  currentArtists,
  scrollTarget,
}: {
  items: { name: string; count: number }[];
  total: number;
  selected: string[];
  loading: boolean;
  onSelectionChange: (names: string[]) => void;
  onMore: () => void;
  onContextMenu: CatalogContextMenuHandler;
  onPlayArtist: (artist: string) => void;
  bookmarkKeys: Set<string>;
  bookmarksUnavailable: boolean;
  pendingBookmarkKeys: Set<string>;
  onBookmarkChange: BookmarkChange;
  currentArtists: ReadonlySet<string>;
  scrollTarget: {
    artist: string;
    requestId: number;
    filterKey: string;
  } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const groupByLetters = total > 10;
  const rows = useMemo(() => {
    const result: (
      | { type: "group"; key: string; label: string; compact: boolean }
      | { type: "artist"; item: (typeof items)[number] }
    )[] = [];
    let hasGroup = false;
    for (const [index, item] of items.entries()) {
      if (
        groupByLetters &&
        !isMissingArtistName(item.name) &&
        (index === 0 || startsNewArtistGroup(item.name, items[index - 1]?.name))
      ) {
        result.push({
          type: "group",
          key: `group:${index}:${artistGroupKey(item.name) || "#"}`,
          label: artistGroupKey(item.name) || "#",
          compact: !hasGroup,
        });
        hasGroup = true;
      }
      result.push({ type: "artist", item });
    }
    return result;
  }, [groupByLetters, items]);
  const selection = usePanelSelection({
    scrollRef: ref,
    selectedKeys: selected,
    onChange: onSelectionChange,
  });
  const highlighted = selection.previewKeys || new Set(selected);
  const centeredRequestId = useRef<number | null>(null);
  const requestedPageKey = useRef<string | null>(null);
  const virtual = useVirtualizer({
    count: rows.length + (items.length < total ? 1 : 0),
    getScrollElement: () => ref.current,
    estimateSize: (index) =>
      rows[index]?.type === "group" ? (rows[index].compact ? 36 : 56) : 36,
    paddingStart: virtualPanelTopInset,
    scrollPaddingStart: virtualPanelTopInset,
    overscan: 6,
  });
  const visible = virtual.getVirtualItems();
  const last = visible.at(-1)?.index ?? 0;
  useEffect(() => {
    if (last >= rows.length - 6 && items.length < total && !loading) onMore();
  }, [last, rows.length, items.length, total, loading, onMore]);
  useEffect(() => {
    if (!scrollTarget) return;
    if (loading) return;
    const targetIndex = rows.findIndex(
      (row) => row.type === "artist" && row.item.name === scrollTarget.artist,
    );
    if (targetIndex >= 0) {
      if (centeredRequestId.current !== scrollTarget.requestId) {
        virtual.scrollToIndex(targetIndex, { align: "center" });
        centeredRequestId.current = scrollTarget.requestId;
      }
      return;
    }
    const pageKey = `${scrollTarget.requestId}:${items.length}`;
    if (
      items.length < total &&
      !loading &&
      requestedPageKey.current !== pageKey
    ) {
      requestedPageKey.current = pageKey;
      onMore();
    }
  }, [scrollTarget, items, rows, total, loading, onMore, virtual]);
  return (
    <div
      className="artist-scroll selection-surface"
      ref={ref}
      {...selection.surfaceProps}
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {visible.map((row) => {
          const entry = rows[row.index];
          if (!entry) return null;
          if (entry.type === "group")
            return (
              <div
                key={entry.key}
                className={`artist-group-label ${
                  entry.compact ? "artist-group-label-compact" : ""
                }`}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 0,
                  transform: `translateY(${row.start}px)`,
                  height: entry.compact ? 36 : 56,
                }}
              >
                {entry.label}
              </div>
            );
          const { item } = entry;
          const label = isMissingArtistName(item.name)
            ? "Без исполнителя"
            : item.name;
          const checked = highlighted.has(item.name);
          const current = currentArtists.has(item.name);
          return (
            <ListTile
              key={item.name}
              className="genre-row artist-row"
              title={label}
              selected={checked}
              current={current}
              playing={current}
              related={selected.includes(item.name) && !current}
              statusIcon={
                current ? <Play size={13} fill="currentColor" /> : undefined
              }
              selectionKey={item.name}
              value={label}
              suffix={count(item.count)}
              onSelect={(event) => {
                if (
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey &&
                  selected.includes(item.name)
                ) {
                  onPlayArtist(item.name);
                  return;
                }
                selection.selectFromClick(
                  event,
                  item.name,
                  items.map((entry) => entry.name),
                );
              }}
              onContextMenu={(event) => {
                const selectedIds = resolveContextSelection(
                  selected,
                  item.name,
                );
                if (!selected.includes(item.name))
                  onSelectionChange(selectedIds);
                onContextMenu(event, "artist", item.name, selectedIds);
              }}
              style={{
                position: "absolute",
                top: 0,
                transform: `translateY(${row.start}px)`,
                height: 36,
              }}
              endAction={
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
              }
            />
          );
        })}
      </div>
      {selection.marquee}
    </div>
  );
}

export function AlbumGrid({
  albums,
  total,
  selected,
  currentAlbumId,
  onSelectionChange,
  onMore,
  loading,
  onContextMenu,
  onPlay,
  onSelectArtist,
  onCoverDrop,
  bookmarkKeys,
  bookmarksUnavailable,
  pendingBookmarkKeys,
  onBookmarkChange,
  scrollTarget,
}: {
  albums: Album[];
  total: number;
  selected: string[];
  currentAlbumId: string | null;
  onSelectionChange: (ids: string[]) => void;
  onMore: () => void;
  loading: boolean;
  onContextMenu: CatalogContextMenuHandler;
  onPlay: (id: string) => void;
  onSelectArtist: (artist: string) => void;
  onCoverDrop: (album: Album, files: File[]) => void;
  bookmarkKeys: Set<string>;
  bookmarksUnavailable: boolean;
  pendingBookmarkKeys: Set<string>;
  onBookmarkChange: BookmarkChange;
  scrollTarget: {
    album: string;
    requestId: number;
    filterKey: string;
  } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selection = usePanelSelection({
    scrollRef: ref,
    selectedKeys: selected,
    onChange: onSelectionChange,
  });
  const highlighted = selection.previewKeys || new Set(selected);
  const albumById = useMemo(
    () => new Map(albums.map((album) => [album.id, album])),
    [albums],
  );
  const [width, setWidth] = useState(330);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const gridGap = 8;
  const gridPadding = 14;
  const columns = Math.max(1, Math.floor((width - 20) / 138));
  const cellWidth =
    (width - gridPadding * 2 - (columns - 1) * gridGap) / columns;
  const rows = useMemo(() => {
    const result: Array<
      | { type: "artist"; key: string; artists: string[] }
      | {
          type: "albums";
          key: string;
          albums: Album[];
          endsArtistGroup: boolean;
        }
    > = [];
    let group: Album[] = [];
    let groupKey = "";
    const appendGroup = () => {
      if (!group.length) return;
      result.push({
        type: "artist",
        key: groupKey,
        artists: group[0].artists,
      });
      for (let index = 0; index < group.length; index += columns)
        result.push({
          type: "albums",
          key: `${groupKey}:${index}`,
          albums: group.slice(index, index + columns),
          endsArtistGroup: index + columns >= group.length,
        });
    };
    for (const album of albums) {
      const key = albumArtistGroupKey(album.artists);
      if (group.length && key !== groupKey) {
        appendGroup();
        group = [];
      }
      groupKey = key;
      group.push(album);
    }
    appendGroup();
    return result;
  }, [albums, columns]);
  const virtual = useVirtualizer({
    count: rows.length + (albums.length < total ? 1 : 0),
    getScrollElement: () => ref.current,
    estimateSize: (index) =>
      rows[index]?.type === "artist"
        ? 23
        : cellWidth + 64 + (rows[index]?.endsArtistGroup ? 12 : 0),
    paddingStart: virtualPanelTopInset,
    scrollPaddingStart: virtualPanelTopInset,
    overscan: 3,
  });
  const visible = virtual.getVirtualItems();
  const last = visible.at(-1)?.index ?? 0;
  useEffect(() => {
    if (last >= rows.length - 3 && albums.length < total && !loading) onMore();
  }, [last, rows.length, albums.length, total, loading, onMore]);
  useEffect(() => {
    virtual.measure();
  }, [cellWidth]);
  const centeredRequestId = useRef<number | null>(null);
  const requestedPageKey = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollTarget || loading) return;
    const targetRow = rows.findIndex(
      (row) =>
        row.type === "albums" &&
        row.albums.some((album) => album.id === scrollTarget.album),
    );
    if (targetRow >= 0) {
      if (centeredRequestId.current !== scrollTarget.requestId) {
        virtual.scrollToIndex(targetRow, { align: "center" });
        centeredRequestId.current = scrollTarget.requestId;
      }
      return;
    }
    const pageKey = `${scrollTarget.requestId}:${albums.length}`;
    if (albums.length < total && requestedPageKey.current !== pageKey) {
      requestedPageKey.current = pageKey;
      onMore();
    }
  }, [scrollTarget, loading, rows, albums.length, total, onMore, virtual]);
  return (
    <div
      ref={ref}
      className="album-scroll selection-surface"
      {...selection.surfaceProps}
    >
      {!albums.length ? (
        <div className="empty-small">
          <Disc3 size={30} />
          <p>{loading ? "Загружаем альбомы…" : "Альбомов пока нет"}</p>
        </div>
      ) : (
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {visible.map((row) => {
            const entry = rows[row.index];
            if (entry?.type === "artist")
              return (
                <div
                  key={row.key}
                  className="album-artist-header"
                  style={{
                    position: "absolute",
                    width: "100%",
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  {entry.artists.length ? (
                    entry.artists.map((artist, index) => (
                      <span key={`${artist}-${index}`}>
                        {index > 0 && ", "}
                        <button
                          type="button"
                          className="album-artist-link"
                          aria-label={`Выбрать исполнителя «${artist}»`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => onSelectArtist(artist)}
                        >
                          {artist}
                        </button>
                      </span>
                    ))
                  ) : (
                    <button
                      type="button"
                      className="album-artist-link"
                      aria-label="Выбрать неизвестного исполнителя"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => onSelectArtist("")}
                    >
                      Неизвестный исполнитель
                    </button>
                  )}
                </div>
              );
            return (
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
                {entry?.type === "albums" &&
                  entry.albums.map((album) => (
                    <div
                      key={album.id}
                      className={`album-card ${highlighted.has(album.id) ? "selected" : ""} ${currentAlbumId === album.id ? "playing" : ""}`}
                      data-selection-key={album.id}
                      title={`${album.title || "Без альбома"} · ${album.artists.join(", ")}`}
                      onContextMenu={(event) => {
                        const selectedIds = resolveContextSelection(
                          selected,
                          album.id,
                        );
                        if (!selected.includes(album.id))
                          onSelectionChange(selectedIds);
                        const copyTexts = selectedIds
                          .map((id) => albumById.get(id))
                          .filter((item): item is Album => Boolean(item))
                          .map(copyAlbumLabel);
                        onContextMenu(
                          event,
                          "album",
                          album.id,
                          selectedIds,
                          copyTexts,
                        );
                      }}
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
                        onClick={(event) => {
                          if (
                            !event.ctrlKey &&
                            !event.metaKey &&
                            !event.shiftKey &&
                            selected.includes(album.id)
                          ) {
                            onPlay(album.id);
                            return;
                          }
                          selection.selectFromClick(
                            event,
                            album.id,
                            albums.map((item) => item.id),
                          );
                        }}
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
                            <div className="cover-placeholder" />
                          )}
                          <span className="album-track-count">
                            {trackCountLabel(album.trackCount)}
                          </span>
                          {dropTarget === album.id && (
                            <span className="album-cover-drop-hint">
                              Отпустите обложку
                            </span>
                          )}
                        </div>
                        <strong>
                          {currentAlbumId === album.id && (
                            <Play
                              className="album-playing-icon"
                              size={13}
                              fill="currentColor"
                              aria-hidden="true"
                            />
                          )}
                          <span>{album.title || "Без альбома"}</span>
                        </strong>
                        <span className="album-details">
                          <small>{album.year || ""}</small>
                        </span>
                      </button>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}
      {selection.marquee}
    </div>
  );
}

export function TrackList({
  tracks,
  total,
  selected,
  selectedAlbumId,
  currentId,
  loading,
  onPlay,
  onSelectAlbum,
  onSelectionChange,
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
  scrollTarget,
}: {
  tracks: Track[];
  total: number;
  selected: Set<string>;
  selectedAlbumId: string | null;
  currentId?: string;
  loading: boolean;
  onPlay: (track: Track) => void;
  onSelectAlbum: (albumId: string) => Promise<void>;
  onSelectionChange: (ids: string[]) => void;
  onMore: () => void;
  onContextMenu: CatalogContextMenuHandler;
  bookmarkKeys: Set<string>;
  bookmarksUnavailable: boolean;
  pendingBookmarkKeys: Set<string>;
  onBookmarkChange: BookmarkChange;
  bookmarksOnly: boolean;
  bookmarkCount: number;
  hasOtherFilters: boolean;
  onDisableBookmarks: () => void;
  onResetBookmarkFilters: () => void;
  scrollTarget: { track: string; requestId: number; filterKey: string } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selection = usePanelSelection({
    scrollRef: ref,
    selectedKeys: [...selected],
    onChange: onSelectionChange,
  });
  const highlighted = selection.previewKeys || selected;
  const trackById = useMemo(
    () => new Map(tracks.map((track) => [track.id, track])),
    [tracks],
  );
  const rows = useMemo(() => {
    return buildTrackListRows(tracks);
  }, [tracks]);
  const virtual = useVirtualizer({
    count: rows.length + (tracks.length < total ? 1 : 0),
    getScrollElement: () => ref.current,
    estimateSize: (index) => (rows[index]?.type === "album" ? 78 : 36),
    paddingStart: virtualPanelTopInset,
    scrollPaddingStart: virtualPanelTopInset,
    overscan: 8,
  });
  const visible = virtual.getVirtualItems();
  const last = visible.at(-1)?.index ?? 0;
  useEffect(() => {
    if (last >= rows.length - 10 && tracks.length < total && !loading) onMore();
  }, [last, rows.length, tracks.length, total, loading, onMore]);
  const centeredRequestId = useRef<number | null>(null);
  const requestedPageKey = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollTarget || loading) return;
    const targetRow = rows.findIndex(
      (row) => row.type === "track" && row.track.id === scrollTarget.track,
    );
    if (targetRow >= 0) {
      if (centeredRequestId.current !== scrollTarget.requestId) {
        virtual.scrollToIndex(targetRow, { align: "center" });
        centeredRequestId.current = scrollTarget.requestId;
      }
      return;
    }
    const pageKey = `${scrollTarget.requestId}:${tracks.length}`;
    if (tracks.length < total && requestedPageKey.current !== pageKey) {
      requestedPageKey.current = pageKey;
      onMore();
    }
  }, [scrollTarget, loading, rows, tracks.length, total, onMore, virtual]);
  return (
    <div
      ref={ref}
      className="track-scroll selection-surface"
      aria-label="Список треков"
      {...selection.surfaceProps}
    >
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
            if (entry.type === "disc")
              return (
                <div
                  key={`disc-${entry.albumKey}-${row.index}`}
                  className="track-disc-header"
                  data-selection-ignore
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    width: "100%",
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  Диск {entry.discNumber}
                </div>
              );
            const track = entry.track;
            return entry.type === "album" ? (
              <div
                key={`album-${track.albumKey}`}
                className={`track-album-header ${selectedAlbumId === track.albumKey ? "selected" : ""}`}
                data-selection-ignore
                role="button"
                tabIndex={-1}
                aria-pressed={selectedAlbumId === track.albumKey}
                aria-label={`Альбом «${track.albumTitle || "Без альбома"}»${entry.genres.length ? `. Жанры: ${entry.genres.join(", ")}` : ""}`}
                onClick={() => void onSelectAlbum(track.albumKey)}
                onContextMenu={(event) =>
                  onContextMenu(
                    event,
                    "album",
                    track.albumKey,
                    [track.albumKey],
                    [
                      copyAlbumLabel({
                        artists: entry.artists,
                        title: track.albumTitle,
                        year: track.year,
                      }),
                    ],
                  )
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
                  <small>
                    {entry.artists.join(", ") || "Неизвестный исполнитель"}
                  </small>
                  <strong>{track.albumTitle || "Без альбома"}</strong>
                  {(track.year || entry.genres.length > 0) && (
                    <small>
                      {[track.year?.toString(), ...entry.genres]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  )}
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
              </div>
            ) : (
              <ListTile
                key={track.id}
                testId="track-row"
                dataFormat={track.format}
                className="track-row"
                selected={
                  highlighted.has(track.id) &&
                  (selection.previewKeys !== null ||
                    selectedAlbumId !== track.albumKey)
                }
                selectionKey={track.id}
                current={currentId === track.id}
                playing={currentId === track.id}
                statusIcon={
                  currentId === track.id ? (
                    <Play size={13} fill="currentColor" />
                  ) : undefined
                }
                prefix={track.trackNumber ?? undefined}
                value={track.title}
                suffix={duration(track.duration)}
                style={{
                  position: "absolute",
                  width: "100%",
                  height: row.size,
                  transform: `translateY(${row.start}px)`,
                }}
                onSelect={(event) =>
                  selection.selectFromClick(
                    event,
                    track.id,
                    tracks.map((item) => item.id),
                  )
                }
                onDoubleClick={() => onPlay(track)}
                onContextMenu={(event) => {
                  const selectedIds = resolveContextSelection(
                    [...selected],
                    track.id,
                  );
                  if (!selected.has(track.id)) onSelectionChange(selectedIds);
                  const copyTexts = selectedIds
                    .map((id) => trackById.get(id))
                    .filter((item): item is Track => Boolean(item))
                    .map(copyTrackLabel);
                  onContextMenu(
                    event,
                    "track",
                    track.id,
                    selectedIds,
                    copyTexts,
                  );
                }}
                endAction={
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
                }
              />
            );
          })}
        </div>
      )}
      {selection.marquee}
    </div>
  );
}
