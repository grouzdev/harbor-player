import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export interface ValueBubbleProps {
  /** Viewport coordinates of the point the bubble describes. */
  anchor: { x: number; y: number };
  children: string;
}

/** Non-interactive value preview, rendered outside clipping containers. */
export function ValueBubble({ anchor, children }: ValueBubbleProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!bubble) return;
    const { width, height } = bubble.getBoundingClientRect();
    const margin = 8;
    const gap = 10;
    const left = Math.max(
      margin,
      Math.min(anchor.x - width / 2, window.innerWidth - width - margin),
    );
    const above = anchor.y - height - gap >= margin;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.max(margin, Math.min(above ? anchor.y - height - gap : anchor.y + gap, window.innerHeight - height - margin))}px`;
    bubble.style.setProperty(
      "--value-bubble-tip",
      `${Math.max(8, Math.min(anchor.x - left, width - 8))}px`,
    );
    bubble.dataset.side = above ? "above" : "below";
  }, [anchor.x, anchor.y, children]);

  return createPortal(
    <div
      ref={ref}
      className="value-bubble"
      role="tooltip"
      style={{ left: anchor.x, top: anchor.y } as CSSProperties}
    >
      {children}
    </div>,
    document.body,
  );
}
