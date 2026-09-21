import { useEffect, useRef, useState } from "react";
import { Funnel } from "lucide-react";
import type { CatalogFilter } from "../shared/contracts";

export function RatingFilter({
  kind,
  filter,
  disabled,
  onChange,
}: {
  kind: "album" | "track";
  filter: CatalogFilter;
  disabled?: boolean;
  onChange: (update: (current: CatalogFilter) => CatalogFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const minKey = kind === "album" ? "albumRatingMin" : "trackRatingMin";
  const maxKey = kind === "album" ? "albumRatingMax" : "trackRatingMax";
  const unratedKey = kind === "album" ? "albumUnrated" : "trackUnrated";
  const active =
    filter[minKey] !== null ||
    filter[maxKey] !== null ||
    filter[unratedKey] ||
    (kind === "album" && filter.albumViewed !== "all");
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  const boundary = (key: typeof minKey | typeof maxKey, raw: string) => {
    const value = raw ? Number(raw) : null;
    onChange((current) => {
      const next = { ...current, [key]: value };
      if (
        value !== null &&
        key === minKey &&
        next[maxKey] !== null &&
        value > next[maxKey]!
      )
        next[maxKey] = value;
      if (
        value !== null &&
        key === maxKey &&
        next[minKey] !== null &&
        value < next[minKey]!
      )
        next[minKey] = value;
      return next;
    });
  };
  return (
    <div className="rating-filter" ref={root}>
      <button
        ref={button}
        type="button"
        className={`icon-button filter-button ${active ? "active" : ""}`}
        aria-label={`Фильтр ${kind === "album" ? "альбомов" : "треков"} по оценке`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Funnel size={15} fill={active ? "currentColor" : "none"} />
      </button>
      {open && (
        <div
          className="filter-popover"
          role="dialog"
          aria-label="Фильтр по оценке"
        >
          <div className="filter-boundaries">
            <label>
              От
              <select
                value={filter[minKey] ?? ""}
                onChange={(e) => boundary(minKey, e.target.value)}
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              До
              <select
                value={filter[maxKey] ?? ""}
                onChange={(e) => boundary(maxKey, e.target.value)}
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="filter-check">
            <input
              type="checkbox"
              checked={filter[unratedKey]}
              onChange={(e) =>
                onChange((current) => ({
                  ...current,
                  [unratedKey]: e.target.checked,
                }))
              }
            />{" "}
            Без оценки
          </label>
          {kind === "album" && (
            <label>
              Просмотренность
              <select
                value={filter.albumViewed}
                onChange={(e) =>
                  onChange((current) => ({
                    ...current,
                    albumViewed: e.target.value as CatalogFilter["albumViewed"],
                  }))
                }
              >
                <option value="all">Все</option>
                <option value="unviewed">Непросмотренные</option>
                <option value="viewed">Просмотренные</option>
              </select>
            </label>
          )}
          <button
            type="button"
            className="text-button"
            disabled={!active}
            onClick={() =>
              onChange((current) => ({
                ...current,
                [minKey]: null,
                [maxKey]: null,
                [unratedKey]: false,
                ...(kind === "album" ? { albumViewed: "all" as const } : {}),
              }))
            }
          >
            Сбросить
          </button>
        </div>
      )}
    </div>
  );
}
