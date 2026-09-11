import { parseFile, type IAudioMetadata } from "music-metadata";
import { createHash } from "node:crypto";
import { stat, readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import type { Track } from "../shared/contracts.js";

const clean = (values: string[] | undefined) => [
  ...new Set((values || []).map((v) => v.trim()).filter(Boolean)),
];
export async function readTrack(
  file: string,
  libraryId: string,
  root: string,
  id: string,
  dataDir: string,
): Promise<Track> {
  const info = await stat(file);
  const metadata = await parseFile(file, { duration: true });
  if (
    !metadata.format.sampleRate ||
    !metadata.format.numberOfChannels ||
    !Number.isFinite(metadata.format.duration) ||
    !metadata.format.duration ||
    metadata.format.duration <= 0
  )
    throw new Error("Не удалось прочитать аудиоданные файла");
  const c = metadata.common;
  let coverId: string | null = null;
  let cover =
    c.picture?.find((p) => /front/i.test(p.type || "")) || c.picture?.[0];
  if (!cover) {
    for (const name of ["cover.jpg", "folder.jpg", "cover.png", "folder.png"]) {
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
  }
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
  if (!c.track.no) missingTagFields.push("trackNumber");
  if (!c.disk.no) missingTagFields.push("discNumber");
  if (!coverId) missingTagFields.push("cover");
  let albumFolder = path.dirname(path.relative(root, file));
  if (/^(cd|disc|disk|диск)[\s_-]*\d+$/i.test(path.basename(albumFolder)))
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
    trackNumber: c.track.no || null,
    discNumber: c.disk.no || null,
    duration: metadata.format.duration || 0,
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
