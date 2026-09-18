import { Bookmark as BookmarkIcon, RefreshCw } from "lucide-react";
import type { BookmarkKind } from "../shared/contracts";

const labels: Record<BookmarkKind, string> = {
  artist: "исполнителя",
  album: "альбом",
  track: "трек",
};

export type BookmarkChange = (
  kind: BookmarkKind,
  id: string,
  bookmarked: boolean,
) => void;

export function BookmarkToggle({
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
  const action = bookmarked
    ? `Удалить ${labels[kind]} «${label}» из закладок`
    : `Добавить ${labels[kind]} «${label}» в закладки`;
  return (
    <button
      type="button"
      className={`bookmark-toggle ${bookmarked ? "bookmarked" : ""} ${className}`}
      data-selection-ignore
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
