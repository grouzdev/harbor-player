import { useEffect, useRef, useState } from "react";
import { ImagePlus, MonitorCog, Trash2 } from "lucide-react";
import type { AppearanceSettings } from "./appearance";
import { autoScanIntervals, type ScanSettings } from "../shared/scan-settings";
import { api } from "./api";
import {
  type BackupRetention,
  type RecoveryStatus,
} from "../shared/recovery-settings";
import "./desktop";
import { Modal } from "./Modal";

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
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Выберите изображение размером до 8 МБ");
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

export function AppearanceSettingsDialog({
  settings,
  onChange,
  scanSettings,
  onScanSettingsChange,
  onClose,
}: {
  settings: AppearanceSettings;
  onChange: (settings: AppearanceSettings) => void;
  scanSettings: ScanSettings;
  onScanSettingsChange: (settings: ScanSettings) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [error, setError] = useState("");
  const desktop = window.harborPlayerDesktop;
  useEffect(() => {
    void api<RecoveryStatus>("/recovery")
      .then(setRecovery)
      .catch(() => {});
  }, []);
  const save = async (next: AppearanceSettings) => {
    onChange(next);
    try {
      onChange(await api<AppearanceSettings>("/appearance", next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const importBackground = async (body: { data?: string; path?: string }) => {
    setBusy(true);
    setError("");
    try {
      onChange(
        await api<AppearanceSettings>("/appearance/background", {
          ...body,
          theme: settings.theme,
          accent: settings.accent,
        }),
      );
      setPath("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const saveScanSettings = async (autoScanIntervalMinutes: number) => {
    setScanBusy(true);
    setError("");
    try {
      onScanSettingsChange(
        await api<ScanSettings>("/scan-settings", { autoScanIntervalMinutes }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanBusy(false);
    }
  };
  const saveRecoverySettings = async (backupRetention: BackupRetention) => {
    setRecoveryBusy(true);
    setError("");
    try {
      setRecovery(
        await api<RecoveryStatus>("/recovery/settings", { backupRetention }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
    setError("");
    try {
      setRecovery(await api<RecoveryStatus>("/recovery", undefined, "DELETE"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRecoveryBusy(false);
    }
  };
  return (
    <Modal title="Настройки" subtitle="Внешний вид" onClose={onClose}>
      <section className="appearance-settings" aria-label="Внешний вид">
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
                onClick={() => void save({ ...settings, accent })}
              />
            ))}
            <label className="accent-custom" title="Свой цвет">
              <input
                type="color"
                value={settings.accent}
                aria-label="Свой акцентный цвет"
                onChange={(event) =>
                  void save({ ...settings, accent: event.target.value })
                }
              />
              <MonitorCog size={17} />
            </label>
          </div>
        </div>
        <div className="appearance-section">
          <h3>Фон</h3>
          <div className="appearance-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={17} /> Выбрать изображение
            </button>
            {settings.backgroundRevision > 0 && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void save({ ...settings, backgroundRevision: 0 })
                }
              >
                <Trash2 size={17} /> Убрать фон
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file)
                void asBase64(file)
                  .then((data) => importBackground({ data }))
                  .catch((cause) =>
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    ),
                  );
            }}
          />
          {desktop && (
            <div className="appearance-path">
              <input
                value={path}
                placeholder="Путь к изображению"
                aria-label="Путь к изображению"
                disabled={busy}
                onChange={(event) => setPath(event.target.value)}
              />
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void desktop
                    .chooseImageFile()
                    .then((selected) => selected && setPath(selected))
                    .catch((cause) =>
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    )
                }
              >
                Обзор…
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || !path.trim()}
                onClick={() => void importBackground({ path: path.trim() })}
              >
                Применить путь
              </button>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>
        <div className="appearance-section">
          <h3>Сканирование</h3>
          <div
            className="appearance-segmented-control"
            role="radiogroup"
            aria-label="Автосканирование"
          >
            {autoScanIntervals.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`appearance-segment ${scanSettings.autoScanIntervalMinutes === minutes ? "selected" : ""}`}
                role="radio"
                aria-checked={scanSettings.autoScanIntervalMinutes === minutes}
                disabled={scanBusy}
                onClick={() => void saveScanSettings(minutes)}
              >
                {minutes === 0 ? "Только вручную" : `Каждые ${minutes} мин.`}
              </button>
            ))}
          </div>
        </div>
        <div className="appearance-section" aria-label="Резервные копии">
          <h3>Резервные копии</h3>
          <div
            className="appearance-segmented-control"
            role="radiogroup"
            aria-label="Срок хранения резервных копий"
          >
            {retentionOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`appearance-segment ${recovery?.backupRetention === option.value ? "selected" : ""}`}
                role="radio"
                aria-checked={recovery?.backupRetention === option.value}
                disabled={recoveryBusy || !recovery}
                onClick={() => void saveRecoverySettings(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
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
        </div>
      </section>
    </Modal>
  );
}
