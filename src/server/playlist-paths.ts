import path from "node:path";
import type { PathTemplate, PathTemplatePart } from "../shared/playlists.js";
import type { Track } from "../shared/contracts.js";

const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function safePathComponent(value: string): string {
  let result = value
    .normalize("NFC")
    .split("")
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? "_"
        : character,
    )
    .join("")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!result) result = "_";
  if (windowsReserved.test(result)) result = `_${result}`;
  return [...result].slice(0, 180).join("");
}

function fieldValue(
  part: Extract<PathTemplatePart, { kind: "field" }>,
  track: Track,
) {
  const albumArtists = track.albumArtists.length
    ? track.albumArtists
    : track.artists;
  const values: Record<typeof part.field, string> = {
    albumArtist: albumArtists.join(", "),
    trackArtist: track.artists.join(", "),
    album: track.albumTitle,
    year: track.year == null ? "" : String(track.year),
    discNumber: track.discNumber == null ? "" : String(track.discNumber),
    trackNumber: track.trackNumber == null ? "" : String(track.trackNumber),
    title: track.title,
    originalName: path.basename(track.relativePath),
    extension: path.extname(track.relativePath).replace(/^\./, ""),
  };
  let value = values[part.field] || part.fallback;
  if (!value) return "";
  if (part.pad && /^\d+$/.test(value)) value = value.padStart(part.pad, "0");
  return `${part.prefix}${value}${part.suffix}`;
}

function renderPattern(pattern: PathTemplate["fileName"], track: Track) {
  return safePathComponent(
    pattern
      .map((part) =>
        part.kind === "literal" ? part.value : fieldValue(part, track),
      )
      .join(""),
  );
}

export function renderTrackPath(template: PathTemplate, track: Track): string {
  return path.join(
    ...template.directories.map((pattern) => renderPattern(pattern, track)),
    renderPattern(template.fileName, track),
  );
}
