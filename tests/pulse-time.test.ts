import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../dist/server/app.js";
import { Catalog } from "../dist/server/database.js";
import type { Track } from "../src/shared/contracts";
import type { PulseEvent } from "../src/shared/pulse";
import {
  PulseRecorder,
  type ListeningEvent,
} from "../src/client/pulse-recorder";
import { toPulseEvent } from "../src/client/pulse-event";

let root: string;
let context: Awaited<ReturnType<typeof createApp>>;
let catalog: Catalog;
let headers: Record<string, string>;
const track = {
  id: "time-track",
  albumKey: "time-album",
  albumTitle: "Time album",
  albumArtists: ["Time artist"],
  artists: ["Time artist"],
} as Track;

beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "pulse-time-"));
  context = await createApp({ dataDir: root });
  catalog = new Catalog(root);
  const session = await context.app.inject({
    url: "/api/session",
    headers: { host: "127.0.0.1:4317" },
  });
  headers = {
    host: "127.0.0.1:4317",
    cookie: String(session.headers["set-cookie"]).split(";")[0],
    "x-csrf-token": session.json().csrf,
  };
});
afterEach(async () => {
  catalog.close();
  await context.app.close();
  await rm(root, { recursive: true, force: true });
});

async function zone(timeZone: string) {
  const response = await context.app.inject({
    method: "PATCH",
    url: "/api/pulse/settings",
    headers,
    payload: { timeZone },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function send(event: PulseEvent) {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/listening-events",
    headers,
    payload: {
      historyGeneration: catalog.pulse.settings().historyGeneration,
      events: [event],
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().acknowledgements[0].albumId as string;
}

function recorder(start: number) {
  let clock = 0;
  let sequence = 0;
  const events: ListeningEvent[] = [];
  const instance = new PulseRecorder(
    (event) => events.push(event),
    catalog.pulse.settings().historyGeneration,
    () => clock,
    () => start,
    () => `time-${++sequence}`,
  );
  instance.source(track);
  return {
    instance,
    events,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function totals(expected: number) {
  const db = (catalog as unknown as { db: Database.Database }).db;
  expect(
    db
      .prepare(
        "SELECT sum(json_extract(payload, '$.playedMs')) total FROM pulse_intervals",
      )
      .get(),
  ).toEqual({ total: expected });
  for (const table of ["pulse_days", "pulse_day_albums", "pulse_album_stats"]) {
    expect(
      db.prepare(`SELECT sum(playedMs) total FROM ${table}`).get(),
    ).toEqual({
      total: expected,
    });
  }
}

describe("Pulse time recorder → HTTP → SQLite", () => {
  it("accepts only the latest cumulative duration, including zero-growth final and stale retry", async () => {
    await zone("UTC");
    const start = Date.parse("2026-03-07T23:59:50Z");
    const f = recorder(start);
    f.instance.playing(0, 1);
    for (let i = 1; i <= 2; i++) {
      f.advance(15_000.25);
      f.instance.sample(i * 15.00025, 1);
    }
    f.advance(0.125);
    f.instance.close(30.000625, 1);
    const wire = f.events.map(toPulseEvent);
    expect(wire.map((event) => event.playedMs)).toEqual([
      15_000, 30_000, 30_000,
    ]);
    expect(wire.map((event) => event.startedAtUtc)).toEqual([
      start,
      start,
      start,
    ]);
    const accepted: number[] = [];
    for (const event of [...wire, wire[0], wire[1], wire[2]]) {
      const albumId = await send(event);
      const total = catalog.pulse.albumStats(albumId).playedMs;
      accepted.push(total);
      totals(total);
    }
    expect(accepted).toEqual([15_000, 30_000, 30_000, 30_000, 30_000, 30_000]);
  });

  it.each([0.5, 1, 2])(
    "keeps cumulative integer revisions at %sx across midnight",
    async (rate) => {
      await zone("UTC");
      const start = Date.parse("2026-03-07T23:59:50.000Z");
      const f = recorder(start);
      f.instance.playing(0, rate);
      f.advance(15_000.25);
      f.instance.sample(15.00025 * rate, rate);
      f.advance(0.25);
      f.instance.close(15.0005 * rate, rate);
      const wire = f.events.map(toPulseEvent);
      expect(wire).toHaveLength(2);
      expect(wire[1]).toMatchObject({
        startedAtUtc: start,
        endedAtUtc: start + 15_000,
        playedMs: 15_000,
        final: true,
      });
      expect(wire[1].endedAtUtc).toBe(wire[0].endedAtUtc);
      let albumId = "";
      let previous = 0;
      for (const event of [...wire, ...wire]) {
        albumId = await send(event);
        const accepted = catalog.pulse.albumStats(albumId).playedMs;
        expect(accepted).toBeGreaterThanOrEqual(previous);
        previous = accepted;
        totals(15_000);
      }
      expect(
        catalog.pulse
          .layout("2026-03-07", "2026-03-08")
          .days.map((day) => day.playedMs),
      ).toEqual([5000, 10_000]);
      for (const day of ["2026-03-07", "2026-03-08"]) {
        expect(catalog.pulse.dayAlbums(day, 20).items[0].visitCount).toBe(1);
      }
      expect(catalog.pulse.albumStats(albumId)).toMatchObject({
        firstPlayedAtUtc: start,
        lastPlayedAtUtc: start + 15_000,
        sameDayReturns: 0,
      });
    },
  );

  it("accepts a delayed multi-hour sample with hourly bounds and one visit", async () => {
    await zone("UTC");
    const start = Date.parse("2026-03-07T22:30:00.125Z");
    const f = recorder(start);
    f.instance.playing(0, 0.5);
    f.advance(10_800_001.5);
    f.instance.sample(5400.00075, 0.5);
    f.instance.close(5400.00075, 0.5);
    const wire = f.events.map(toPulseEvent);
    expect(wire.map((event) => event.playedMs)).toEqual([
      3_600_000, 3_600_000, 3_600_000, 1,
    ]);
    expect(new Set(wire.map((event) => event.visitId)).size).toBe(1);
    let albumId = "";
    for (const event of wire) {
      expect(event.endedAtUtc - event.startedAtUtc).toBeLessThanOrEqual(
        3_600_000,
      );
      expect(event.playedMs).toBeLessThanOrEqual(
        event.endedAtUtc - event.startedAtUtc,
      );
      albumId = await send(event);
    }
    totals(10_800_001);
    expect(catalog.pulse.albumStats(albumId)).toMatchObject({
      sameDayReturns: 0,
    });
    expect(
      catalog.pulse
        .layout("2026-03-07", "2026-03-08")
        .days.map((day) => day.playedMs),
    ).toEqual([5_400_126, 5_399_875]);
    for (const day of ["2026-03-07", "2026-03-08"])
      expect(catalog.pulse.dayAlbums(day, 20).items[0].visitCount).toBe(1);
  });

  it.each([
    ["2026-03-08T06:59:50Z", "2026-03-08", "01:59", "03:00"],
    ["2026-11-01T05:59:50Z", "2026-11-01", "01:59", "01:00"],
  ])(
    "counts real elapsed time through DST at %s",
    async (timestamp, day, before, after) => {
      await zone("America/New_York");
      const start = Date.parse(timestamp);
      const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      expect(local.format(start)).toBe(before);
      expect(local.format(start + 20_000)).toBe(after);
      const f = recorder(start);
      f.instance.playing(0, 1);
      f.advance(20_000);
      f.instance.close(20, 1);
      await send(toPulseEvent(f.events[0]));
      totals(20_000);
      expect(catalog.pulse.layout(day, day).days).toMatchObject([
        { dayKey: day, playedMs: 20_000 },
      ]);
      catalog.close();
      catalog = new Catalog(root);
      expect(catalog.pulse.settings().timeZone).toBe("America/New_York");
      totals(20_000);
    },
  );

  it("uses the saved timezone after the process timezone changes", async () => {
    await zone("America/New_York");
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
        "Asia/Tokyo",
      );
      const start = Date.parse("2026-03-08T04:59:50Z");
      const f = recorder(start);
      f.instance.playing(0, 1);
      f.advance(20_000);
      f.instance.close(20, 1);
      await send(toPulseEvent(f.events[0]));
      totals(20_000);
      expect(
        catalog.pulse.layout("2026-03-07", "2026-03-08").days.map((day) => ({
          dayKey: day.dayKey,
          playedMs: day.playedMs,
        })),
      ).toEqual([
        { dayKey: "2026-03-08", playedMs: 10_000 },
        { dayKey: "2026-03-07", playedMs: 10_000 },
      ]);
      expect(catalog.pulse.settings().timeZone).toBe("America/New_York");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
