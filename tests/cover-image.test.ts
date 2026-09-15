import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeWebpCover } from "../dist/server/cover-image.js";

describe("normalizeWebpCover", () => {
  it("stores an opaque WebP as JPEG", async () => {
    const source = await sharp({
      create: { width: 3, height: 2, channels: 3, background: "#d04030" },
    })
      .webp()
      .toBuffer();

    const result = await normalizeWebpCover(source);

    expect(result.mime).toBe("image/jpeg");
    expect((await sharp(Buffer.from(result.data, "base64")).metadata()).format).toBe("jpeg");
  });

  it("stores a transparent WebP as PNG", async () => {
    const source = await sharp({
      create: { width: 3, height: 2, channels: 4, background: "#d0403080" },
    })
      .webp()
      .toBuffer();

    const result = await normalizeWebpCover(source);

    expect(result.mime).toBe("image/png");
    expect((await sharp(Buffer.from(result.data, "base64")).metadata()).format).toBe("png");
  });

  it("rejects a malformed WebP", async () => {
    await expect(normalizeWebpCover(Buffer.from("RIFFxxxxWEBP"))).rejects.toThrow(
      "webp",
    );
  });
});
