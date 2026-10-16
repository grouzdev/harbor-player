import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

function syncSafe(value) {
  assert(value < 0x10000000);
  return Buffer.from([
    (value >>> 21) & 127,
    (value >>> 14) & 127,
    (value >>> 7) & 127,
    value & 127,
  ]);
}

/** RIFF's supported ID3 chunk, with an unmodified ID3v2.3 APIC original. */
export function artworkWav(
  audio,
  original,
  format,
  title = "Storage original",
) {
  assert(["jpeg", "png"].includes(format));
  assert(original.length <= 10 * 1024 * 1024, "Scanner cover limit: 10 MiB");
  const body = Buffer.concat([
    Buffer.from(`\0image/${format}\0\x03\0`, "latin1"),
    original,
  ]);
  const frame = Buffer.alloc(10);
  frame.write("APIC");
  frame.writeUInt32BE(body.length, 4);
  const textFrames = ["TIT2", "TALB", "TPE1"].map((id) => {
    const text = Buffer.from(`\0${title}`, "latin1");
    const header = Buffer.alloc(10);
    header.write(id);
    header.writeUInt32BE(text.length, 4);
    return Buffer.concat([header, text]);
  });
  const frames = Buffer.concat([...textFrames, frame, body]);
  const tag = Buffer.concat([
    Buffer.from("ID3\x03\0\0", "latin1"),
    syncSafe(frames.length),
    frames,
  ]);
  const chunk = Buffer.alloc(8);
  chunk.write("id3 ");
  chunk.writeUInt32LE(tag.length, 4);
  const result = Buffer.concat([
    audio,
    chunk,
    tag,
    Buffer.alloc(tag.length % 2),
  ]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}
