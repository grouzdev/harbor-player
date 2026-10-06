import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { UpdateState } from "../shared/desktop-contract";
import { UpdateControls, updateStatus } from "./UpdateControls";
import "./desktop";

export function UpdatePanel() {
  const bridge = window.harborPlayerDesktop;
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = bridge.subscribeUpdateState((next) => {
      receivedUpdate = true;
      if (active) setState(next);
    });
    void bridge
      .getUpdateState()
      .then((next) => {
        if (active && !receivedUpdate) setState(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);
  const notificationId = state?.notificationId;
  if (
    !bridge ||
    !state ||
    state.notificationHidden ||
    (notificationId !== undefined && dismissedId === notificationId) ||
    ["idle", "checking", "upToDate"].includes(state.status)
  )
    return null;
  const dismiss = () => {
    setDismissedId(notificationId ?? null);
    void bridge.dismissUpdate().catch(() => undefined);
  };
  return (
    <aside className="update-panel" aria-label="Обновление приложения">
      <button
        type="button"
        className="update-close"
        aria-label="Закрыть уведомление об обновлении"
        onClick={dismiss}
      >
        <X size={18} />
      </button>
      <div className="update-panel-body">
        <p className="update-text" role="status">
          {updateStatus(state)}
        </p>
        {state.status === "error" && (
          <p className="hint update-text">
            Можно продолжить пользоваться плеером и обновиться позже.
          </p>
        )}
        {state.status === "downloading" && (
          <p className="hint update-text">
            Закрытие уведомления не отменяет загрузку. Статус доступен в
            настройках.
          </p>
        )}
        <UpdateControls key={notificationId} state={state} desktop={bridge} />
      </div>
      <div className="update-panel-footer">
        <button className="button secondary" onClick={dismiss}>
          {state.status === "downloading" ? "Скрыть" : "Не сейчас"}
        </button>
      </div>
    </aside>
  );
}
