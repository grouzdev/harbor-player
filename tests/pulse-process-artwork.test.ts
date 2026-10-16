import assert from "node:assert/strict";
import { test } from "vitest";
import { parseBuffer } from "music-metadata";
import { artworkWav } from "../scripts/pulse-process-artwork.mjs";

test("RIFF ID3 APIC preserves permitted bytes and distinct album metadata", async () => {
  const audio = Buffer.alloc(16044);
  audio.write("RIFF");
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(16000, 40);
  for (const format of ["jpeg", "png"]) {
    const original = Buffer.from([255, 0, 10, 13, 128, 0, 42]);
    const tagged = artworkWav(audio, original, format, `Album-${format}`);
    const metadata = await parseBuffer(tagged, { mimeType: "audio/wav" });
    assert.equal(metadata.format.duration, 1);
    assert.equal(metadata.common.album, `Album-${format}`);
    assert.equal(metadata.common.title, `Album-${format}`);
    assert.equal(metadata.common.picture?.[0].format, `image/${format}`);
    assert.deepEqual(Buffer.from(metadata.common.picture![0].data), original);
    assert.deepEqual(tagged.subarray(44, audio.length), audio.subarray(44));
    assert.equal(tagged.readUInt32LE(4), tagged.length - 8);
  }
  assert.throws(
    () => artworkWav(audio, Buffer.alloc(10 * 1024 * 1024 + 1), "png"),
    /Scanner cover limit/,
  );
});
