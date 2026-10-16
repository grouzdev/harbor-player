// Bulk read/UI fixture, NOT evidence of ingestion. Only caller-owned fresh roots.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Catalog } from "../dist/server/database.js";
import {
  assertArtworkRoot,
  seedPermittedArtwork,
} from "./pulse-artwork-fixture.mjs";

export async function seedUiDataset(root, dataset, artworkOptions = {}) {
  assert(["ordinary", "ten-year"].includes(dataset));
  await assertArtworkRoot(root);
  const relative = path.relative(
    path.resolve(".test-data"),
    path.resolve(root),
  );
  assert(
    !path.isAbsolute(relative) &&
      !relative.startsWith("..") &&
      relative.startsWith("pulse-p1-ui-"),
    "UI seed must stay in its owned disposable root",
  );
  const catalog = new Catalog(root);
  const db = catalog.db;
  try {
    assert.equal(db.prepare("SELECT count(*) n FROM pulse_days").get().n, 0);
    catalog.pulse.updateSettings({ enabled: true, timeZone: "UTC" });
    // Explicit anchor makes a retained manifest reproducible without fake clocks.
    const to =
      process.env.HARBOR_PLAYER_UI_SEED_DATE ||
      new Date().toISOString().slice(0, 10);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(to));
    const first = new Date(`${to}T00:00:00Z`);
    if (dataset === "ordinary") first.setUTCDate(first.getUTCDate() - 4);
    else {
      first.setUTCFullYear(first.getUTCFullYear() - 10);
      first.setUTCDate(first.getUTCDate() + 1);
    }
    const from = first.toISOString().slice(0, 10);
    const busyCount = dataset === "ordinary" ? 6 : 1000;
    const sentinel = randomUUID();
    const title = (i) => `Disposable album ${i} ${sentinel}`;
    const covers = [];
    await mkdir(path.join(root, "pulse-covers"), { recursive: true });
    for (const size of [80, 512, 1600, 0]) {
      const bytes = size
        ? await sharp({
            create: {
              width: size,
              height: size,
              channels: 3,
              background: { r: 40, g: 100, b: 160 },
            },
          })
            .png()
            .toBuffer()
        : Buffer.from("deliberately corrupt UI fixture");
      const id = `${createHash("sha256").update(bytes).digest("hex")}.png`;
      await writeFile(path.join(root, "pulse-covers", id), bytes, {
        flag: "wx",
      });
      covers.push({
        id,
        size,
        bytes: bytes.length,
        status: size ? "valid-synthetic" : "corrupt",
      });
    }
    const artwork = await seedPermittedArtwork(root, undefined, artworkOptions);
    covers.push(...artwork.files);
    const coverCycle = [...covers.slice(0, 4), null, ...artwork.files];
    const coverCounts = { missing: 0, valid: 0, corrupt: 0 };
    db.transaction(() => {
      const album = db.prepare("INSERT INTO pulse_albums VALUES (?,?)");
      const alias = db.prepare("INSERT INTO pulse_album_aliases VALUES (?,?)");
      const dayAlbum = db.prepare(
        "INSERT INTO pulse_day_albums VALUES (?,?,?,?,?,?)",
      );
      for (let i = 0; i < busyCount; i++) {
        const id = `pulse-ui-${i}`;
        const cover = coverCycle[i % coverCycle.length];
        coverCounts[
          !cover ? "missing" : cover.status === "corrupt" ? "corrupt" : "valid"
        ]++;
        album.run(
          id,
          JSON.stringify({
            title: title(i),
            artists: ["Pulse UI fixture"],
            year: 2024,
            coverId: cover?.id ?? null,
          }),
        );
        alias.run(id, id);
        const timestamp = Date.parse(`${to}T00:00:00Z`) + i * 1000;
        dayAlbum.run(to, id, 60000 + i, timestamp, timestamp + 60000 + i, 1);
      }
      const start = Date.parse(`${from}T00:00:00Z`);
      const end = Date.parse(`${to}T00:00:00Z`);
      for (let t = start, i = 0; t < end; t += 86400000, i++) {
        if (i % 3 === 0 || t === start)
          dayAlbum.run(
            new Date(t).toISOString().slice(0, 10),
            "pulse-ui-0",
            180000,
            t,
            t + 180000,
            1,
          );
      }
      db.exec(`
        INSERT INTO pulse_days SELECT dayKey,SUM(playedMs),COUNT(*),MAX(playedMs) FROM pulse_day_albums GROUP BY dayKey;
        INSERT INTO pulse_album_stats SELECT albumId,SUM(playedMs),COUNT(*),SUM(visitCount-1),MIN(firstPlayedAtUtc),MAX(lastPlayedAtUtc) FROM pulse_day_albums GROUP BY albumId;
        ANALYZE;
      `);
    })();
    db.pragma("wal_checkpoint(TRUNCATE)");
    return {
      version: 1,
      dataset,
      from,
      to,
      busyDay: to,
      busyCount,
      sentinel,
      representatives: [0, Math.floor(busyCount / 2), busyCount - 1].map(
        (rank) => ({
          rank,
          albumId: `pulse-ui-${rank}`,
          title: title(rank),
          playedMs: 60000 + rank,
        }),
      ),
      historyDays:
        Math.ceil((Date.parse(to) - Date.parse(from)) / 86400000 / 3) + 1,
      busyTotalMs: busyCount * 60000 + (busyCount * (busyCount - 1)) / 2,
      covers: { ...coverCounts, files: covers, artwork },
      note:
        artwork.mode === "generated-only"
          ? "Deterministic aggregate-only fixture, generated solid-color PNGs; real artwork transfer/decode requires a separate permitted-image run."
          : "Aggregate-only fixture with explicitly permitted local files; sharp decode is not browser decode or actual recorder evidence.",
    };
  } finally {
    catalog.close();
  }
}
