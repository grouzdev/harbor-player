import type { CSSProperties, MouseEvent, ReactNode } from "react";

type ListTileProps = {
  value: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  selected?: boolean;
  current?: boolean;
  related?: boolean;
  playing?: boolean;
  statusIcon?: ReactNode;
  expanded?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  dataFormat?: string;
  selectionKey?: string;
  startAction?: ReactNode;
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
  related = false,
  playing = false,
  statusIcon,
  expanded,
  disabled = false,
  title,
  className = "",
  style,
  testId,
  dataFormat,
  selectionKey,
  startAction,
  endAction,
  onSelect,
  onDoubleClick,
  onContextMenu,
}: ListTileProps) {
  return (
    <div
      className={`list-tile ${selected ? "selected" : ""} ${current ? "current" : ""} ${related ? "related" : ""} ${playing ? "playing" : ""} ${startAction ? "has-start-action" : ""} ${endAction ? "has-end-action" : ""} ${className}`}
      style={style}
      data-testid={testId}
      data-format={dataFormat}
      data-selection-key={selectionKey}
      onContextMenu={onContextMenu}
    >
      {startAction}
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
        <span className="list-tile-value">
          {statusIcon ? (
            <span className="list-tile-status-icon" aria-hidden="true">
              {statusIcon}
            </span>
          ) : related ? (
            <span className="list-tile-related-marker" aria-hidden="true" />
          ) : null}
          <span className="list-tile-label">{value}</span>
        </span>
        {suffix !== undefined && (
          <span className="list-tile-suffix">{suffix}</span>
        )}
      </button>
      {endAction}
    </div>
  );
}
