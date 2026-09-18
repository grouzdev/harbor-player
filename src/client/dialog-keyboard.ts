import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function activateDialogPrimaryOnEnter(
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
