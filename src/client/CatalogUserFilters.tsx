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
  Search,
  Star,
  X,
} from "lucide-react";
import { emptyFilter, type CatalogFilter } from "../shared/contracts";
import { RangeSlider } from "./RangeSlider";

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
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const pointerDown = useRef(false);
  const collapsed = !search.trim() && !searchFocused;
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [ratingDraft, setRatingDraft] = useState<RatingRange | null>(null);
  const [recentDraft, setRecentDraft] = useState<RecentlyAddedDays | null>(
    null,
  );
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
    if (
      ratingDraft &&
      (reset ||
        ratingRangeFromFilter(previousFilter).join() !==
          [minimum, maximum].join())
    ) {
      setRatingDraft(null);
    }
    if (
      recentDraft &&
      (reset || previousFilter.recentlyAddedDays !== filter.recentlyAddedDays)
    )
      setRecentDraft(null);
  }
  const addable = filterDefinitions.filter(({ kind }) => !active[kind]);

  useEffect(() => {
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const press = () => {
      pointerDown.current = true;
    };
    const release = () => {
      pointerDown.current = false;
      // Keep the clicked control in place until pointerup has dispatched click.
      // Otherwise collapsing an empty search on blur moves the filter away.
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        setSearchFocused(document.activeElement === searchInput.current);
      }, 0);
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    return () => {
      clearTimeout(releaseTimer);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setMenuOpen(false);
      setRatingDraft(null);
      setRecentDraft(null);
    }
  }, [disabled]);

  useEffect(() => {
    if (!ratingDraft && !recentDraft) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRatingDraft(null);
        setRecentDraft(null);
      }
    };
    document.addEventListener("keydown", cancel);
    return () => document.removeEventListener("keydown", cancel);
  }, [ratingDraft, recentDraft]);

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
    if (kind === "rating") setRatingDraft([0, 5]);
    else if (kind === "recent") setRecentDraft(1);
    else {
      setOrder([...visible, kind]);
      changeBoolean(kind, true);
    }
  };
  const remove = (kind: FilterKind) => {
    setOrder(visible.filter((item) => item !== kind));
    if (kind === "rating") {
      setNeutralRating(false);
      setRatingDraft(null);
      onChange((current) => withSharedRatingRange(current, 0, 5));
    } else if (kind === "recent") {
      setRecentDraft(null);
      onChange((current) => ({ ...current, recentlyAddedDays: null }));
    } else changeBoolean(kind, false);
  };
  const renderRatingEditor = () =>
    ratingDraft && (
      <div
        className="catalog-filter-editor"
        role="group"
        aria-label="Фильтр по рейтингу"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setRatingDraft(null);
          }
        }}
      >
        <span>
          Рейтинг: от {ratingDraft[0]} до {ratingDraft[1]}
        </span>
        <RangeSlider
          className="catalog-filter-slider"
          variant="double"
          min={0}
          max={5}
          step={1}
          values={ratingDraft}
          ariaLabels={["Минимальная оценка", "Максимальная оценка"]}
          disabled={disabled}
          onChange={setRatingDraft}
        />
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Применить рейтинг"
          disabled={disabled}
          onClick={() => {
            setNeutralRating(ratingDraft[0] === 0 && ratingDraft[1] === 5);
            if (!visible.includes("rating")) setOrder([...visible, "rating"]);
            onChange((current) =>
              withSharedRatingRange(current, ratingDraft[0], ratingDraft[1]),
            );
            setRatingDraft(null);
          }}
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Отменить изменение рейтинга"
          onClick={() => setRatingDraft(null)}
        >
          <X size={16} />
        </button>
      </div>
    );

  const renderRecentEditor = () =>
    recentDraft && (
      <div
        className="catalog-filter-editor"
        role="group"
        aria-label="Фильтр по времени добавления"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setRecentDraft(null);
          }
        }}
      >
        <span>{recentlyAddedFilterLabel(recentDraft)}</span>
        <RangeSlider
          className="catalog-filter-slider"
          value={recentlyAddedDayOptions.indexOf(recentDraft)}
          min={0}
          max={recentlyAddedDayOptions.length - 1}
          step={1}
          ariaLabel="Период недавнего добавления"
          disabled={disabled}
          onChange={(index) => setRecentDraft(recentlyAddedDayOptions[index]!)}
        />
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Применить период недавнего добавления"
          disabled={disabled}
          onClick={() => {
            if (!visible.includes("recent")) setOrder([...visible, "recent"]);
            onChange((current) => ({
              ...current,
              recentlyAddedDays: recentDraft,
            }));
            setRecentDraft(null);
          }}
        >
          <Check size={16} />
        </button>
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Отменить изменение периода недавнего добавления"
          onClick={() => setRecentDraft(null)}
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
      <div
        className={`catalog-search${collapsed ? " is-collapsed" : " search"}`}
        title={collapsed ? "Поиск музыки" : undefined}
      >
        <input
          ref={searchInput}
          aria-label="Поиск музыки"
          placeholder={collapsed ? "" : "Треки, артисты, альбомы"}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => {
            if (!pointerDown.current) setSearchFocused(false);
          }}
        />
        {collapsed && (
          <button
            type="button"
            className="icon-button"
            aria-label="Открыть поиск"
            onClick={() => searchInput.current?.focus()}
          >
            <Search size={19} aria-hidden="true" />
          </button>
        )}
        {search.trim() && (
          <button
            type="button"
            className="catalog-filter-small-button"
            aria-label="Очистить поиск"
            onClick={() => {
              onSearchChange("");
              searchInput.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className={`catalog-filter-items${disabled ? " is-disabled" : ""}`}>
        {visible.map((kind) => {
          if (kind === "rating" && ratingDraft)
            return (
              <div className="catalog-filter-editor-slot" key={kind}>
                {renderRatingEditor()}
              </div>
            );
          if (kind === "recent" && recentDraft)
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
                    disabled || busy || Boolean(ratingDraft || recentDraft)
                  }
                  onClick={() =>
                    error
                      ? onRetryBookmarks()
                      : kind === "rating"
                        ? setRatingDraft([minimum, maximum])
                        : setRecentDraft(filter.recentlyAddedDays!)
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
            disabled || Boolean(ratingDraft || recentDraft) || !addable.length
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
