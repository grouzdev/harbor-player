import type { CSSProperties, MouseEvent, ReactNode } from "react";

type ListTileProps = {
  value: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  selected?: boolean;
  current?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  dataFormat?: string;
  endAction?: ReactNode;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
};

export function ListTile({
  value,
  prefix,
  suffix,
  selected = false,
  current = false,
  expanded,
  disabled = false,
  title,
  className = "",
  style,
  testId,
  dataFormat,
  endAction,
  onSelect,
  onDoubleClick,
  onContextMenu,
}: ListTileProps) {
  return (
    <div
      className={`list-tile ${selected ? "selected" : ""} ${current ? "current" : ""} ${endAction ? "has-end-action" : ""} ${className}`}
      style={style}
      data-testid={testId}
      data-format={dataFormat}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className="list-tile-main"
        aria-pressed={selected}
        aria-expanded={expanded}
        title={title || value}
        disabled={disabled}
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
      >
        {prefix !== undefined && (
          <span className="list-tile-prefix">{prefix}</span>
        )}
        <span className="list-tile-value">{value}</span>
        {suffix !== undefined && (
          <span className="list-tile-suffix">{suffix}</span>
        )}
      </button>
      {endAction}
    </div>
  );
}
