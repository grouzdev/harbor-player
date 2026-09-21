import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, Star } from "lucide-react";
import type { CatalogUserStatePatch, UserStateKind } from "../shared/contracts";

export type UserStateChange = (
  kind: UserStateKind,
  ids: readonly string[],
  patch: CatalogUserStatePatch,
) => void;

type RatingAnchor = RefObject<HTMLElement | null> | { x: number; y: number };

function anchorBox(anchor: RatingAnchor) {
  if ("current" in anchor)
    return anchor.current?.getBoundingClientRect() ?? null;
  return {
    left: anchor.x,
    right: anchor.x,
    top: anchor.y,
    bottom: anchor.y,
    width: 0,
    height: 0,
    x: anchor.x,
    y: anchor.y,
    toJSON: () => ({}),
  } satisfies DOMRect;
}

export function RatingPopover({
  anchor,
  rating,
  pending = false,
  onChoose,
  onClose,
}: {
  anchor: RatingAnchor;
  rating: number | null;
  pending?: boolean;
  onChoose: (rating: 1 | 2 | 3 | 4 | 5 | null) => void;
  onClose: () => void;
}) {
  const popover = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    const target = anchorBox(anchor);
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
      const trigger = "current" in anchor ? anchor.current : null;
      if (
        !popover.current?.contains(event.target as Node) &&
        !trigger?.contains(event.target as Node)
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
      className="rating-popover"
      role="dialog"
      aria-label="Изменить оценку"
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="rating-stars" role="group" aria-label="Оценка">
        {([1, 2, 3, 4, 5] as const).map((value) => (
          <button
            type="button"
            key={value}
            disabled={pending}
            className={value <= (rating || 0) ? "filled" : ""}
            aria-label={`${value} из 5`}
            aria-pressed={rating === value}
            onClick={() => onChoose(value === rating ? null : value)}
          >
            <Star
              size={18}
              fill={value <= (rating || 0) ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function RatingControl({
  kind,
  id,
  rating,
  pending = false,
  onChange,
  className = "",
}: {
  kind: UserStateKind;
  id: string;
  rating: number | null;
  pending?: boolean;
  onChange: UserStateChange;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <span className={`rating-control ${className}`} data-selection-ignore>
      <button
        ref={trigger}
        type="button"
        className={`compact-rating ${rating ? "rated" : ""}`}
        disabled={pending}
        aria-label={rating ? `Оценка ${rating} из 5` : "Без оценки"}
        aria-expanded={open}
        title={rating ? `Оценка ${rating} из 5` : "Без оценки"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <Star size={15} fill={rating ? "currentColor" : "none"} />
        {rating && <span>{rating}</span>}
      </button>
      {open && (
        <RatingPopover
          anchor={trigger}
          rating={rating}
          pending={pending}
          onChoose={(value) => {
            onChange(kind, [id], { rating: value });
            close();
          }}
          onClose={close}
        />
      )}
    </span>
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
      className={`icon-button viewed-toggle ${viewed ? "viewed" : ""} ${className}`}
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
      {viewed ? (
        <EyeOff size={17} aria-hidden="true" />
      ) : (
        <Eye size={17} aria-hidden="true" />
      )}
    </button>
  );
}
