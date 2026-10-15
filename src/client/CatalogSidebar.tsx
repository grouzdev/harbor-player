import { Activity, Settings, type LucideIcon } from "lucide-react";

export function CatalogSidebar({
  panels,
  showPanels,
  settingsOpen,
  pulseMode,
  busy,
  onShowPanel,
  onToggleSettings,
  onTogglePulse,
}: {
  panels: readonly { id: string; label: string; Icon: LucideIcon }[];
  showPanels: boolean;
  settingsOpen: boolean;
  pulseMode: boolean;
  busy: boolean;
  onShowPanel: (id: string) => void;
  onToggleSettings: () => void;
  onTogglePulse: () => void;
}) {
  return (
    <aside className="catalog-sidebar" aria-label="Боковая панель">
      <div className="catalog-sidebar-panels">
        {showPanels && panels.length > 0 && (
          <div
            className="panel-visibility-controls"
            role="group"
            aria-label="Видимость панелей каталога"
          >
            {panels.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className="icon-button panel-visibility-button is-hidden"
                data-restore-panel={id}
                aria-label={`Показать панель «${label}»`}
                aria-pressed={false}
                title={`Показать панель «${label}»`}
                disabled={busy}
                onClick={() => onShowPanel(id)}
              >
                <Icon size={19} />
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="icon-button pulse-mode-toggle"
        aria-label={pulseMode ? "Вернуться к панелям" : "Открыть Пульс"}
        title={pulseMode ? "Вернуться к панелям" : "Пульс"}
        aria-pressed={pulseMode}
        onClick={onTogglePulse}
      >
        <Activity size={21} />
      </button>
      <button
        type="button"
        className="icon-button sidebar-settings"
        aria-label="Настройки"
        aria-pressed={settingsOpen}
        title={settingsOpen ? "Закрыть настройки" : "Настройки"}
        onClick={onToggleSettings}
      >
        <Settings size={20} />
      </button>
    </aside>
  );
}
