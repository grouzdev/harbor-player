import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/** Hash encoded audio independently of mutable tags/container offsets. Fail closed on malformed input. */
export async function audioDigest(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const hash = createHash("sha256");
    let bytes = 0;
    const read = async (offset: number, length: number) => {
      if (offset < 0 || length < 0 || offset + length > size)
        throw new Error("Повреждённый аудиоконтейнер");
      const b = Buffer.alloc(length);
      const r = await handle.read(b, 0, length, offset);
      if (r.bytesRead !== length) throw new Error("Файл изменился при чтении");
      return b;
    };
    const add = async (start: number, end: number) => {
      if (end > size || end < start)
        throw new Error("Повреждённый аудиоконтейнер");
      for (let p = start; p < end;) {
        const b = await read(p, Math.min(1024 * 1024, end - p));
        hash.update(b);
        bytes += b.length;
        p += b.length;
      }
    };
    const ext = path.extname(file).toLowerCase();
    if (ext === ".mp3" || ext === ".aac") {
      let start = 0;
      let end = size;
      while (start + 10 <= end) {
        const h = await read(start, 10);
        if (h.toString("ascii", 0, 3) !== "ID3") break;
        if ([...h.subarray(6, 10)].some((n) => n > 127))
          throw new Error("Некорректный ID3");
        start +=
          10 +
          ((h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9]) +
          (h[3] === 4 && h[5] & 16 ? 10 : 0);
      }
      if (end >= 128 && (await read(end - 128, 3)).toString() === "TAG")
        end -= 128;
      if (end >= 32) {
        const footer = await read(end - 32, 32);
        if (footer.toString("ascii", 0, 8) === "APETAGEX") {
          end -= footer.readUInt32LE(12);
          if (end >= 32 && (await read(end - 32, 8)).toString() === "APETAGEX")
            end -= 32;
        }
      }
      await add(start, end);
    } else if (ext === ".flac") {
      if ((await read(0, 4)).toString() !== "fLaC")
        throw new Error("Неподдерживаемый FLAC");
      let p = 4;
      while (true) {
        const h = await read(p, 4);
        p += 4 + h.readUIntBE(1, 3);
        if (h[0] & 128) break;
      }
      await add(p, size);
    } else if (ext === ".wav") {
      const header = await read(0, 12);
      if (
        header.toString("ascii", 0, 4) !== "RIFF" ||
        header.toString("ascii", 8) !== "WAVE"
      )
        throw new Error("Поддерживается только RIFF/WAVE");
      for (let p = 12; p + 8 <= size;) {
        const h = await read(p, 8);
        const n = h.readUInt32LE(4);
        if (
          h.toString("ascii", 0, 4) === "data" ||
          h.toString("ascii", 0, 4) === "fmt "
        )
          await add(p + 8, p + 8 + n);
        p += 8 + n + (n % 2);
      }
    } else if (ext === ".m4a") {
      for (let p = 0; p + 8 <= size;) {
        const h = await read(p, 8);
        let n = h.readUInt32BE(0);
        let headSize = 8;
        if (n === 1) {
          n = Number((await read(p + 8, 8)).readBigUInt64BE());
          headSize = 16;
        }
        if (n === 0) n = size - p;
        if (n < headSize || p + n > size) throw new Error("Повреждённый MP4");
        if (h.toString("ascii", 4) === "mdat") await add(p + headSize, p + n);
        p += n;
      }
    } else if ([".ogg", ".oga", ".opus"].includes(ext)) {
      let packets: Buffer[] = [];
      let packetSize = 0;
      for (let p = 0; p < size;) {
        const h = await read(p, 27);
        if (h.toString("ascii", 0, 4) !== "OggS")
          throw new Error("Повреждённый Ogg");
        const lace = await read(p + 27, h[26]);
        let cursor = p + 27 + h[26];
        for (const n of lace) {
          packets.push(await read(cursor, n));
          packetSize += n;
          cursor += n;
          if (packetSize > 20 * 1024 * 1024)
            throw new Error("Слишком большой пакет Ogg");
          if (n < 255) {
            const packet = Buffer.concat(packets);
            if (!(
              packet.toString("ascii", 0, 8) === "OpusTags" ||
              (packet[0] === 3 && packet.toString("ascii", 1, 7) === "vorbis")
            )) {
              hash.update(packet);
              bytes += packet.length;
            }
            packets = [];
            packetSize = 0;
          }
        }
        p = cursor;
      }
      if (packetSize) throw new Error("Незавершённый пакет Ogg");
    } else throw new Error("Проверка аудиоданных для формата не реализована");
    if (!bytes) throw new Error("Аудиоданные не найдены");
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
