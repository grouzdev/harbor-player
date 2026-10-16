import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  pulseBatchSchema,
  pulseSettingsPatchSchema,
  type PulseEvent,
  type PulseSettings,
  type PulseBatchResult,
  type PulseDay,
  type PulseDayAlbumPage,
  type PulseAlbumStats,
} from "../shared/pulse.js";
import { badRequest, conflict, notFound } from "./http-error.js";

type Interval = {
  albumId: string;
  revision: number;
  payload: string;
  dayContributions: string;
};
type Contribution = {
  dayKey: string;
  playedMs: number;
  start: number;
  end: number;
};
type StoredEvent = Omit<PulseEvent, "snapshot"> & { snapshotHash: string };

/** Find the next local date boundary by binary search, not a fixed 24-hour day.
 * Intervals are bounded to one hour, so at most one local midnight is crossed. */
export function splitPulseInterval(
  event: PulseEvent,
  timeZone: string,
): Contribution[] {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = (ms: number) => {
    const parts = formatter.formatToParts(ms);
    return ["year", "month", "day"]
      .map((type) => parts.find((p) => p.type === type)!.value)
      .join("-");
  };
  const result: Contribution[] = [];
  let start = event.startedAtUtc;
  let allocated = 0;
  while (start < event.endedAtUtc) {
    const dayKey = day(start);
    let end = event.endedAtUtc;
    if (day(end - 1) !== dayKey) {
      let lo = start + 1,
        hi = end;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (day(mid) === dayKey) lo = mid + 1;
        else hi = mid;
      }
      end = lo;
    }
    const cumulative = Math.floor(
      (event.playedMs * (end - event.startedAtUtc)) /
        (event.endedAtUtc - event.startedAtUtc),
    );
    result.push({ dayKey, playedMs: cumulative - allocated, start, end });
    allocated = cumulative;
    start = end;
  }
  return result.filter((part) => part.playedMs > 0);
}

export class PulseStore {
  private readonly coverCopies = new Map<string, Promise<void>>();
  private readonly coverQueue: (() => void)[] = [];
  private activeCoverCopies = 0;

  constructor(
    private readonly db: Database.Database,
    private readonly dataDir: string,
  ) {}

  settings(): PulseSettings {
    const row = this.db
      .prepare(
        "SELECT enabled,timeZone,historyGeneration,coverageStartedAtUtc FROM pulse_settings WHERE id=1",
      )
      .get() as PulseSettings;
    return { ...row, enabled: Boolean(row.enabled) };
  }

  updateSettings(input: unknown): PulseSettings {
    const patch = pulseSettingsPatchSchema.parse(input);
    return this.db.transaction(() => {
      const settings = this.settings();
      if (patch.timeZone) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: patch.timeZone }).format(0);
        } catch {
          throw badRequest("Некорректный часовой пояс");
        }
        if (settings.timeZone && patch.timeZone !== settings.timeZone)
          throw conflict("Смена часового пояса истории пока не поддерживается");
      }
      const enabled = patch.enabled ?? settings.enabled;
      this.db
        .prepare(
          "UPDATE pulse_settings SET enabled=?,timeZone=?,historyGeneration=? WHERE id=1",
        )
        .run(
          Number(enabled),
          patch.timeZone ?? settings.timeZone,
          settings.historyGeneration + Number(enabled && !settings.enabled),
        );
      return this.settings();
    })();
  }

  clear(generation: number): PulseSettings {
    return this.db.transaction(() => {
      if (this.settings().historyGeneration !== generation)
        throw conflict("Поколение истории изменилось");
      for (const table of [
        "pulse_intervals",
        "pulse_day_visits",
        "pulse_day_albums",
        "pulse_days",
        "pulse_album_stats",
        "pulse_track_aliases",
        "pulse_album_aliases",
        "pulse_albums",
      ])
        this.db.exec(`DELETE FROM ${table}`);
      this.db
        .prepare(
          "UPDATE pulse_settings SET historyGeneration=historyGeneration+1,coverageStartedAtUtc=? WHERE id=1",
        )
        .run(Date.now());
      return this.settings();
    })();
  }

  async ingest(input: unknown): Promise<PulseBatchResult> {
    const batch = pulseBatchSchema.parse(input);
    const settings = this.settings();
    if (!settings.enabled) throw conflict("Сбор истории отключён");
    if (settings.historyGeneration !== batch.historyGeneration)
      throw conflict("Поколение истории изменилось");
    if (!settings.timeZone)
      throw conflict("Сначала задайте часовой пояс истории");
    // No filesystem work or await inside the SQLite write transaction.
    await Promise.all(
      [...new Set(batch.events.map((event) => event.snapshot.coverId))]
        .filter((id): id is string => id !== null)
        .map((id) => this.prepareCover(id)),
    );
    return this.db.transaction(() => {
      const current = this.settings();
      if (!current.enabled) throw conflict("Сбор истории отключён");
      if (current.historyGeneration !== batch.historyGeneration)
        throw conflict("Поколение истории изменилось");
      if (!current.timeZone || current.timeZone !== settings.timeZone)
        throw conflict("Часовой пояс истории изменился");
      const acknowledgements = batch.events.map((event) =>
        this.apply(event, current.timeZone!),
      );
      return {
        historyGeneration: settings.historyGeneration,
        acknowledgements,
      };
    })();
  }

  private prepareCover(id: string): Promise<void> {
    const pending = this.coverCopies.get(id);
    if (pending) return pending;
    const copy = this.hasCover(id)
      .then(async (exists) => {
        // A checkpoint for an already archived image must not wait behind an
        // unrelated batch's heavy copies. No accumulating existence cache.
        if (exists) return;
        await new Promise<void>((resolve) => {
          const run = () => {
            this.activeCoverCopies++;
            void this.copyCover(id)
              .catch(() => {
                // Preparation stays best-effort if a future adapter rejects.
              })
              .finally(() => {
                this.activeCoverCopies--;
                resolve();
                this.coverQueue.shift()?.();
              });
          };
          if (this.activeCoverCopies < 4) run();
          else this.coverQueue.push(run);
        });
      })
      .finally(() => this.coverCopies.delete(id));
    this.coverCopies.set(id, copy);
    return copy;
  }

  private async hasCover(id: string): Promise<boolean> {
    const target = path.join(this.dataDir, "pulse-covers", id);
    for (const file of [target, path.join(`${target}.archive`, "image")]) {
      try {
        await access(file);
        return true;
      } catch {
        // Missing or unreadable images remain best-effort decoration.
      }
    }
    return false;
  }

  private async copyCover(id: string): Promise<void> {
    const directory = path.join(this.dataDir, "pulse-covers");
    const target = path.join(directory, id);
    let staging: string | undefined;
    try {
      if (await this.hasCover(id)) return;
      // Avoid staging for absent sources, without caching absence across retries.
      // Copy still handles disappearance after access as best-effort artwork.
      const source = path.join(this.dataDir, "covers", id);
      await access(source);
      await mkdir(directory, { recursive: true });
      staging = path.join(directory, `.pulse-${id}-${randomUUID()}.tmp`);
      await mkdir(staging);
      await copyFile(source, path.join(staging, "image"));
      // Publish a complete, nonempty directory on all filesystems. Directory
      // rename cannot replace another nonempty winner, unlike flat-file rename.
      // This also works on FAT/exFAT where hard links are unavailable.
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(staging, `${target}.archive`);
          break;
        } catch (error) {
          // Windows scanners can briefly hold the completed staging directory.
          // Retry publication only, before ACK, with a bounded 140ms backoff.
          const code = (error as NodeJS.ErrnoException).code;
          if (
            attempt === 3 ||
            !["EPERM", "EBUSY", "EACCES"].includes(code ?? "")
          )
            throw error;
          await delay(20 * 2 ** attempt);
        }
      }
    } catch {
      // Artwork is best-effort; preserve the snapshot and listening time.
    } finally {
      if (staging)
        await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  private apply(event: PulseEvent, timeZone: string) {
    // Metadata lives once in pulse_albums. Keep only its fingerprint in the
    // interval ledger to validate retries without duplicating artwork/tags.
    const payload = {
      ...event,
      snapshot: undefined,
      snapshotHash: createHash("sha256")
        .update(JSON.stringify(event.snapshot))
        .digest("hex"),
    };
    const prior = this.db
      .prepare(
        "SELECT albumId,revision,payload,dayContributions FROM pulse_intervals WHERE eventId=?",
      )
      .get(event.eventId) as Interval | undefined;
    const old: StoredEvent | undefined = prior
      ? JSON.parse(prior.payload)
      : undefined;
    if (old) {
      for (const key of [
        "trackId",
        "albumKey",
        "sessionId",
        "visitId",
        "startedAtUtc",
      ] as const)
        if (old[key] !== event[key])
          throw conflict("Изменена идентичность события");
      if (old.snapshotHash !== payload.snapshotHash)
        throw conflict("Изменён снимок события");
      if (
        event.revision === old.revision &&
        JSON.stringify(old) !== JSON.stringify(payload)
      )
        throw conflict("Несовместимая версия события");
      if (
        event.revision < old.revision &&
        (event.playedMs > old.playedMs ||
          event.endedAtUtc > old.endedAtUtc ||
          event.final)
      )
        throw conflict("Несовместимый старый checkpoint");
      if (event.revision <= old.revision)
        return {
          eventId: event.eventId,
          revision: old.revision,
          albumId: prior!.albumId,
        };
      if (
        old.final ||
        event.endedAtUtc < old.endedAtUtc ||
        event.playedMs < old.playedMs ||
        event.playedMs - old.playedMs > event.endedAtUtc - old.endedAtUtc
      )
        throw conflict("Недопустимое продолжение checkpoint");
    }
    const lookup = (table: string, key: string, value: string | null) =>
      value
        ? (
            this.db
              .prepare(`SELECT albumId FROM ${table} WHERE ${key}=?`)
              .get(value) as { albumId: string } | undefined
          )?.albumId
        : undefined;
    const albumId =
      prior?.albumId ??
      lookup("pulse_track_aliases", "trackId", event.trackId) ??
      lookup("pulse_album_aliases", "albumKey", event.albumKey) ??
      randomUUID();
    this.db
      .prepare("INSERT OR IGNORE INTO pulse_albums VALUES (?,?)")
      .run(albumId, JSON.stringify(event.snapshot));
    this.db
      .prepare("INSERT OR IGNORE INTO pulse_album_aliases VALUES (?,?)")
      .run(event.albumKey, albumId);
    if (event.trackId)
      this.db
        .prepare("INSERT OR IGNORE INTO pulse_track_aliases VALUES (?,?)")
        .run(event.trackId, albumId);
    // A checkpoint extends the confirmed tail only. Never redistribute already
    // accepted milliseconds across midnight when wall-clock rounding changes.
    // Keep the integer day allocation with the raw interval for future rebuilds.
    const previous: Contribution[] = prior
      ? JSON.parse(prior.dayContributions)
      : [];
    const deltaMs = event.playedMs - (old?.playedMs ?? 0);
    const current =
      deltaMs > 0
        ? splitPulseInterval(
            {
              ...event,
              startedAtUtc: old?.endedAtUtc ?? event.startedAtUtc,
              playedMs: deltaMs,
            },
            timeZone,
          )
        : [];
    const contributions = new Map(previous.map((part) => [part.dayKey, part]));
    let newDays = 0,
      returns = 0;
    for (const part of current) {
      const before = this.db
        .prepare(
          "SELECT playedMs,visitCount FROM pulse_day_albums WHERE dayKey=? AND albumId=?",
        )
        .get(part.dayKey, albumId) as
        { playedMs: number; visitCount: number } | undefined;
      const visit = this.db
        .prepare("INSERT OR IGNORE INTO pulse_day_visits VALUES (?,?,?)")
        .run(part.dayKey, albumId, event.visitId).changes;
      if (!before) newDays++;
      if (visit && before) returns++;
      const delta = part.playedMs;
      const previousPart = contributions.get(part.dayKey);
      contributions.set(
        part.dayKey,
        previousPart
          ? {
              ...previousPart,
              playedMs: previousPart.playedMs + delta,
              end: part.end,
            }
          : part,
      );
      this.db
        .prepare(
          `INSERT INTO pulse_day_albums VALUES (?,?,?,?,?,?)
        ON CONFLICT(dayKey,albumId) DO UPDATE SET playedMs=playedMs+excluded.playedMs,
        firstPlayedAtUtc=min(firstPlayedAtUtc,excluded.firstPlayedAtUtc),
        lastPlayedAtUtc=max(lastPlayedAtUtc,excluded.lastPlayedAtUtc),visitCount=visitCount+excluded.visitCount`,
        )
        .run(part.dayKey, albumId, delta, part.start, part.end, visit);
      this.db
        .prepare(
          `INSERT INTO pulse_days VALUES (?,?,?,?)
        ON CONFLICT(dayKey) DO UPDATE SET playedMs=playedMs+excluded.playedMs,
        albumCount=albumCount+excluded.albumCount,maxAlbumMs=max(maxAlbumMs,excluded.maxAlbumMs)`,
        )
        .run(
          part.dayKey,
          delta,
          Number(!before),
          (before?.playedMs ?? 0) + delta,
        );
    }
    this.db
      .prepare(
        `INSERT INTO pulse_album_stats VALUES (?,?,?,?,?,?)
      ON CONFLICT(albumId) DO UPDATE SET playedMs=playedMs+excluded.playedMs,
      dayCount=dayCount+excluded.dayCount,sameDayReturns=sameDayReturns+excluded.sameDayReturns,
      firstPlayedAtUtc=min(firstPlayedAtUtc,excluded.firstPlayedAtUtc),lastPlayedAtUtc=max(lastPlayedAtUtc,excluded.lastPlayedAtUtc)`,
      )
      .run(
        albumId,
        event.playedMs - (old?.playedMs ?? 0),
        newDays,
        returns,
        event.startedAtUtc,
        event.endedAtUtc,
      );
    this.db
      .prepare(
        `INSERT INTO pulse_intervals VALUES (?,?,?,?,?,?)
      ON CONFLICT(eventId) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,dayContributions=excluded.dayContributions`,
      )
      .run(
        event.eventId,
        event.revision,
        albumId,
        JSON.stringify(payload),
        event.startedAtUtc,
        JSON.stringify([...contributions.values()]),
      );
    return { eventId: event.eventId, revision: event.revision, albumId };
  }

  range() {
    const bounds = this.db
      .prepare(
        "SELECT min(dayKey) firstDay,max(dayKey) lastDay FROM pulse_days",
      )
      .get() as { firstDay: string | null; lastDay: string | null };
    const settings = this.settings();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(Date.now());
    const today = ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)!.value)
      .join("-");
    return {
      ...settings,
      ...bounds,
      lastDay: bounds.firstDay
        ? bounds.lastDay! > today
          ? bounds.lastDay
          : today
        : null,
    };
  }
  layout(from: string, to: string) {
    return {
      historyGeneration: this.settings().historyGeneration,
      days: this.db
        .prepare(
          "SELECT * FROM pulse_days WHERE dayKey BETWEEN ? AND ? ORDER BY dayKey DESC",
        )
        .all(from, to) as PulseDay[],
    };
  }
  window(from: string, to: string) {
    const layout = this.layout(from, to);
    return {
      ...layout,
      albums: layout.days.map((day) => this.dayAlbums(day.dayKey, 20)),
    };
  }
  dayAlbums(
    dayKey: string,
    limit: number,
    cursor?: string,
    offset = 0,
  ): PulseDayAlbumPage {
    let after: [number, string] | undefined;
    if (cursor) {
      try {
        const parsed: unknown = JSON.parse(
          Buffer.from(cursor, "base64url").toString(),
        );
        if (
          !Array.isArray(parsed) ||
          parsed.length !== 3 ||
          parsed[0] !== dayKey ||
          !Number.isSafeInteger(parsed[1]) ||
          typeof parsed[2] !== "string"
        )
          throw new Error();
        after = [parsed[1], parsed[2]];
      } catch {
        throw badRequest("Некорректный курсор");
      }
    }
    const rows = this.db
      .prepare(
        `SELECT d.*,a.snapshot FROM pulse_day_albums d JOIN pulse_albums a USING(albumId)
      WHERE dayKey=? ${after ? "AND (firstPlayedAtUtc,albumId)>(?,?)" : ""}
      ORDER BY firstPlayedAtUtc,albumId LIMIT ? OFFSET ?`,
      )
      .all(dayKey, ...(after ?? []), limit + 1, offset) as (Record<
      string,
      unknown
    > & { albumId: string; firstPlayedAtUtc: number; snapshot: string })[];
    const more = rows.length > limit;
    const items = rows
      .slice(0, limit)
      .map(({ snapshot, dayKey: _day, ...row }) => ({
        ...row,
        ...JSON.parse(snapshot),
      }));
    const last = rows[Math.min(rows.length, limit) - 1];
    return {
      dayKey,
      items,
      nextCursor: more
        ? Buffer.from(
            JSON.stringify([dayKey, last.firstPlayedAtUtc, last.albumId]),
          ).toString("base64url")
        : null,
    };
  }
  albumStats(albumId: string, dayKey?: string): PulseAlbumStats {
    const stats = this.db
      .prepare(
        "SELECT s.*,a.snapshot FROM pulse_album_stats s JOIN pulse_albums a USING(albumId) WHERE albumId=?",
      )
      .get(albumId) as (PulseAlbumStats & { snapshot: string }) | undefined;
    if (!stats) throw notFound("Альбом отсутствует в истории");
    const { snapshot, ...values } = stats;
    const dayPlayedMs = dayKey
      ? ((
          this.db
            .prepare(
              "SELECT playedMs FROM pulse_day_albums WHERE dayKey=? AND albumId=?",
            )
            .get(dayKey, albumId) as { playedMs: number } | undefined
        )?.playedMs ?? 0)
      : 0;
    const dayTotalMs = dayKey
      ? ((
          this.db
            .prepare("SELECT playedMs FROM pulse_days WHERE dayKey=?")
            .get(dayKey) as { playedMs: number } | undefined
        )?.playedMs ?? 0)
      : 0;
    return { ...values, ...JSON.parse(snapshot), dayPlayedMs, dayTotalMs };
  }
}
