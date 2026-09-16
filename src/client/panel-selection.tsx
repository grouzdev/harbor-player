import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export type SelectionClickResult = {
  keys: string[];
  anchor: string;
};

export function resolveContextSelection(
  currentKeys: readonly string[],
  targetKey: string,
) {
  return currentKeys.includes(targetKey) ? [...currentKeys] : [targetKey];
}

export function resolveSelectionClick(
  currentKeys: readonly string[],
  orderedKeys: readonly string[],
  targetKey: string,
  anchorKey: string | null,
  modifiers: { ctrl: boolean; shift: boolean },
): SelectionClickResult {
  const current = new Set(currentKeys);
  if (modifiers.shift && anchorKey) {
    const anchorIndex = orderedKeys.indexOf(anchorKey);
    const targetIndex = orderedKeys.indexOf(targetKey);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const from = Math.min(anchorIndex, targetIndex);
      const to = Math.max(anchorIndex, targetIndex);
      const range = orderedKeys.slice(from, to + 1);
      return {
        keys: modifiers.ctrl ? [...new Set([...currentKeys, ...range])] : range,
        anchor: anchorKey,
      };
    }
  }

  if (modifiers.ctrl) {
    if (current.has(targetKey)) current.delete(targetKey);
    else current.add(targetKey);
    return { keys: [...current], anchor: targetKey };
  }
  return { keys: [targetKey], anchor: targetKey };
}

export function addMarqueeSelection(
  currentKeys: readonly string[],
  hitKeys: readonly string[],
  additive: boolean,
) {
  return additive ? [...new Set([...currentKeys, ...hitKeys])] : [...hitKeys];
}

type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number };

function rectangle(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

function intersects(left: Rect, right: Rect) {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  );
}

export function selectionKeysInDom(element: HTMLElement | null) {
  if (!element) return [];
  return [...element.querySelectorAll<HTMLElement>("[data-selection-key]")]
    .map((item) => item.dataset.selectionKey)
    .filter((key): key is string => Boolean(key));
}

type SelectionClickTarget = Pick<Element, "closest">;

export function isEmptySelectionSurfaceClick(
  target: SelectionClickTarget | null,
) {
  if (!target) return false;
  return (
    !target.closest("[data-selection-key]") &&
    !target.closest("[data-selection-ignore]") &&
    !target.closest("button,a,input,textarea,select,[role=button]")
  );
}

export function usePanelSelection({
  scrollRef,
  selectedKeys,
  onChange,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  selectedKeys: readonly string[];
  onChange: (keys: string[]) => void;
}) {
  const anchorRef = useRef<string | null>(null);
  const selectedRef = useRef(selectedKeys);
  const onChangeRef = useRef(onChange);
  const gestureRef = useRef<{
    pointerId: number;
    startClient: Point;
    startContent: Point;
    currentClient: Point;
    snapshot: string[];
    additive: boolean;
    active: boolean;
    geometry: Map<string, Rect>;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const previewRef = useRef<Set<string> | null>(null);
  const [previewKeys, setPreviewKeys] = useState<Set<string> | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);

  selectedRef.current = selectedKeys;
  onChangeRef.current = onChange;

  const collectGeometry = useCallback(() => {
    const scroll = scrollRef.current;
    const gesture = gestureRef.current;
    if (!scroll || !gesture) return;
    const scrollBox = scroll.getBoundingClientRect();
    for (const item of scroll.querySelectorAll<HTMLElement>(
      "[data-selection-key]",
    )) {
      const key = item.dataset.selectionKey;
      if (!key) continue;
      const box = item.getBoundingClientRect();
      gesture.geometry.set(key, {
        left: box.left - scrollBox.left + scroll.scrollLeft,
        top: box.top - scrollBox.top + scroll.scrollTop,
        right: box.right - scrollBox.left + scroll.scrollLeft,
        bottom: box.bottom - scrollBox.top + scroll.scrollTop,
      });
    }
  }, [scrollRef]);

  const updateGesture = useCallback(() => {
    const scroll = scrollRef.current;
    const gesture = gestureRef.current;
    if (!scroll || !gesture || !gesture.active) return;
    const box = scroll.getBoundingClientRect();
    const clientX = Math.max(
      box.left,
      Math.min(box.right, gesture.currentClient.x),
    );
    const clientY = Math.max(
      box.top,
      Math.min(box.bottom, gesture.currentClient.y),
    );
    const current = {
      x: clientX - box.left + scroll.scrollLeft,
      y: clientY - box.top + scroll.scrollTop,
    };
    const rect = rectangle(gesture.startContent, current);
    collectGeometry();
    const ordered = selectionKeysInDom(scroll);
    const hitSet = new Set<string>();
    for (const [key, itemRect] of gesture.geometry)
      if (intersects(rect, itemRect)) hitSet.add(key);
    const knownOrder = [
      ...ordered,
      ...[...gesture.geometry.keys()].filter((key) => !ordered.includes(key)),
    ];
    const hits = knownOrder.filter((key) => hitSet.has(key));
    const nextPreview = new Set(
      addMarqueeSelection(gesture.snapshot, hits, gesture.additive),
    );
    previewRef.current = nextPreview;
    setPreviewKeys(nextPreview);
    setMarqueeRect(rect);
  }, [collectGeometry, scrollRef]);

  const stopAutoScroll = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const startAutoScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    const tick = () => {
      const scroll = scrollRef.current;
      const gesture = gestureRef.current;
      if (!scroll || !gesture || !gesture.active) {
        frameRef.current = null;
        return;
      }
      const box = scroll.getBoundingClientRect();
      const edge = 32;
      let delta = 0;
      if (gesture.currentClient.y < box.top + edge)
        delta = -Math.ceil((box.top + edge - gesture.currentClient.y) / 3);
      else if (gesture.currentClient.y > box.bottom - edge)
        delta = Math.ceil((gesture.currentClient.y - (box.bottom - edge)) / 3);
      if (delta) {
        const before = scroll.scrollTop;
        scroll.scrollTop += Math.max(-18, Math.min(18, delta));
        if (scroll.scrollTop !== before) updateGesture();
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [scrollRef, updateGesture]);

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  const finish = useCallback(
    (commit: boolean) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      stopAutoScroll();
      if (gesture.active) {
        suppressClickRef.current = true;
        if (commit && previewRef.current)
          onChangeRef.current([...previewRef.current]);
      }
      gestureRef.current = null;
      previewRef.current = null;
      setPreviewKeys(null);
      setMarqueeRect(null);
    },
    [stopAutoScroll],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.currentClient = { x: event.clientX, y: event.clientY };
      if (!gesture.active) {
        const distance = Math.hypot(
          event.clientX - gesture.startClient.x,
          event.clientY - gesture.startClient.y,
        );
        if (distance < 5) return;
        gesture.active = true;
        document.body.classList.add("selection-dragging");
        collectGeometry();
        startAutoScroll();
      }
      event.preventDefault();
      updateGesture();
    };
    const onUp = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      document.body.classList.remove("selection-dragging");
      finish(true);
    };
    const onCancel = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      document.body.classList.remove("selection-dragging");
      finish(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !gestureRef.current?.active) return;
      event.preventDefault();
      document.body.classList.remove("selection-dragging");
      finish(false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("selection-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [collectGeometry, finish, startAutoScroll, updateGesture]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || gestureRef.current) return;
      const target = event.target as HTMLElement;
      const candidate = target.closest<HTMLElement>("[data-selection-key]");
      if (
        target.closest("[data-selection-ignore]") ||
        (!candidate &&
          target.closest("button,a,input,textarea,select,[role=button]"))
      )
        return;
      const scroll = scrollRef.current;
      if (!scroll) return;
      const box = scroll.getBoundingClientRect();
      gestureRef.current = {
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startContent: {
          x: event.clientX - box.left + scroll.scrollLeft,
          y: event.clientY - box.top + scroll.scrollTop,
        },
        currentClient: { x: event.clientX, y: event.clientY },
        snapshot: [...selectedRef.current],
        additive: event.ctrlKey || event.metaKey,
        active: false,
        geometry: new Map(),
      };
    },
    [scrollRef],
  );

  const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (!isEmptySelectionSurfaceClick(target)) return;
    event.preventDefault();
    anchorRef.current = null;
    onChangeRef.current([]);
  }, []);

  const selectFromClick = useCallback(
    (
      event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">,
      targetKey: string,
      orderedKeys = selectionKeysInDom(scrollRef.current),
    ) => {
      const result = resolveSelectionClick(
        selectedRef.current,
        orderedKeys,
        targetKey,
        anchorRef.current,
        { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey },
      );
      anchorRef.current = result.anchor;
      onChangeRef.current(result.keys);
    },
    [scrollRef],
  );

  return {
    previewKeys,
    selectFromClick,
    surfaceProps: { onPointerDown, onClickCapture },
    marquee: marqueeRect ? (
      <div
        className="selection-marquee"
        data-testid="selection-marquee"
        style={{
          left: marqueeRect.left,
          top: marqueeRect.top,
          width: marqueeRect.right - marqueeRect.left,
          height: marqueeRect.bottom - marqueeRect.top,
        }}
      />
    ) : null,
  };
}
