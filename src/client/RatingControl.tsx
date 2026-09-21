import { useEffect, useRef, useState } from "react";
import type { CatalogUserStatePatch, UserStateKind } from "../shared/contracts";

export type UserStateChange = (
  kind: UserStateKind,
  ids: readonly string[],
  patch: CatalogUserStatePatch,
) => void;

export function RatingControl({
  kind,
  id,
  rating,
  pending = false,
  compact = false,
  onChange,
}: {
  kind: UserStateKind;
  id: string;
  rating: number | null;
  pending?: boolean;
  compact?: boolean;
  onChange: UserStateChange;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  const choose = (value: number | null) => {
    onChange(kind, [id], {
      rating: value === rating ? null : (value as 1 | 2 | 3 | 4 | 5 | null),
    });
    if (compact) {
      setOpen(false);
      trigger.current?.focus();
    }
  };
  const stars = (
    <div className="rating-stars" role="group" aria-label="Оценка">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          type="button"
          key={value}
          data-selection-ignore
          disabled={pending}
          className={value <= (rating || 0) ? "filled" : ""}
          aria-label={`${value} из 5`}
          aria-pressed={rating === value}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            choose(value);
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
  if (!compact) return <div className="rating-control">{stars}</div>;
  return (
    <div className="rating-control compact" ref={root} data-selection-ignore>
      <button
        ref={trigger}
        type="button"
        className={`compact-rating ${rating ? "rated" : ""}`}
        disabled={pending}
        aria-label={rating ? `Оценка ${rating} из 5` : "Без оценки"}
        aria-expanded={open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        ★{rating ? ` ${rating}` : ""}
      </button>
      {open && (
        <div
          className="rating-popover"
          role="dialog"
          aria-label="Изменить оценку"
        >
          {stars}
          <button
            type="button"
            className="rating-clear"
            disabled={pending || rating === null}
            onClick={(event) => {
              event.stopPropagation();
              choose(null);
            }}
          >
            Без оценки
          </button>
        </div>
      )}
    </div>
  );
}

export function ViewedToggle({
  id,
  viewed,
  pending = false,
  onChange,
  className = "",
}: {
  id: string;
  viewed: boolean;
  pending?: boolean;
  onChange: UserStateChange;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-selection-ignore
      className={`viewed-toggle ${viewed ? "viewed" : ""} ${className}`}
      aria-label={
        viewed ? "Отметить непросмотренным" : "Отметить просмотренным"
      }
      aria-pressed={viewed}
      disabled={pending}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onChange("album", [id], { viewed: !viewed });
      }}
    >
      ✓
    </button>
  );
}
