import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeTags } from "../dist/server/tag-writer.js";
import { writeMp3Cover } from "../dist/server/mp3-cover.js";
import { audioDigest } from "../src/server/audio-digest.js";

const fixtures = path.resolve(".fixtures");
let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

function syncsafe(value: number) {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function size(value: Buffer) {
  return (value[0] << 21) | (value[1] << 14) | (value[2] << 7) | value[3];
}

function frame(id: string, body: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from(id), length, Buffer.from([0, 0]), body]);
}

function apic(type: number, data: Buffer) {
  return frame(
    "APIC",
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from("image/png\0", "ascii"),
      Buffer.from([type, 0]),
      data,
    ]),
  );
}

function frames(data: Buffer) {
  const tagSize = size(data.subarray(6, 10));
  const result: Buffer[] = [];
  let offset = 10;
  const end = 10 + tagSize;
  while (
    offset + 10 <= end &&
    !data.subarray(offset, offset + 4).every((n) => !n)
  ) {
    const length = data.readUInt32BE(offset + 4);
    result.push(data.subarray(offset, offset + 10 + length));
    offset += 10 + length;
  }
  return result;
}

function frontCover(frame: Buffer) {
  if (frame.subarray(0, 4).toString("ascii") !== "APIC") return false;
  const body = frame.subarray(10);
  const mimeEnd = body.indexOf(0, 1);
  return mimeEnd >= 1 && body[mimeEnd + 1] === 3;
}

async function mp3WithSeparateGenres() {
  root = await mkdtemp(path.join(os.tmpdir(), "mymusiclib-mp3-cover-"));
  const original = await readFile(path.join(fixtures, "sample.mp3"));
  const audio = original.subarray(10 + size(original.subarray(6, 10)));
  const preserved = [
    frame("TIT2", Buffer.from("Track", "latin1")),
    frame("TCON", Buffer.from("Post-Rock", "latin1")),
    frame("TCON", Buffer.from("Math Rock", "latin1")),
    frame("TCON", Buffer.from("Experimental", "latin1")),
    apic(0, Buffer.from("other-image")),
  ];
  const tag = Buffer.concat(preserved);
  const file = path.join(root, "multi-genre.mp3");
  await writeFile(
    file,
    Buffer.concat([
      Buffer.from([0x49, 0x44, 0x33, 3, 0, 0]),
      syncsafe(tag.length),
      tag,
      audio,
    ]),
  );
  return { file, preserved };
}

describe("MP3 cover writer", () => {
  it("adds, replaces and removes a front cover without changing other ID3 frames", async () => {
    const { file, preserved } = await mp3WithSeparateGenres();
    const cover = await readFile(path.join(fixtures, "cover.png"));
    const replacement = await readFile(path.join(fixtures, "large-cover.png"));
    const audio = await audioDigest(file);
    const patch = (data: Buffer) => ({
      data: data.toString("base64"),
      mime: "image/png" as const,
    });

    await writeTags(file, { cover: patch(cover) });
    expect(await audioDigest(file)).toBe(audio);
    const afterAdd = frames(await readFile(file));
    expect(afterAdd.filter((entry) => !frontCover(entry))).toEqual(preserved);
    expect(afterAdd.filter(frontCover)).toHaveLength(1);
    expect(
      afterAdd.find(frontCover)?.subarray(-cover.length).equals(cover),
    ).toBe(true);

    await writeTags(file, { cover: patch(replacement) });
    const afterReplace = frames(await readFile(file));
    expect(afterReplace.filter((entry) => !frontCover(entry))).toEqual(
      preserved,
    );
    expect(afterReplace.filter(frontCover)).toHaveLength(1);
    expect(
      afterReplace
        .find(frontCover)
        ?.subarray(-replacement.length)
        .equals(replacement),
    ).toBe(true);

    await writeTags(file, { cover: null });
    const afterRemove = frames(await readFile(file));
    expect(afterRemove).toEqual(preserved);
  });

  it("rejects an unsupported ID3 version without changing the file", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mymusiclib-mp3-cover-"));
    const file = path.join(root, "v22.mp3");
    await copyFile(path.join(fixtures, "sample.mp3"), file);
    const before = await readFile(file);
    const malformed = Buffer.from(before);
    malformed[3] = 2;
    await writeFile(file, malformed);

    await expect(
      writeMp3Cover(file, { data: "AA==", mime: "image/png" }),
    ).rejects.toThrow("ID3v2.3");
    expect(await readFile(file)).toEqual(malformed);
  });
});
