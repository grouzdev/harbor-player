import { z } from "zod";

const id = z.string().min(1).max(500);
const ms = z.number().int().min(0).max(8640000000000000);
export const pulseSnapshotSchema = z.object({
  title: z.string().max(2000),
  artists: z.array(z.string().max(1000)).max(100),
  year: z.number().int().nullable(),
  coverId: z
    .string()
    .regex(/^[a-f0-9]{64}\.(jpg|png)$/)
    .nullable(),
});
export const pulseEventSchema = z
  .object({
    eventId: id,
    revision: z.number().int().min(1),
    trackId: id.nullable(),
    albumKey: id,
    snapshot: pulseSnapshotSchema,
    sessionId: id,
    visitId: id,
    startedAtUtc: ms,
    endedAtUtc: ms,
    playedMs: z.number().int().positive().max(3600000),
    final: z.boolean(),
  })
  .refine(
    (e) =>
      e.endedAtUtc > e.startedAtUtc &&
      e.endedAtUtc - e.startedAtUtc <= 3600000 &&
      e.playedMs <= e.endedAtUtc - e.startedAtUtc,
    "Invalid continuous interval",
  );
export const pulseBatchSchema = z.object({
  historyGeneration: z.number().int().min(1),
  events: z.array(pulseEventSchema).min(1).max(100),
});
export const pulseSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    timeZone: z.string().min(1).max(100).optional(),
  })
  .strict();
export type PulseEvent = z.infer<typeof pulseEventSchema>;
export type PulseBatch = z.infer<typeof pulseBatchSchema>;
export type PulseSnapshot = z.infer<typeof pulseSnapshotSchema>;
export interface PulseSettings {
  enabled: boolean;
  timeZone: string | null;
  historyGeneration: number;
  coverageStartedAtUtc: number;
}
export interface PulseAcknowledgement {
  eventId: string;
  revision: number;
  albumId: string;
}
export interface PulseBatchResult {
  historyGeneration: number;
  acknowledgements: PulseAcknowledgement[];
}
export interface PulseDay {
  dayKey: string;
  playedMs: number;
  albumCount: number;
  maxAlbumMs: number;
}
export interface PulseDayAlbum extends PulseSnapshot {
  albumId: string;
  playedMs: number;
  firstPlayedAtUtc: number;
  lastPlayedAtUtc: number;
  visitCount: number;
}
export interface PulseDayAlbumPage {
  dayKey: string;
  items: PulseDayAlbum[];
  nextCursor: string | null;
}
export interface PulseHistoryRange extends PulseSettings {
  firstDay: string | null;
  lastDay: string | null;
}
export interface PulseLayout {
  historyGeneration: number;
  days: PulseDay[];
}
export interface PulseWindow extends PulseLayout {
  albums: PulseDayAlbumPage[];
}
export interface PulseAlbumStats extends PulseSnapshot {
  albumId: string;
  playedMs: number;
  dayCount: number;
  sameDayReturns: number;
  firstPlayedAtUtc: number;
  lastPlayedAtUtc: number;
  dayPlayedMs: number;
  dayTotalMs: number;
}

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const durationMs = z.number().int().nonnegative();
export const pulseSettingsSchema = z.object({
  enabled: z.boolean(),
  timeZone: z.string().nullable(),
  historyGeneration: z.number().int().positive(),
  coverageStartedAtUtc: ms,
}) satisfies z.ZodType<PulseSettings>;
export const pulseHistoryRangeSchema = pulseSettingsSchema.extend({
  firstDay: dayKey.nullable(),
  lastDay: dayKey.nullable(),
});
export const pulseDaySchema = z.object({
  dayKey,
  playedMs: durationMs,
  albumCount: z.number().int().nonnegative(),
  maxAlbumMs: durationMs,
});
export const pulseLayoutSchema = z.object({
  historyGeneration: z.number().int().positive(),
  days: z.array(pulseDaySchema).max(366),
});
export const pulseDayAlbumSchema = pulseSnapshotSchema.extend({
  albumId: id,
  playedMs: durationMs,
  firstPlayedAtUtc: ms,
  lastPlayedAtUtc: ms,
  visitCount: z.number().int().positive(),
});
export const pulseDayAlbumPageSchema = z.object({
  dayKey,
  items: z.array(pulseDayAlbumSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const pulseWindowSchema = pulseLayoutSchema.extend({
  albums: z.array(pulseDayAlbumPageSchema).max(31),
});
export const pulseAlbumStatsSchema = pulseSnapshotSchema.extend({
  albumId: id,
  playedMs: durationMs,
  dayCount: z.number().int().positive(),
  sameDayReturns: z.number().int().nonnegative(),
  firstPlayedAtUtc: ms,
  lastPlayedAtUtc: ms,
  dayPlayedMs: durationMs,
  dayTotalMs: durationMs,
});
export const pulseBatchResultSchema = z.object({
  historyGeneration: z.number().int().positive(),
  acknowledgements: z
    .array(
      z.object({
        eventId: id,
        revision: z.number().int().positive(),
        albumId: id,
      }),
    )
    .max(100),
});
