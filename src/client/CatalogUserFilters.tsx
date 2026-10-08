import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Bookmark,
  Check,
  Clock3,
  Eye,
  Plus,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import { emptyFilter, type CatalogFilter } from "../shared/contracts";
import { RangeSlider } from "./RangeSlider";
import { ExpandingSearch } from "./ExpandingSearch";

export type RatingRange = readonly [minimum: number, maximum: number];

export const recentlyAddedDayOptions = [1, 3, 7, 14, 30] as const;
export type RecentlyAddedDays = (typeof recentlyAddedDayOptions)[number];

export function recentlyAddedFilterLabel(days: RecentlyAddedDays): string {
  const label =
    days === 1 ? "1 день" : days < 5 ? `${days} дня` : `${days} дней`;
  return `Добавлено ${label} назад`;
}

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
  { kind: "unviewed", label: "Не просмотрено", Icon: Eye },
  { kind: "rating", label: "Рейтинг", Icon: Star },
  { kind: "recent", label: "Недавние", Icon: Clock3 },
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
  const [collapsed, setCollapsed] = useState(!search.trim());
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [ratingEditing, setRatingEditing] = useState(false);
  const [recentEditing, setRecentEditing] = useState(false);
  const [neutralRating, setNeutralRating] = useState(false);
  const [order, setOrder] = useState<FilterKind[]>([]);
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
  // Reconcile externally changed filters without losing insertion order.
  const visible = order.filter((kind) => active[kind]);
  for (const { kind } of filterDefinitions) {
    if (active[kind] && !visible.includes(kind)) visible.push(kind);
  }
  const visibleKey = visible.join();
  if (visibleKey !== order.join()) setOrder(visible);
  if (previousFilter !== filter) {
    setPreviousFilter(filter);
    if (reset) setNeutralRating(false);
    if (ratingEditing && (reset || (!ratingActive && !neutralRating))) {
      setRatingEditing(false);
    }
    if (recentEditing && (reset || filter.recentlyAddedDays === null))
      setRecentEditing(false);
  }
  const addable = filterDefinitions.filter(({ kind }) => !active[kind]);

  useEffect(() => {
    if (disabled) {
      setMenuOpen(false);
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

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const update = () => {
      const target = trigger.current?.getBoundingClientRect();
      const box = menu.current?.getBoundingClientRect();
      if (!target || !box) return;
      setPosition({
        left: Math.max(
          8,
          Math.min(target.left, window.innerWidth - box.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(target.bottom + 4, window.innerHeight - box.height - 8),
        ),
      });
    };
    update();
    const close = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setMenuOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [menuOpen, collapsed, bookmarksError, visibleKey]);

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
    setMenuOpen(false);
    if (kind === "rating") {
      setOrder([...visible, "rating"]);
      setNeutralRating(true);
      onChange((current) => withSharedRatingRange(current, 0, 5));
      setRatingEditing(true);
    } else if (kind === "recent") {
      setOrder([...visible, "recent"]);
      onChange((current) => ({ ...current, recentlyAddedDays: 1 }));
      setRecentEditing(true);
    } else {
      setOrder([...visible, kind]);
      changeBoolean(kind, true);
    }
  };
  const remove = (kind: FilterKind) => {
    setOrder(visible.filter((item) => item !== kind));
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
        <span>{recentlyAddedFilterLabel(filter.recentlyAddedDays)}</span>
        <RangeSlider
          className="catalog-filter-slider"
          value={recentlyAddedDayOptions.indexOf(filter.recentlyAddedDays)}
          min={0}
          max={recentlyAddedDayOptions.length - 1}
          step={1}
          ariaLabel="Период недавнего добавления"
          disabled={disabled}
          onChange={(index) =>
            onChange((current) => ({
              ...current,
              recentlyAddedDays: recentlyAddedDayOptions[index]!,
            }))
          }
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
      <ExpandingSearch
        value={search}
        onChange={onSearchChange}
        onCollapsedChange={setCollapsed}
      />
      <div className={`catalog-filter-items${disabled ? " is-disabled" : ""}`}>
        {visible.map((kind) => {
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
          const { label, Icon } = filterDefinitions.find(
            (item) => item.kind === kind,
          )!;
          const busy = kind === "bookmarks" && bookmarksBusy;
          const error = kind === "bookmarks" && bookmarksError;
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
        {!visible.includes("rating") && renderRatingEditor()}
        {!visible.includes("recent") && renderRecentEditor()}
        <button
          ref={trigger}
          type="button"
          className="icon-button catalog-filter-add"
          aria-label="Добавить фильтр"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={
            disabled ||
            Boolean(ratingEditing || recentEditing) ||
            !addable.length
          }
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Plus size={18} />
        </button>
      </div>
      {trailingControls}
      {menuOpen &&
        createPortal(
          <div
            ref={menu}
            className="catalog-filter-menu"
            role="menu"
            aria-label="Добавить фильтр"
            style={position}
          >
            {addable.map(({ kind, label, Icon }) => (
              <button
                type="button"
                role="menuitem"
                key={kind}
                disabled={disabled || (kind === "bookmarks" && bookmarksBusy)}
                className={
                  kind === "bookmarks" && bookmarksError
                    ? "is-error"
                    : undefined
                }
                title={
                  kind === "recent"
                    ? "Выбрать период недавнего добавления"
                    : undefined
                }
                onClick={() => add(kind)}
              >
                {kind === "bookmarks" && bookmarksBusy ? (
                  <RefreshCw size={16} className="spinning" />
                ) : (
                  <Icon size={16} />
                )}
                {kind === "bookmarks" && bookmarksError
                  ? "Закладки: повторить загрузку"
                  : label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
