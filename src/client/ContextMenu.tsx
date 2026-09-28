import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void | Promise<void>;
  submenu?: ContextMenuItem[];
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
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const submenuFirstItemRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");

  useEffect(() => {
    if (!menu) return;
    setOpenSubmenu(null);
    setSubmenuSide("right");
    requestAnimationFrame(() => firstItemRef.current?.focus());
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
    return () => {
      document.removeEventListener("pointerdown", closeForOutsidePress, true);
      document.removeEventListener("keydown", closeForKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [menu, onClose]);

  useLayoutEffect(() => {
    if (!openSubmenu || !submenuRef.current) return;
    const box = submenuRef.current.getBoundingClientRect();
    setSubmenuSide(box.right > window.innerWidth - 8 ? "left" : "right");
    submenuFirstItemRef.current?.focus();
  }, [openSubmenu]);

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
      {menu.items.map((item, index) => {
        const expanded = openSubmenu === item.label;
        return (
          <div
            key={item.label}
            className="context-menu-submenu-wrap"
            onMouseEnter={() => item.submenu && setOpenSubmenu(item.label)}
            onMouseLeave={() => item.submenu && setOpenSubmenu(null)}
          >
            <button
              ref={index === 0 ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              className="context-menu-item"
              disabled={item.disabled}
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-expanded={item.submenu ? expanded : undefined}
              onFocus={() => item.submenu && setOpenSubmenu(item.label)}
              onKeyDown={(event) => {
                if (item.submenu && event.key === "ArrowRight") {
                  event.preventDefault();
                  setOpenSubmenu(item.label);
                }
                if (item.submenu && event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                }
              }}
              onClick={() => {
                if (item.submenu) {
                  setOpenSubmenu(item.label);
                  return;
                }
                onClose();
                void item.onSelect?.();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.submenu && <span className="context-menu-arrow">›</span>}
            </button>
            {item.submenu && expanded && (
              <div
                ref={submenuRef}
                className={`context-menu context-menu-submenu context-menu-submenu-${submenuSide}`}
                role="menu"
              >
                {item.submenu.map((subitem, subitemIndex) => (
                  <button
                    ref={subitemIndex === 0 ? submenuFirstItemRef : undefined}
                    key={subitem.label}
                    type="button"
                    role="menuitem"
                    className="context-menu-item"
                    disabled={subitem.disabled}
                    onClick={() => {
                      onClose();
                      void subitem.onSelect?.();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" || event.key === "ArrowLeft") {
                        event.preventDefault();
                        setOpenSubmenu(null);
                        ref.current
                          ?.querySelector<HTMLButtonElement>(
                            `[aria-expanded="true"]`,
                          )
                          ?.focus();
                      }
                    }}
                  >
                    {subitem.icon}
                    <span>{subitem.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
