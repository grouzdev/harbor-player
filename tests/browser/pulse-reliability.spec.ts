import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function initializeCollection(page: Page) {
  const session = await (await page.request.get("/api/session")).json();
  const current = await (await page.request.get("/api/pulse/settings")).json();
  const response = await page.request.patch("/api/pulse/settings", {
    headers: { "X-CSRF-Token": session.csrf },
    data: {
      enabled: true,
      ...(current.timeZone === null ? { timeZone: "UTC" } : {}),
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).historyGeneration as number;
}

async function seedPending(page: Page, historyGeneration: number) {
  const identity = randomUUID();
  const event = {
    eventId: identity,
    revision: 1,
    historyGeneration,
    sessionId: identity,
    visitId: identity,
    track: {
      id: identity,
      albumKey: identity,
      albumTitle: `Pending ${identity}`,
      artists: ["Pending artist"],
      albumArtists: ["Pending artist"],
      coverId: null,
      year: 2026,
    },
    startedAt: Date.parse("2026-03-07T12:00:00Z"),
    endedAt: Date.parse("2026-03-07T12:00:15Z"),
    playedMs: 15000,
    final: false,
  };
  await page.evaluate(async (pending) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("harbor-player-pulse", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("events", { keyPath: "eventId" });
        request.result.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["events", "meta"], "readwrite");
      tx.objectStore("meta").put(pending.historyGeneration, "generation");
      tx.objectStore("events").put(pending);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, event);
  return event;
}

async function pendingCount(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("harbor-player-pulse", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("events", { keyPath: "eventId" });
        request.result.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction("events");
      const request = tx.objectStore("events").count();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    db.close();
    return count;
  });
}

test("idle player with empty outbox makes no listening requests across flush ticks", async ({
  page,
}) => {
  await page.clock.install();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(pulse\/settings|listening-events)(?:\?|$)/.test(request.url()))
      requests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator("audio")).toHaveCount(1);
  await expect.poll(() => pendingCount(page)).toBe(0);
  await page.clock.runFor(16_000);
  expect(requests).toEqual([]);
  expect(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
});

test("restart delivers a durable checkpoint while paused and retry after lost ACK counts once", async ({
  page,
}) => {
  const generation = await initializeCollection(page);
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect.poll(() => pendingCount(page)).toBe(0);
  const event = await seedPending(page, generation);
  let committedAlbum = "";
  let attempts = 0;
  await page.route("**/api/listening-events", async (route) => {
    attempts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const result = await response.json();
    committedAlbum = result.acknowledgements[0].albumId;
    if (attempts === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page.reload();
  await expect.poll(() => committedAlbum).not.toBe("");
  await expect.poll(() => pendingCount(page)).toBe(1);
  const firstStats = await (
    await page.request.get(`/api/pulse/albums/${committedAlbum}/stats`)
  ).json();
  expect(firstStats.playedMs).toBe(event.playedMs);
  await page.clock.runFor(6000);
  await expect.poll(() => pendingCount(page)).toBe(0);
  expect(attempts).toBe(2);
  const finalStats = await (
    await page.request.get(`/api/pulse/albums/${committedAlbum}/stats`)
  ).json();
  expect(finalStats.playedMs).toBe(event.playedMs);
  expect(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true);
});

test("IndexedDB open error is visible and clears after storage recovers while idle", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    let failed = true;
    Object.defineProperty(window, "restorePulseStorage", {
      value: () => {
        failed = false;
      },
    });
    IDBFactory.prototype.open = function (...args) {
      if (failed && args[0] === "harbor-player-pulse")
        throw new DOMException("storage unavailable", "SecurityError");
      return original.apply(this, args);
    };
  });
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-mode")).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.locator(".pulse-settings-error").first()).toContainText(
    "Не удалось сохранить или отправить историю",
  );
  await page.evaluate(() => {
    (
      window as unknown as { restorePulseStorage(): void }
    ).restorePulseStorage();
  });
  await page.clock.runFor(5000);
  await expect(page.locator(".pulse-settings-error")).toHaveCount(0);
  await expect.poll(() => pendingCount(page)).toBe(0);
});

for (const order of ["ingest-before-clear", "clear-before-ingest"] as const) {
  test(`settings change queued during POST is refreshed: ${order}`, async ({
    page,
  }) => {
    const generation = await initializeCollection(page);
    await page.goto("/");
    await expect(page.locator(".workspace")).toBeVisible();
    await expect.poll(() => pendingCount(page)).toBe(0);
    await seedPending(page, generation);
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => (entered = resolve));
    await page.route("**/api/listening-events", async (route) => {
      const response =
        order === "ingest-before-clear" ? await route.fetch() : null;
      entered!();
      await barrier;
      const completed = response ?? (await route.fetch());
      expect(completed.status()).toBe(
        order === "ingest-before-clear" ? 200 : 409,
      );
      await route.fulfill({ response: completed });
    });
    await page.reload();
    await started;
    let refreshedAfterPost = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/pulse/settings")) refreshedAfterPost++;
    });
    const session = await (await page.request.get("/api/session")).json();
    const headers = { "X-CSRF-Token": session.csrf };
    const cleared = await page.request.post("/api/pulse/clear", {
      headers,
      data: { confirm: true, historyGeneration: generation },
    });
    expect(cleared.ok()).toBe(true);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("harbor-pulse-settings-changed")),
    );
    release!();
    await expect.poll(() => refreshedAfterPost).toBeGreaterThan(0);
    await expect.poll(() => pendingCount(page)).toBe(0);
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/pulse/history-range")).json())
            .firstDay,
      )
      .toBeNull();
  });
}

test("settings broadcast refreshes another paused window with empty outbox", async ({
  page,
  context,
}) => {
  const generation = await initializeCollection(page);
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator(".workspace")).toBeVisible();
  await expect.poll(() => pendingCount(other)).toBe(0);
  let settingsReads = 0;
  other.on("request", (request) => {
    if (request.url().endsWith("/api/pulse/settings")) settingsReads++;
  });
  const session = await (await page.request.get("/api/session")).json();
  const cleared = await page.request.post("/api/pulse/clear", {
    headers: { "X-CSRF-Token": session.csrf },
    data: { confirm: true, historyGeneration: generation },
  });
  expect(cleared.ok()).toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("harbor-pulse-settings-changed")),
  );
  await expect.poll(() => settingsReads).toBeGreaterThan(0);
  await expect.poll(() => pendingCount(other)).toBe(0);
  await other.close();
});

test("real audio retries an offline checkpoint and excludes disabled playback after re-enable", async ({
  page,
}, info) => {
  const generation = await initializeCollection(page);
  const source = path.resolve(
    ".test-data/browser",
    info.project.name,
    `pulse-reliability-${randomUUID()}`,
  );
  await mkdir(source, { recursive: true });
  // A long local WAV exercises a real checkpoint, not a stream of short finals.
  const samples = 40 * 8000;
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
  await writeFile(path.join(source, "Listening.wav"), wav);
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
  await page.locator(".add-library").click();
  await page.getByLabel("Путь к папке", { exact: true }).fill(source);
  const name = `Reliability audio ${info.project.name}`;
  await page.getByLabel("Название библиотеки", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".libraries-panel .list-tile")
    .filter({ hasText: name })
    .locator(".list-tile-main")
    .click();
  await expect(page.getByTestId("track-row")).toHaveCount(1);
  let offline = true;
  let albumId = "";
  const sent: {
    eventId: string;
    revision: number;
    generation: number;
    startedAtUtc: number;
    endedAtUtc: number;
    playedMs: number;
  }[] = [];
  await page.route("**/api/listening-events", async (route) => {
    if (offline) {
      await route.abort("failed");
      return;
    }
    const body = route.request().postDataJSON();
    const response = await route.fetch();
    if (response.ok()) {
      sent.push(
        ...body.events.map((event: (typeof sent)[number]) => ({
          ...event,
          generation: body.historyGeneration,
        })),
      );
      albumId = (await response.json()).acknowledgements[0].albumId;
    }
    await route.fulfill({ response });
  });
  await page.getByTestId("track-row").dblclick();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0.3);
  await expect
    .poll(() => pendingCount(page), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Открыть Пульс", exact: true })
    .click();
  await expect(page.locator(".pulse-settings-error").first()).toBeVisible();
  offline = false;
  await expect.poll(() => albumId, { timeout: 10_000 }).not.toBe("");
  await expect(page.locator(".pulse-settings-error")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Настройки истории прослушивания" })
    .click();
  const dialog = page.getByRole("dialog", { name: "История прослушивания" });
  const collection = dialog.getByRole("checkbox", {
    name: "Сохранять историю прослушивания на этом устройстве",
  });
  await collection.uncheck();
  await expect(collection).not.toBeChecked();
  const confirmedBeforeDisabled = (
    await (await page.request.get(`/api/pulse/albums/${albumId}/stats`)).json()
  ).playedMs;
  const beforeDisabled = await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await expect
    .poll(
      () =>
        page
          .locator("audio")
          .evaluate((audio: HTMLAudioElement) => audio.currentTime),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(beforeDisabled + 3);
  expect(
    (
      await (
        await page.request.get(`/api/pulse/albums/${albumId}/stats`)
      ).json()
    ).playedMs,
  ).toBe(confirmedBeforeDisabled);
  const enabledAt = await page.evaluate(() => Date.now());
  await collection.check();
  await expect(collection).toBeChecked();
  const current = await (await page.request.get("/api/pulse/settings")).json();
  expect(current.historyGeneration).toBe(generation + 1);
  const resumed = await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(resumed + 1);
  await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.pause());
  await expect.poll(() => pendingCount(page), { timeout: 10_000 }).toBe(0);
  const after = sent.filter(
    (event) => event.generation === current.historyGeneration,
  );
  expect(after.length).toBeGreaterThan(0);
  for (const event of after) {
    expect(event.startedAtUtc).toBeGreaterThanOrEqual(enabledAt);
    expect(event.playedMs).toBeLessThanOrEqual(
      event.endedAtUtc - event.startedAtUtc,
    );
  }
  const stats = await (
    await page.request.get(`/api/pulse/albums/${albumId}/stats`)
  ).json();
  const latest = new Map<string, (typeof sent)[number]>();
  for (const event of sent)
    if ((latest.get(event.eventId)?.revision ?? 0) < event.revision)
      latest.set(event.eventId, event);
  expect(stats.playedMs).toBe(
    [...latest.values()].reduce((total, event) => total + event.playedMs, 0),
  );
});
