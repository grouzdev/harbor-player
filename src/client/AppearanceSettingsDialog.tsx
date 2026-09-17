import { useRef, useState } from "react";
import { ImagePlus, MonitorCog, Trash2 } from "lucide-react";
import type { AppearanceSettings } from "./appearance";
import { api } from "./api";
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
  onClose,
}: {
  settings: AppearanceSettings;
  onChange: (settings: AppearanceSettings) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const desktop = window.harborPlayerDesktop;
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
  return (
    <Modal title="Настройки" subtitle="Внешний вид" onClose={onClose}>
      <section className="appearance-settings" aria-label="Внешний вид">
        <div className="appearance-section">
          <h3>Тема</h3>
          <div
            className="appearance-choice-row"
            role="radiogroup"
            aria-label="Тема"
          >
            {(["dark", "light"] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`appearance-theme-card ${settings.theme === theme ? "selected" : ""}`}
                role="radio"
                aria-checked={settings.theme === theme}
                onClick={() => void save({ ...settings, theme })}
              >
                <span className={`theme-preview theme-preview--${theme}`} />
                {theme === "dark" ? "Тёмная" : "Светлая"}
              </button>
            ))}
          </div>
        </div>
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
          <p className="hint">
            Картинка копируется в данные Harbor Player — исходный файл можно
            удалить.
          </p>
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
          <p className="appearance-upcoming">
            Галерея Unsplash появится здесь позже.
          </p>
        </div>
      </section>
    </Modal>
  );
}
