import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import type { PulseSettings } from "../shared/pulse";
import { api } from "./api";
import { Modal } from "./Modal";

/**
 * Collection controls are independent of the current track and timeline query.
 * Clearing advances the server generation, so delayed outbox entries cannot
 * repopulate the history.
 */
export function PulseSettingsControl({
  onCleared,
}: {
  onCleared?: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(
    null,
  );
  const [error, setError] = useState("");
  const [recorderError, setRecorderError] = useState("");
  const settings = useQuery({
    queryKey: ["pulse", "settings"],
    queryFn: () => api<PulseSettings>("/pulse/settings"),
    enabled: open,
    staleTime: 0,
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ error?: string | null }>).detail;
      setRecorderError(detail?.error ?? "");
    };
    window.addEventListener("harbor-pulse-status", listener);
    return () => window.removeEventListener("harbor-pulse-status", listener);
  }, []);

  async function changeCollection() {
    if (!settings.data || busy) return;
    setBusy(true);
    setError("");
    setOptimisticEnabled(!settings.data.enabled);
    try {
      const value = await api<PulseSettings>(
        "/pulse/settings",
        { enabled: !settings.data.enabled },
        "PATCH",
      );
      queryClient.setQueryData(["pulse", "settings"], value);
      window.dispatchEvent(new Event("harbor-pulse-settings-changed"));
      await queryClient.invalidateQueries({ queryKey: ["pulse"] });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Не удалось изменить сбор истории",
      );
    } finally {
      setOptimisticEnabled(null);
      setBusy(false);
    }
  }

  async function clearHistory() {
    if (!settings.data || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/pulse/clear", {
        confirm: true,
        historyGeneration: settings.data.historyGeneration,
      });
      onCleared?.();
      window.dispatchEvent(new Event("harbor-pulse-settings-changed"));
      await queryClient.invalidateQueries({ queryKey: ["pulse"] });
      setConfirmClear(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Не удалось очистить историю",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Настройки истории прослушивания"
        title={recorderError || "Настройки истории прослушивания"}
        onClick={() => setOpen(true)}
      >
        <Settings2 size={18} />
      </button>
      {recorderError && (
        <span role="status" className="pulse-settings-error">
          {recorderError}
        </span>
      )}
      {open && (
        <Modal
          title="История прослушивания"
          onClose={() => {
            if (busy) return;
            setOpen(false);
            setConfirmClear(false);
            setError("");
          }}
        >
          {settings.isPending && <p role="status">Загрузка…</p>}
          {settings.isError && (
            <div role="alert">
              <p>{settings.error.message}</p>
              <button type="button" onClick={() => void settings.refetch()}>
                Повторить
              </button>
            </div>
          )}
          {settings.data && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={optimisticEnabled ?? settings.data.enabled}
                  disabled={busy}
                  onChange={() => void changeCollection()}
                />{" "}
                Сохранять историю прослушивания на этом устройстве
              </label>
              <div className="pulse-settings-actions">
                {!confirmClear ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmClear(true)}
                  >
                    Очистить историю
                  </button>
                ) : (
                  <div role="group" aria-label="Подтверждение очистки истории">
                    <p>
                      Удалить всю историю прослушивания? Музыка и очередь
                      останутся.
                    </p>
                    <div className="pulse-settings-actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void clearHistory()}
                      >
                        Удалить историю
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmClear(false)}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="pulse-settings-error">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
