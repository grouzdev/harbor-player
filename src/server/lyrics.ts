import { parseFile } from "music-metadata";
import { createRequire } from "node:module";
import {
  lyricsCandidatesSchema,
  type LyricsCandidate,
} from "../shared/lyrics.js";
import { HttpError } from "./http-error.js";

const { version } = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

export async function readEmbeddedLyrics(file: string): Promise<string | null> {
  const metadata = await parseFile(file, { skipCovers: true });
  const text = metadata.common.lyrics?.find((entry) =>
    entry.text?.trim(),
  )?.text;
  return text?.replace(/^\uFEFF/, "") ?? null;
}

/** One queue per application instance; searches happen only on explicit request. */
export class LyricsSearch {
  private pending = Promise.resolve();
  private nextAt = 0;
  private cache = new Map<
    string,
    { expires: number; items: LyricsCandidate[] }
  >();
  constructor(private readonly request: typeof fetch = fetch) {}

  search(artist: string, title: string): Promise<LyricsCandidate[]> {
    const key = JSON.stringify([artist, title]);
    const run = this.pending.then(async () => {
      const cached = this.cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.items;
      if (this.nextAt - Date.now() > 1000)
        throw new HttpError(429, "LRCLIB ограничил запросы. Повторите позже.");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, this.nextAt - Date.now())),
      );
      const url = new URL("https://lrclib.net/api/search");
      url.search = new URLSearchParams({
        artist_name: artist,
        track_name: title,
      }).toString();
      try {
        const response = await this.request(url, {
          redirect: "error",
          headers: {
            "User-Agent": `HarborPlayer/${version} (https://github.com/grouzdev/harbor-player)`,
          },
          signal: AbortSignal.timeout(15_000),
        });
        this.nextAt = Date.now() + 500;
        if (response.status === 429 || response.status === 503) {
          const retry = response.headers.get("retry-after");
          const seconds =
            retry && /^\d+$/.test(retry)
              ? Number(retry)
              : retry
                ? Math.max(1, (Date.parse(retry) - Date.now()) / 1000)
                : 60;
          this.nextAt =
            Date.now() + (Number.isFinite(seconds) ? seconds : 60) * 1300;
          throw new HttpError(
            429,
            "LRCLIB временно недоступен. Повторите позже.",
          );
        }
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          throw new Error("Некорректный ответ LRCLIB");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Пустой ответ LRCLIB");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 4 * 1024 * 1024)
              throw new Error("Слишком большой ответ LRCLIB");
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const items = lyricsCandidatesSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        if (this.cache.size >= 50)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: Date.now() + 5 * 60_000, items });
        return items;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, "Не удалось получить текст из LRCLIB");
      }
    });
    this.pending = run.then(
      () => {},
      () => {},
    );
    return run;
  }
}
