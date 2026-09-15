export function selectionScrollAnchor(
  previousFilterKey: string | null,
  nextFilterKey: string,
  selectedKeys: readonly string[],
) {
  if (previousFilterKey === null || previousFilterKey === nextFilterKey)
    return null;
  return selectedKeys.at(-1) || null;
}
