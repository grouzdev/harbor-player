import path from 'node:path';
import os from 'node:os';

export function dataDirectory(): string {
  if (process.env.MYMUSICLIB_DATA_DIR) return path.resolve(process.env.MYMUSICLIB_DATA_DIR);
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'MyMusicLib');
}
export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export const audioExtensions = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav']);
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
