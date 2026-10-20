import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { Catalog } from "../dist/server/database.js";
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
beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "pulse-delete-"));
  catalog = new Catalog(root);
  catalog.pulse.updateSettings({ timeZone: "UTC" });
});
afterEach(async () => {
  catalog.close();
  await rm(root, { recursive: true, force: true });
});

it("removes only the selected day, recalculates totals and prevents checkpoint resurrection", async () => {
  const {
    acknowledgements: [{ albumId }],
  } = await send(event());
  const {
    acknowledgements: [{ albumId: otherId }],
  } = await send(
    event({
      eventId: "other",
      trackId: "other",
      albumKey: "other",
      visitId: "other",
    }),
  );
  const generation = catalog.pulse.settings().historyGeneration;
  catalog.pulse.deleteDayAlbums("2026-03-07", [albumId], generation);
  expect(catalog.pulse.albumStats(albumId)).toMatchObject({
    playedMs: 5000,
    dayCount: 1,
    sameDayReturns: 0,
    firstPlayedAtUtc: Date.parse("2026-03-08"),
  });
  expect(catalog.pulse.layout("2026-03-07", "2026-03-08").days).toMatchObject([
    { playedMs: 10000, albumCount: 2, maxAlbumMs: 5000 },
    { playedMs: 10000, albumCount: 1, maxAlbumMs: 10000 },
  ]);
  await send(event());
  await send(
    event({ revision: 2, endedAtUtc: start + 20000, playedMs: 20000 }),
  );
  expect(
    catalog.pulse.dayAlbums("2026-03-07", 20).items.map((a) => a.albumId),
  ).toEqual([otherId]);
  expect(catalog.pulse.albumStats(albumId)).toMatchObject({
    playedMs: 10000,
    dayCount: 1,
  });
  catalog.pulse.deleteDayAlbums("2026-03-08", [albumId, otherId], generation);
  expect(() => catalog.pulse.albumStats(albumId)).toThrow("отсутствует");
  await send(
    event({
      revision: 3,
      endedAtUtc: start + 25000,
      playedMs: 25000,
      final: true,
    }),
  );
  expect(() => catalog.pulse.albumStats(albumId)).toThrow("отсутствует");
  catalog.pulse.deleteDayAlbums("2026-03-07", [otherId], generation);
  expect(catalog.pulse.range().firstDay).toBeNull();
  catalog.close();
  catalog = new Catalog(root);
  expect(catalog.pulse.range().firstDay).toBeNull();
  // A genuinely new listen remains recordable.
  await send(event({ eventId: "new", visitId: "new" }));
  expect(catalog.pulse.albumStats(albumId).playedMs).toBe(15000);
});

it("suppresses extensions on the deleted day and recomputes returns on remaining days", async () => {
  const {
    acknowledgements: [{ albumId }],
  } = await send(
    event({
      startedAtUtc: start - 60000,
      endedAtUtc: start - 50000,
      playedMs: 10000,
    }),
  );
  const generation = catalog.pulse.settings().historyGeneration;
  catalog.pulse.deleteDayAlbums("2026-03-07", [albumId], generation);
  await send(
    event({
      revision: 2,
      startedAtUtc: start - 60000,
      endedAtUtc: start - 40000,
      playedMs: 20000,
    }),
  );
  expect(catalog.pulse.range().firstDay).toBeNull();
  await send(event({ eventId: "second", visitId: "second" }));
  await send(event({ eventId: "third", visitId: "third" }));
  catalog.pulse.deleteDayAlbums("2026-03-07", [albumId], generation);
  expect(catalog.pulse.albumStats(albumId)).toMatchObject({
    playedMs: 10000,
    dayCount: 1,
    sameDayReturns: 1,
  });
});

it("validates DELETE requests, CSRF and generation without changing unrelated history", async () => {
  const {
    acknowledgements: [{ albumId }],
  } = await send(event());
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
    const payload = {
      albumIds: [albumId],
      historyGeneration: catalog.pulse.settings().historyGeneration,
    };
    const remove = (day: string, body = payload, auth = headers) =>
      context.app.inject({
        method: "DELETE",
        url: `/api/pulse/days/${day}/albums`,
        headers: auth,
        payload: body,
      });
    expect((await remove("2026-02-30")).statusCode).toBe(400);
    expect(
      (await remove("2026-03-07", { ...payload, albumIds: [] })).statusCode,
    ).toBe(400);
    expect(
      (
        await remove("2026-03-07", {
          ...payload,
          historyGeneration: payload.historyGeneration + 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await remove("2026-03-07", payload, { ...headers, "x-csrf-token": "" }))
        .statusCode,
    ).toBe(403);
    expect((await remove("2026-03-07")).json()).toEqual({ ok: true });
    expect(catalog.pulse.albumStats(albumId).playedMs).toBe(5000);
    expect((await remove("2026-03-07")).statusCode).toBe(200);
  } finally {
    await context.app.close();
  }
});
