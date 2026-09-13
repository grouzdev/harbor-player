import { open } from "node:fs/promises";
import type { TagPatch } from "../shared/contracts.js";

type Version = 3 | 4;
const frameIds: Record<string, string> = {
  title: "TIT2",
  artists: "TPE1",
  albumTitle: "TALB",
  albumArtists: "TPE2",
  genres: "TCON",
  year: "TDRC",
  trackNumber: "TRCK",
  discNumber: "TPOS",
};
const syncsafe = (value: number) =>
  Buffer.from([
    (value >> 21) & 127,
    (value >> 14) & 127,
    (value >> 7) & 127,
    value & 127,
  ]);
const readSyncsafe = (value: Buffer) => {
  if (value.some((byte) => byte & 128))
    throw new Error("Повреждён размер ID3-тега");
  return (value[0] << 21) | (value[1] << 14) | (value[2] << 7) | value[3];
};
function textFrame(id: string, values: string[], version: Version) {
  const separator = version === 4 ? "\0" : "\0";
  const text = values.join(separator);
  const body =
    version === 4
      ? Buffer.concat([Buffer.from([3]), Buffer.from(text, "utf8")])
      : Buffer.concat([
          Buffer.from([1, 255, 254]),
          Buffer.from(text, "utf16le"),
        ]);
  const size = Buffer.alloc(4);
  if (version === 4) syncsafe(body.length).copy(size);
  else size.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from(id), size, Buffer.from([0, 0]), body]);
}

/** Changes a fixed-size ID3v2 tag only; audio starts at exactly the same byte offset. */
export async function writeId3InPlace(
  file: string,
  patch: TagPatch,
): Promise<{ fast: boolean; reason?: string }> {
  if (patch.cover !== undefined)
    return { fast: false, reason: "обложка обрабатывается отдельно" };
  // A genre edit must update every existing ID3 representation (including a
  // possible second ID3v2 tag and ID3v1). The fixed-size writer only sees the
  // first ID3v2 block, so use the verified full writer for genre changes.
  if (patch.genres !== undefined)
    return { fast: false, reason: "жанр синхронизируется во всех версиях ID3" };
  const handle = await open(file, "r+");
  try {
    const header = Buffer.alloc(10);
    if (
      (await handle.read(header, 0, 10, 0)).bytesRead !== 10 ||
      header.toString("ascii", 0, 3) !== "ID3"
    )
      return { fast: false, reason: "нет ID3v2 с резервом" };
    const version = header[3] as Version;
    if ((version !== 3 && version !== 4) || header[4] !== 0 || header[5] !== 0)
      return { fast: false, reason: "неподдерживаемая структура ID3v2" };
    const size = readSyncsafe(header.subarray(6));
    const body = Buffer.alloc(size);
    if ((await handle.read(body, 0, size, 10)).bytesRead !== size)
      return { fast: false, reason: "повреждён ID3v2" };
    const replace = new Set(
      Object.keys(patch)
        .map((key) => frameIds[key])
        .filter(Boolean),
    );
    const frames: Buffer[] = [];
    for (let offset = 0; offset < body.length;) {
      if (body.subarray(offset, offset + 4).every((byte) => byte === 0)) break;
      if (offset + 10 > body.length)
        return { fast: false, reason: "неподдерживаемый ID3v2" };
      const id = body.subarray(offset, offset + 4).toString("ascii");
      const length =
        version === 4
          ? readSyncsafe(body.subarray(offset + 4, offset + 8))
          : body.readUInt32BE(offset + 4);
      const end = offset + 10 + length;
      if (!/^[A-Z0-9]{4}$/.test(id) || end > body.length)
        return { fast: false, reason: "неподдерживаемый ID3v2" };
      if (!replace.has(id)) frames.push(body.subarray(offset, end));
      offset = end;
    }
    for (const [key, value] of Object.entries(patch)) {
      const id = frameIds[key];
      if (!id || value === undefined || value === null) continue;
      const values = Array.isArray(value) ? value : [String(value)];
      frames.push(textFrame(id, values, version));
    }
    const updated = Buffer.concat(frames);
    if (updated.length > size)
      return { fast: false, reason: "в ID3v2 недостаточно свободного места" };
    await handle.write(
      Buffer.concat([updated, Buffer.alloc(size - updated.length)]),
      0,
      size,
      10,
    );
    await handle.sync();
    return { fast: true };
  } finally {
    await handle.close();
  }
}
