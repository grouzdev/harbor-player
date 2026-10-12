import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { Catalog } from "../dist/server/database.js";
import { splitPulseInterval } from "../dist/server/pulse.js";
import { createApp } from "../dist/server/app.js";
import type { PulseEvent } from "../src/shared/pulse.js";
import type { Track } from "../src/shared/contracts.js";

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
  vi.restoreAllMocks();
  catalog.close();
  await rm(root, { recursive: true, force: true });
});

describe("Pulse storage", () => {
  it.each(["clear", "disable", "re-enable", "timeZone"])(
    "allows reads during preparation and rejects stale commit after %s",
    async (change) => {
      let release!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const artwork = catalog.pulse as unknown as {
        copyCover(id: string): Promise<void>;
      };
      vi.spyOn(artwork, "copyCover").mockImplementation(() => paused);
      const pending = send(
        event({
          snapshot: { ...event().snapshot, coverId: `${"c".repeat(64)}.jpg` },
        }),
      );
      expect(catalog.pulse.range().firstDay).toBeNull();
      expect(catalog.pulse.layout("2026-03-07", "2026-03-08").days).toEqual([]);
      if (change === "clear")
        catalog.pulse.clear(catalog.pulse.settings().historyGeneration);
      else if (change === "timeZone")
        db()
          .prepare("UPDATE pulse_settings SET timeZone='Europe/Berlin'")
          .run();
      else {
        catalog.pulse.updateSettings({ enabled: false });
        if (change === "re-enable")
          catalog.pulse.updateSettings({ enabled: true });
      }
      const rejected = expect(pending).rejects.toThrow(
        change === "disable"
          ? "отключён"
          : change === "timeZone"
            ? "пояс"
            : "Поколение",
      );
      release();
      await rejected;
      expect(
        db().prepare("SELECT count(*) n FROM pulse_intervals").get(),
      ).toEqual({ n: 0 });
    },
  );

  it("bounds artwork work across batches, deduplicates concurrent covers and keeps retry sums", async () => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const artwork = catalog.pulse as unknown as {
      copyCover(id: string): Promise<void>;
    };
    const prepare = vi
      .spyOn(artwork, "copyCover")
      .mockImplementation(() => paused);
    const events = Array.from({ length: 8 }, (_, i) =>
      event({
        eventId: `bounded-${i}`,
        snapshot: {
          ...event().snapshot,
          coverId: `${String(i).repeat(64)}.jpg`,
        },
      }),
    );
    const first = send(...events);
    const retry = send(...events);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(4));
    release();
    const [accepted, retried] = await Promise.all([first, retry]);
    expect(prepare).toHaveBeenCalledTimes(8);
    expect(retried).toEqual(accepted);
    expect(
      db().prepare("SELECT sum(playedMs) n FROM pulse_days").get(),
    ).toEqual({ n: 120000 });
  });

  it("drains the artwork queue after rejected preparation and permits retry", async () => {
    const artwork = catalog.pulse as unknown as {
      copyCover(id: string): Promise<void>;
    };
    const prepare = vi
      .spyOn(artwork, "copyCover")
      .mockRejectedValue(new Error("Artwork adapter failed"));
    const events = Array.from({ length: 8 }, (_, index) =>
      event({
        eventId: `rejected-cover-${index}`,
        snapshot: {
          ...event().snapshot,
          coverId: `${String(index).repeat(64)}.jpg`,
        },
      }),
    );
    const first = await send(...events);
    expect(first.acknowledgements).toHaveLength(8);
    expect(prepare).toHaveBeenCalledTimes(8);
    expect(await send(...events)).toEqual(first);
    expect(prepare).toHaveBeenCalledTimes(16);
    expect(
      db().prepare("SELECT sum(playedMs) n FROM pulse_days").get(),
    ).toEqual({ n: 120000 });
  });

  it("acknowledges an existing flat cover while unrelated heavy copies are paused", async () => {
    const coverId = `${"e".repeat(64)}.jpg`;
    await mkdir(path.join(root, "pulse-covers"));
    await writeFile(path.join(root, "pulse-covers", coverId), "legacy cover");
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const artwork = catalog.pulse as unknown as {
      copyCover(id: string): Promise<void>;
    };
    const prepare = vi
      .spyOn(artwork, "copyCover")
      .mockImplementation(() => paused);
    const batch = send(
      ...Array.from({ length: 8 }, (_, index) =>
        event({
          eventId: `slow-cover-${index}`,
          snapshot: {
            ...event().snapshot,
            coverId: `${String(index).repeat(64)}.jpg`,
          },
        }),
      ),
    );
    let acknowledged = false;
    let checkpoint: Promise<unknown> | undefined;
    try {
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(4));
      checkpoint = send(
        event({
          eventId: "existing-cover",
          snapshot: { ...event().snapshot, coverId },
        }),
      ).then(() => {
        acknowledged = true;
      });
      await vi.waitFor(() => expect(acknowledged).toBe(true));
      expect(prepare).toHaveBeenCalledTimes(4);
    } finally {
      release();
      await Promise.all([batch, checkpoint]);
    }
    expect(
      await readFile(path.join(root, "pulse-covers", coverId), "utf8"),
    ).toBe("legacy cover");
  });

  it("preserves aliases and the first snapshot through actual catalog lifecycle operations", async () => {
    const library = catalog.addLibrary("Lifecycle", path.join(root, "music"));
    const track: Track = {
      id: "track",
      libraryId: library.id,
      relativePath: "Album/song.flac",
      title: "Song",
      artists: ["Artist"],
      albumTitle: "Album",
      albumArtists: ["Artist"],
      albumKey: "album",
      rating: null,
      albumRating: null,
      albumViewed: false,
      genres: [],
      year: 2026,
      trackNumber: 1,
      discNumber: null,
      duration: 15,
      format: "flac",
      size: 1,
      mtimeMs: 1,
      coverId: null,
      available: true,
    };
    await mkdir(path.join(root, "music", "Album"), { recursive: true });
    await writeFile(
      path.join(root, "music", track.relativePath),
      "synthetic audio",
    );
    catalog.upsert(track);
    const albumId = (await send(event())).acknowledgements[0].albumId;
    catalog.renameLibrary(library.id, "Renamed library");
    catalog.upsert({ ...track, albumKey: "retagged", albumTitle: "Retagged" });
    expect(
      (
        await send(
          event({
            eventId: "retagged",
            albumKey: "retagged",
            snapshot: { ...event().snapshot, title: "Retagged" },
          }),
        )
      ).acknowledgements[0].albumId,
    ).toBe(albumId);
    const { rename } = await import("node:fs/promises");
    await rename(
      path.join(root, "music", track.relativePath),
      path.join(root, "music", "moved.flac"),
    );
    catalog.upsert({
      ...track,
      relativePath: "moved.flac",
      albumKey: "retagged",
      albumTitle: "Retagged",
    });
    expect(
      (await send(event({ eventId: "moved", albumKey: "retagged" })))
        .acknowledgements[0].albumId,
    ).toBe(albumId);
    catalog.removeLibrary(library.id);
    expect(catalog.track("track")).toBeUndefined();
    catalog.close();
    catalog = new Catalog(root);
    expect(catalog.pulse.albumStats(albumId)).toMatchObject({
      playedMs: 45000,
      title: "Album",
      artists: ["Artist"],
      year: 2026,
    });
    expect(
      db()
        .prepare(
          "SELECT albumKey FROM pulse_album_aliases WHERE albumId=? ORDER BY albumKey",
        )
        .all(albumId),
    ).toEqual([{ albumKey: "album" }, { albumKey: "retagged" }]);
    expect(
      db()
        .prepare(
          "SELECT albumId FROM pulse_track_aliases WHERE trackId='track'",
        )
        .get(),
    ).toEqual({ albumId });
  });

  it.each(["missing", "copy-error"])(
    "records time and snapshot when cover is %s",
    async (fault) => {
      const coverId = `${"b".repeat(64)}.jpg`;
      if (fault === "copy-error") {
        // Copying a directory as a file fails even with elevated privileges.
        await mkdir(path.join(root, "covers", coverId), { recursive: true });
      }
      const albumId = (
        await send(event({ snapshot: { ...event().snapshot, coverId } }))
      ).acknowledgements[0].albumId;
      expect(catalog.pulse.albumStats(albumId)).toMatchObject({
        title: "Album",
        playedMs: 15000,
        coverId,
      });
      expect(await readdir(path.join(root, "pulse-covers"))).toEqual([]);
      if (fault === "copy-error")
        await rm(path.join(root, "covers"), { recursive: true });
      const context = await createApp({ dataDir: root });
      try {
        const session = await context.app.inject({
          url: "/api/session",
          headers: { host: "127.0.0.1:4317" },
        });
        const response = await context.app.inject({
          url: `/api/covers/${coverId}`,
          headers: {
            host: "127.0.0.1:4317",
            cookie: String(session.headers["set-cookie"]).split(";")[0],
          },
        });
        expect(response.statusCode).toBe(404);
      } finally {
        await context.app.close();
      }
    },
  );

  it.each(["ingest-first", "clear-first"])(
    "rejects old generation after clear with %s ordering",
    async (ordering) => {
      const generation = catalog.pulse.settings().historyGeneration;
      const ingest = () =>
        catalog.pulse.ingest({
          historyGeneration: generation,
          events: [event()],
        });
      if (ordering === "ingest-first") await ingest();
      const cleared = catalog.pulse.clear(generation);
      await expect(ingest()).rejects.toThrow("Поколение");
      expect(catalog.pulse.range().firstDay).toBeNull();
      catalog.close();
      catalog = new Catalog(root);
      await expect(ingest()).rejects.toThrow("Поколение");
      expect(catalog.pulse.settings().historyGeneration).toBe(
        cleared.historyGeneration,
      );
      await send(event());
      expect(
        db().prepare("SELECT sum(playedMs) n FROM pulse_days").get(),
      ).toEqual({ n: 15000 });
    },
  );

  it("counts independent sessions once despite retry and equal-duration final revisions", async () => {
    const a = event({ startedAtUtc: start - 60000, endedAtUtc: start - 45000 });
    const b = {
      ...a,
      eventId: "window-b",
      sessionId: "session-b",
      visitId: "visit-b",
    };
    const albumId = (await send(a, b)).acknowledgements[0].albumId;
    await send(b, a);
    await send(
      { ...a, revision: 2, final: true },
      { ...b, revision: 2, final: true },
    );
    await send(a, b);
    expect(catalog.pulse.albumStats(albumId)).toMatchObject({
      playedMs: 30000,
      sameDayReturns: 1,
    });
    expect(catalog.pulse.dayAlbums("2026-03-07", 20).items[0].visitCount).toBe(
      2,
    );
    for (const table of [
      "pulse_days",
      "pulse_day_albums",
      "pulse_album_stats",
    ]) {
      expect(
        db().prepare(`SELECT sum(playedMs) n FROM ${table}`).get(),
      ).toEqual({ n: 30000 });
    }
    expect(
      db().prepare("SELECT count(*) n FROM pulse_intervals").get(),
    ).toEqual({ n: 2 });
  });

  it.each([
    ["2026-03-08T06:59:50Z", "2026-03-08"],
    ["2026-11-01T05:59:50Z", "2026-11-01"],
  ])(
    "retains exact milliseconds across actual DST transition at %s",
    async (timestamp, dayKey) => {
      const time = Date.parse(timestamp);
      expect(
        splitPulseInterval(
          event({
            startedAtUtc: time,
            endedAtUtc: time + 20000,
            playedMs: 20000,
          }),
          "America/New_York",
        ),
      ).toEqual([{ dayKey, playedMs: 20000, start: time, end: time + 20000 }]);
      const dstRoot = path.join(root, "dst");
      const dst = new Catalog(dstRoot);
      let albumId: string;
      try {
        dst.pulse.updateSettings({ timeZone: "America/New_York" });
        albumId = (
          await dst.pulse.ingest({
            historyGeneration: dst.pulse.settings().historyGeneration,
            events: [
              event({
                startedAtUtc: time,
                endedAtUtc: time + 20000,
                playedMs: 20000,
              }),
            ],
          })
        ).acknowledgements[0].albumId;
      } finally {
        dst.close();
      }
      const reopened = new Catalog(dstRoot);
      try {
        expect(reopened.pulse.settings().timeZone).toBe("America/New_York");
        expect(reopened.pulse.albumStats(albumId!).playedMs).toBe(20000);
        expect(reopened.pulse.layout(dayKey, dayKey).days).toEqual([
          { dayKey, playedMs: 20000, albumCount: 1, maxAlbumMs: 20000 },
        ]);
      } finally {
        reopened.close();
      }
    },
  );

  it("migrates to version 13 and retains exact milliseconds through retries and checkpoints", async () => {
    expect(db().pragma("user_version", { simple: true })).toBe(13);
    const albumId = (await send(event())).acknowledgements[0].albumId;
    await send(event());
    await send(
      event({ revision: 2, endedAtUtc: start + 30000, playedMs: 30000 }),
    );
    expect((await send(event())).acknowledgements[0].revision).toBe(2);
    await send(
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

  it("rolls the entire batch back on conflicting revisions or identities", async () => {
    await send(event());
    await expect(
      send(event({ eventId: "second" }), event({ playedMs: 14000 })),
    ).rejects.toThrow("Несовместимая");
    expect(
      db().prepare("SELECT count(*) n FROM pulse_intervals").get(),
    ).toEqual({ n: 1 });
    await expect(
      send(event({ revision: 2, albumKey: "other" })),
    ).rejects.toThrow("идентичность");
    await expect(
      send(event({ revision: 2, endedAtUtc: start + 14000, playedMs: 14000 })),
    ).rejects.toThrow("продолжение");
    await send(event({ revision: 2, final: true }));
    await expect(
      send(event({ revision: 3, endedAtUtc: start + 16000, playedMs: 16000 })),
    ).rejects.toThrow("продолжение");
  });

  it("deduplicates album visits across tracks and counts same-day returns once", async () => {
    const albumId = (await send(event())).acknowledgements[0].albumId;
    await send(event({ eventId: "next-track", trackId: "track2" }));
    await send(event({ eventId: "return", visitId: "visit2" }));
    await send(event({ eventId: "return-next", visitId: "visit2" }));
    expect(catalog.pulse.albumStats(albumId)).toMatchObject({
      playedMs: 60000,
      dayCount: 2,
      sameDayReturns: 2,
    });
    expect(catalog.pulse.dayAlbums("2026-03-07", 20).items[0].visitCount).toBe(
      2,
    );
  });

  it("keeps historical identity and snapshot across tag renames and catalog removal", async () => {
    const first = (await send(event())).acknowledgements[0].albumId;
    const renamed = event({
      eventId: "renamed",
      albumKey: "new-key",
      snapshot: { ...event().snapshot, title: "Renamed" },
    });
    expect((await send(renamed)).acknowledgements[0].albumId).toBe(first);
    expect(
      (
        await send(
          event({ eventId: "next", trackId: "new-track", albumKey: "new-key" }),
        )
      ).acknowledgements[0].albumId,
    ).toBe(first);
    expect(catalog.pulse.dayAlbums("2026-03-07", 20).items[0].title).toBe(
      "Album",
    );
    expect(
      (
        await send(
          event({
            eventId: "edition",
            trackId: "other-track",
            albumKey: "other-key",
          }),
        )
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
    const withCover = event({ snapshot: { ...event().snapshot, coverId } });
    const secondStore = new Catalog(root);
    try {
      const [first, retry] = await Promise.all([
        send(withCover),
        secondStore.pulse.ingest({
          historyGeneration: secondStore.pulse.settings().historyGeneration,
          events: [withCover],
        }),
      ]);
      expect(retry).toEqual(first);
      expect(
        catalog.pulse.albumStats(first.acknowledgements[0].albumId).playedMs,
      ).toBe(15000);
    } finally {
      secondStore.close();
    }
    await writeFile(path.join(root, "covers", coverId), "replacement");
    await send(event({ snapshot: { ...event().snapshot, coverId } }));
    expect(await readdir(path.join(root, "pulse-covers"))).toEqual([
      `${coverId}.archive`,
    ]);
    await rm(path.join(root, "covers"), { recursive: true });
    expect(
      await readFile(
        path.join(root, "pulse-covers", `${coverId}.archive`, "image"),
        "utf8",
      ),
    ).toBe("cover");
    await send(
      event({
        eventId: "missing-cover",
        snapshot: { ...event().snapshot, coverId },
      }),
    );
    const context = await createApp({ dataDir: root });
    try {
      const session = await context.app.inject({
        url: "/api/session",
        headers: { host: "127.0.0.1:4317" },
      });
      const response = await context.app.inject({
        url: `/api/covers/${coverId}`,
        headers: {
          host: "127.0.0.1:4317",
          cookie: String(session.headers["set-cookie"]).split(";")[0],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("cover");
    } finally {
      await context.app.close();
    }
  });

  it("defaults enabled and invalidates pending events after clear and re-enable", async () => {
    expect(catalog.pulse.settings().enabled).toBe(true);
    await send(event());
    const old = catalog.pulse.settings().historyGeneration;
    expect(catalog.pulse.clear(old).historyGeneration).toBe(old + 1);
    expect(catalog.pulse.range().firstDay).toBeNull();
    await expect(
      catalog.pulse.ingest({ historyGeneration: old, events: [event()] }),
    ).rejects.toThrow("Поколение");
    catalog.pulse.updateSettings({ enabled: false });
    await expect(send(event())).rejects.toThrow("отключён");
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

  it("provides sparse windows, cursor pagination and direct ranks for a busy day", async () => {
    for (let batch = 0; batch < 11; batch++) {
      await send(
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

  it("keeps subsecond allocations stable when later checkpoints have wall-clock drift", async () => {
    const time = Date.parse("2026-03-07T23:59:59.999Z");
    const albumId = (
      await send(
        event({ startedAtUtc: time, endedAtUtc: time + 2, playedMs: 2 }),
      )
    ).acknowledgements[0].albumId;
    await send(
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
