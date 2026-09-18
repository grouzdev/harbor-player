import { parseFile, type IAudioMetadata } from "music-metadata";
import { File, PictureType } from "@digimezzo/node-taglib-sharp";
import { createHash } from "node:crypto";
import { stat, readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import type { Track } from "../shared/contracts.js";

const clean = (values: string[] | undefined) => [
  ...new Set((values || []).map((v) => v.trim()).filter(Boolean)),
];

type ParsedAudioMetadata = {
  common: Pick<
    IAudioMetadata["common"],
    | "title"
    | "artists"
    | "artist"
    | "album"
    | "albumartists"
    | "albumartist"
    | "genre"
    | "year"
    | "musicbrainz_recordingid"
    | "musicbrainz_albumid"
    | "musicbrainz_releasegroupid"
  > & {
    picture?: { type?: string; format: string; data: Uint8Array }[];
    track?: { no: number | null; of?: number | null };
    disk?: { no: number | null; of?: number | null };
  };
  format: Pick<
    IAudioMetadata["format"],
    "sampleRate" | "numberOfChannels" | "duration"
  >;
};

function readWithTagLib(file: string): ParsedAudioMetadata {
  const tagged = File.createFromPath(file);
  try {
    const { tag, properties } = tagged;
    const artists = clean(tag.performers);
    const albumArtists = clean(tag.albumArtists);
    const picture = tag.pictures
      .filter(
        (item) =>
          item.data.length <= 10 * 1024 * 1024 &&
          ["image/jpeg", "image/png"].includes(item.mimeType),
      )
      .sort(
        (a, b) =>
          Number(b.type === PictureType.FrontCover) -
          Number(a.type === PictureType.FrontCover),
      )[0];
    return {
      common: {
        title: tag.title || undefined,
        artists,
        artist: artists.join("; ") || undefined,
        album: tag.album || undefined,
        albumartists: albumArtists,
        albumartist: albumArtists.join("; ") || undefined,
        genre: clean(tag.genres),
        year: tag.year || undefined,
        track: { no: tag.track || null, of: tag.trackCount || null },
        disk: { no: tag.disc || null, of: tag.discCount || null },
        picture: picture
          ? [
              {
                type:
                  picture.type === PictureType.FrontCover
                    ? "Cover (front)"
                    : "",
                format: picture.mimeType,
                data: Buffer.from(picture.data.toByteArray()),
              },
            ]
          : undefined,
      },
      format: {
        sampleRate: properties.audioSampleRate,
        numberOfChannels: properties.audioChannels,
        duration: properties.durationMilliseconds / 1000,
      },
    };
  } finally {
    tagged.dispose();
  }
}

async function parseTrackMetadata(
  file: string,
  parse: typeof parseFile,
  readDuration: boolean,
): Promise<ParsedAudioMetadata> {
  const parseOnce = async () => {
    const metadata = await parse(file, { duration: readDuration });
    if (!metadata?.common || !metadata.format)
      throw new Error("Парсер вернул неполные метаданные");
    return metadata;
  };
  try {
    return await parseOnce();
  } catch (primaryError) {
    try {
      return await parseOnce();
    } catch {
      try {
        return readWithTagLib(file);
      } catch {
        throw primaryError;
      }
    }
  }
}

export async function readTrack(
  file: string,
  libraryId: string,
  root: string,
  id: string,
  dataDir: string,
  parse: typeof parseFile = parseFile,
  knownDuration?: number,
): Promise<Track> {
  const info = await stat(file);
  const metadata = await parseTrackMetadata(
    file,
    parse,
    knownDuration === undefined,
  );
  if (
    !metadata.format.sampleRate ||
    !metadata.format.numberOfChannels ||
    !Number.isFinite(metadata.format.duration || knownDuration) ||
    !(metadata.format.duration || knownDuration) ||
    (metadata.format.duration || knownDuration)! <= 0
  )
    throw new Error("Не удалось прочитать аудиоданные файла");
  const c = metadata.common;
  let coverId: string | null = null;
  let cover: { format: string; data: Uint8Array } | undefined;
  for (const name of ["cover.jpg", "cover.png", "folder.jpg", "folder.png"]) {
    try {
      const coverPath = path.join(path.dirname(file), name);
      const s = await lstat(coverPath);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 10 * 1024 * 1024)
        continue;
      cover = {
        format: name.endsWith("png") ? "image/png" : "image/jpeg",
        data: await readFile(coverPath),
      };
      break;
    } catch {
      /* An external cover is optional. */
    }
  }
  cover ||=
    c.picture?.find((p) => /front/i.test(p.type || "")) || c.picture?.[0];
  if (
    cover &&
    cover.data.length <= 10 * 1024 * 1024 &&
    ["image/jpeg", "image/png"].includes(cover.format)
  ) {
    coverId =
      createHash("sha256").update(cover.data).digest("hex") +
      (cover.format === "image/png" ? ".png" : ".jpg");
    await mkdir(path.join(dataDir, "covers"), { recursive: true });
    await writeFile(path.join(dataDir, "covers", coverId), cover.data, {
      flag: "wx",
    }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
  }
  const missingTagFields: NonNullable<Track["missingTagFields"]> = [];
  if (!c.title) missingTagFields.push("title");
  if (!(c.artists?.length || c.artist)) missingTagFields.push("artists");
  if (!c.album) missingTagFields.push("albumTitle");
  if (!(c.albumartists?.length || c.albumartist))
    missingTagFields.push("albumArtists");
  if (!c.genre?.length) missingTagFields.push("genres");
  if (!c.year) missingTagFields.push("year");
  if (!c.track?.no) missingTagFields.push("trackNumber");
  if (!c.disk?.no) missingTagFields.push("discNumber");
  if (!coverId) missingTagFields.push("cover");
  let albumFolder = path.dirname(path.relative(root, file));
  if (/^(cd|disc|disk|диск)[\s_-]*\d+\b/i.test(path.basename(albumFolder)))
    albumFolder = path.dirname(albumFolder);
  // Folder identity separates editions; albumArtist (not track artist) keeps compilations together.
  const albumArtists = clean(
    c.albumartists || (c.albumartist ? [c.albumartist] : []),
  );
  const albumKey = createHash("sha256")
    .update(
      JSON.stringify([
        libraryId,
        albumFolder,
        c.album || "",
        albumArtists,
        c.musicbrainz_albumid || c.year || "",
      ]),
    )
    .digest("hex");
  return {
    id,
    libraryId,
    relativePath: path.relative(root, file),
    title: c.title || path.basename(file, path.extname(file)),
    artists: clean(c.artists || (c.artist ? [c.artist] : [])),
    albumTitle: c.album || "",
    albumArtists,
    albumKey,
    genres: clean(c.genre),
    year: c.year || null,
    trackNumber: c.track?.no || null,
    discNumber: c.disk?.no || null,
    duration: metadata.format.duration || knownDuration || 0,
    format: path.extname(file).toLowerCase().slice(1),
    size: info.size,
    mtimeMs: info.mtimeMs,
    coverId,
    missingTagFields,
    musicBrainzRecordingId: c.musicbrainz_recordingid || null,
    musicBrainzReleaseId: c.musicbrainz_albumid || null,
    musicBrainzReleaseGroupId: c.musicbrainz_releasegroupid || null,
    available: true,
  };
}
