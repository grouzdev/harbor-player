import { createHash } from "node:crypto";
import path from "node:path";

const discFolderPattern = /^(cd|disc|disk|диск)[\s_-]*\d+\b/i;

export function normalizedAlbumFolder(relativePath: string): string {
  let albumFolder = path.dirname(relativePath);
  if (discFolderPattern.test(path.basename(albumFolder)))
    albumFolder = path.dirname(albumFolder);
  return albumFolder;
}

export function albumIdentityKey({
  libraryId,
  relativePath,
  albumTitle,
  albumArtists,
  year,
}: {
  libraryId: string;
  relativePath: string;
  albumTitle: string;
  albumArtists: string[];
  year: number | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        libraryId,
        normalizedAlbumFolder(relativePath),
        albumTitle,
        albumArtists,
        year,
      ]),
    )
    .digest("hex");
}
