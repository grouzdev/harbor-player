import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export const settingsPanelMinimumWidth = 300;
const separatorWidth = 4;
const workspaceMinimumWidth =
  settingsPanelMinimumWidth * 4 + separatorWidth * 3;
type PanelShares = [number, number, number, number];
type SeparatorIndex = 0 | 1 | 2;
const equalShares: PanelShares = [1 / 4, 1 / 4, 1 / 4, 1 / 4];

/** Shares describe only space above the minimum, so resizing one pair never moves other panels. */
export function resizeSettingsPanels(
  shares: PanelShares,
  index: SeparatorIndex,
  delta: number,
  availableSpace: number,
): PanelShares {
  if (availableSpace <= 0) return shares;
  const next: PanelShares = [...shares];
  const change = Math.max(
    -shares[index],
    Math.min(shares[index + 1], delta / availableSpace),
  );
  next[index] += change;
  next[index + 1] -= change;
  return next;
}

export function SettingsWorkspace({
  children,
}: {
  children: (
    renderSeparator: (index: SeparatorIndex) => ReactNode,
  ) => ReactNode;
}) {
  // This component is mounted anew each time settings opens: no persisted widths.
  const [shares, setShares] = useState<PanelShares>(equalShares);
  const [width, setWidth] = useState(workspaceMinimumWidth);
  const [resizing, setResizing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    shares: PanelShares;
    availableSpace: number;
  } | null>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => setWidth(grid.clientWidth));
    observer.observe(grid);
    setWidth(grid.clientWidth);
    return () => observer.disconnect();
  }, []);
  const availableSpace = Math.max(0, width - workspaceMinimumWidth);
  const labels = [
    "Внешний вид — Приложение",
    "Приложение — Версия и обновления",
    "Версия и обновления — История действий",
  ];
  const renderSeparator = (index: SeparatorIndex) => (
    <div
      className="settings-workspace-resizer"
      role="separator"
      tabIndex={0}
      aria-label={`Ширина: ${labels[index]}`}
      aria-orientation="vertical"
      aria-valuemin={settingsPanelMinimumWidth}
      aria-valuemax={Math.round(
        settingsPanelMinimumWidth +
          availableSpace * (shares[index] + shares[index + 1]),
      )}
      aria-valuenow={Math.round(
        settingsPanelMinimumWidth + availableSpace * shares[index],
      )}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          shares,
          availableSpace: Math.max(
            0,
            (gridRef.current?.clientWidth ?? width) - workspaceMinimumWidth,
          ),
        };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        setShares(
          resizeSettingsPanels(
            current.shares,
            index,
            event.clientX - current.startX,
            current.availableSpace,
          ),
        );
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        setResizing(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setResizing(false);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setResizing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Home") {
          event.preventDefault();
          setShares(equalShares);
          return;
        }
        const delta =
          event.key === "ArrowLeft"
            ? -(event.shiftKey ? 60 : 20)
            : event.key === "ArrowRight"
              ? event.shiftKey
                ? 60
                : 20
              : event.key === "End"
                ? availableSpace
                : null;
        if (delta === null) return;
        event.preventDefault();
        setShares((current) =>
          resizeSettingsPanels(current, index, delta, availableSpace),
        );
      }}
    />
  );
  return (
    <main
      className={`settings-workspace-scroll${resizing ? " is-resizing" : ""}`}
      aria-label="Настройки"
    >
      <div
        ref={gridRef}
        className="settings-workspace"
        style={
          {
            "--settings-columns": shares
              .map(
                (share) =>
                  `calc(${settingsPanelMinimumWidth}px + (100% - ${workspaceMinimumWidth}px) * ${share})`,
              )
              .join(` ${separatorWidth}px `),
          } as CSSProperties
        }
      >
        {children(renderSeparator)}
      </div>
    </main>
  );
}
