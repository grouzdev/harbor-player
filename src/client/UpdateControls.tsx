import { useState } from "react";
import type {
  UpdatePreferences,
  UpdateState,
} from "../shared/desktop-contract";
import type { DesktopBridge } from "./desktop";

export function updateStatus(state: UpdateState): string {
  switch (state.status) {
    case "idle":
      return "";
    case "checking":
      return "Проверяем обновления…";
    case "upToDate":
      return "Установлена актуальная версия";
    case "available":
      return `Доступна версия ${state.version}`;
    case "downloading":
      return `Загрузка ${state.version}: ${Math.round(state.percent)}%`;
    case "downloaded":
      return `Версия ${state.version} готова к установке`;
    case "preparingInstall":
      return "Подготовка к установке…";
    case "unsupported":
      return "Portable-версия обновляется вручную со страницы релизов.";
    case "error":
      return state.message;
  }
}

export function UpdateControls({
  state,
  desktop,
  onPreferencesChange,
}: {
  state: UpdateState;
  desktop: DesktopBridge;
  onPreferencesChange?: (preferences: UpdatePreferences) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch {
      // IPC failures must not leak technical exceptions into the interface.
      setError("Не удалось выполнить действие. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <div className="update-actions">
        {state.status === "available" && (
          <button
            className="button"
            disabled={pending}
            onClick={() => void run(() => desktop.downloadUpdate())}
          >
            Скачать
          </button>
        )}
        {state.status === "downloaded" && (
          <button
            className="button"
            disabled={pending}
            onClick={() => void run(() => desktop.installUpdate())}
          >
            Перезапустить и установить
          </button>
        )}
        {(state.status === "available" || state.status === "downloaded") && (
          <button
            className="button secondary"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                const preferences = await desktop.setUpdatePreferences({
                  skippedVersion: state.version,
                });
                onPreferencesChange?.(preferences);
              })
            }
          >
            Пропустить эту версию
          </button>
        )}
        {state.status === "error" && (
          <>
            {state.retryable && (
              <button
                className="button"
                disabled={pending}
                onClick={() => void run(() => desktop.retryUpdate())}
              >
                Повторить
              </button>
            )}
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => void run(() => desktop.openUpdateLog())}
            >
              Открыть журнал
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="error-text update-text" role="status">
          {error}
        </p>
      )}
    </>
  );
}
