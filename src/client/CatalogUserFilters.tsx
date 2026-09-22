import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Eye, Star, StarOff } from "lucide-react";
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

function RangeValue({
  value,
  onClick,
  label,
  disabled = false,
}: {
  value: number;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="catalog-rating-range-value catalog-rating-range-value-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {value === 0 ? (
        <StarOff size={19} aria-hidden="true" />
      ) : (
        <>
          <span>{value}</span>
          <Star size={19} aria-hidden="true" />
        </>
      )}
    </button>
  );
}

function RatingFilterPopover({
  anchor,
  minimum,
  maximum,
  disabled,
  onChange,
  onClose,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  minimum: number;
  maximum: number;
  disabled: boolean;
  onChange: (minimum: number, maximum: number) => void;
  onClose: () => void;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    const target = anchor.current?.getBoundingClientRect();
    const node = popover.current;
    if (!target || !node) return;
    const box = node.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const below = target.bottom + gap;
    const top =
      below + box.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, target.top - box.height - gap);
    const idealLeft = target.left + target.width / 2 - box.width / 2;
    const left = Math.max(
      margin,
      Math.min(idealLeft, window.innerWidth - box.width - margin),
    );
    setPosition({ left, top });
  }, [anchor]);

  useEffect(() => {
    const closeForPointer = (event: PointerEvent) => {
      if (
        !popover.current?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        onClose();
    };
    const closeForKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeForPointer, true);
    document.addEventListener("keydown", closeForKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", closeForPointer, true);
      document.removeEventListener("keydown", closeForKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={popover}
      className="catalog-rating-filter-popover"
      role="dialog"
      aria-label="Фильтр по рейтингу"
      style={position}
    >
      <RangeValue
        value={minimum}
        label="Установить минимальную оценку 0"
        disabled={disabled || minimum === 0}
        onClick={() => onChange(0, maximum)}
      />
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
          onChange(nextMinimum, nextMaximum)
        }
      />
      <RangeValue
        value={maximum}
        label="Установить максимальную оценку 5"
        disabled={disabled || maximum === 5}
        onClick={() => onChange(minimum, 5)}
      />
    </div>,
    document.body,
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
  const [ratingOpen, setRatingOpen] = useState(false);
  const ratingTrigger = useRef<HTMLButtonElement>(null);
  const commit = (nextMinimum: number, nextMaximum: number) =>
    onChange((current) =>
      withSharedRatingRange(current, nextMinimum, nextMaximum),
    );
  const unviewedOnly = filter.albumViewed === "unviewed";
  const ratingFilterActive = minimum !== 0 || maximum !== 5;
  const closeRating = () => {
    setRatingOpen(false);
    requestAnimationFrame(() => ratingTrigger.current?.focus());
  };
  return (
    <div className="catalog-user-filters" aria-label="Фильтры каталога">
      <button
        type="button"
        className={`icon-button catalog-filter-button ${unviewedOnly ? "active" : ""}`}
        aria-label="Только непросмотренные"
        aria-pressed={unviewedOnly}
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
        <Eye size={19} aria-hidden="true" />
      </button>
      <button
        ref={ratingTrigger}
        type="button"
        className={`icon-button catalog-filter-button ${ratingFilterActive ? "active" : ""}`}
        aria-label="Фильтр по рейтингу"
        aria-expanded={ratingOpen}
        title="Фильтр по рейтингу"
        disabled={disabled}
        onClick={() => setRatingOpen((open) => !open)}
      >
        <Star size={19} aria-hidden="true" />
      </button>
      {ratingOpen && (
        <RatingFilterPopover
          anchor={ratingTrigger}
          minimum={minimum}
          maximum={maximum}
          disabled={disabled}
          onChange={commit}
          onClose={closeRating}
        />
      )}
    </div>
  );
}
