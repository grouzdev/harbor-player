import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  captureListening,
  finishListening,
  preparePulseAudio,
  progressAudio,
  startAudio,
} from "./pulse-audio-helpers";

for (const rate of [0.5, 1, 2]) {
  test(`real audio counts elapsed listening time at ${rate}x`, async ({
    page,
  }, info) => {
    await preparePulseAudio(page, info);
    const ledger = await captureListening(page);
    await page.locator("audio").evaluate((audio: HTMLAudioElement, speed) => {
      audio.defaultPlaybackRate = speed;
      audio.playbackRate = speed;
      const observation = { started: 0, elapsed: 0, position: 0 };
      Object.assign(window, { pulseAudioObservation: observation });
      audio.addEventListener("playing", () => {
        observation.started = performance.now();
      });
      audio.addEventListener("pause", () => {
        observation.elapsed = performance.now() - observation.started;
        observation.position = audio.currentTime;
      });
    }, rate);
    await startAudio(page);
    await progressAudio(page, rate * 2);
    const { total } = await finishListening(page, ledger);
    const observed = await page.evaluate(
      () =>
        (
          window as unknown as {
            pulseAudioObservation: { elapsed: number; position: number };
          }
        ).pulseAudioObservation,
    );
    expect(Math.abs(total - observed.elapsed)).toBeLessThan(300);
    expect(Math.abs(total - (observed.position * 1000) / rate)).toBeLessThan(
      300,
    );
  });
}

test("real seek, pause and repeat-one preserve one visit without counting skipped audio", async ({
  page,
}, info) => {
  await preparePulseAudio(page, info, 8);
  const ledger = await captureListening(page);
  await page.getByRole("button", { name: "Повтор: выключен" }).click();
  await page.getByRole("button", { name: "Повтор: вся очередь" }).click();
  await startAudio(page);
  await progressAudio(page, 0.5);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 6;
  });
  await progressAudio(page, 0.5);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 1;
  });
  await progressAudio(page, 0.5);
  await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.pause());
  const pausedAt = await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  // Hold a real pause; do not replace the recorder's clocks during live audio.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(
    await page
      .locator("audio")
      .evaluate((audio: HTMLAudioElement) => audio.currentTime),
  ).toBe(pausedAt);
  await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.play());
  await progressAudio(page, 0.5);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 7.5;
  });
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeLessThan(2);
  await progressAudio(page, 0.5);
  const { events, total } = await finishListening(page, ledger);
  expect(new Set(events.map((event) => event.visitId)).size).toBe(1);
  expect(new Set(events.map((event) => event.sessionId)).size).toBe(1);
  expect(events.length).toBeGreaterThanOrEqual(4);
  expect(total).toBeGreaterThan(2000);
  expect(total).toBeLessThan(8000);
});

test("moving the playing file replaces audio source and preserves historical identity", async ({
  page,
}, info) => {
  const fixture = await preparePulseAudio(page, info);
  const ledger = await captureListening(page);
  const target = path.join(
    fixture.source,
    "..",
    `target-${fixture.library.id}`,
  );
  await mkdir(target);
  const added = await page.request.post("/api/libraries", {
    headers: fixture.headers,
    data: { name: `Target ${fixture.library.id}`, path: target },
  });
  expect(added.ok()).toBe(true);
  const targetId = (await added.json()).library.id;
  await startAudio(page);
  await progressAudio(page, 1);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    const sourceEvents: string[] = [];
    Object.assign(window, { pulseSourceEvents: sourceEvents });
    for (const event of ["pause", "emptied", "playing"])
      audio.addEventListener(event, () => sourceEvents.push(event));
  });
  const preview = await page.request.post("/api/operations/preview", {
    headers: fixture.headers,
    data: {
      kind: "move",
      selection: { trackIds: [fixture.track.id] },
      targetLibraryId: targetId,
      companions: false,
    },
  });
  expect(preview.ok(), await preview.text()).toBe(true);
  const operation = await preview.json();
  const execute = await page.request.post(
    `/api/operations/${operation.id}/execute`,
    {
      headers: fixture.headers,
    },
  );
  expect(execute.ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/tracks/${fixture.track.id}`)
          ).json()
        ).libraryId,
    )
    .toBe(targetId);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { pulseSourceEvents: string[] })
            .pulseSourceEvents,
      ),
    )
    .toEqual(expect.arrayContaining(["emptied", "playing"]));
  await progressAudio(page, 1);
  const { events } = await finishListening(page, ledger);
  expect(events.length).toBeGreaterThanOrEqual(2);
  expect(new Set(events.map((event) => event.trackId))).toEqual(
    new Set([fixture.track.id]),
  );
  expect(new Set(events.map((event) => event.visitId)).size).toBe(1);
  expect(ledger.albums.size).toBe(1);
});

test("renderer freeze and background playback count only confirmed media progression", async ({
  page,
  context,
}, info) => {
  await preparePulseAudio(page, info);
  const ledger = await captureListening(page);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    const samples: object[] = [];
    Object.assign(window, { pulseFreezeSamples: samples });
    for (const name of [
      "playing",
      "pause",
      "waiting",
      "timeupdate",
      "seeking",
      "seeked",
    ])
      audio.addEventListener(name, () =>
        samples.push({
          name,
          position: audio.currentTime,
          time: performance.now(),
          paused: audio.paused,
          readyState: audio.readyState,
        }),
      );
  });
  await startAudio(page);
  await progressAudio(page, 1);
  const cdp = await context.newCDPSession(page);
  const before = await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => ({
      position: audio.currentTime,
      time: performance.now(),
    }));
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  // Driver timer, not a timer in the frozen renderer. This is not OS sleep.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  const after = await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => ({
      position: audio.currentTime,
      time: performance.now(),
    }));
  await cdp.detach();
  await progressAudio(page, 1);
  const finalPosition = await page
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.currentTime);
  const { total, events } = await finishListening(page, ledger);
  const samples = await page.evaluate(
    () =>
      (window as unknown as { pulseFreezeSamples: object[] })
        .pulseFreezeSamples,
  );
  await info.attach("renderer-freeze-observation", {
    contentType: "application/json",
    body: JSON.stringify({
      before,
      after,
      finalPosition,
      total,
      events,
      samples,
    }),
  });
  const progressed = (after.position - before.position) * 1000;
  expect(progressed).toBeGreaterThanOrEqual(0);
  // At 1x without seek, media progression is an independent time oracle.
  expect(Math.abs(total - finalPosition * 1000)).toBeLessThan(350);
});

test("real media error closes the interval and recovery does not count the unavailable period", async ({
  page,
}, info) => {
  const fixture = await preparePulseAudio(page, info);
  const ledger = await captureListening(page);
  await startAudio(page);
  await progressAudio(page, 1);
  const sourceUrl = await page.locator("audio").getAttribute("src");
  const original = path.join(fixture.source, "Listening.wav");
  const held = `${original}.unavailable`;
  await rename(original, held);
  try {
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
      audio.src = `${audio.getAttribute("src")}&pulse-error=${crypto.randomUUID()}`;
      audio.load();
    });
    await expect
      .poll(() =>
        page
          .locator("audio")
          .evaluate((audio: HTMLAudioElement) => audio.error !== null),
      )
      .toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(
      await page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    ).toBe(0);
  } finally {
    await rename(held, original);
  }
  await page
    .locator("audio")
    .evaluate(async (audio: HTMLAudioElement, source) => {
      audio.src = source!;
      audio.load();
      await audio.play();
    }, sourceUrl);
  await progressAudio(page, 1);
  const { events, total } = await finishListening(page, ledger);
  expect(events.length).toBeGreaterThanOrEqual(2);
  expect(new Set(events.map((event) => event.visitId)).size).toBe(1);
  expect(total).toBeGreaterThan(2000);
  expect(total).toBeLessThan(6000);
});

test("historical album title and time remain visible when both cover copies are missing", async ({
  page,
}, info) => {
  const fixture = await preparePulseAudio(page, info, 60, true);
  expect(fixture.track.coverId).not.toBeNull();
  const settings = await (await page.request.get("/api/pulse/settings")).json();
  const cleared = await page.request.post("/api/pulse/clear", {
    headers: fixture.headers,
    data: { confirm: true, historyGeneration: settings.historyGeneration },
  });
  expect(cleared.ok()).toBe(true);
  const ledger = await captureListening(page);
  await startAudio(page);
  await progressAudio(page, 1);
  const { total } = await finishListening(page, ledger);
  const albumId = [...ledger.albums][0];
  const files = ["covers", "pulse-covers"].map((folder) =>
    path.resolve(".test-data/browser/data", folder, fixture.track.coverId!),
  );
  const moved: string[] = [];
  try {
    for (const file of files) {
      await rename(file, `${file}.unavailable`);
      moved.push(file);
    }
    const image = await page.request.get(
      `/api/covers/${fixture.track.coverId}`,
    );
    expect(image.status()).toBe(404);
    await page
      .getByRole("button", { name: "Открыть Пульс", exact: true })
      .click();
    await expect(page.locator(".pulse-album")).toHaveCount(1);
    await page.locator(".pulse-album").click();
    await expect(page.locator(".pulse-copy")).toContainText(
      fixture.track.albumTitle,
    );
    await expect(page.locator(".pulse-stat-numbers")).toBeVisible();
    const stats = await (
      await page.request.get(`/api/pulse/albums/${albumId}/stats`)
    ).json();
    expect(stats.playedMs).toBe(total);
    await expect(page.locator(".pulse-album img")).toHaveCSS(
      "visibility",
      "hidden",
    );
  } finally {
    for (const file of moved) await rename(`${file}.unavailable`, file);
  }
});
