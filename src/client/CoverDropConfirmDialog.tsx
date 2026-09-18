import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { count } from "./api";
import { Modal } from "./Modal";

function activatePrimaryOnEnter(
  event: ReactKeyboardEvent<HTMLDialogElement>,
  button: HTMLButtonElement | null,
) {
  if (
    event.key !== "Enter" ||
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" || target.tagName === "TEXTAREA")
  )
    return;
  if (!button || button.disabled) return;
  event.preventDefault();
  button.click();
}

export function CoverDropConfirmDialog({
  albumTitle,
  coverName,
  trackCount,
  onClose,
  onConfirm,
}: {
  albumTitle: string;
  coverName: string;
  trackCount: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Применить обложку?"
      subtitle={albumTitle || "Без альбома"}
      onClose={busy ? () => {} : onClose}
      onKeyDown={(event) =>
        activatePrimaryOnEnter(event, primaryButtonRef.current)
      }
    >
      <p className="hint">
        Применить обложку «{coverName}» ко всем {count(trackCount)} трекам
        альбома?
      </p>
      {error && <p className="error-text">{error}</p>}
      <footer className="modal-footer">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onClose}
        >
          Отмена
        </button>
        <button
          type="button"
          ref={primaryButtonRef}
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
              setBusy(false);
            }
          }}
        >
          {busy ? "Применяем…" : "Применить"}
        </button>
      </footer>
    </Modal>
  );
}
