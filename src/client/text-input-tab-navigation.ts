const textInputTypes = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

function isTextEntry(
  element: Element,
): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return !element.disabled;
  return (
    element instanceof HTMLInputElement &&
    !element.disabled &&
    textInputTypes.has(element.type)
  );
}

function isVisible(element: HTMLElement) {
  return element.getClientRects().length > 0;
}

function textEntries(scope: ParentNode) {
  return Array.from(scope.querySelectorAll("input, textarea")).filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement =>
      isTextEntry(element) && isVisible(element),
  );
}

export function focusFirstTextEntry(scope: ParentNode) {
  const entry = textEntries(scope)[0];
  if (!entry) return false;
  entry.focus();
  return true;
}

export function installTextInputTabNavigation() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.isComposing) return;

    const target = event.target instanceof Element ? event.target : null;
    const scope =
      target?.closest<HTMLElement>(
        'dialog[open], [role="dialog"][aria-modal="true"]',
      ) ?? document;
    const entries = textEntries(scope);
    event.preventDefault();
    if (!entries.length) return;

    const current = target ? entries.indexOf(target as HTMLInputElement) : -1;
    const next = event.shiftKey
      ? current <= 0
        ? entries.length - 1
        : current - 1
      : current === -1 || current === entries.length - 1
        ? 0
        : current + 1;
    entries[next]?.focus();
  });
}
