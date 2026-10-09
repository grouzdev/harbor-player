import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, type Page, type TestInfo } from "@playwright/test";
import type { PulseEvent } from "../../src/shared/pulse";
import type { Track } from "../../src/shared/contracts";

export async function preparePulseAudio(
  page: Page,
  info: TestInfo,
  seconds = 60,
  withCover = false,
) {
  const name = `Pulse timing ${randomUUID()}`;
  const source = path.resolve(".test-data/browser", info.project.name, name);
  await mkdir(source, { recursive: true });
  const samples = seconds * 8000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / 8000) * 1600),
      44 + i * 2,
    );
  // A real RIFF INFO album tag makes title preservation independently testable.
  const title = Buffer.from(`${name}\0`, "utf8");
  const metadata = Buffer.alloc(20 + title.length + (title.length % 2));
  metadata.write("LIST", 0);
  metadata.writeUInt32LE(metadata.length - 8, 4);
  metadata.write("INFOIPRD", 8);
  metadata.writeUInt32LE(title.length, 16);
  title.copy(metadata, 20);
  wav.writeUInt32LE(wav.length + metadata.length - 8, 4);
  await writeFile(
    path.join(source, "Listening.wav"),
    Buffer.concat([wav, metadata]),
  );
  if (withCover)
    await copyFile(
      path.resolve(".fixtures/cover.png"),
      path.join(source, "cover.png"),
    );
  const session = await (await page.request.get("/api/session")).json();
  const headers = { "X-CSRF-Token": session.csrf };
  const current = await (await page.request.get("/api/pulse/settings")).json();
  const initialized = await page.request.patch("/api/pulse/settings", {
    headers,
    data: {
      enabled: true,
      ...(current.timeZone === null ? { timeZone: "UTC" } : {}),
    },
  });
  expect(initialized.ok()).toBe(true);
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(source);
  await page.getByLabel("Название библиотеки", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: name })
    .locator(".list-tile-main")
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  const libraries = (await (
    await page.request.get("/api/libraries")
  ).json()) as {
    id: string;
    path: string;
  }[];
  const library = libraries.find((item) => path.resolve(item.path) === source)!;
  const filter = new URLSearchParams({
    filter: JSON.stringify({ libraryIds: [library.id] }),
  });
  const tracks = await (await page.request.get(`/api/tracks?${filter}`)).json();
  expect(tracks.items[0].albumTitle).toBe(name);
  return { source, library, track: tracks.items[0] as Track, headers };
}

export async function captureListening(page: Page) {
  const latest = new Map<string, PulseEvent>();
  const albums = new Set<string>();
  await page.route("**/api/listening-events", async (route) => {
    const response = await route.fetch();
    if (response.ok()) {
      const body = route.request().postDataJSON() as { events: PulseEvent[] };
      for (const event of body.events)
        if ((latest.get(event.eventId)?.revision ?? 0) < event.revision)
          latest.set(event.eventId, event);
      const result = await response.json();
      for (const ack of result.acknowledgements) albums.add(ack.albumId);
    }
    await route.fulfill({ response });
  });
  return { latest, albums };
}

export async function startAudio(page: Page) {
  await page.getByTestId("track-row").dblclick();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.3);
}

export async function progressAudio(page: Page, seconds: number) {
  const before = await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(before + seconds);
}

export async function finishListening(
  page: Page,
  ledger: Awaited<ReturnType<typeof captureListening>>,
) {
  await page.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
    if (audio.paused) return;
    await new Promise<void>((resolve) => {
      audio.addEventListener("pause", () => resolve(), { once: true });
      audio.pause();
    });
  });
  // A prior final revision may already be ACKed while the last section is still
  // pending. Wait for actual local durability/delivery, not just an older final.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("harbor-player-pulse", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise<number>((resolve, reject) => {
              const tx = db.transaction("events");
              const request = tx.objectStore("events").count();
              tx.oncomplete = () => resolve(request.result);
              tx.onabort = tx.onerror = () => reject(tx.error);
            });
          } finally {
            db.close();
          }
        }),
      { timeout: 10_000 },
    )
    .toBe(0);
  await expect
    .poll(
      () =>
        ledger.latest.size > 0 &&
        [...ledger.latest.values()].every((event) => event.final),
      { timeout: 10_000 },
    )
    .toBe(true);
  const events = [...ledger.latest.values()];
  const total = events.reduce((sum, event) => sum + event.playedMs, 0);
  let statsTotal = 0;
  for (const album of ledger.albums) {
    const response = await page.request.get(`/api/pulse/albums/${album}/stats`);
    expect(response.ok()).toBe(true);
    statsTotal += (await response.json()).playedMs;
  }
  expect(statsTotal).toBe(total);
  // Scope SQL checks to these intervals/albums, not history made by earlier tests.
  const db = new Database(
    path.resolve(".test-data/browser/data/catalog.sqlite"),
    {
      readonly: true,
      fileMustExist: true,
    },
  );
  try {
    const ids = events.map((event) => event.eventId);
    expect(
      db
        .prepare(
          `SELECT sum(json_extract(payload,'$.playedMs')) total FROM pulse_intervals WHERE eventId IN (${ids.map(() => "?").join(",")})`,
        )
        .get(...ids),
    ).toEqual({ total });
    const albumIds = [...ledger.albums];
    expect(
      db
        .prepare(
          `SELECT sum(playedMs) total FROM pulse_day_albums WHERE albumId IN (${albumIds.map(() => "?").join(",")})`,
        )
        .get(...albumIds),
    ).toEqual({ total });
  } finally {
    db.close();
  }
  return { events, total };
}
