import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { FolderInput, FolderOpen } from "lucide-react";
import type { Library } from "../shared/contracts";
import { api } from "./api";
import "./desktop";
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

export function AddLibraryDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [error, setError] = useState("");
  const desktop = window.harborPlayerDesktop;
  return (
    <Modal title="Подключить библиотеку" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/libraries", { name, path: folder });
            onAdded();
            onClose();
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Путь к папке
          <span className="library-path-input">
            <input
              autoFocus
              required
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
            />
            {desktop && (
              <button
                type="button"
                className="button secondary"
                disabled={busy || choosingFolder}
                onClick={() => {
                  setChoosingFolder(true);
                  setError("");
                  void desktop
                    .chooseLibraryDirectory()
                    .then((selected) => selected && setFolder(selected))
                    .catch((cause) =>
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    )
                    .finally(() => setChoosingFolder(false));
                }}
              >
                <FolderOpen size={16} />
                Обзор…
              </button>
            )}
          </span>
        </label>
        <label className="field">
          Название библиотеки
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            className="button primary"
            disabled={busy || choosingFolder || !folder.trim()}
          >
            <FolderInput size={16} />
            {busy ? "Подключение…" : "Подключить"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function RenameLibraryDialog({
  library,
  onClose,
  onRename,
}: {
  library: Library;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(library.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Переименовать библиотеку"
      subtitle={library.path}
      onClose={busy ? () => {} : onClose}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onRename(name);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Название библиотеки
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function RemoveLibraryDialog({
  library,
  onClose,
  onRemove,
}: {
  library: Library;
  onClose: () => void;
  onRemove: () => Promise<void>;
}) {
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Отключить библиотеку?"
      subtitle={library.name}
      onClose={busy ? () => {} : onClose}
      onKeyDown={(event) =>
        activatePrimaryOnEnter(event, primaryButtonRef.current)
      }
    >
      <p className="hint">
        Папка будет удалена из каталога Harbor Player вместе с индексированными
        треками. Файлы музыки на диске останутся без изменений.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <footer className="modal-footer">
        <button
          type="button"
          className="button secondary"
          onClick={onClose}
          disabled={busy}
        >
          Отмена
        </button>
        <button
          type="button"
          ref={primaryButtonRef}
          className="button danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onRemove();
              onClose();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Отключение…" : "Отключить"}
        </button>
      </footer>
    </Modal>
  );
}
