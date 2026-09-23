/**
 * Canonical key shared by the client and SQLite catalog queries.
 * Missing names stay first, non-letter names form the existing `#` section,
 * and letter names compare case- and accent-insensitively.
 */
export function artistSortKey(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "0";
  const normalized = trimmed
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
  if (!/^\p{L}/u.test(normalized)) return `1${normalized}`;
  const first = Array.from(normalized)[0];
  const script = /\p{Script=Cyrillic}/u.test(first)
    ? "2"
    : /\p{Script=Latin}/u.test(first)
      ? "3"
      : "4";
  return `${script}${normalized}`;
}

export function albumArtistGroupKey(artists: readonly string[]): string {
  return [...artists].map(artistSortKey).sort().join("\u001f");
}

/** Summarizes the visible album-artist groups in an album result. */
export function albumArtistGroupStats(artists: readonly (readonly string[])[]) {
  const groupCount = new Set(artists.map(albumArtistGroupKey)).size;
  return {
    groupCount,
    albumCount: artists.length,
    averageSize: groupCount ? artists.length / groupCount : 0,
  };
}

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
  const left = artistSortKey(a);
  const right = artistSortKey(b);
  return left < right ? -1 : left > right ? 1 : a.localeCompare(b);
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

/**
 * Summarizes the groups that receive a visible heading in the artist panel.
 * Names are expected to be in artist display order.
 */
export function artistGroupStats(names: readonly string[]) {
  let groupCount = 0;
  let artistCount = 0;
  let previousName: string | undefined;

  for (const name of names) {
    if (!isMissingArtistName(name)) {
      artistCount += 1;
      if (
        previousName === undefined ||
        startsNewArtistGroup(name, previousName)
      )
        groupCount += 1;
    }
    previousName = name;
  }

  return {
    groupCount,
    artistCount,
    averageSize: groupCount ? artistCount / groupCount : 0,
  };
}

export function shouldGroupArtists(
  total: number,
  averageGroupSize: number,
): boolean {
  return total > 10 && averageGroupSize >= 3;
}

export function shouldGroupAlbums(averageGroupSize: number): boolean {
  return averageGroupSize >= 3;
}
