import sharp from "sharp";

const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_COVER_PIXELS = 40_000_000;

export type NormalizedCover = {
  data: string;
  mime: "image/jpeg" | "image/png";
};

function isWebp(data: Buffer) {
  return (
    data.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    data.subarray(8, 12).equals(Buffer.from("WEBP"))
  );
}

/** Decodes a user-supplied WebP and returns the only cover formats we persist. */
export async function normalizeWebpCover(
  data: Buffer,
): Promise<NormalizedCover> {
  if (data.length > MAX_COVER_BYTES)
    throw new Error("Выберите обложку размером до 10 МБ");
  if (!isWebp(data)) throw new Error("Выберите корректный файл WebP");

  const image = sharp(data, {
    failOn: "error",
    limitInputPixels: MAX_COVER_PIXELS,
  }).rotate();
  const metadata = await image.metadata();
  const mime = metadata.hasAlpha ? "image/png" : "image/jpeg";
  const output =
    mime === "image/png"
      ? await image.png({ compressionLevel: 9 }).toBuffer()
      : await image.jpeg({ quality: 92, mozjpeg: true }).toBuffer();

  if (output.length > MAX_COVER_BYTES)
    throw new Error("После преобразования обложка больше 10 МБ");
  return { data: output.toString("base64"), mime };
}
