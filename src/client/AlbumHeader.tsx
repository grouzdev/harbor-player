import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { CoverPlaceholder } from "./CoverPlaceholder";

export type AlbumHeaderProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "title"
> & {
  title: string;
  artists?: readonly string[];
  year?: number | null;
  genres?: readonly string[];
  coverId?: string | null;
  subtitle?: ReactNode;
  details?: ReactNode;
  cover?: ReactNode;
  duration?: ReactNode;
  actions?: ReactNode;
  collapseControl?: ReactNode;
  statusIcon?: ReactNode;
  contentButton?: ComponentPropsWithoutRef<"button">;
  selected?: boolean;
};

/** Shared album presentation; callers own selection, actions and collapse state. */
export function AlbumHeader({
  title,
  artists = [],
  year,
  genres = [],
  coverId,
  subtitle,
  details,
  cover,
  duration,
  actions,
  collapseControl,
  statusIcon,
  contentButton,
  selected = false,
  className,
  ...props
}: AlbumHeaderProps) {
  const copy = (
    <>
      <small>
        {subtitle ?? (artists.join(", ") || "Неизвестный исполнитель")}
      </small>
      <strong>
        {statusIcon && (
          <span className="list-tile-status-icon" aria-hidden="true">
            {statusIcon}
          </span>
        )}
        {title || "Без альбома"}
      </strong>
      {details != null ? (
        <small>{details}</small>
      ) : (
        (year || genres.length > 0) && (
          <small>
            {[year?.toString(), ...genres].filter(Boolean).join(" · ")}
          </small>
        )
      )}
    </>
  );
  return (
    <div
      {...props}
      className={`track-album-header ${selected ? "selected" : ""}${className ? ` ${className}` : ""}`}
    >
      {collapseControl}
      <div className="tiny-cover">
        {cover ??
          (coverId ? (
            <img src={`/api/covers/${coverId}`} alt="" />
          ) : (
            <CoverPlaceholder />
          ))}
      </div>
      {contentButton ? (
        <button
          {...contentButton}
          type="button"
          className="track-album-copy track-album-main"
        >
          {copy}
        </button>
      ) : (
        <div className="track-album-copy">{copy}</div>
      )}
      <div className="track-album-state" data-selection-ignore>
        <div className="track-album-actions">{actions}</div>
        <span className="track-album-duration">{duration}</span>
      </div>
    </div>
  );
}
