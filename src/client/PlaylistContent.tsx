import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  CircleUserRound,
  DiscAlbum,
  Drama,
  FolderOpen,
  Music,
  Play,
  Trash2,
} from "lucide-react";
import type { PlaylistEntry, ResolvedPlaylistTrack } from "../shared/playlists";
import { AlbumHeader } from "./AlbumHeader";
import { DiscHeader } from "./DiscHeader";
import { ListTile } from "./ListTile";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { CollapseToggle } from "./CollapseToggle";
import { duration } from "./api";
import {
  buildPlaylistRows,
  findPlaylistOccurrence,
  visiblePlaylistRows,
  type PlaylistRow,
} from "./playlist-grouping";

const playlistDragType = "application/x-harbor-playlist-entry";
const entryIcons = {
  folder: FolderOpen,
  genre: Drama,
  artist: CircleUserRound,
  album: DiscAlbum,
  track: Music,
};

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
  const [context, setContext] = useState<{
    entryId: string;
    x: number;
    y: number;
  } | null>(null);
  const closeContext = useCallback(() => setContext(null), []);
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
    estimateSize: (index) => (visible[index].type === "album" ? 78 : 36),
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
  const contextIndex = context ? entryIndices.get(context.entryId) : undefined;
  const menu: ContextMenuState | null =
    context && contextIndex !== undefined
      ? {
          x: context.x,
          y: context.y,
          items: [
            {
              label: "Переместить вверх",
              icon: <ArrowUp size={16} />,
              disabled: editingDisabled || contextIndex === 0,
              onSelect: () =>
                onReorder(context.entryId, entries[contextIndex - 1].id),
            },
            {
              label: "Переместить вниз",
              icon: <ArrowDown size={16} />,
              disabled: editingDisabled || contextIndex === entries.length - 1,
              onSelect: () =>
                onReorder(
                  context.entryId,
                  entries[contextIndex + 2]?.id ?? null,
                ),
            },
            {
              label: "Удалить из плейлиста",
              icon: <Trash2 size={16} />,
              disabled: editingDisabled,
              onSelect: () => onRemove(context.entryId),
            },
          ],
        }
      : null;
  const openContext = (event: MouseEvent, entryId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContext({ entryId, x: event.clientX, y: event.clientY });
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
            paddingLeft: row.type === "entry" ? 0 : 20 + row.depth * 12,
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
                currentQueueItem={isCurrent}
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

          if (row.type === "entry") {
            const KindIcon = entryIcons[row.entry.kind];
            const album = row.album;
            const title = album?.track.albumTitle || row.entry.snapshot.title;
            const hasSubtitle = ["track", "album", "folder"].includes(
              row.entry.kind,
            );
            const subtitle = album
              ? album.artists.join(", ") || "Неизвестный исполнитель"
              : row.entry.snapshot.subtitle;
            const year =
              row.entry.kind === "album" ? album?.track.year : undefined;
            return (
              <div
                key={row.key}
                data-testid="playlist-entry"
                data-entry-id={row.entry.id}
                className={`playlist-item playlist-added-item playlist-entity-row ${selected === row.key ? "selected" : ""} ${isCurrent ? "current current-queue-item" : ""} ${dropBefore === row.entry.id ? "playlist-drop-before" : ""}`}
                style={style}
                role="group"
                aria-label={title}
                onContextMenu={(event) => openContext(event, row.entry.id)}
                draggable={!editingDisabled}
                onDragStart={(event) => {
                  event.dataTransfer.setData(playlistDragType, row.entry.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDropBefore(null)}
                onDragOver={dragOver(row.entry.id)}
                onDrop={dropOn(row.entry.id)}
              >
                <button
                  type="button"
                  className="playlist-entity-main"
                  aria-label={[
                    subtitle && hasSubtitle ? subtitle : null,
                    title,
                    year,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  aria-pressed={selected === row.key}
                  aria-expanded={
                    row.collapsible ? !collapsed.has(row.key) : undefined
                  }
                  onClick={(event) => {
                    setSelected(row.key);
                    if (row.collapsible && event.detail < 2) toggle(row.key);
                  }}
                  onDoubleClick={() => play(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      play(row);
                    } else if (
                      event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10")
                    ) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setContext({
                        entryId: row.entry.id,
                        x: rect.left,
                        y: rect.bottom,
                      });
                    }
                  }}
                >
                  <KindIcon
                    size={16}
                    className="playlist-entity-icon"
                    aria-hidden="true"
                  />
                  <span className="playlist-entity-copy">
                    {hasSubtitle && (subtitle || year) ? (
                      <span className="playlist-entity-subtitle">
                        <span title={subtitle}>{subtitle}</span>
                        {year ? (
                          <span className="playlist-entity-year">{year}</span>
                        ) : null}
                      </span>
                    ) : null}
                    <span className="playlist-entity-title" title={title}>
                      {title}
                    </span>
                  </span>
                  <span className="playlist-entity-duration">
                    {duration(row.duration)}
                  </span>
                </button>
              </div>
            );
          }
          return (
            <AlbumHeader
              key={row.key}
              data-testid="playlist-album"
              data-entry-id={row.entry.id}
              className={`playlist-item ${isCurrent ? "current current-queue-item" : ""}`}
              style={style}
              role="group"
              aria-label={
                row.album.track.albumTitle || row.entry.snapshot.title
              }
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
              title={row.album.track.albumTitle || row.entry.snapshot.title}
              subtitle={
                row.album.artists.join(", ") || "Неизвестный исполнитель"
              }
              details={[row.album.track.year, ...row.album.genres]
                .filter(Boolean)
                .join(" · ")}
              coverId={row.album.track.coverId ?? row.entry.snapshot.coverId}
              duration={duration(row.album.duration)}
              collapseControl={collapseControl(row)}
              onClick={() => setSelected(row.key)}
              onDoubleClick={() => play(row)}
              onDragEnd={() => setDropBefore(null)}
              onDragOver={dragOver(row.entry.id)}
              onDrop={dropOn(row.entry.id)}
            />
          );
        })}
      </div>
      {createPortal(
        <ContextMenu menu={menu} onClose={closeContext} />,
        document.body,
      )}
    </div>
  );
}
