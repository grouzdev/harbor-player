import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { expect, it } from "vitest";
import { createApp } from "../dist/server/app.js";
import { Catalog } from "../dist/server/database.js";

it("failed server write sends no ACK, rolls back the entire batch and allows exact retry", async () => {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data", "pulse-write-fault-"));
  const context = await createApp({ dataDir: root });
  const catalog = new Catalog(root);
  const db = (catalog as unknown as { db: Database.Database }).db;
  try {
    catalog.pulse.updateSettings({ timeZone: "UTC" });
    const generation = catalog.pulse.settings().historyGeneration;
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
    const events = ["first", "second"].map((eventId) => ({
      eventId,
      revision: 1,
      trackId: null,
      albumKey: "storage-fault",
      snapshot: {
        title: "Storage fault",
        artists: ["Artist"],
        year: null,
        coverId: null,
      },
      sessionId: "storage-fault",
      visitId: "storage-fault",
      startedAtUtc: Date.parse("2026-03-07T12:00:00Z"),
      endedAtUtc: Date.parse("2026-03-07T12:00:15Z"),
      playedMs: 15000,
      final: true,
    }));
    // Deterministic write failure after the first event. Never fill a real disk.
    db.exec(`
      CREATE TRIGGER pulse_write_fault BEFORE INSERT ON pulse_intervals
      WHEN NEW.eventId='second'
      BEGIN SELECT RAISE(ABORT, 'injected storage write failure'); END;
    `);
    const send = () =>
      context.app.inject({
        method: "POST",
        url: "/api/listening-events",
        headers,
        payload: { historyGeneration: generation, events },
      });
    const failed = await send();
    expect(failed.statusCode, failed.body).toBe(500);
    expect(failed.json()).not.toHaveProperty("acknowledgements");
    for (const table of [
      "pulse_intervals",
      "pulse_albums",
      "pulse_album_aliases",
      "pulse_days",
      "pulse_day_albums",
      "pulse_day_visits",
      "pulse_album_stats",
    ])
      expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({
        n: 0,
      });
    db.exec("DROP TRIGGER pulse_write_fault");
    const accepted = await send();
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().acknowledgements).toHaveLength(2);
    const retried = await send();
    expect(retried.statusCode, retried.body).toBe(200);
    expect(
      catalog.pulse.albumStats(accepted.json().acknowledgements[0].albumId),
    ).toMatchObject({ playedMs: 30000, sameDayReturns: 0 });
    expect(db.prepare("SELECT count(*) n FROM pulse_intervals").get()).toEqual({
      n: 2,
    });
  } finally {
    catalog.close();
    await context.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
