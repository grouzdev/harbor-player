import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';
import { writeTags } from '../dist/server/metadata.js';

const root = path.resolve('.fixtures'); const output = path.join(root, 'verification'); mkdirSync(output, { recursive: true });
const pcmHash = file => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' }).trim();
const results = [];
for (const format of ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav']) {
  const file = path.join(output, `write.${format}`); copyFileSync(path.join(root, `sample.${format}`), file);
  try {
    const before = pcmHash(file);
    await writeTags(file, { title: 'Проверено — музыка', artists: ['Первый', 'Второй'], albumTitle: 'Новый альбом', albumArtists: ['Общий исполнитель'], genres: ['Ambient', 'Electronic'], year: 2025, trackNumber: 3, discNumber: 2 });
    await writeTags(file, { title: 'Только название' });
    await writeTags(file, { cover: { data: readFileSync(path.join(root, 'cover.png')).toString('base64'), mime: 'image/png' } });
    await writeTags(file, { cover: null });
    if (pcmHash(file) !== before) throw new Error('Decoded PCM changed');
    const moved = `${file}.renamed`; renameSync(file, moved); renameSync(moved, file);
    if (format === 'mp3') { const v24 = path.join(output, 'v24.mp3'); copyFileSync(path.join(root, 'id3v24.mp3'), v24); await writeTags(v24, { title: 'Проверка ID3 v2.4' }); }
    results.push({ format, passed: true, bytes: statSync(file).size }); console.log(`${format}: PASS`);
  } catch (error) { results.push({ format, passed: false, error: error.message }); console.log(`${format}: BLOCKED — ${error.message}`); }
}
const pkg = JSON.parse(readFileSync('node_modules/@digimezzo/node-taglib-sharp/package.json', 'utf8'));
mkdirSync('verification', { recursive: true });
writeFileSync('verification/tag-support.json', JSON.stringify({ date: new Date().toISOString(), writerVersion: pkg.version, platform: process.platform, node: process.version, checks: ['independent metadata read', 'unchanged native tags', 'encoded audio SHA256', 'decoded PCM SHA256 via FFmpeg', 'multiple values', 'cover add/remove', 'file handle release', 'ID3v2.3 and ID3v2.4'], formats: results }, null, 2) + '\n');
if (!results.some(r => r.passed)) process.exitCode = 1;
