import { parseFile, type IAudioMetadata } from 'music-metadata';
import { File, Picture, PictureType, ByteVector } from '@digimezzo/node-taglib-sharp';
import { createHash } from 'node:crypto';
import { stat, readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { TagPatch, Track } from '../shared/contracts.js';
import { audioDigest } from './audio-digest.js';

const clean = (values: string[] | undefined) => [...new Set((values || []).map(v => v.trim()).filter(Boolean))];
export async function readTrack(file: string, libraryId: string, root: string, id: string, dataDir: string): Promise<Track> {
  const info = await stat(file); const metadata = await parseFile(file, { duration: true });
  const c = metadata.common; let coverId: string | null = null;
  let cover = c.picture?.find(p => /front/i.test(p.type || '')) || c.picture?.[0];
  if (!cover) {
    for (const name of ['cover.jpg', 'folder.jpg', 'cover.png', 'folder.png']) {
      try {
        const coverPath = path.join(path.dirname(file), name); const s = await lstat(coverPath);
        if (!s.isFile() || s.isSymbolicLink() || s.size > 10 * 1024 * 1024) continue;
        cover = { format: name.endsWith('png') ? 'image/png' : 'image/jpeg', data: await readFile(coverPath) }; break;
      } catch { /* An external cover is optional. */ }
    }
  }
  if (cover && cover.data.length <= 10 * 1024 * 1024 && ['image/jpeg', 'image/png'].includes(cover.format)) {
    coverId = createHash('sha256').update(cover.data).digest('hex') + (cover.format === 'image/png' ? '.png' : '.jpg');
    await mkdir(path.join(dataDir, 'covers'), { recursive: true });
    await writeFile(path.join(dataDir, 'covers', coverId), cover.data, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST') throw e; });
  }
  let albumFolder = path.dirname(path.relative(root, file));
  if (/^(cd|disc|disk|диск)[\s_-]*\d+$/i.test(path.basename(albumFolder))) albumFolder = path.dirname(albumFolder);
  // Folder identity separates editions; albumArtist (not track artist) keeps compilations together.
  const albumArtists = clean(c.albumartist ? [c.albumartist] : []);
  const albumKey = createHash('sha256').update(JSON.stringify([libraryId, albumFolder, c.album || '', albumArtists, c.musicbrainz_albumid || c.year || ''])).digest('hex');
  return {
    id, libraryId, relativePath: path.relative(root, file), title: c.title || path.basename(file, path.extname(file)),
    artists: clean(c.artists || (c.artist ? [c.artist] : [])), albumTitle: c.album || '', albumArtists,
    albumKey, genres: clean(c.genre), year: c.year || null, trackNumber: c.track.no || null, discNumber: c.disk.no || null,
    duration: metadata.format.duration || 0, format: path.extname(file).toLowerCase().slice(1), size: info.size,
    mtimeMs: info.mtimeMs, coverId, available: true,
  };
}

const fields: Record<string, string[]> = { title: ['title'], artists: ['artist', 'artists'], albumTitle: ['album'], albumArtists: ['albumartist'], genres: ['genre'], year: ['year', 'date'], trackNumber: ['track'], discNumber: ['disk'], cover: ['picture'] };
function unchangedCommon(meta: IAudioMetadata, patch: TagPatch): Record<string, unknown> {
  const result = { ...meta.common } as Record<string, unknown>;
  for (const key of Object.keys(patch)) for (const common of fields[key] || []) {
    if (common === 'track' || common === 'disk') result[common] = { of: (result[common] as {of:unknown})?.of };
    else delete result[common];
  }
  // Tag writers may add a container encoder marker; it is not user metadata.
  delete result.encodedby; delete result.encodersettings;
  return result;
}
export async function writeTags(file: string, patch: TagPatch): Promise<void> {
  const before = await parseFile(file, { duration: true }); const digest = await audioDigest(file);
  const tagged = File.createFromPath(file);
  try {
    if (patch.title !== undefined) tagged.tag.title = patch.title;
    if (patch.artists !== undefined) tagged.tag.performers = patch.artists;
    if (patch.albumTitle !== undefined) tagged.tag.album = patch.albumTitle;
    if (patch.albumArtists !== undefined) tagged.tag.albumArtists = patch.albumArtists;
    if (patch.genres !== undefined) tagged.tag.genres = patch.genres;
    if (patch.year !== undefined) tagged.tag.year = patch.year || 0;
    if (patch.trackNumber !== undefined) tagged.tag.track = patch.trackNumber || 0;
    if (patch.discNumber !== undefined) tagged.tag.disc = patch.discNumber || 0;
    if (patch.cover !== undefined) {
      const other = tagged.tag.pictures.filter(p => p.type !== PictureType.FrontCover);
      tagged.tag.pictures = patch.cover === null ? [] : [...other, Picture.fromFullData(ByteVector.fromByteArray(Buffer.from(patch.cover.data, 'base64')), PictureType.FrontCover, patch.cover.mime, '')];
    }
    tagged.save();
  } finally { tagged.dispose(); }
  const after = await parseFile(file, { duration: true });
  if (digest !== await audioDigest(file)) throw new Error('Запись отклонена: изменились аудиоданные');
  if (!isDeepStrictEqual(unchangedCommon(before, patch), unchangedCommon(after, patch))) throw new Error('Запись отклонена: изменились невыбранные теги');
  const c = after.common;
  const actual: Record<string, unknown> = { title: c.title || '', artists: c.artists || (c.artist ? [c.artist] : []), albumTitle: c.album || '', albumArtists: c.albumartist ? c.albumartist.split(';').map(s => s.trim()) : [], genres: c.genre || [], year: c.year || null, trackNumber: c.track.no || null, discNumber: c.disk.no || null };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'cover') {
      if (value === null && c.picture?.length) throw new Error('Не удалось удалить обложку');
      if (patch.cover && !c.picture?.some(p => Buffer.from(p.data).equals(Buffer.from(patch.cover!.data, 'base64')))) throw new Error('Не удалось сохранить обложку');
    } else if (!isDeepStrictEqual(actual[key], value === 0 ? null : value)) throw new Error(`Не удалось точно сохранить поле ${key}`);
  }
  // Native unknown/custom tags must survive. Ignore only frames for fields the user changed.
  const changed = Object.keys(patch).flatMap(key => ({ title: ['TIT2', 'TITLE', '©nam', 'INAM'], artists: ['TPE1', 'ARTIST', '©ART', 'IART'], albumTitle: ['TALB', 'ALBUM', '©alb', 'IPRD'], albumArtists: ['TPE2', 'ALBUMARTIST', 'ALBUM ARTIST', 'aART'], genres: ['TCON', 'GENRE', '©gen', 'gnre', 'IGNR'], year: ['TYER', 'TDRC', 'DATE', 'YEAR', '©day', 'ICRD'], trackNumber: ['TRCK', 'TRACKNUMBER', 'TRACK', 'trkn', 'ITRK'], discNumber: ['TPOS', 'DISCNUMBER', 'DISC', 'disk'], cover: ['APIC', 'METADATA_BLOCK_PICTURE', 'covr'] } as Record<string, string[]>)[key] || []);
  for (const [format, tags] of Object.entries(before.native)) {
    if (format === 'ID3v1') continue; // The rich tag is checked above; ID3v1 is intrinsically lossy.
    for (const tag of tags) {
      if (changed.includes(tag.id) || ['TSSE', 'ENCODER', '©too'].includes(tag.id)) continue;
      if (!(after.native[format] || []).some(other => other.id === tag.id && isDeepStrictEqual(other.value, tag.value))) throw new Error(`Запись отклонена: потеря тега ${tag.id}`);
    }
  }
}
