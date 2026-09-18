import { useEffect, useState } from "react";
import type { UpdateState } from "../shared/desktop-contract";
import "./desktop";

export function UpdatePanel() {
  const bridge = window.harborPlayerDesktop;
  const [state, setState] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    void bridge
      .getUpdateState()
      .then(setState)
      .catch(() => undefined);
    return bridge.subscribeUpdateState((next) => {
      setDismissed(false);
      setState(next);
    });
  }, [bridge]);
  if (
    !bridge ||
    !state ||
    dismissed ||
    ["idle", "checking", "upToDate"].includes(state.status)
  )
    return null;
  const retry = () => void bridge.checkForUpdates();
  return (
    <aside className="update-panel" aria-live="polite">
      {state.status === "unsupported" && (
        <span>Portable-версия обновляется вручную со страницы релизов.</span>
      )}
      {state.status === "available" && (
        <>
          <span>Доступна версия {state.version}.</span>
          <button onClick={() => void bridge.downloadUpdate()}>Скачать</button>
        </>
      )}
      {state.status === "downloading" && (
        <span>
          Скачивание версии {state.version}: {state.percent}%
        </span>
      )}
      {state.status === "downloaded" && (
        <>
          <span>Версия {state.version} готова к установке.</span>
          <button onClick={() => void bridge.installUpdate()}>
            Перезапустить и установить
          </button>
          <button className="secondary" onClick={() => setDismissed(true)}>
            Позже
          </button>
        </>
      )}
      {state.status === "preparingInstall" && (
        <span>Ожидаем безопасного завершения операции…</span>
      )}
      {state.status === "error" && (
        <>
          <span>
            Не удалось проверить или скачать обновление: {state.message}
          </span>
          <button onClick={retry}>Повторить</button>
        </>
      )}
    </aside>
  );
}
