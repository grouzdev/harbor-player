export const librarySelectionKey = (libraryId: string) =>
  `library:${libraryId}`;

export const folderSelectionKey = (libraryId: string, relativePath: string) =>
  `folder:${JSON.stringify([libraryId, relativePath])}`;

export function locationsFromSelectionKeys(keys: readonly string[]) {
  const libraryIds: string[] = [];
  const folders: { libraryId: string; relativePath: string }[] = [];
  for (const key of keys) {
    if (key.startsWith("library:")) {
      const id = key.slice("library:".length);
      if (id && !libraryIds.includes(id)) libraryIds.push(id);
      continue;
    }
    if (!key.startsWith("folder:")) continue;
    try {
      const value: unknown = JSON.parse(key.slice("folder:".length));
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "string" &&
        typeof value[1] === "string"
      )
        folders.push({ libraryId: value[0], relativePath: value[1] });
    } catch {
      // Ignore a stale or malformed DOM key.
    }
  }
  const libraries = new Set(libraryIds);
  const normalizedFolders = folders.filter((folder, index) => {
    if (libraries.has(folder.libraryId)) return false;
    return !folders.some(
      (parent, parentIndex) =>
        parentIndex !== index &&
        parent.libraryId === folder.libraryId &&
        folder.relativePath.startsWith(`${parent.relativePath}\\`),
    );
  });
  return { libraryIds, folders: normalizedFolders };
}
