import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ImagePlus,
  MonitorCog,
  Palette,
  Pipette,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { AppearanceSettings } from "./appearance";
import { autoScanIntervals, type ScanSettings } from "../shared/scan-settings";
import { api } from "./api";
import {
  type BackupRetention,
  type RecoveryStatus,
} from "../shared/recovery-settings";
import "./desktop";
import { MAX_BACKGROUND_IMAGE_BYTES } from "../shared/appearance-background";
import { useQueryClient } from "@tanstack/react-query";
import { backgroundPresets } from "./background-presets";
import { VersionSettingsPanel } from "./VersionSettingsPanel";

const accents = [
  "#b8bd82",
  "#9bc8aa",
  "#79b9d4",
  "#c59bc9",
  "#dd9e7c",
  "#d0b66d",
];
const retentionOptions: { value: BackupRetention; label: string }[] = [
  { value: "none", label: "Не сохранять" },
  { value: "1d", label: "1 день" },
  { value: "7d", label: "7 дней" },
  { value: "never", label: "Не очищать никогда" },
];
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
}

async function asBase64(file: File) {
  if (file.size > MAX_BACKGROUND_IMAGE_BYTES)
    throw new Error("Выберите изображение размером до 32 МБ");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Не удалось прочитать изображение"));
    reader.onload = () => {
      if (typeof reader.result !== "string")
        return reject(new Error("Не удалось прочитать изображение"));
      resolve(reader.result.split(",")[1] || "");
    };
    reader.readAsDataURL(file);
  });
  if (!data) throw new Error("Не удалось прочитать изображение");
  return data;
}

export function AppearanceSettingsPanels({
  settings,
  onChange,
  scanSettings,
  onScanSettingsChange,
  onScanAll,
  scanInProgress,
  history,
  renderSeparator,
}: {
  settings: AppearanceSettings;
  onChange: (settings: AppearanceSettings) => void;
  scanSettings: ScanSettings;
  onScanSettingsChange: (settings: ScanSettings) => void;
  onScanAll: (force: boolean) => Promise<void>;
  scanInProgress: boolean;
  history: ReactNode;
  renderSeparator: (index: 0 | 1 | 2) => ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [accentDraft, setAccentDraft] = useState(settings.accent.toUpperCase());
  const [appearanceError, setAppearanceError] = useState("");
  const [scanError, setScanError] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const desktop = window.harborPlayerDesktop;
  useEffect(() => {
    void api<RecoveryStatus>("/recovery")
      .then(setRecovery)
      .catch((cause) =>
        setRecoveryError(
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
  }, []);
  useEffect(() => {
    setAccentDraft(settings.accent.toUpperCase());
  }, [settings.accent]);
  const save = async (next: AppearanceSettings) => {
    setBusy(true);
    setAppearanceError("");
    onChange(next);
    try {
      onChange(await api<AppearanceSettings>("/appearance", next));
    } catch (cause) {
      onChange(settings);
      setAppearanceError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };
  const importBackground = async (body: { data?: string; path?: string }) => {
    setBusy(true);
    setAppearanceError("");
    try {
      onChange(
        await api<AppearanceSettings>("/appearance/background", {
          ...body,
          theme: settings.theme,
          accent: settings.accent,
        }),
      );
    } catch (cause) {
      setAppearanceError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  };
  const saveScanSettings = async (autoScanIntervalMinutes: number) => {
    setScanBusy(true);
    setScanError("");
    try {
      onScanSettingsChange(
        await api<ScanSettings>("/scan-settings", { autoScanIntervalMinutes }),
      );
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanBusy(false);
    }
  };
  const scanAll = async (force: boolean) => {
    setScanBusy(true);
    setScanError("");
    try {
      await onScanAll(force);
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanBusy(false);
    }
  };
  const saveRecoverySettings = async (backupRetention: BackupRetention) => {
    setRecoveryBusy(true);
    setRecoveryError("");
    try {
      setRecovery(
        await api<RecoveryStatus>("/recovery/settings", { backupRetention }),
      );
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRecoveryBusy(false);
    }
  };
  const clearRecovery = async () => {
    if (
      !window.confirm(
        "Все резервные копии будут удалены. Восстановление связанных изменений и удалений станет недоступно.",
      )
    )
      return;
    setRecoveryBusy(true);
    setRecoveryError("");
    try {
      setRecovery(await api<RecoveryStatus>("/recovery", undefined, "DELETE"));
      await queryClient.invalidateQueries({ queryKey: ["history"] });
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRecoveryBusy(false);
    }
  };
  const saveAccentDraft = () => {
    const accent = accentDraft.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/i.test(accent)) return;
    if (accent !== settings.accent) void save({ ...settings, accent });
  };
  return (
    <>
      <section className="panel settings-panel" aria-label="Внешний вид">
        <header className="panel-heading settings-panel-heading">
          <Palette size={17} />
          <h2>Внешний вид</h2>
        </header>
        <div className="settings-panel-body appearance-settings">
          <div className="appearance-section">
            <h3>Акцентный цвет</h3>
            <div className="accent-picker">
              {accents.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  className={`accent-swatch ${settings.accent === accent ? "selected" : ""}`}
                  style={{ backgroundColor: accent }}
                  aria-label={`Выбрать цвет ${accent}`}
                  aria-pressed={settings.accent === accent}
                  disabled={busy}
                  onClick={() => void save({ ...settings, accent })}
                />
              ))}
            </div>
            <div className="settings-accent-row">
              <label className="settings-accent-custom button secondary">
                <Pipette size={17} />
                <span>Свой цвет</span>
                <input
                  type="color"
                  value={settings.accent}
                  aria-label="Свой акцентный цвет"
                  disabled={busy}
                  onChange={(event) =>
                    void save({ ...settings, accent: event.target.value })
                  }
                />
              </label>
              <input
                className="settings-accent-value"
                aria-label="Код акцентного цвета"
                value={accentDraft}
                maxLength={7}
                spellCheck={false}
                pattern="#[0-9a-fA-F]{6}"
                disabled={busy}
                onChange={(event) => setAccentDraft(event.target.value)}
                onBlur={saveAccentDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveAccentDraft();
                  if (event.key === "Escape")
                    setAccentDraft(settings.accent.toUpperCase());
                }}
              />
            </div>
          </div>
          <div className="appearance-section">
            <h3>Фон</h3>
            <div
              className="settings-background-presets"
              aria-label="Встроенные фоны"
            >
              {backgroundPresets.map((preset) => (
                <button
                  key={preset.number}
                  type="button"
                  className="settings-background-preset"
                  aria-label={`Выбрать фон ${preset.number}`}
                  aria-pressed={settings.backgroundPreset === preset.number}
                  disabled={busy}
                  onClick={() =>
                    void save({
                      ...settings,
                      backgroundRevision: 0,
                      backgroundPreset: preset.number,
                    })
                  }
                >
                  <img src={preset.url} alt="" />
                </button>
              ))}
            </div>
            <div className="appearance-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  if (!desktop) {
                    fileRef.current?.click();
                    return;
                  }
                  void desktop
                    .chooseImageFile()
                    .then((path) => {
                      if (path) return importBackground({ path });
                    })
                    .catch((cause) =>
                      setAppearanceError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    );
                }}
              >
                <ImagePlus size={17} /> Выбрать изображение
              </button>
              {(settings.backgroundRevision > 0 ||
                settings.backgroundPreset) && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      ...settings,
                      backgroundRevision: 0,
                      backgroundPreset: undefined,
                    })
                  }
                >
                  <Trash2 size={17} /> Убрать фон
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file)
                  void asBase64(file)
                    .then((data) => importBackground({ data }))
                    .catch((cause) =>
                      setAppearanceError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    );
              }}
            />
            {appearanceError && (
              <p className="error-text" role="alert">
                {appearanceError}
              </p>
            )}
          </div>
        </div>
      </section>
      {renderSeparator(0)}
      <section className="panel settings-panel" aria-label="Приложение">
        <header className="panel-heading settings-panel-heading">
          <MonitorCog size={17} />
          <h2>Приложение</h2>
        </header>
        <div className="settings-panel-body appearance-settings">
          <div className="appearance-section">
            <h3>Сканирование</h3>
            <label className="settings-control-row">
              <span>Автосканирование</span>
              <select
                aria-label="Автосканирование"
                value={scanSettings.autoScanIntervalMinutes}
                disabled={scanBusy}
                onChange={(event) =>
                  void saveScanSettings(Number(event.target.value))
                }
              >
                {autoScanIntervals.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes === 0
                      ? "Только вручную"
                      : `Каждые ${minutes} мин.`}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-scan-actions">
              <button
                type="button"
                className="button secondary"
                disabled={scanBusy || scanInProgress}
                onClick={() => void scanAll(false)}
              >
                <RefreshCw size={17} /> Быстрое сканирование
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={scanBusy || scanInProgress}
                onClick={() => void scanAll(true)}
              >
                <RefreshCw size={17} /> Полное обновление
              </button>
            </div>
            {scanError && (
              <p className="error-text" role="alert">
                {scanError}
              </p>
            )}
          </div>
          <div className="appearance-section" aria-label="Резервные копии">
            <h3>Резервные копии</h3>
            <label className="settings-control-row">
              <span>Срок хранения</span>
              <select
                aria-label="Срок хранения резервных копий"
                value={recovery?.backupRetention || "7d"}
                disabled={recoveryBusy || !recovery}
                onChange={(event) =>
                  void saveRecoverySettings(
                    event.target.value as BackupRetention,
                  )
                }
              >
                {retentionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="appearance-actions">
              <span className="hint">
                {recovery
                  ? recovery.size === 0
                    ? "Резервных копий нет"
                    : `Занято: ${formatSize(recovery.size)}`
                  : "Занято: …"}
              </span>
              {recovery && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={recoveryBusy || recovery.size === 0}
                  onClick={() => void clearRecovery()}
                >
                  <Trash2 size={17} /> Очистить резервные копии
                </button>
              )}
            </div>
            {recoveryError && (
              <p className="error-text" role="alert">
                {recoveryError}
              </p>
            )}
          </div>
        </div>
      </section>
      {renderSeparator(1)}
      <VersionSettingsPanel />
      {renderSeparator(2)}
      {history}
    </>
  );
}
