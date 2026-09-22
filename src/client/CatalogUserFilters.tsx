import { Eye, EyeOff, Star, StarOff } from "lucide-react";
import type { CatalogFilter } from "../shared/contracts";
import { RangeSlider } from "./RangeSlider";

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
        <StarOff size={19} />
      ) : (
        <>
          <span>{value}</span>
          <Star size={19} />
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
  const [minimum, maximum] = ratingRangeFromFilter(filter);
  const commit = (nextMinimum: number, nextMaximum: number) =>
    onChange((current) =>
      withSharedRatingRange(current, nextMinimum, nextMaximum),
    );
  const unviewedOnly = filter.albumViewed === "unviewed";
  return (
    <div className="catalog-user-filters" aria-label="Фильтры каталога">
      <div className={`catalog-rating-range ${disabled ? "disabled" : ""}`}>
        <RangeValue value={minimum} />
        <RangeSlider
          className="catalog-rating-range-track"
          variant="double"
          min={0}
          max={5}
          step={1}
          values={[minimum, maximum]}
          ariaLabels={["Минимальная оценка", "Максимальная оценка"]}
          disabled={disabled}
          onChange={([nextMinimum, nextMaximum]) =>
            commit(nextMinimum, nextMaximum)
          }
        />
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
          {unviewedOnly ? (
            <Eye size={19} aria-hidden="true" />
          ) : (
            <EyeOff size={19} aria-hidden="true" />
          )}
        </span>
      </button>
    </div>
  );
}
