import path from "node:path";
import type { MusicService } from "./service.js";
import type { ServiceEvent } from "./service-events.js";
import { LyricsSearch, readEmbeddedLyrics } from "./lyrics.js";
import { notFound, conflict } from "./http-error.js";
import {
  selectAutomaticLyrics,
  type AutomaticLyrics,
} from "../shared/lyrics.js";

export class AutomaticLyricsService {
  private opening = new Map<string, Promise<AutomaticLyrics>>();
  constructor(
    private readonly service: MusicService,
    private readonly search: LyricsSearch,
  ) {}

  open(id: string): Promise<AutomaticLyrics> {
    const pending = this.opening.get(id);
    if (pending) return pending;
    const promise = this.find(id).finally(() => this.opening.delete(id));
    this.opening.set(id, promise);
    return promise;
  }

  private async existing(id: string) {
    const track = this.service.catalog.track(id);
    if (!track) throw notFound("Трек не найден");
    const local = this.service.catalog.localLyrics(id);
    if (local?.trim()) return { track, text: local };
    if (!track.available) throw conflict("Файл недоступен");
    const file = path.join(
      this.service.catalog.library(track.libraryId).path,
      track.relativePath,
    );
    await this.service.safePath(file);
    return { track, text: await readEmbeddedLyrics(file) };
  }

  private async find(id: string): Promise<AutomaticLyrics> {
    const { track, text } = await this.existing(id);
    if (text) return { text, candidates: [], saved: false };
    const artist = track.artists.join(", ");
    if (!artist.trim() || !track.title.trim())
      return { text: null, candidates: [], saved: false };
    const candidates = await this.search.search(artist, track.title);
    const match = selectAutomaticLyrics(track, candidates);
    if (!match) return { text: null, candidates, saved: false };
    if (
      !["mp3", "flac"].includes(track.format) ||
      !this.service.capabilities.writableFormats.includes(track.format)
    )
      return { text: match.plainLyrics, candidates: [], saved: false };
    return this.fill(id, match.plainLyrics!);
  }

  async fill(id: string, value: string): Promise<AutomaticLyrics> {
    const { text } = await this.existing(id);
    if (text) return { text, candidates: [], saved: false };
    const preview = await this.service.previewMissingLyrics(id, value);
    const failure = preview.items.find((item) => item.error);
    if (failure) throw conflict(failure.error!);
    await new Promise<void>((resolve, reject) => {
      let jobId = "";
      const changed = (event: ServiceEvent) => {
        if (
          event.type !== "job" ||
          event.job.id !== jobId ||
          ["queued", "running"].includes(event.job.status)
        )
          return;
        this.service.off("change", changed);
        if (event.job.status === "done" && !event.job.errors.length) resolve();
        else
          reject(
            conflict(
              event.job.errors.join("\n") || "Не удалось записать текст",
            ),
          );
      };
      this.service.on("change", changed);
      try {
        jobId = this.service.execute(preview.id).id;
      } catch (error) {
        this.service.off("change", changed);
        reject(error);
      }
    });
    return { text: value, candidates: [], saved: true };
  }
}
