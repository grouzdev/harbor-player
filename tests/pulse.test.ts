import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { Catalog } from "../dist/server/database.js";
import { splitPulseInterval } from "../dist/server/pulse.js";
import { createApp } from "../dist/server/app.js";
import type { PulseEvent } from "../src/shared/pulse.js";

let root: string;
let catalog: Catalog;
const start = Date.parse("2026-03-07T23:59:50Z");
const event = (patch: Partial<PulseEvent> = {}): PulseEvent => ({
  eventId: "event",
  revision: 1,
  trackId: "track",
  albumKey: "album",
  snapshot: { title: "Album", artists: ["Artist"], year: 2026, coverId: null },
  sessionId: "session",
  visitId: "visit",
  startedAtUtc: start,
  endedAtUtc: start + 15000,
  playedMs: 15000,
  final: false,
  ...patch,
});
const send = (...events: PulseEvent[]) =>
  catalog.pulse.ingest({
    historyGeneration: catalog.pulse.settings().historyGeneration,
    events,
  });
const db = () => (catalog as unknown as { db: Database.Database }).db;
beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "pulse-"));
  catalog = new Catalog(root);
  catalog.pulse.updateSettings({ timeZone: "UTC" });
});
afterEach(async () => {
  catalog.close();
  await rm(root, { recursive: true, force: true });
});

describe("Pulse storage", () => {
  it("migrates to version 13 and retains exact milliseconds through retries and checkpoints", () => {
    expect(db().pragma("user_version", { simple: true })).toBe(13);
    const albumId = send(event()).acknowledgements[0].albumId;
    send(event());
    send(event({ revision: 2, endedAtUtc: start + 30000, playedMs: 30000 }));
    expect(send(event()).acknowledgements[0].revision).toBe(2);
    send(
      event({
        revision: 3,
        endedAtUtc: start + 30000,
        playedMs: 30000,
        final: true,
      }),
    );
    expect(
      db().prepare("SELECT count(*) n FROM pulse_intervals").get(),
    ).toEqual({ n: 1 });
    expect(catalog.pulse.layout("2026-03-07", "2026-03-08").days).toEqual([
      {
        dayKey: "2026-03-08",
        playedMs: 20000,
        albumCount: 1,
        maxAlbumMs: 20000,
      },
      {
        dayKey: "2026-03-07",
        playedMs: 10000,
        albumCount: 1,
        maxAlbumMs: 10000,
      },
    ]);
    expect(catalog.pulse.albumStats(albumId)).toMatchObject({
      playedMs: 30000,
      dayCount: 2,
      sameDayReturns: 0,
      firstPlayedAtUtc: start,
      lastPlayedAtUtc: start + 30000,
    });
  });

  it("rolls the entire batch back on conflicting revisions or identities", () => {
    send(event());
    expect(() =>
      send(event({ eventId: "second" }), event({ playedMs: 14000 })),
    ).toThrow("Несовместимая");
    expect(
      db().prepare("SELECT count(*) n FROM pulse_intervals").get(),
    ).toEqual({ n: 1 });
    expect(() => send(event({ revision: 2, albumKey: "other" }))).toThrow(
      "идентичность",
    );
    expect(() =>
      send(event({ revision: 2, endedAtUtc: start + 14000, playedMs: 14000 })),
    ).toThrow("продолжение");
    send(event({ revision: 2, final: true }));
    expect(() =>
      send(event({ revision: 3, endedAtUtc: start + 16000, playedMs: 16000 })),
    ).toThrow("продолжение");
  });

  it("deduplicates album visits across tracks and counts same-day returns once", () => {
    const albumId = send(event()).acknowledgements[0].albumId;
    send(event({ eventId: "next-track", trackId: "track2" }));
    send(event({ eventId: "return", visitId: "visit2" }));
    send(event({ eventId: "return-next", visitId: "visit2" }));
    expect(catalog.pulse.albumStats(albumId)).toMatchObject({
      playedMs: 60000,
      dayCount: 2,
      sameDayReturns: 2,
    });
    expect(catalog.pulse.dayAlbums("2026-03-07", 20).items[0].visitCount).toBe(
      2,
    );
  });

  it("keeps historical identity and snapshot across tag renames and catalog removal", () => {
    const first = send(event()).acknowledgements[0].albumId;
    const renamed = event({
      eventId: "renamed",
      albumKey: "new-key",
      snapshot: { ...event().snapshot, title: "Renamed" },
    });
    expect(send(renamed).acknowledgements[0].albumId).toBe(first);
    expect(
      send(
        event({ eventId: "next", trackId: "new-track", albumKey: "new-key" }),
      ).acknowledgements[0].albumId,
    ).toBe(first);
    expect(catalog.pulse.dayAlbums("2026-03-07", 20).items[0].title).toBe(
      "Album",
    );
    expect(
      send(
        event({
          eventId: "edition",
          trackId: "other-track",
          albumKey: "other-key",
        }),
      ).acknowledgements[0].albumId,
    ).not.toBe(first);
    catalog.close();
    catalog = new Catalog(root);
    expect(catalog.pulse.albumStats(first).playedMs).toBe(45000);
  });

  it("retains one hash-addressed historical cover outside the catalog cache", async () => {
    const coverId = `${"a".repeat(64)}.jpg`;
    await mkdir(path.join(root, "covers"));
    await writeFile(path.join(root, "covers", coverId), "cover");
    send(event({ snapshot: { ...event().snapshot, coverId } }));
    await rm(path.join(root, "covers"), { recursive: true });
    expect(
      await readFile(path.join(root, "pulse-covers", coverId), "utf8"),
    ).toBe("cover");
    send(
      event({
        eventId: "missing-cover",
        snapshot: { ...event().snapshot, coverId },
      }),
    );
  });

  it("defaults enabled and invalidates pending events after clear and re-enable", () => {
    expect(catalog.pulse.settings().enabled).toBe(true);
    send(event());
    const old = catalog.pulse.settings().historyGeneration;
    expect(catalog.pulse.clear(old).historyGeneration).toBe(old + 1);
    expect(catalog.pulse.range().firstDay).toBeNull();
    expect(() =>
      catalog.pulse.ingest({ historyGeneration: old, events: [event()] }),
    ).toThrow("Поколение");
    catalog.pulse.updateSettings({ enabled: false });
    expect(() => send(event())).toThrow("отключён");
    expect(
      catalog.pulse.updateSettings({ enabled: true }).historyGeneration,
    ).toBe(old + 2);
    expect(() =>
      catalog.pulse.updateSettings({ timeZone: "Europe/Berlin" }),
    ).toThrow("пока не поддерживается");
    expect(() => catalog.pulse.updateSettings({ timeZone: "invalid" })).toThrow(
      "часовой пояс",
    );
  });

  it("provides sparse windows, cursor pagination and direct ranks for a busy day", () => {
    for (let batch = 0; batch < 11; batch++) {
      send(
        ...Array.from({ length: 100 }, (_, i) => {
          const n = batch * 100 + i;
          return event({
            eventId: `e${n}`,
            trackId: `t${n}`,
            albumKey: `a${n}`,
            startedAtUtc: start - 3600000 + n,
            endedAtUtc: start - 3600000 + n + 1,
            playedMs: 1,
          });
        }),
      );
    }
    expect(
      catalog.pulse.window("2026-03-01", "2026-03-07").albums[0].items,
    ).toHaveLength(20);
    expect(
      catalog.pulse.layout("2026-03-01", "2026-03-07").days[0].albumCount,
    ).toBe(1100);
    const all = catalog.pulse.dayAlbums("2026-03-07", 100, undefined, 1000);
    expect(all.items).toHaveLength(100);
    expect(all.nextCursor).toBeNull();
    const first = catalog.pulse.dayAlbums("2026-03-07", 10);
    const next = catalog.pulse.dayAlbums("2026-03-07", 10, first.nextCursor!);
    expect(next.items[0].firstPlayedAtUtc).toBe(start - 3600000 + 10);
    expect(() =>
      catalog.pulse.dayAlbums("2026-03-08", 10, first.nextCursor!),
    ).toThrow("курсор");
  });

  it.each([
    ["America/New_York", "2026-03-08T04:59:50Z", "2026-03-07", "2026-03-08"],
    ["America/New_York", "2026-11-01T03:59:50Z", "2026-10-31", "2026-11-01"],
    ["Asia/Kathmandu", "2026-03-07T18:14:50Z", "2026-03-07", "2026-03-08"],
  ])(
    "splits local midnight with timezone %s",
    (zone, timestamp, before, after) => {
      const time = Date.parse(timestamp);
      expect(
        splitPulseInterval(
          event({
            startedAtUtc: time,
            endedAtUtc: time + 20000,
            playedMs: 20000,
          }),
          zone,
        ),
      ).toEqual([
        { dayKey: before, playedMs: 10000, start: time, end: time + 10000 },
        {
          dayKey: after,
          playedMs: 10000,
          start: time + 10000,
          end: time + 20000,
        },
      ]);
    },
  );

  it("keeps subsecond allocations stable when later checkpoints have wall-clock drift", () => {
    const time = Date.parse("2026-03-07T23:59:59.999Z");
    const albumId = send(
      event({ startedAtUtc: time, endedAtUtc: time + 2, playedMs: 2 }),
    ).acknowledgements[0].albumId;
    send(
      event({
        revision: 2,
        startedAtUtc: time,
        endedAtUtc: time + 1000,
        playedMs: 3,
      }),
    );
    expect(catalog.pulse.albumStats(albumId)).toMatchObject({
      playedMs: 3,
      dayCount: 2,
    });
    expect(
      catalog.pulse
        .layout("2026-03-07", "2026-03-08")
        .days.map((day) => day.playedMs),
    ).toEqual([2, 1]);
  });

  it("enforces API bounds and preserves historical cover serving under session protections", async () => {
    const context = await createApp({ dataDir: root });
    try {
      const session = await context.app.inject({
        url: "/api/session",
        headers: { host: "127.0.0.1:4317" },
      });
      const headers = {
        host: "127.0.0.1:4317",
        cookie: String(session.headers["set-cookie"]).split(";")[0],
        "x-csrf-token": session.json().csrf,
      };
      const get = (url: string) => context.app.inject({ url, headers });
      const post = (url: string, payload: object) =>
        context.app.inject({ method: "POST", url, headers, payload });
      expect(
        (
          await post("/api/listening-events", {
            historyGeneration: 1,
            events: [event()],
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post("/api/listening-events", {
            historyGeneration: 1,
            events: Array(101).fill(event()),
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post("/api/listening-events", {
            historyGeneration: 1,
            events: [event({ playedMs: 1.5 })],
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post("/api/listening-events", {
            historyGeneration: 1,
            events: [event({ endedAtUtc: start + 3600001 })],
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await get("/api/pulse/layout?from=2026-01-01&to=2027-01-02"))
          .statusCode,
      ).toBe(400);
      expect(
        (await get("/api/pulse/window?from=2026-01-01&to=2026-02-01"))
          .statusCode,
      ).toBe(400);
      expect(
        (await get("/api/pulse/layout?from=2026-02-30&to=2026-03-01"))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await get(
            "/api/pulse/layout?from=2026-03-01&to=2026-03-09&timeZone=UTC",
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (await get("/api/pulse/days/2026-03-07/albums?offset=1&limit=100"))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await post("/api/pulse/clear", {
            confirm: false,
            historyGeneration: 1,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post("/api/pulse/clear", {
            confirm: true,
            historyGeneration: 1,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await post("/api/listening-events", {
            historyGeneration: 1,
            events: [event()],
          })
        ).statusCode,
      ).toBe(409);
    } finally {
      await context.app.close();
    }
  });
});
