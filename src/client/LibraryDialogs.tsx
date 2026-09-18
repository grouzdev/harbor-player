import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { FolderInput } from "lucide-react";
import type { Library } from "../shared/contracts";
import { api } from "./api";
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
  const [error, setError] = useState("");
  return (
    <Modal
      title="Подключить библиотеку"
      subtitle="Музыка останется в своей папке. Мы добавим её в каталог."
      onClose={onClose}
    >
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
          <input
            autoFocus
            required
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder={"D:\\Music\\Collection"}
          />
        </label>
        <label className="field">
          Название библиотеки <span className="muted">необязательно</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Например, Коллекция"
          />
        </label>
        <p className="hint">
          Можно подключить несколько папок с разных дисков. Вложенные папки
          будут просканированы автоматически.
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={busy || !folder.trim()}>
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
