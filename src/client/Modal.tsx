import {
  useEffect,
  useId,
  useRef,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { focusFirstTextEntry } from "./text-input-tab-navigation";

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  onKeyDown,
  className = "",
  closeOnBackdrop = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>;
  className?: string;
  closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const backdropStart = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    dialog.showModal();
    if (!focusFirstTextEntry(dialog)) dialog.focus();
    return () => {
      dialog.close();
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        opener.getClientRects().length &&
        !opener.closest("[inert]")
      )
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${wide ? "modal wide" : "modal"} ${className}`.trim()}
      onPointerDown={(event) => {
        backdropStart.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          closeOnBackdrop &&
          backdropStart.current &&
          event.target === event.currentTarget
        )
          onClose();
        backdropStart.current = false;
      }}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-content">
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
