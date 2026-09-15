import { readFile, writeFile } from "node:fs/promises";
import type { TagPatch } from "../shared/contracts.js";

type Version = 3 | 4;
type Header = { version: Version; size: number; end: number };

const id3v1Genres = [
  "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop", "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise", "Alt. Rock", "Bass", "Soul", "Punk", "Space", "Meditative", "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave", "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock", "Comedy", "Cult", "Gangsta Rap", "Top 40", "Christian Rap", "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll", "Hard Rock", "Folk", "Folk/Rock", "National Folk", "Swing", "Fast-Fusion", "Bebob", "Latin", "Revival", "Celtic", "Bluegrass", "Avantgarde", "Gothic Rock", "Progressive Rock", "Psychedelic Rock", "Symphonic Rock", "Slow Rock", "Big Band", "Chorus", "Easy Listening", "Acoustic", "Humour", "Speech", "Chanson", "Opera", "Chamber Music", "Sonata", "Symphony", "Booty Bass", "Primus", "Porn Groove", "Satire", "Slow Jam", "Club", "Tango", "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul", "Freestyle", "Duet", "Punk Rock", "Drum Solo", "A Cappella", "Euro-House", "Dance Hall", "Goa", "Drum & Bass", "Club-House", "Hardcore", "Terror", "Indie", "BritPop", "Negerpunk", "Polsk Punk", "Beat", "Christian Gangsta Rap", "Heavy Metal", "Black Metal", "Crossover", "Contemporary Christian", "Christian Rock", "Merengue", "Salsa", "Thrash Metal", "Anime", "JPop", "Synthpop",
];

const syncsafe = (value: number) =>
  Buffer.from([(value >> 21) & 127, (value >> 14) & 127, (value >> 7) & 127, value & 127]);

function readSyncsafe(value: Buffer) {
  if (value.length !== 4 || value.some((byte) => byte & 128))
    throw new Error("Повреждён размер ID3-тега");
  return (value[0] << 21) | (value[1] << 14) | (value[2] << 7) | value[3];
}

function header(data: Buffer, offset: number): Header | null {
  if (!data.subarray(offset, offset + 3).equals(Buffer.from("ID3"))) return null;
  const version = data[offset + 3] as Version;
  if ((version !== 3 && version !== 4) || data[offset + 4] !== 0 || data[offset + 5] !== 0)
    throw new Error("Неподдерживаемая структура ID3-тега");
  const size = readSyncsafe(data.subarray(offset + 6, offset + 10));
  const end = offset + 10 + size;
  if (end > data.length) throw new Error("Повреждён размер ID3-тега");
  return { version, size, end };
}

function frames(data: Buffer, offset: number, tag: Header) {
  const body = data.subarray(offset + 10, tag.end);
  const result: Buffer[] = [];
  for (let cursor = 0; cursor < body.length;) {
    if (body.subarray(cursor, cursor + 4).every((byte) => byte === 0)) break;
    if (cursor + 10 > body.length) throw new Error("Повреждён кадр ID3-тега");
    const id = body.subarray(cursor, cursor + 4).toString("latin1");
    const size = tag.version === 3 ? body.readUInt32BE(cursor + 4) : readSyncsafe(body.subarray(cursor + 4, cursor + 8));
    const end = cursor + 10 + size;
    if (!/^[A-Z0-9]{4}$/.test(id) || end > body.length)
      throw new Error("Неподдерживаемый кадр ID3-тега");
    result.push(body.subarray(cursor, end));
    cursor = end;
  }
  return result;
}

function frame(id: string, body: Buffer, version: Version) {
  const size = version === 3 ? Buffer.alloc(4) : syncsafe(body.length);
  if (version === 3) size.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from(id), size, Buffer.from([0, 0]), body]);
}

function textFrame(id: string, values: string[], version: Version) {
  const value = values.join("\0");
  const body = version === 4
    ? Buffer.concat([Buffer.from([3]), Buffer.from(value, "utf8")])
    : Buffer.concat([Buffer.from([1, 255, 254]), Buffer.from(value, "utf16le")]);
  return frame(id, body, version);
}

function frontCover(frameBytes: Buffer, version: Version) {
  if (frameBytes.subarray(0, 4).toString("latin1") !== "APIC") return false;
  const size = version === 3 ? frameBytes.readUInt32BE(4) : readSyncsafe(frameBytes.subarray(4, 8));
  const body = frameBytes.subarray(10);
  if (size !== body.length || body.length < 3) throw new Error("Повреждён APIC-кадр ID3-тега");
  const mimeEnd = body.indexOf(0, 1);
  if (mimeEnd < 1 || mimeEnd + 1 >= body.length) throw new Error("Повреждён APIC-кадр ID3-тега");
  return body[mimeEnd + 1] === 3;
}

function coverFrame(cover: NonNullable<TagPatch["cover"]>, version: Version) {
  return frame("APIC", Buffer.concat([
    Buffer.from([0]), Buffer.from(cover.mime, "ascii"), Buffer.from([0, 3, 0]), Buffer.from(cover.data, "base64"),
  ]), version);
}

function writeId3v1(data: Buffer, patch: TagPatch) {
  if (data.length < 128 || data.subarray(-128, -125).toString("ascii") !== "TAG") return data;
  const tag = Buffer.from(data.subarray(-128));
  const set = (offset: number, length: number, value: string) => {
    tag.fill(0, offset, offset + length);
    Buffer.from(value, "latin1").copy(tag, offset, 0, length);
  };
  if (patch.title !== undefined) set(3, 30, patch.title);
  if (patch.artists !== undefined) set(33, 30, patch.artists.join(" / "));
  if (patch.albumTitle !== undefined) set(63, 30, patch.albumTitle);
  if (patch.year !== undefined) set(93, 4, patch.year ? String(patch.year) : "");
  if (patch.trackNumber !== undefined && tag[125] === 0) tag[126] = patch.trackNumber || 0;
  if (patch.genres !== undefined) {
    const index = patch.genres.length === 1 ? id3v1Genres.indexOf(patch.genres[0]) : -1;
    tag[127] = index >= 0 ? index : 255;
  }
  return Buffer.concat([data.subarray(0, -128), tag]);
}

const ids = (version: Version): Record<string, string> => ({
  title: "TIT2", artists: "TPE1", albumTitle: "TALB", albumArtists: "TPE2", genres: "TCON",
  year: version === 4 ? "TDRC" : "TYER", trackNumber: "TRCK", discNumber: "TPOS",
});

/** Rewrites only selected ID3 frames and keeps every other source frame byte-for-byte. */
export async function writeMp3TagsLosslessly(file: string, patch: TagPatch, counts: { track?: number; disc?: number }) {
  let data = await readFile(file);
  const blocks: { offset: number; tag: Header }[] = [];
  for (let offset = 0;;) {
    const tag = header(data, offset);
    if (!tag) break;
    blocks.push({ offset, tag });
    offset = tag.end;
  }
  if (!blocks.length) return false;
  const output: Buffer[] = [];
  for (const { offset, tag } of blocks) {
    const replace = new Set(Object.keys(patch).map((key) => ids(tag.version)[key]).filter(Boolean));
    let current = frames(data, offset, tag).filter((entry) => {
      const id = entry.subarray(0, 4).toString("latin1");
      return !replace.has(id) && !(patch.cover !== undefined && frontCover(entry, tag.version));
    });
    for (const [key, value] of Object.entries(patch)) {
      const id = ids(tag.version)[key];
      if (!id || value === undefined || (Array.isArray(value) && !value.length)) continue;
      const count = key === "trackNumber" ? counts.track : key === "discNumber" ? counts.disc : undefined;
      // Clearing a number must retain its total: 1/7 becomes /7, not an absent frame.
      if (value === null && !count) continue;
      const values = Array.isArray(value) ? value : [
        value === null ? `/${count}` : count ? `${value}/${count}` : String(value),
      ];
      current.push(textFrame(id, values, tag.version));
    }
    if (patch.cover) current.push(coverFrame(patch.cover, tag.version));
    const body = Buffer.concat(current);
    const padding = Buffer.alloc(Math.max(1024, 4096 - body.length));
    output.push(Buffer.from([0x49, 0x44, 0x33, tag.version, 0, 0]), syncsafe(body.length + padding.length), body, padding);
  }
  const tail = writeId3v1(data.subarray(blocks.at(-1)!.tag.end), patch);
  await writeFile(file, Buffer.concat([...output, tail]));
  return true;
}
