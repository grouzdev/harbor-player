import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export function ExpandingSearch({
  value,
  onChange,
  closeOnEscape = false,
  onCollapsedChange,
}: {
  value: string;
  onChange: (value: string) => void;
  closeOnEscape?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pointerDown = useRef(false);
  const restoreFocus = useRef(false);
  const collapsed = !value.trim() && !focused;

  useLayoutEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  useLayoutEffect(() => {
    if (collapsed && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [collapsed]);

  useEffect(() => {
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const press = () => {
      pointerDown.current = true;
    };
    const release = () => {
      pointerDown.current = false;
      // Keep adjacent controls in place until pointerup has dispatched click.
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        setFocused(document.activeElement === input.current);
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
    if (!closeOnEscape || collapsed) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture before quick-search and cover-mode handlers see the same key.
      event.preventDefault();
      event.stopPropagation();
      restoreFocus.current = true;
      onChange("");
      setFocused(false);
      input.current?.blur();
    };
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [closeOnEscape, collapsed, onChange]);

  return (
    <div
      className={`catalog-search${collapsed ? " is-collapsed" : " search"}`}
      title={collapsed ? "Поиск музыки" : undefined}
      data-window-control
    >
      <input
        ref={input}
        aria-label="Поиск музыки"
        placeholder={collapsed ? "" : "Треки, артисты, альбомы"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (!pointerDown.current) setFocused(false);
        }}
      />
      {collapsed && (
        <button
          ref={trigger}
          type="button"
          className="icon-button"
          aria-label="Открыть поиск"
          onClick={() => input.current?.focus()}
        >
          <Search size={19} aria-hidden="true" />
        </button>
      )}
      {value.trim() && (
        <button
          type="button"
          className="catalog-filter-small-button"
          aria-label="Очистить поиск"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
