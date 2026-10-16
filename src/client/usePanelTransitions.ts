import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const duration = 400;
const easing = "cubic-bezier(0.22, 1, 0.36, 1)";
type Snapshot = { element: HTMLElement; rect: DOMRect };
type Pending = {
  id: string;
  opening: boolean;
  panels: Map<string, Snapshot>;
  buttons: Map<string, Snapshot>;
  ghost: HTMLElement | null;
  focus: boolean;
};

function measure(root: HTMLElement, selector: string, attribute: string) {
  return new Map(
    [...root.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => [
        element.getAttribute(attribute)!,
        { element, rect: element.getBoundingClientRect() },
      ]),
  );
}

/** Decorative snapshots retain disappearing content; live panels never scale. */
function snapshot(element: HTMLElement, rect: DOMRect) {
  const wrapper = document.createElement("div");
  wrapper.className = "panel-transition-snapshot";
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.inert = true;
  Object.assign(wrapper.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  const copy = element.cloneNode(true) as HTMLElement;
  const computed = getComputedStyle(element);
  copy.removeAttribute("id");
  copy.removeAttribute("data-panel-id");
  copy.removeAttribute("data-restore-panel");
  copy
    .querySelectorAll("[id], [data-panel-id], [data-restore-panel]")
    .forEach((node) => {
      node.removeAttribute("id");
      node.removeAttribute("data-panel-id");
      node.removeAttribute("data-restore-panel");
    });
  Object.assign(copy.style, {
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    color: computed.color,
    opacity: computed.opacity,
  });
  // cloneNode does not copy scrolling positions, including virtualized lists.
  const originalChildren = element.querySelectorAll("*");
  const copiedChildren = copy.querySelectorAll("*");
  wrapper.append(copy);
  document.body.append(wrapper);
  copiedChildren.forEach((child, index) => {
    child.scrollTop = originalChildren[index].scrollTop;
    child.scrollLeft = originalChildren[index].scrollLeft;
  });
  return wrapper;
}

export function usePanelTransitions(
  workspaceRef: RefObject<HTMLElement | null>,
  shellRef: RefObject<HTMLElement | null>,
  visibility: Record<string, boolean>,
  mode: string,
) {
  const [busy, setBusy] = useState(false);
  const pending = useRef<Pending | null>(null);
  const running = useRef<(() => void) | null>(null);
  const visibilityKey = JSON.stringify(visibility);

  const prepare = useCallback(
    (id: string, opening: boolean) => {
      if (pending.current) return false;
      running.current?.();
      const workspace = workspaceRef.current;
      const shell = shellRef.current;
      if (
        !workspace ||
        !shell ||
        !workspace.getClientRects().length ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return true;
      const panels = measure(workspace, "[data-panel-id]", "data-panel-id");
      const buttons = measure(
        shell,
        "[data-restore-panel]",
        "data-restore-panel",
      );
      const source = opening ? buttons.get(id) : panels.get(id);
      pending.current = {
        id,
        opening,
        panels,
        buttons,
        ghost: source ? snapshot(source.element, source.rect) : null,
        focus:
          !!source &&
          source.element.contains(document.activeElement) &&
          source.element.matches(":focus-visible, :has(:focus-visible)"),
      };
      setBusy(true);
      return true;
    },
    [workspaceRef, shellRef],
  );

  useLayoutEffect(() => {
    const transition = pending.current;
    const workspace = workspaceRef.current;
    const shell = shellRef.current;
    if (!transition || !workspace || !shell) return;
    pending.current = null;
    const animations: Animation[] = [];
    const openingDelay = transition.opening ? 60 : 0;
    const animate = (
      element: HTMLElement,
      frames: Keyframe[],
      delay = 0,
      time = duration,
    ) => {
      const animation = element.animate(frames, {
        duration: time,
        delay,
        easing,
        fill: "both",
      });
      animations.push(animation);
      return animation;
    };
    const panels = measure(workspace, "[data-panel-id]", "data-panel-id");
    const buttons = measure(
      shell,
      "[data-restore-panel]",
      "data-restore-panel",
    );
    workspace.dataset.panelTransition = transition.opening
      ? "opening"
      : "closing";
    for (const [id, { element, rect }] of panels) {
      const old = transition.panels.get(id)?.rect;
      if (old) {
        animate(
          element,
          [
            {
              transform: `translate(${old.left - rect.left}px, ${old.top - rect.top}px)`,
              width: `${old.width}px`,
              height: `${old.height}px`,
            },
            {
              transform: "translate(0, 0)",
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            },
          ],
          openingDelay,
        );
      } else {
        animate(
          element,
          [
            { clipPath: "inset(0 100% 0 0)", opacity: 0 },
            { clipPath: "inset(0 50% 0 0)", opacity: 0, offset: 0.5 },
            { clipPath: "inset(0 0 0 0)", opacity: 1 },
          ],
          openingDelay,
        );
      }
    }
    for (const [id, { element, rect }] of buttons) {
      const old = transition.buttons.get(id)?.rect;
      if (old)
        animate(element, [
          { transform: `translateY(${old.top - rect.top}px)` },
          { transform: "translateY(0)" },
        ]);
      else animate(element, [{ opacity: 0 }, { opacity: 1 }], 240, 160);
    }
    if (transition.ghost) {
      if (transition.opening)
        animate(transition.ghost, [{ opacity: 1 }, { opacity: 0 }], 0, 140);
      else {
        const old = transition.panels.get(transition.id)!.rect;
        const rowDisappears = ![...panels.values()].some(
          ({ rect }) => Math.abs(rect.top - old.top) < 1,
        );
        animate(transition.ghost, [
          { width: `${old.width}px`, height: `${old.height}px` },
          { width: "0px", height: rowDisappears ? "0px" : `${old.height}px` },
        ]);
        animate(
          transition.ghost.firstElementChild as HTMLElement,
          [{ opacity: 1 }, { opacity: 0 }],
          0,
          200,
        );
      }
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      animations.forEach((animation) => animation.cancel());
      transition.ghost?.remove();
      delete workspace.dataset.panelTransition;
      running.current = null;
      window.removeEventListener("resize", finish);
      observer.disconnect();
      motion.removeEventListener("change", finish);
      if (transition.focus) {
        const target = transition.opening
          ? panels
              .get(transition.id)
              ?.element.querySelector<HTMLElement>(".panel-heading button")
          : buttons.get(transition.id)?.element;
        target?.focus({ preventScroll: true });
      }
      setBusy(false);
    };
    const observer = new ResizeObserver(() => {
      const rect = workspace.getBoundingClientRect();
      if (
        rect.width !== workspaceBounds.width ||
        rect.height !== workspaceBounds.height
      )
        finish();
    });
    const workspaceBounds = workspace.getBoundingClientRect();
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    observer.observe(workspace);
    motion.addEventListener("change", finish);
    window.addEventListener("resize", finish);
    running.current = finish;
    void Promise.all(
      animations.map((animation) => animation.finished.catch(() => {})),
    ).then(finish);
  }, [visibilityKey, workspaceRef, shellRef]);

  useLayoutEffect(() => {
    running.current?.();
    if (pending.current) setBusy(false);
    pending.current?.ghost?.remove();
    pending.current = null;
  }, [mode]);

  useLayoutEffect(
    () => () => {
      running.current?.();
      pending.current?.ghost?.remove();
    },
    [],
  );

  return { busy, prepare };
}
