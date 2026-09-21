import { useState, type CSSProperties } from "react";
import { Eye, Star, StarOff } from "lucide-react";
import type { CatalogFilter } from "../shared/contracts";

export type RatingRange = readonly [minimum: number, maximum: number];

export function ratingRangeFromFilter(filter: CatalogFilter): RatingRange {
  const { albumRatingMin, albumRatingMax, albumUnrated } = filter;
  if (!albumUnrated && albumRatingMin === null && albumRatingMax === null)
    return [0, 5];
  if (albumUnrated && albumRatingMin === null && albumRatingMax === null)
    return [0, 0];
  return [albumUnrated ? 0 : (albumRatingMin ?? 1), albumRatingMax ?? 5];
}

export function withSharedRatingRange(
  filter: CatalogFilter,
  minimum: number,
  maximum: number,
): CatalogFilter {
  const min = Math.max(0, Math.min(5, Math.min(minimum, maximum)));
  const max = Math.max(min, Math.min(5, maximum));
  const inactive = min === 0 && max === 5;
  const unrated = !inactive && min === 0;
  const ratingMin = min === 0 ? null : min;
  const ratingMax = inactive || max === 5 || max === 0 ? null : max;
  return {
    ...filter,
    albumRatingMin: ratingMin,
    albumRatingMax: ratingMax,
    albumUnrated: unrated,
    trackRatingMin: ratingMin,
    trackRatingMax: ratingMax,
    trackUnrated: unrated,
  };
}

function RangeValue({ value }: { value: number }) {
  return (
    <span className="catalog-rating-range-value" aria-hidden="true">
      {value === 0 ? (
        <StarOff size={16} />
      ) : (
        <>
          <span>{value}</span>
          <Star size={14} />
        </>
      )}
    </span>
  );
}

export function CatalogUserFilters({
  filter,
  disabled = false,
  onChange,
}: {
  filter: CatalogFilter;
  disabled?: boolean;
  onChange: (update: (current: CatalogFilter) => CatalogFilter) => void;
}) {
  const [activeHandle, setActiveHandle] = useState<"minimum" | "maximum">(
    "maximum",
  );
  const [minimum, maximum] = ratingRangeFromFilter(filter);
  const commit = (nextMinimum: number, nextMaximum: number) =>
    onChange((current) =>
      withSharedRatingRange(current, nextMinimum, nextMaximum),
    );
  const start = `${minimum * 20}%`;
  const end = `${100 - maximum * 20}%`;
  const unviewedOnly = filter.albumViewed === "unviewed";
  return (
    <div className="catalog-user-filters" aria-label="Фильтры каталога">
      <div className={`catalog-rating-range ${disabled ? "disabled" : ""}`}>
        <RangeValue value={minimum} />
        <div
          className="catalog-rating-range-track"
          style={
            { "--range-start": start, "--range-end": end } as CSSProperties
          }
        >
          <input
            className={`rating-range-input minimum ${activeHandle === "minimum" ? "active" : ""}`}
            type="range"
            min="0"
            max="5"
            step="1"
            value={minimum}
            disabled={disabled}
            aria-label="Минимальная оценка"
            onFocus={() => setActiveHandle("minimum")}
            onPointerDown={() => setActiveHandle("minimum")}
            onChange={(event) =>
              commit(Math.min(Number(event.target.value), maximum), maximum)
            }
          />
          <input
            className={`rating-range-input maximum ${activeHandle === "maximum" ? "active" : ""}`}
            type="range"
            min="0"
            max="5"
            step="1"
            value={maximum}
            disabled={disabled}
            aria-label="Максимальная оценка"
            onFocus={() => setActiveHandle("maximum")}
            onPointerDown={() => setActiveHandle("maximum")}
            onChange={(event) =>
              commit(minimum, Math.max(Number(event.target.value), minimum))
            }
          />
        </div>
        <RangeValue value={maximum} />
      </div>
      <button
        type="button"
        role="switch"
        className={`unviewed-filter-switch ${unviewedOnly ? "active" : ""}`}
        aria-label="Только непросмотренные"
        aria-checked={unviewedOnly}
        title="Только непросмотренные"
        disabled={disabled}
        onClick={() =>
          onChange((current) => ({
            ...current,
            albumViewed:
              current.albumViewed === "unviewed" ? "all" : "unviewed",
          }))
        }
      >
        <span className="unviewed-filter-thumb">
          <Eye size={13} aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}
