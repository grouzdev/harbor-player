import { readFile, writeFile } from "node:fs/promises";
import type { TagPatch } from "../shared/contracts.js";

const HEADER_SIZE = 10;
const FRONT_COVER = 3;

type Id3Header = {
  version: 3 | 4;
  flags: number;
  size: number;
};

type CoverPatch = NonNullable<TagPatch["cover"]>;

const syncsafe = (value: number) =>
  Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);

function decodeSyncsafe(value: Buffer) {
  if (value.length !== 4 || value.some((byte) => byte & 0x80))
    throw new Error("Повреждён размер ID3-тега");
  return (value[0] << 21) | (value[1] << 14) | (value[2] << 7) | value[3];
}

function header(data: Buffer): Id3Header | null {
  if (!data.subarray(0, 3).equals(Buffer.from("ID3"))) return null;
  const version = data[3];
  if (version !== 3 && version !== 4)
    throw new Error("Поддерживаются только ID3v2.3 и ID3v2.4");
  if (data[4] !== 0) throw new Error("Неподдерживаемая ревизия ID3-тега");
  const flags = data[5];
  if (flags !== 0) throw new Error("Неподдерживаемая структура ID3-тега");
  const size = decodeSyncsafe(data.subarray(6, 10));
  if (HEADER_SIZE + size > data.length)
    throw new Error("Повреждён размер ID3-тега");
  return { version, flags, size };
}

function frameSize(data: Buffer, version: 3 | 4) {
  return version === 3 ? data.readUInt32BE() : decodeSyncsafe(data);
}

function apicType(frame: Buffer, version: 3 | 4): number | null {
  if (frame.subarray(0, 4).toString("latin1") !== "APIC") return null;
  if (frame[8] || frame[9])
    throw new Error("Неподдерживаемый APIC-кадр ID3-тега");
  const size = frameSize(frame.subarray(4, 8), version);
  const body = frame.subarray(10);
  if (size !== body.length || body.length < 3)
    throw new Error("Повреждён APIC-кадр ID3-тега");
  const mimeEnd = body.indexOf(0, 1);
  if (mimeEnd < 1 || mimeEnd + 1 >= body.length)
    throw new Error("Повреждён APIC-кадр ID3-тега");
  return body[mimeEnd + 1];
}

function parseFrames(data: Buffer, tag: Id3Header) {
  const body = data.subarray(HEADER_SIZE, HEADER_SIZE + tag.size);
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    if (body.subarray(offset, offset + 4).every((byte) => byte === 0)) break;
    if (offset + 10 > body.length) throw new Error("Повреждён кадр ID3-тега");
    const id = body.subarray(offset, offset + 4).toString("latin1");
    if (!/^[A-Z0-9]{4}$/.test(id))
      throw new Error("Неподдерживаемый кадр ID3-тега");
    const size = frameSize(body.subarray(offset + 4, offset + 8), tag.version);
    const end = offset + 10 + size;
    if (end > body.length) throw new Error("Повреждён размер кадра ID3-тега");
    frames.push(body.subarray(offset, end));
    offset = end;
  }
  return frames;
}

function coverFrame(cover: CoverPatch, version: 3 | 4) {
  const image = Buffer.from(cover.data, "base64");
  const body = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(cover.mime, "ascii"),
    Buffer.from([0, FRONT_COVER, 0]),
    image,
  ]);
  const size =
    version === 3
      ? (() => {
          const bytes = Buffer.alloc(4);
          bytes.writeUInt32BE(body.length);
          return bytes;
        })()
      : syncsafe(body.length);
  return Buffer.concat([Buffer.from("APIC"), size, Buffer.from([0, 0]), body]);
}

function tagBytes(
  version: 3 | 4,
  flags: number,
  frames: Buffer[],
  audio: Buffer,
) {
  const content = Buffer.concat(frames);
  const padding = Buffer.alloc(Math.max(1024, 4096 - content.length));
  const body = Buffer.concat([content, padding]);
  const head = Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, version, 0, flags]),
    syncsafe(body.length),
  ]);
  return Buffer.concat([head, body, audio]);
}

/** Replaces only the ID3 front-cover frame and preserves all other ID3 frames. */
export async function writeMp3Cover(file: string, cover: CoverPatch | null) {
  const data = await readFile(file);
  const current = header(data);
  if (!current) {
    if (cover === null) return;
    await writeFile(file, tagBytes(3, 0, [coverFrame(cover, 3)], data));
    return;
  }
  const audio = data.subarray(HEADER_SIZE + current.size);
  const frames = parseFrames(data, current).filter(
    (frame) => apicType(frame, current.version) !== FRONT_COVER,
  );
  if (cover) frames.push(coverFrame(cover, current.version));
  await writeFile(
    file,
    tagBytes(current.version, current.flags, frames, audio),
  );
}
