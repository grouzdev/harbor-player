import { type ReactNode, useEffect, useState } from "react";
import { Bookmark, Check, Clock3, Eye, RefreshCw, Star, X } from "lucide-react";
import { emptyFilter, type CatalogFilter } from "../shared/contracts";
import { RangeSlider } from "./RangeSlider";
import { ExpandingSearch } from "./ExpandingSearch";

export type RatingRange = readonly [minimum: number, maximum: number];

const recentPeriodStorageKey = "harbor-player-recently-added-days";

function readRecentPeriod(): number {
  try {
    const days = Number(localStorage.getItem(recentPeriodStorageKey));
    if (Number.isInteger(days) && days >= 1 && days <= 30) return days;
  } catch {
    // Storage may be unavailable; the filter should still work.
  }
  return 1;
}

function rememberRecentPeriod(days: number) {
  try {
    localStorage.setItem(recentPeriodStorageKey, String(days));
  } catch {
    // Remembering the period is optional when storage is unavailable.
  }
}

export function recentlyAddedFilterLabel(days: number): string {
  const lastDigit = days % 10;
  const label =
    days >= 11 && days <= 14
      ? `${days} дней`
      : lastDigit === 1
        ? `${days} день`
        : lastDigit >= 2 && lastDigit <= 4
          ? `${days} дня`
          : `${days} дней`;
  return `Добавлено ${label} назад`;
}

const recentPeriodLabels = Array.from({ length: 30 }, (_, index) =>
  recentlyAddedFilterLabel(index + 1),
);

export function ratingFilterLabel(minimum: number, maximum: number): string {
  return minimum === 0 && maximum === 0
    ? "Без рейтинга"
    : `Рейтинг: от ${minimum} до ${maximum}`;
}

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

const filterDefinitions = [
  { kind: "bookmarks", label: "Закладки", Icon: Bookmark },
  { kind: "recent", label: "Недавние", Icon: Clock3 },
  { kind: "unviewed", label: "Не просмотрено", Icon: Eye },
  { kind: "rating", label: "Рейтинг", Icon: Star },
] as const;
type FilterKind = (typeof filterDefinitions)[number]["kind"];

export function CatalogUserFilters({
  filter,
  search,
  onSearchChange,
  disabled = false,
  onChange,
  bookmarksBusy,
  bookmarksError,
  onRetryBookmarks,
  trailingControls,
}: {
  filter: CatalogFilter;
  search: string;
  onSearchChange: (value: string) => void;
  disabled?: boolean;
  onChange: (update: (current: CatalogFilter) => CatalogFilter) => void;
  bookmarksBusy: boolean;
  bookmarksError: boolean;
  onRetryBookmarks: () => void;
  trailingControls?: ReactNode;
}) {
  const [ratingEditing, setRatingEditing] = useState(false);
  const [recentEditing, setRecentEditing] = useState(false);
  const [neutralRating, setNeutralRating] = useState(false);
  const [previousFilter, setPreviousFilter] = useState(filter);
  const [minimum, maximum] = ratingRangeFromFilter(filter);
  const ratingActive = minimum !== 0 || maximum !== 5;
  const reset = previousFilter !== filter && filter === emptyFilter;
  const active: Record<FilterKind, boolean> = {
    bookmarks: filter.bookmarksOnly,
    unviewed: filter.albumViewed === "unviewed",
    rating: ratingActive || (neutralRating && !reset),
    recent: filter.recentlyAddedDays !== null,
  };
  if (previousFilter !== filter) {
    setPreviousFilter(filter);
    if (reset) setNeutralRating(false);
    if (ratingEditing && (reset || (!ratingActive && !neutralRating))) {
      setRatingEditing(false);
    }
    if (recentEditing && (reset || filter.recentlyAddedDays === null))
      setRecentEditing(false);
  }
  useEffect(() => {
    if (disabled) {
      setRatingEditing(false);
      setRecentEditing(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!ratingEditing && !recentEditing) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRatingEditing(false);
        setRecentEditing(false);
      }
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, [ratingEditing, recentEditing]);

  const changeBoolean = (kind: FilterKind, value: boolean) => {
    onChange((current) => ({
      ...current,
      ...(kind === "bookmarks" ? { bookmarksOnly: value } : {}),
      ...(kind === "unviewed"
        ? { albumViewed: value ? ("unviewed" as const) : ("all" as const) }
        : {}),
    }));
  };
  const add = (kind: FilterKind) => {
    if (kind === "bookmarks" && bookmarksError) {
      onRetryBookmarks();
      return;
    }
    if (kind === "rating") {
      setNeutralRating(true);
      onChange((current) => withSharedRatingRange(current, 0, 5));
      setRatingEditing(true);
    } else if (kind === "recent") {
      const days = readRecentPeriod();
      onChange((current) => ({ ...current, recentlyAddedDays: days }));
      setRecentEditing(false);
    } else {
      changeBoolean(kind, true);
    }
  };
  const remove = (kind: FilterKind) => {
    if (kind === "rating") {
      setNeutralRating(false);
      setRatingEditing(false);
      onChange((current) => withSharedRatingRange(current, 0, 5));
    } else if (kind === "recent") {
      setRecentEditing(false);
      onChange((current) => ({ ...current, recentlyAddedDays: null }));
    } else changeBoolean(kind, false);
  };
  const renderRatingEditor = () =>
    ratingEditing && (
      <div
        className="catalog-filter-editor"
        role="group"
        aria-label="Фильтр по рейтингу"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setRatingEditing(false);
          }
        }}
      >
        <span>
          Рейтинг: от {minimum} до {maximum}
        </span>
        <RangeSlider
          className="catalog-filter-slider"
          variant="double"
          min={0}
          max={5}
          step={1}
          values={[minimum, maximum]}
          ariaLabels={["Минимальная оценка", "Максимальная оценка"]}
          disabled={disabled}
          onChange={(values) => {
            setNeutralRating(values[0] === 0 && values[1] === 5);
            onChange((current) =>
              withSharedRatingRange(current, values[0], values[1]),
            );
          }}
        />
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Закрыть изменение рейтинга"
          disabled={disabled}
          onClick={() => setRatingEditing(false)}
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Удалить фильтр «Рейтинг»"
          disabled={disabled}
          onClick={() => remove("rating")}
        >
          <X size={16} />
        </button>
      </div>
    );

  const renderRecentEditor = () =>
    recentEditing &&
    filter.recentlyAddedDays !== null && (
      <div
        className="catalog-filter-editor"
        role="group"
        aria-label="Фильтр по времени добавления"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setRecentEditing(false);
          }
        }}
      >
        <span className="catalog-recent-period-label">
          {recentPeriodLabels.map((label) => (
            <span
              key={label}
              className="catalog-recent-period-sizer"
              aria-hidden="true"
            >
              {label}
            </span>
          ))}
          <span>{recentlyAddedFilterLabel(filter.recentlyAddedDays)}</span>
        </span>
        <RangeSlider
          className="catalog-filter-slider"
          value={filter.recentlyAddedDays}
          min={1}
          max={30}
          step={1}
          ariaLabel="Период недавнего добавления"
          disabled={disabled}
          onChange={(days) => {
            rememberRecentPeriod(days);
            onChange((current) => ({
              ...current,
              recentlyAddedDays: days,
            }));
          }}
        />
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Закрыть изменение периода недавнего добавления"
          disabled={disabled}
          onClick={() => setRecentEditing(false)}
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Удалить фильтр «Недавние»"
          disabled={disabled}
          onClick={() => remove("recent")}
        >
          <X size={16} />
        </button>
      </div>
    );

  return (
    <div
      className="catalog-user-filters"
      aria-label="Поиск и фильтры каталога"
      data-window-control
    >
      <ExpandingSearch value={search} onChange={onSearchChange} />
      <div className={`catalog-filter-items${disabled ? " is-disabled" : ""}`}>
        {filterDefinitions.map(({ kind, label, Icon }) => {
          if (kind === "rating" && ratingEditing)
            return (
              <div className="catalog-filter-editor-slot" key={kind}>
                {renderRatingEditor()}
              </div>
            );
          if (kind === "recent" && recentEditing)
            return (
              <div className="catalog-filter-editor-slot" key={kind}>
                {renderRecentEditor()}
              </div>
            );
          const busy = kind === "bookmarks" && bookmarksBusy;
          const error = kind === "bookmarks" && bookmarksError;
          if (!active[kind])
            return (
              <button
                type="button"
                key={kind}
                className={`icon-button catalog-filter-add${error ? " is-error" : ""}`}
                aria-label={
                  error
                    ? "Повторить загрузку закладок"
                    : `Добавить фильтр «${label}»`
                }
                title={
                  error
                    ? "Не удалось загрузить закладки. Нажмите, чтобы повторить"
                    : `Добавить фильтр «${label}»`
                }
                disabled={
                  disabled || busy || Boolean(ratingEditing || recentEditing)
                }
                onClick={() => add(kind)}
              >
                {busy ? (
                  <RefreshCw size={16} className="spinning" />
                ) : (
                  <Icon size={18} />
                )}
              </button>
            );
          const title = error
            ? "Не удалось загрузить закладки. Нажмите, чтобы повторить"
            : kind === "recent"
              ? recentlyAddedFilterLabel(filter.recentlyAddedDays!)
              : label;
          const content = (
            <>
              {busy ? (
                <RefreshCw size={16} className="spinning" />
              ) : (
                <Icon size={16} />
              )}
              <span>
                {kind === "rating"
                  ? ratingFilterLabel(minimum, maximum)
                  : kind === "recent"
                    ? recentlyAddedFilterLabel(filter.recentlyAddedDays!)
                    : label}
              </span>
            </>
          );
          return (
            <div
              key={kind}
              className={`catalog-filter-chip${error ? " is-error" : ""}`}
              data-filter={kind}
              title={title}
            >
              {kind === "rating" || kind === "recent" || error ? (
                <button
                  type="button"
                  className="catalog-filter-chip-label"
                  aria-label={
                    error
                      ? "Повторить загрузку закладок"
                      : kind === "rating"
                        ? "Редактировать рейтинг"
                        : "Редактировать период недавнего добавления"
                  }
                  disabled={
                    disabled || busy || Boolean(ratingEditing || recentEditing)
                  }
                  onClick={() =>
                    error
                      ? onRetryBookmarks()
                      : kind === "rating"
                        ? setRatingEditing(true)
                        : setRecentEditing(true)
                  }
                >
                  {content}
                </button>
              ) : (
                <span className="catalog-filter-chip-label">{content}</span>
              )}
              <button
                type="button"
                className="catalog-filter-small-button"
                aria-label={`Удалить фильтр «${label}»`}
                disabled={disabled || busy}
                onClick={() => remove(kind)}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {trailingControls}
    </div>
  );
}
