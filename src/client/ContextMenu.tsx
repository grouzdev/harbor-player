import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function ContextMenu({
  menu,
  onClose,
}: {
  menu: ContextMenuState | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    const closeForOutsidePress = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const closeForKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeForOutsidePress, true);
    document.addEventListener("keydown", closeForKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    firstItem.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", closeForOutsidePress, true);
      document.removeEventListener("keydown", closeForKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [menu, onClose]);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    ref.current.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8))}px`;
    ref.current.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8))}px`;
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Контекстное меню"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.items.map((item, index) => (
        <button
          key={item.label}
          ref={index === 0 ? firstItem : undefined}
          type="button"
          role="menuitem"
          className="context-menu-item"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            void item.onSelect();
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
