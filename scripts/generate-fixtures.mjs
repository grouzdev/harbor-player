import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.fixtures'); mkdirSync(root, { recursive: true });
const formats = { mp3: ['-c:a', 'libmp3lame', '-id3v2_version', '3'], flac: ['-c:a', 'flac'], m4a: ['-c:a', 'aac'], aac: ['-c:a', 'aac', '-f', 'adts', '-write_id3v2', '1'], ogg: ['-c:a', 'libvorbis'], opus: ['-c:a', 'libopus'], wav: ['-c:a', 'pcm_s16le'] };
for (const [extension, flags] of Object.entries(formats)) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', ...flags,
    '-metadata', 'title=Первый трек', '-metadata', 'artist=Исполнитель', '-metadata', 'album=Тестовый альбом', '-metadata', 'album_artist=Исполнитель альбома',
    '-metadata', 'genre=Ambient', '-metadata', 'date=2024', '-metadata', 'track=1/8', '-metadata', 'disc=1/2', '-metadata', 'comment=Не менять комментарий', '-metadata', 'CUSTOM_TEST=Сохранить неизвестное поле', path.join(root, `sample.${extension}`)]);
}
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-c:a', 'libmp3lame', '-id3v2_version', '4', '-metadata', 'title=ID3 v2.4', '-metadata', 'CUSTOM_TEST=Неизвестный тег', path.join(root, 'id3v24.mp3')]);
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2c615c:s=600x600', '-frames:v', '1', path.join(root, 'cover.png')]);
writeFileSync(path.join(root, 'broken.mp3'), 'not an audio file');
console.log(`Generated fixtures in ${root}`);
