import path from "node:path";
export { dataDirectory } from "../shared/app-paths.js";

export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export const audioExtensions = new Set([
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".wav",
]);
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
