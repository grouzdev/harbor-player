import { Bookmark, Eye, Star } from "lucide-react";

/** Read-only catalog state; editing belongs to the context menu. */
export function CatalogStateIndicators({
  bookmarked = false,
  viewed = false,
  rating,
  onCover = false,
}: {
  bookmarked?: boolean;
  viewed?: boolean;
  rating?: number | null;
  onCover?: boolean;
}) {
  if (!bookmarked && !viewed && rating == null) return null;
  return (
    <span className={`catalog-state-indicators${onCover ? " on-cover" : ""}`}>
      {bookmarked && (
        <span
          className="catalog-state-mark is-bookmarked"
          role="img"
          aria-label="В закладках"
        >
          <Bookmark size={12} fill="currentColor" aria-hidden="true" />
        </span>
      )}
      {viewed && (
        <span
          className="catalog-state-mark is-viewed"
          role="img"
          aria-label="Просмотрен"
        >
          <Eye size={12} aria-hidden="true" />
        </span>
      )}
      {rating != null && (
        <span
          className="catalog-state-mark is-rated"
          role="img"
          aria-label={`Оценка ${rating} из 5`}
        >
          <Star size={12} fill="currentColor" aria-hidden="true" />
          <span aria-hidden="true">{rating}</span>
        </span>
      )}
    </span>
  );
}
