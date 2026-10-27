import {
  CircleUserRound,
  DiscAlbum,
  Drama,
  FolderOpen,
  Music,
} from "lucide-react";
import type { PlaylistEntryKind } from "../shared/playlists";
import { duration } from "./api";

const icons = {
  folder: FolderOpen,
  genre: Drama,
  artist: CircleUserRound,
  album: DiscAlbum,
  track: Music,
};

export type PlaylistEntityLabel = {
  kind: PlaylistEntryKind;
  title: string;
  subtitle?: string;
  year?: number | null;
  seconds?: number;
};

export function PlaylistEntityCopy({
  kind,
  title,
  subtitle,
  year,
  seconds,
}: PlaylistEntityLabel) {
  const Icon = icons[kind];
  const hasSubtitle = ["track", "album", "folder"].includes(kind);
  return (
    <>
      <Icon size={16} className="playlist-entity-icon" aria-hidden="true" />
      <span className="playlist-entity-copy">
        {hasSubtitle && (subtitle || year) ? (
          <span className="playlist-entity-subtitle">
            <span title={subtitle}>{subtitle}</span>
            {year ? <span className="playlist-entity-year">{year}</span> : null}
          </span>
        ) : null}
        <span className="playlist-entity-title" title={title}>
          {title}
        </span>
      </span>
      {seconds !== undefined ? (
        <span className="playlist-entity-duration">{duration(seconds)}</span>
      ) : null}
    </>
  );
}
