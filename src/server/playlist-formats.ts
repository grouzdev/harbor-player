import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Track } from "../shared/contracts.js";
import type { PlaylistExportFormat } from "../shared/playlists.js";

const xmlDecode = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const xmlEncode = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function playlistReference(value: string, base: string): string {
  const trimmed = value.trim();
  if (/^file:/i.test(trimmed)) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return trimmed;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  const decoded = (() => {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  })();
  return path.isAbsolute(decoded)
    ? path.normalize(decoded)
    : path.resolve(base, decoded);
}

export async function parsePlaylistFile(file: string): Promise<string[]> {
  const content = await readFile(file, "utf8");
  const base = path.dirname(file);
  const extension = path.extname(file).toLowerCase();
  let values: string[];
  if (extension === ".xspf") {
    values = [
      ...content.matchAll(/<location(?:\s[^>]*)?>([\s\S]*?)<\/location>/gi),
    ].map((match) => xmlDecode(match[1].trim()));
  } else if (extension === ".pls") {
    values = content
      .split(/\r?\n/)
      .map((line) => /^File\d+=(.*)$/i.exec(line)?.[1]?.trim())
      .filter((value): value is string => Boolean(value));
  } else if (extension === ".m3u" || extension === ".m3u8") {
    values = content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } else throw new Error("Поддерживаются M3U, M3U8, XSPF и PLS");
  return values.map((value) => playlistReference(value, base));
}

export function writePlaylistFile(
  format: PlaylistExportFormat,
  title: string,
  items: Array<{ track: Track; file: string; relative: boolean }>,
): string {
  if (format === "m3u8") {
    const lines = ["#EXTM3U"];
    for (const { track, file } of items) {
      const artist = (
        track.artists.length ? track.artists : track.albumArtists
      ).join(", ");
      lines.push(
        `#EXTINF:${Math.floor(track.duration)},${artist}${artist ? " - " : ""}${track.title}`,
      );
      lines.push(file);
    }
    return `${lines.join("\r\n")}\r\n`;
  }
  const locations = items
    .map(({ file, relative }) => {
      const location = relative
        ? file
            .split(path.sep)
            .map((part) => encodeURIComponent(part))
            .join("/")
        : pathToFileURL(file).href;
      return `      <track><location>${xmlEncode(location)}</location></track>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>${xmlEncode(title)}</title>\n  <trackList>\n${locations}\n  </trackList>\n</playlist>\n`;
}
