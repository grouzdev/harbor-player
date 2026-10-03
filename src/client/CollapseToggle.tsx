import { ChevronDown, ChevronRight } from "lucide-react";

export function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="collapse-toggle"
      aria-label={collapsed ? "Развернуть" : "Свернуть"}
      aria-expanded={!collapsed}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
    </button>
  );
}
