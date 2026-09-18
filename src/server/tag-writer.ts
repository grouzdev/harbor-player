import { parseFile, type IAudioMetadata } from "music-metadata";
import {
  File,
  Picture,
  PictureType,
  ByteVector,
  StringType,
  TagTypes,
  Mpeg4AppleTag,
  Mpeg4BoxType,
  Mpeg4AppleDataBoxFlagType,
} from "@digimezzo/node-taglib-sharp";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { TagPatch } from "../shared/contracts.js";
import { audioDigest } from "./audio-digest.js";
import { writeMp3Cover } from "./mp3-cover.js";
import { writeMp3TagsLosslessly } from "./mp3-id3.js";

const fields: Record<string, string[]> = {
  title: ["title"],
  artists: ["artist", "artists"],
  albumTitle: ["album"],
  albumArtists: ["albumartist", "albumartists"],
  genres: ["genre"],
  year: ["year", "date"],
  trackNumber: ["track"],
  discNumber: ["disk"],
  cover: ["picture"],
};

function normalizeLyrics(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value.map((lyric) => {
    if (!lyric || typeof lyric !== "object") return lyric;
    const entry = lyric as Record<string, unknown>;
    return {
      ...entry,
      text:
        typeof entry.text === "string"
          ? entry.text.replace(/^\uFEFF/, "")
          : entry.text,
    };
  });
}

function nativeTagEqual(id: string, before: unknown, after: unknown): boolean {
  if (id !== "USLT") return isDeepStrictEqual(after, before);
  const normalize = (value: unknown) => {
    if (!value || typeof value !== "object") return value;
    const lyric = value as Record<string, unknown>;
    return {
      ...lyric,
      text:
        typeof lyric.text === "string"
          ? lyric.text.replace(/^\uFEFF/, "")
          : lyric.text,
    };
  };
  return isDeepStrictEqual(normalize(after), normalize(before));
}

function unchangedCommon(
  meta: IAudioMetadata,
  patch: TagPatch,
): Record<string, unknown> {
  const result = { ...meta.common } as Record<string, unknown>;
  for (const key of Object.keys(patch))
    for (const common of fields[key] || []) {
      if (common === "track" || common === "disk")
        result[common] = { of: (result[common] as { of: unknown })?.of };
      else delete result[common];
    }
  delete result.encodedby;
  delete result.encodersettings;
  if (!result.year) delete result.year;
  if (Array.isArray(result.comment))
    result.comment = result.comment.map((c: any) => ({
      text: c.text,
      language: c.language && c.language !== "XXX" ? c.language : "",
      descriptor: c.descriptor || "",
    }));
  result.lyrics = normalizeLyrics(result.lyrics);
  return result;
}

/** Loaded only in the short-lived child process: node-taglib-sharp must never share state between files. */
export async function writeTags(file: string, patch: TagPatch): Promise<void> {
  if (patch.cover) {
    const data = Buffer.from(patch.cover.data, "base64");
    const png = data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
    if (
      data.length > 10 * 1024 * 1024 ||
      !(png || jpeg) ||
      patch.cover.mime !== (png ? "image/png" : "image/jpeg")
    )
      throw new Error("Некорректная обложка");
  }
  const before = await parseFile(file, { duration: true });
  const digest = await audioDigest(file);
  const coverOnlyMp3 =
    path.extname(file).toLowerCase() === ".mp3" &&
    patch.cover !== undefined &&
    Object.keys(patch).every((key) => key === "cover");
  if (coverOnlyMp3) await writeMp3Cover(file, patch.cover!);
  const losslessMp3 =
    !coverOnlyMp3 && path.extname(file).toLowerCase() === ".mp3"
      ? await writeMp3TagsLosslessly(file, patch, {
          track: before.common.track.of || undefined,
          disc: before.common.disk.of || undefined,
        })
      : false;
  if (!coverOnlyMp3 && !losslessMp3) {
    const tagged = File.createFromPath(file);
    try {
      if (
        before.common.track.of &&
        tagged.tag.trackCount !== before.common.track.of
      )
        tagged.tag.trackCount = before.common.track.of;
      if (
        before.common.disk.of &&
        tagged.tag.discCount !== before.common.disk.of
      )
        tagged.tag.discCount = before.common.disk.of;
      if (patch.title !== undefined) tagged.tag.title = patch.title;
      if (patch.artists !== undefined) tagged.tag.performers = patch.artists;
      if (patch.albumTitle !== undefined) tagged.tag.album = patch.albumTitle;
      if (patch.albumArtists !== undefined)
        tagged.tag.albumArtists = patch.albumArtists;
      if (patch.genres !== undefined) tagged.tag.genres = patch.genres;
      if (patch.year !== undefined) tagged.tag.year = patch.year || 0;
      if (patch.trackNumber !== undefined)
        tagged.tag.track = patch.trackNumber || 0;
      if (patch.discNumber !== undefined)
        tagged.tag.disc = patch.discNumber || 0;
      if (path.extname(file).toLowerCase() === ".m4a") {
        const apple = tagged.getTag(TagTypes.Apple, true) as Mpeg4AppleTag;
        for (const [values, box] of [
          [patch.artists, Mpeg4BoxType.ART],
          [patch.albumArtists, Mpeg4BoxType.AART],
          [patch.genres, Mpeg4BoxType.GEN],
        ] as const)
          if (values !== undefined)
            apple.setQuickTimeData(
              box,
              values.map((s) => ByteVector.fromString(s, StringType.UTF8)),
              Mpeg4AppleDataBoxFlagType.ContainsText,
            );
      }
      if (patch.cover !== undefined) {
        const other = tagged.tag.pictures.filter(
          (p) => p.type !== PictureType.FrontCover,
        );
        tagged.tag.pictures =
          patch.cover === null
            ? []
            : [
                ...other,
                Picture.fromFullData(
                  ByteVector.fromByteArray(
                    Buffer.from(patch.cover.data, "base64"),
                  ),
                  PictureType.FrontCover,
                  patch.cover.mime,
                  "",
                ),
              ];
      }
      tagged.save();
    } finally {
      tagged.dispose();
    }
  }
  const after = await parseFile(file, { duration: true });
  if (digest !== (await audioDigest(file)))
    throw new Error("Запись отклонена: изменились аудиоданные");
  if (
    !isDeepStrictEqual(
      unchangedCommon(before, patch),
      unchangedCommon(after, patch),
    )
  )
    throw new Error("Запись отклонена: изменились невыбранные теги");
  const c = after.common;
  const actual: Record<string, unknown> = {
    title: c.title || "",
    artists: c.artists || (c.artist ? [c.artist] : []),
    albumTitle: c.album || "",
    albumArtists: c.albumartists || (c.albumartist ? [c.albumartist] : []),
    genres: c.genre || [],
    year: c.year || null,
    trackNumber: c.track.no || null,
    discNumber: c.disk.no || null,
  };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "cover") {
      if (
        value === null &&
        c.picture?.some((picture) => picture.type === "Cover (front)")
      )
        throw new Error("Не удалось удалить обложку");
      if (
        patch.cover &&
        !c.picture?.some((p) =>
          Buffer.from(p.data).equals(Buffer.from(patch.cover!.data, "base64")),
        )
      )
        throw new Error("Не удалось сохранить обложку");
    } else if (!isDeepStrictEqual(actual[key], value === 0 ? null : value))
      throw new Error(`Не удалось точно сохранить поле ${key}`);
  }
  const changed = Object.keys(patch).flatMap((key) => {
    const nativeFields: Record<string, string[]> = {
      title: ["TIT2", "TITLE", "©nam", "INAM"],
      artists: ["TPE1", "ARTIST", "©ART", "IART"],
      albumTitle: ["TALB", "ALBUM", "©alb", "IPRD"],
      albumArtists: ["TPE2", "ALBUMARTIST", "ALBUM ARTIST", "aART"],
      genres: ["TCON", "GENRE", "Genre", "genre", "©gen", "gnre", "IGNR"],
      year: ["TYER", "TDRC", "DATE", "YEAR", "©day", "ICRD"],
      trackNumber: ["TRCK", "TRACKNUMBER", "TRACK", "trkn", "ITRK", "IPRT"],
      discNumber: ["TPOS", "DISCNUMBER", "DISC", "disk"],
      cover: ["APIC", "METADATA_BLOCK_PICTURE", "covr"],
    };
    return nativeFields[key] || [];
  });
  for (const [format, tags] of Object.entries(before.native)) {
    if (format === "ID3v1") continue;
    for (const tag of tags) {
      if (
        changed.includes(tag.id) ||
        ["TSSE", "ENCODER", "©too"].includes(tag.id)
      )
        continue;
      if (
        !(after.native[format] || []).some(
          (other) =>
            other.id === tag.id &&
            nativeTagEqual(tag.id, tag.value, other.value),
        )
      )
        throw new Error(`Запись отклонена: потеря тега ${tag.id}`);
    }
  }
}
