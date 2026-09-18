import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  MetadataProposal,
  MetadataProposalItem,
  MusicBrainzCandidate,
  MusicBrainzSearchContext,
  PerTrackTagPatch,
  Selection,
  TagField,
  Track,
} from "../shared/contracts.js";
import {
  coverArchiveSchema,
  musicBrainzSearchSchema,
  releaseGroupSchema,
  releaseSchema,
  type MusicBrainzRelease,
} from "./musicbrainz-contracts.js";
import type { Catalog } from "./database.js";

type Fetch = typeof fetch;
type RemoteTrack = {
  discNumber: number;
  trackNumber: number;
  title: string;
  artists: string[];
  duration: number;
  recordingId: string | undefined;
};

export interface MusicBrainzOptions {
  fetch?: Fetch;
  apiBase?: string;
  coverBase?: string;
  minIntervalMs?: number;
  timeoutMs?: number;
}

const DAY = 24 * 60 * 60 * 1000;
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unique = (values: (string | null | undefined)[]) => [
  ...new Set(
    values
      .filter((value): value is string => !!value?.trim())
      .map((value) => value.trim()),
  ),
];

export function escapeLucene(value: string): string {
  return value.replace(/([+\-!(){}[^\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");
}

const credit = (
  entity:
    | { "artist-credit"?: { name?: string; artist?: { name?: string } }[] }
    | undefined,
): string[] =>
  unique(
    (entity?.["artist-credit"] || []).map(
      (entry) => entry.name || entry.artist?.name,
    ),
  );

const normalized = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/^\s*(?:cd|disc|disk|диск)?\s*\d+[\s._-]+/i, "")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLocaleLowerCase();

const missingFields = (track: Track): TagField[] =>
  track.missingTagFields || [
    ...(!track.title ? (["title"] as TagField[]) : []),
    ...(!track.artists.length ? (["artists"] as TagField[]) : []),
    ...(!track.albumTitle ? (["albumTitle"] as TagField[]) : []),
    ...(!track.albumArtists.length ? (["albumArtists"] as TagField[]) : []),
    ...(!track.genres.length ? (["genres"] as TagField[]) : []),
    ...(track.year === null ? (["year"] as TagField[]) : []),
    ...(track.trackNumber === null ? (["trackNumber"] as TagField[]) : []),
    ...(track.discNumber === null ? (["discNumber"] as TagField[]) : []),
    ...(track.coverId === null ? (["cover"] as TagField[]) : []),
  ];

function releaseCandidate(
  release: MusicBrainzRelease,
  score = 100,
  recordingId?: string,
): MusicBrainzCandidate {
  const media = release.media || [];
  const formats = unique(media.map((medium) => medium.format));
  const trackCount =
    Number(release["track-count"]) ||
    media.reduce(
      (sum: number, medium) =>
        sum + Number(medium["track-count"] || medium.tracks?.length || 0),
      0,
    );
  return {
    id: `${release.id || ""}:${recordingId || "release"}`,
    releaseId: release.id || "",
    recordingId,
    title: release.title || "Без названия",
    artists: credit(release),
    date: release.date || null,
    country: release.country || null,
    status: release.status || null,
    formats,
    discCount: media.length,
    trackCount,
    score: Number(score) || 0,
    thumbnailUrl: `/api/metadata/musicbrainz/thumbnail/${release.id || ""}`,
  };
}

export class MusicBrainzService {
  private readonly fetcher: Fetch;
  private readonly apiBase: string;
  private readonly coverBase: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private queue = Promise.resolve();
  private lastRequestAt = 0;
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    private readonly catalog: Catalog,
    private readonly dataDir: string,
    options: MusicBrainzOptions = {},
  ) {
    this.fetcher = options.fetch || fetch;
    this.apiBase = (options.apiBase || "https://musicbrainz.org/ws/2").replace(
      /\/$/,
      "",
    );
    this.coverBase = (
      options.coverBase || "https://coverartarchive.org"
    ).replace(/\/$/, "");
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  context(selection: Selection): MusicBrainzSearchContext {
    const tracks = this.catalog.selected(selection);
    if (tracks.length === 1) {
      const track = tracks[0];
      return {
        supported: true,
        mode: "track",
        title:
          track.title ||
          path.basename(track.relativePath, path.extname(track.relativePath)),
        artist: track.artists.join("; "),
      };
    }
    const albumKeys = new Set(tracks.map((track) => track.albumKey));
    if (albumKeys.size !== 1)
      return {
        supported: false,
        mode: null,
        title: "",
        artist: "",
        reason:
          "MusicBrainz доступен для одного трека или одного полного альбома.",
      };
    const albumKey = tracks[0].albumKey;
    const total = this.catalog.albumAvailableTrackCount(albumKey);
    if (total !== tracks.length)
      return {
        supported: false,
        mode: null,
        title: "",
        artist: "",
        reason: "Выберите все доступные треки альбома для поиска MusicBrainz.",
      };
    const first = tracks[0];
    let folder = path.dirname(first.relativePath);
    if (/^(cd|disc|disk|диск)[\s_-]*\d+$/i.test(path.basename(folder)))
      folder = path.dirname(folder);
    return {
      supported: true,
      mode: "album",
      title: first.albumTitle || path.basename(folder),
      artist: (first.albumArtists.length
        ? first.albumArtists
        : unique(tracks.flatMap((track) => track.artists))
      ).join("; "),
    };
  }

  async search(
    selection: Selection,
    query: { title: string; artist: string },
  ): Promise<{
    context: MusicBrainzSearchContext;
    candidates: MusicBrainzCandidate[];
  }> {
    const context = this.context(selection);
    if (!context.supported || !context.mode) throw new Error(context.reason);
    const title = query.title.trim();
    const artist = query.artist.trim();
    if (!title) throw new Error("Укажите название для поиска MusicBrainz");
    const tracks = this.catalog.selected(selection);
    const exactReleaseIds = unique(
      tracks.map((track) => track.musicBrainzReleaseId),
    );
    if (exactReleaseIds.length === 1 && uuid.test(exactReleaseIds[0])) {
      const release = await this.release(exactReleaseIds[0]);
      if (release)
        return {
          context: { ...context, title, artist },
          candidates: [
            releaseCandidate(
              release,
              100,
              context.mode === "track"
                ? tracks[0].musicBrainzRecordingId || undefined
                : undefined,
            ),
          ],
        };
    }
    const clauses = [
      `${context.mode === "album" ? "release" : "recording"}:"${escapeLucene(title)}"`,
    ];
    if (artist) clauses.push(`artist:"${escapeLucene(artist)}"`);
    if (context.mode === "album") clauses.push(`tracks:${tracks.length}`);
    else clauses.push(`qdur:${Math.round(tracks[0].duration / 2)}`);
    const entity = context.mode === "album" ? "release" : "recording";
    const url = new URL(`${this.apiBase}/${entity}`);
    url.searchParams.set("query", clauses.join(" AND "));
    url.searchParams.set("limit", "10");
    url.searchParams.set("fmt", "json");
    const data = await this.json(
      url.toString(),
      DAY,
      true,
      musicBrainzSearchSchema,
    );
    let candidates: MusicBrainzCandidate[] = [];
    if (context.mode === "album")
      candidates = (data?.releases || []).map((release) =>
        releaseCandidate(release, release.score),
      );
    else {
      for (const recording of data?.recordings || [])
        for (const release of recording.releases || [])
          candidates.push(
            releaseCandidate(
              {
                ...release,
                date: release.date || recording["first-release-date"],
                "artist-credit":
                  release["artist-credit"] || recording["artist-credit"],
              },
              recording.score,
              recording.id,
            ),
          );
    }
    const seen = new Set<string>();
    candidates = candidates
      .filter((candidate) => uuid.test(candidate.releaseId))
      .filter((candidate) => {
        if (seen.has(candidate.id)) return false;
        seen.add(candidate.id);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return { context: { ...context, title, artist }, candidates };
  }

  async proposal(
    selection: Selection,
    releaseId: string,
    recordingId?: string,
  ): Promise<MetadataProposal> {
    if (!uuid.test(releaseId) || (recordingId && !uuid.test(recordingId)))
      throw new Error("Некорректный идентификатор MusicBrainz");
    const context = this.context(selection);
    if (!context.supported || !context.mode) throw new Error(context.reason);
    const local = [...this.catalog.selected(selection)].sort(
      (a, b) =>
        (a.discNumber || Number.MAX_SAFE_INTEGER) -
          (b.discNumber || Number.MAX_SAFE_INTEGER) ||
        (a.trackNumber || Number.MAX_SAFE_INTEGER) -
          (b.trackNumber || Number.MAX_SAFE_INTEGER) ||
        a.relativePath.localeCompare(b.relativePath),
    );
    const release = await this.release(releaseId);
    if (!release) throw new Error("Релиз MusicBrainz больше не найден");
    const group = release["release-group"];
    const groupId = group?.id && uuid.test(group.id) ? group.id : undefined;
    const groupDetail = groupId
      ? await this.json(
          `${this.apiBase}/release-group/${groupId}?inc=genres&fmt=json`,
          7 * DAY,
          true,
          releaseGroupSchema,
        )
      : null;
    const genres = unique(
      [...(release.genres || []), ...(groupDetail?.genres || [])]
        .filter((genre) => Number(genre.count || 0) > 0)
        .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
        .map((genre) => genre.name),
    );
    const releaseArtists = credit(release);
    const yearText =
      release.date ||
      group?.["first-release-date"] ||
      groupDetail?.["first-release-date"];
    const year = /^\d{4}/.test(yearText || "")
      ? Number((yearText || "").slice(0, 4))
      : null;
    const remote: RemoteTrack[] = (release.media || []).flatMap(
      (medium, mediumIndex: number) =>
        (medium.tracks || []).map((track, trackIndex: number) => ({
          discNumber: Number(medium.position || mediumIndex + 1),
          trackNumber: Number(track.position || trackIndex + 1),
          title: track.title || track.recording?.title || "",
          artists: credit(track).length
            ? credit(track)
            : credit(track.recording).length
              ? credit(track.recording)
              : releaseArtists,
          duration: Number(track.length || track.recording?.length || 0) / 1000,
          recordingId: track.recording?.id,
        })),
    );
    const used = new Set<number>();
    const matched = new Map<
      string,
      { index: number; match: MetadataProposalItem["match"] }
    >();
    const claim = (
      track: Track,
      predicate: (remote: RemoteTrack) => boolean,
      match: MetadataProposalItem["match"],
    ) => {
      const choices = remote
        .map((candidate, index: number) => ({ candidate, index }))
        .filter(
          ({ candidate, index }) => !used.has(index) && predicate(candidate),
        );
      if (choices.length === 1) {
        used.add(choices[0].index);
        matched.set(track.id, { index: choices[0].index, match });
      }
    };
    for (const track of local) {
      if (context.mode === "track" && recordingId)
        claim(
          track,
          (candidate) => candidate.recordingId === recordingId,
          "recording",
        );
      if (!matched.has(track.id) && track.discNumber && track.trackNumber)
        claim(
          track,
          (candidate) =>
            candidate.discNumber === track.discNumber &&
            candidate.trackNumber === track.trackNumber,
          "position",
        );
    }
    for (const track of local)
      if (!matched.has(track.id))
        claim(
          track,
          (candidate) =>
            normalized(candidate.title) === normalized(track.title) &&
            (!candidate.duration ||
              Math.abs(candidate.duration - track.duration) <= 8),
          "title-duration",
        );
    if (remote.length === local.length) {
      const remainingLocal = local.filter((track) => !matched.has(track.id));
      const remainingRemote = remote
        .map((candidate, index: number) => ({ candidate, index }))
        .filter(({ index }) => !used.has(index));
      remainingLocal.forEach((track, index) => {
        const choice = remainingRemote[index];
        if (choice) {
          used.add(choice.index);
          matched.set(track.id, { index: choice.index, match: "order" });
        }
      });
    }
    const items: MetadataProposalItem[] = local.map((track) => {
      const found = matched.get(track.id);
      if (!found)
        return {
          trackId: track.id,
          title: track.title,
          missingFields: missingFields(track),
          changedFields: [],
          match: "none",
          warning: "Трек не удалось надёжно сопоставить с выбранным изданием.",
        };
      const candidate = remote[found.index];
      const patch: PerTrackTagPatch = {};
      if (candidate.title) patch.title = candidate.title;
      if (candidate.artists.length) patch.artists = candidate.artists;
      if (release.title) patch.albumTitle = release.title;
      if (releaseArtists.length) patch.albumArtists = releaseArtists;
      if (genres.length) patch.genres = genres;
      if (year !== null) patch.year = year;
      if (candidate.trackNumber) patch.trackNumber = candidate.trackNumber;
      if (candidate.discNumber) patch.discNumber = candidate.discNumber;
      const changedFields = (
        Object.keys(patch) as (keyof PerTrackTagPatch)[]
      ).filter(
        (field) =>
          JSON.stringify(track[field]) !== JSON.stringify(patch[field]),
      );
      return {
        trackId: track.id,
        title: track.title,
        patch,
        missingFields: missingFields(track),
        changedFields,
        match: found.match,
        warning:
          found.match === "order"
            ? "Сопоставлено по порядку треков; проверьте предварительный просмотр."
            : undefined,
      };
    });
    const cover = await this.cover(releaseId, groupId);
    return {
      releaseId,
      recordingId,
      releaseTitle: release.title || "Без названия",
      items,
      cover,
    };
  }

  async thumbnail(
    releaseId: string,
  ): Promise<{ data: Buffer; mime: string } | null> {
    if (!uuid.test(releaseId)) return null;
    const cached = await this.cachedCover(
      `${this.coverBase}/release/${releaseId}/front-250`,
    );
    if (!cached) return null;
    return {
      data: await readFile(path.join(this.dataDir, "covers", cached.id)),
      mime: cached.id.endsWith(".png") ? "image/png" : "image/jpeg",
    };
  }

  private async release(id: string): Promise<MusicBrainzRelease | null> {
    return this.json(
      `${this.apiBase}/release/${id}?inc=recordings+artist-credits+release-groups+genres&fmt=json`,
      7 * DAY,
      true,
      releaseSchema,
    );
  }

  private async cover(
    releaseId: string,
    groupId?: string,
  ): Promise<MetadataProposal["cover"]> {
    const exact = await this.json(
      `${this.coverBase}/release/${releaseId}`,
      7 * DAY,
      false,
      coverArchiveSchema,
      DAY,
    );
    const exactFront = exact?.images?.find(
      (image) => image.front && image.approved,
    );
    let source: "release" | "release-group" = "release";
    let url = exactFront
      ? `${this.coverBase}/release/${releaseId}/${exactFront.id}-1200`
      : "";
    if (!url && groupId) {
      const grouped = await this.json(
        `${this.coverBase}/release-group/${groupId}`,
        7 * DAY,
        false,
        coverArchiveSchema,
        DAY,
      );
      const groupFront = grouped?.images?.find(
        (image) => image.front && image.approved,
      );
      if (groupFront) {
        source = "release-group";
        url = `${this.coverBase}/release-group/${groupId}/front-1200`;
      }
    }
    if (!url) return undefined;
    let image = await this.cachedCover(url);
    if (!image) image = await this.cachedCover(url.replace(/-1200$/, "-500"));
    if (!image) return undefined;
    return {
      id: image.id,
      source,
      warning:
        source === "release-group"
          ? "Обложка взята из группы релизов и может относиться к другому изданию."
          : undefined,
    };
  }

  private async cachedCover(url: string): Promise<{ id: string } | null> {
    const key = `cover-file:${url}`;
    const cached = this.cache(key);
    if (cached?.status === 404) return null;
    if (
      cached?.status === 200 &&
      existsSync(
        path.join(
          this.dataDir,
          "covers",
          (cached.payload as { id: string }).id,
        ),
      )
    )
      return cached.payload as { id: string };
    const image = await this.bytes(url, false);
    if (!image) {
      this.saveCache(key, 404, {}, DAY);
      return null;
    }
    const extension = image.mime === "image/png" ? ".png" : ".jpg";
    const id =
      createHash("sha256").update(image.data).digest("hex") + extension;
    await mkdir(path.join(this.dataDir, "covers"), { recursive: true });
    await writeFile(path.join(this.dataDir, "covers", id), image.data, {
      flag: "wx",
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    this.saveCache(key, 200, { id }, 7 * DAY);
    return { id };
  }

  private cache(key: string): { status: number; payload: unknown } | null {
    const cached = this.catalog.cachedHttpResponse(key);
    return cached ? { status: cached.status, payload: cached.payload } : null;
  }

  private saveCache(
    key: string,
    status: number,
    payload: unknown,
    ttl: number,
  ) {
    this.catalog.saveHttpResponse(key, status, payload, ttl);
  }

  private async json<T extends z.ZodType>(
    url: string,
    ttl: number,
    throttled: boolean,
    schema: T,
    negativeTtl = 0,
  ): Promise<z.infer<T> | null> {
    const cached = this.cache(url);
    if (cached)
      return cached.status === 200
        ? (schema.parse(cached.payload) as z.infer<T>)
        : null;
    const existing = this.pending.get(url);
    if (existing) return existing as Promise<z.infer<T> | null>;
    const request = (async () => {
      const response = await this.request(url, throttled);
      if (response.status === 404) {
        if (negativeTtl) this.saveCache(url, 404, {}, negativeTtl);
        return null;
      }
      if (!response.ok)
        throw new Error(`MusicBrainz вернул ошибку ${response.status}`);
      const payload = schema.parse(await response.json());
      this.saveCache(url, 200, payload, ttl);
      return payload;
    })().finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request;
  }

  private async bytes(
    url: string,
    throttled: boolean,
  ): Promise<{ data: Buffer; mime: string } | null> {
    const response = await this.request(
      url,
      throttled,
      "image/jpeg,image/png,image/*;q=0.8",
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Сервис обложек вернул ошибку ${response.status}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 10 * 1024 * 1024) throw new Error("Обложка превышает 10 МБ");
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 10 * 1024 * 1024)
      throw new Error("Обложка превышает 10 МБ");
    const png = data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
    if (!png && !jpeg)
      throw new Error("Сервис вернул неподдерживаемый формат обложки");
    return { data, mime: png ? "image/png" : "image/jpeg" };
  }

  private async request(
    url: string,
    throttled: boolean,
    accept = "application/json",
  ): Promise<Response> {
    let last: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const run = async () => {
        if (throttled) {
          const wait = Math.max(
            0,
            this.minIntervalMs - (Date.now() - this.lastRequestAt),
          );
          if (wait) await sleep(wait);
          this.lastRequestAt = Date.now();
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          return await this.fetcher(url, {
            signal: controller.signal,
            headers: {
              Accept: accept,
              "User-Agent":
                "HarborPlayer/0.1.0 (https://github.com/grouzdev/harbor-player)",
            },
          });
        } finally {
          clearTimeout(timer);
        }
      };
      if (throttled) {
        const result = this.queue.then(run, run);
        this.queue = result.then(
          () => undefined,
          () => undefined,
        );
        last = await result;
      } else last = await run();
      if (![429, 503].includes(last.status)) return last;
      const retryAfter = Number(last.headers.get("retry-after") || 0) * 1000;
      if (attempt < 2) await sleep(Math.max(retryAfter, 500 * 2 ** attempt));
    }
    return last!;
  }
}
