const collator = new Intl.Collator("und", {
  sensitivity: "base",
  numeric: true,
});

/**
 * Returns the normalized first letter of an artist name, or null when its
 * first visible character is not a letter.
 */
export function artistGroupKey(name: string): string | null {
  const first = Array.from(name.trimStart())[0];
  if (!first) return null;

  const normalized = first.normalize("NFD").replace(/\p{M}/gu, "");
  return /^\p{L}+$/u.test(normalized) ? normalized.toLocaleUpperCase() : null;
}

export function isMissingArtistName(name: string): boolean {
  return !name.trim();
}

export function compareArtistNames(a: string, b: string): number {
  const aMissing = isMissingArtistName(a);
  const bMissing = isMissingArtistName(b);
  if (aMissing && !bMissing) return -1;
  if (!aMissing && bMissing) return 1;

  const aGroup = artistGroupKey(a);
  const bGroup = artistGroupKey(b);
  if (aGroup === null && bGroup !== null) return -1;
  if (aGroup !== null && bGroup === null) return 1;
  if (aGroup !== null && bGroup !== null) {
    const groupOrder = collator.compare(aGroup, bGroup);
    if (groupOrder) return groupOrder;
  }

  const nameOrder = collator.compare(a, b);
  return nameOrder || a.localeCompare(b);
}

export function startsNewArtistGroup(
  name: string,
  previousName: string | undefined,
): boolean {
  return (
    previousName !== undefined &&
    (isMissingArtistName(name) !== isMissingArtistName(previousName) ||
      artistGroupKey(name) !== artistGroupKey(previousName))
  );
}
