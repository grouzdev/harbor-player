import { useEffect, useRef, type RefObject } from "react";

// Virtual panels resolve keys against their data, not just mounted DOM rows.
export const panelScrollResolvers = new WeakMap<
  HTMLElement,
  (key: string) => { top?: number; pending: boolean }
>();

export type ViewportAnchor = { panelId: string; key: string; y: number };

export function usePanelScrollResolver(
  ref: RefObject<HTMLDivElement | null>,
  findTop: (key: string) => number | undefined,
  loaded: number,
  total: number,
  loading: boolean,
  onMore: () => void,
) {
  const requested = useRef<string | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    panelScrollResolvers.set(node, (key) => {
      if (loading) return { pending: true };
      const top = findTop(key);
      if (top !== undefined) return { top, pending: false };
      if (loaded >= total) return { pending: false };
      const pageKey = `${key}:${loaded}`;
      if (requested.current !== pageKey) {
        requested.current = pageKey;
        onMore();
      }
      return { pending: true };
    });
    return () => {
      panelScrollResolvers.delete(node);
    };
  });
}

export function preservedScrollTop(
  itemTop: number,
  viewportY: number,
  maximum: number,
) {
  return Math.max(0, Math.min(maximum, itemTop - viewportY));
}

// Keep fully visible rows still; otherwise reveal at the nearest edge.
export function minimalRevealScrollTop(
  itemTop: number,
  itemHeight: number,
  scrollTop: number,
  viewportHeight: number,
  maximum: number,
  inset = 8,
) {
  const bottom = itemTop + itemHeight;
  if (itemTop >= scrollTop && bottom <= scrollTop + viewportHeight)
    return scrollTop;
  const above = itemTop - inset;
  const below = bottom - viewportHeight + inset;
  const target =
    itemTop < scrollTop && bottom > scrollTop + viewportHeight
      ? Math.abs(above - scrollTop) < Math.abs(below - scrollTop)
        ? above
        : below
      : itemTop < scrollTop
        ? above
        : below;
  return Math.max(0, Math.min(Math.max(0, maximum), target));
}
