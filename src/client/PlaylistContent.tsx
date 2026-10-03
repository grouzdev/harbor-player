import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  CircleUserRound,
  Drama,
  FolderOpen,
  Play,
  Trash2,
} from "lucide-react";
import type { PlaylistEntry, ResolvedPlaylistTrack } from "../shared/playlists";
import { AlbumHeader } from "./AlbumHeader";
import { DiscHeader } from "./DiscHeader";
import { ListTile } from "./ListTile";
import { CoverPlaceholder } from "./CoverPlaceholder";
import { CollapseToggle } from "./CollapseToggle";
import { duration } from "./api";
import {
  buildPlaylistRows,
  findPlaylistOccurrence,
  visiblePlaylistRows,
  type PlaylistRow,
} from "./playlist-grouping";

const playlistDragType = "application/x-harbor-playlist-entry";

export type PlaylistCurrentTrack = {
  entryId?: string;
  trackId?: string;
  requestKey: string;
};

export function PlaylistContent({
  entries,
  items,
  editingDisabled,
  collapsed,
  setCollapsed,
  current,
  onPlay,
  onReorder,
  onRemove,
  onAddSelection,
}: {
  entries: PlaylistEntry[];
  items: ResolvedPlaylistTrack[];
  editingDisabled: boolean;
  collapsed: Set<string>;
  setCollapsed: Dispatch<SetStateAction<Set<string>>>;
  current?: PlaylistCurrentTrack;
  onPlay: (entryId: string, trackId: string) => void;
  onReorder: (entryId: string, beforeId: string | null) => void;
  onRemove: (entryId: string) => void;
  onAddSelection: (beforeEntryId?: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const rows = useMemo(
    () => buildPlaylistRows(entries, items),
    [entries, items],
  );
  const target = useMemo(
    () => findPlaylistOccurrence(rows, current?.entryId, current?.trackId),
    [rows, current?.entryId, current?.trackId],
  );
  const visible = useMemo(
    () => visiblePlaylistRows(rows, collapsed),
    [rows, collapsed],
  );
  const virtual = useVirtualizer({
    count: visible.length,
    getScrollElement: () => ref.current,
    getItemKey: (index) => visible[index].key,
    estimateSize: (index) =>
      visible[index].type === "entry" || visible[index].type === "album"
        ? 78
        : 36,
    paddingStart: 14,
    paddingEnd: 14,
    overscan: 8,
  });
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !current || followed.current === current.requestKey) return;
    if (target.parents.some((key) => collapsed.has(key))) {
      setCollapsed((previous) => {
        const next = new Set(previous);
        target.parents.forEach((key) => next.delete(key));
        return next;
      });
      return;
    }
    const index = visible.findIndex((row) => row.key === target.key);
    if (index < 0) return;
    virtual.scrollToIndex(index, { align: "auto" });
    followed.current = current.requestKey;
  }, [target, current, collapsed, setCollapsed, visible, virtual]);

  const toggle = (key: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const play = (row: PlaylistRow) => {
    const item =
      row.type === "track"
        ? row.item
        : row.type === "entry" || row.type === "album"
          ? row.firstTrack
          : undefined;
    if (item?.track.available) onPlay(row.entry.id, item.track.id);
  };
  const collapseControl = (row: PlaylistRow) => (
    <CollapseToggle
      collapsed={collapsed.has(row.key)}
      onToggle={() => toggle(row.key)}
    />
  );
  const entryIndices = useMemo(
    () => new Map(entries.map((entry, index) => [entry.id, index])),
    [entries],
  );
  const actions = (entry: PlaylistEntry) => {
    const index = entryIndices.get(entry.id)!;
    return (
      <div
        className="playlist-item-actions"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="icon-button"
          aria-label="Переместить вверх"
          title="Переместить вверх"
          disabled={editingDisabled || index === 0}
          onClick={() => onReorder(entry.id, entries[index - 1].id)}
        >
          <ArrowUp size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Переместить вниз"
          title="Переместить вниз"
          disabled={editingDisabled || index === entries.length - 1}
          onClick={() => onReorder(entry.id, entries[index + 2]?.id ?? null)}
        >
          <ArrowDown size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Удалить из плейлиста"
          title="Удалить из плейлиста"
          disabled={editingDisabled}
          onClick={() => onRemove(entry.id)}
        >
          <Trash2 size={15} />
        </button>
      </div>
    );
  };
  const dropOn = (entryId: string) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDropBefore(null);
    const dragged = event.dataTransfer.getData(playlistDragType);
    if (dragged) {
      if (!editingDisabled) onReorder(dragged, entryId);
    } else if (
      event.dataTransfer.types.includes(
        "application/x-harbor-catalog-selection",
      )
    ) {
      void onAddSelection(entryId);
    }
  };
  const dragOver = (entryId: string) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropBefore(entryId);
  };

  return (
    <div
      ref={ref}
      className="track-scroll playlist-content"
      aria-label="Содержимое плейлиста"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const dragged = event.dataTransfer.getData(playlistDragType);
        if (!dragged) return;
        event.preventDefault();
        event.stopPropagation();
        setDropBefore(null);
        if (!editingDisabled) onReorder(dragged, null);
      }}
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((position) => {
          const row = visible[position.index];
          const style: CSSProperties = {
            position: "absolute",
            width: "100%",
            height: position.size,
            transform: `translateY(${position.start}px)`,
            paddingLeft: 20 + row.depth * 12,
          };
          const isCurrent = target?.key === row.key;
          if (row.type === "disc")
            return (
              <DiscHeader
                key={row.key}
                discNumber={row.discNumber}
                style={style}
                onDragOver={dragOver(row.entry.id)}
                onDrop={dropOn(row.entry.id)}
              />
            );
          if (row.type === "track")
            return (
              <ListTile
                key={row.key}
                testId="playlist-track-row"
                className="track-row"
                style={style}
                value={row.item.track.title}
                prefix={row.item.track.trackNumber ?? undefined}
                suffix={duration(row.item.track.duration)}
                selected={selected === row.key}
                current={isCurrent}
                playing={isCurrent}
                statusIcon={
                  isCurrent ? <Play size={13} fill="currentColor" /> : undefined
                }
                onSelect={() => setSelected(row.key)}
                onDoubleClick={() => play(row)}
                onDragOver={dragOver(row.entry.id)}
                onDrop={dropOn(row.entry.id)}
                endAction={
                  <button
                    type="button"
                    className="icon-button row-play"
                    aria-label={`Воспроизвести ${row.item.track.title}`}
                    disabled={!row.item.track.available}
                    onClick={() => play(row)}
                  >
                    <Play size={14} fill="currentColor" />
                  </button>
                }
              />
            );

          const album = row.album;
          const track =
            row.type === "entry" && row.entry.kind === "track"
              ? row.track
              : undefined;
          const KindIcon =
            row.entry.kind === "folder"
              ? FolderOpen
              : row.entry.kind === "genre"
                ? Drama
                : row.entry.kind === "artist"
                  ? CircleUserRound
                  : undefined;
          const isEntry = row.type === "entry";
          const isTrackEntry = isEntry && row.entry.kind === "track";
          return (
            <AlbumHeader
              key={row.key}
              data-testid={isEntry ? "playlist-entry" : "playlist-album"}
              data-entry-id={row.entry.id}
              className={`playlist-item ${isEntry ? "playlist-added-item" : ""} ${isCurrent ? "current playing" : ""} ${dropBefore === row.entry.id && isEntry ? "playlist-drop-before" : ""}`}
              style={style}
              role="group"
              aria-label={album?.track.albumTitle || row.entry.snapshot.title}
              selected={selected === row.key}
              contentButton={{
                "aria-pressed": selected === row.key,
                onClick: (event) => {
                  event.stopPropagation();
                  setSelected(row.key);
                },
                onDoubleClick: (event) => {
                  event.stopPropagation();
                  play(row);
                },
                onKeyDown: (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    play(row);
                  }
                },
              }}
              title={album?.track.albumTitle || row.entry.snapshot.title}
              subtitle={
                album
                  ? album.artists.join(", ") || "Неизвестный исполнитель"
                  : row.entry.snapshot.subtitle
              }
              details={
                album
                  ? [album.track.year, ...album.genres]
                      .filter(Boolean)
                      .join(" · ")
                  : track
                    ? [track.albumTitle, track.year].filter(Boolean).join(" · ")
                    : undefined
              }
              coverId={album?.track.coverId ?? row.entry.snapshot.coverId}
              cover={
                isTrackEntry ? (
                  <>
                    {row.entry.snapshot.coverId ? (
                      <img
                        src={`/api/covers/${row.entry.snapshot.coverId}`}
                        alt=""
                      />
                    ) : (
                      <CoverPlaceholder />
                    )}
                    <button
                      type="button"
                      className="icon-button row-play playlist-entry-play"
                      aria-label={`Воспроизвести ${row.entry.snapshot.title}`}
                      disabled={!row.firstTrack}
                      onClick={(event) => {
                        event.stopPropagation();
                        play(row);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                  </>
                ) : !album && !row.entry.snapshot.coverId && KindIcon ? (
                  <KindIcon size={24} />
                ) : undefined
              }
              statusIcon={
                isTrackEntry && isCurrent ? (
                  <Play size={13} fill="currentColor" />
                ) : isEntry && row.entry.snapshot.coverId && KindIcon ? (
                  <KindIcon size={13} />
                ) : undefined
              }
              duration={duration(
                row.type === "album" ? row.album.duration : row.duration,
              )}
              collapseControl={
                row.type === "album" || row.collapsible
                  ? collapseControl(row)
                  : undefined
              }
              actions={isEntry ? actions(row.entry) : undefined}
              onClick={() => setSelected(row.key)}
              onDoubleClick={() => play(row)}
              draggable={isEntry && !editingDisabled}
              onDragStart={
                isEntry
                  ? (event) => {
                      event.dataTransfer.setData(
                        playlistDragType,
                        row.entry.id,
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onDragEnd={() => setDropBefore(null)}
              onDragOver={dragOver(row.entry.id)}
              onDrop={dropOn(row.entry.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
