import { expect, it } from "vitest";
import { chromium } from "@playwright/test";
import { uiBenchmarkOptions } from "../scripts/pulse-ui-options.mjs";
import {
  mutationKinds,
  verifyMutationCohort,
} from "../scripts/pulse-ui-mutations.mjs";
import { installUiProbe } from "../scripts/pulse-ui-evidence.mjs";

function cohort() {
  const manifests = ["ordinary", "ten-year"].map((dataset) => ({
    dataset,
    runRoot: dataset,
    sentinel: `${dataset}-sentinel`,
    from: dataset === "ordinary" ? "2026-01-01" : "2016-01-01",
    to: "2026-01-05",
    busyCount: dataset === "ordinary" ? 6 : 1000,
    historyDays: dataset === "ordinary" ? 3 : 1200,
  }));
  const samples = manifests.flatMap((manifest) => {
    const { from, to, busyCount, historyDays } = manifest;
    const base = {
      chainId: manifest.runRoot,
      sentinel: manifest.sentinel,
      baselineVerified: true,
      seed: { from, to, busyCount, historyDays },
      generationBefore: 1,
    };
    return mutationKinds.map((kind, i) => ({
      dataset: manifest.dataset,
      kind,
      dataReady: 10,
      coversReady: 20,
      http: [] as { endpoint: string; query: string }[],
      fixture: { empty: i === 1 },
      mutation: {
        ...base,
        generationAfter: i === 0 ? 1 : 2,
        historyState: [
          "seeded-plus-event",
          "empty-after-clear",
          "single-recovered-album",
        ][i],
        eventId: `${manifest.dataset}-${i}`,
        previousAlbumId: "old",
        before: { playedMs: 60000, dayTotalMs: 1000000 },
        after:
          i === 0
            ? { playedMs: 150000, dayTotalMs: 1090000 }
            : {
                albumId: "new",
                playedMs: 90000,
                dayPlayedMs: 90000,
                dayTotalMs: 90000,
                dayCount: 1,
                sameDayReturns: 0,
              },
        range: { firstDay: null, lastDay: null },
      },
    }));
  });
  return { manifests, samples };
}

it("budgets thirty independent fixtures per dataset and keeps smoke separate", () => {
  expect(uiBenchmarkOptions(["--mutations-only"])).toMatchObject({
    launches: 30,
    retainedCopies: 60,
    mutationsOnly: true,
    coldScenario: "ready-panels",
  });
  expect(uiBenchmarkOptions(["--mutations-only", "--smoke"])).toMatchObject({
    launches: 1,
    retainedCopies: 2,
    smoke: true,
  });
  for (const conflicting of [
    "--latency-only",
    "--diagnostic",
    "--cold=ready-panels",
  ])
    expect(() =>
      uiBenchmarkOptions(["--mutations-only", conflicting]),
    ).toThrow();
});

it("validates separate seed/empty/recovery states without claiming enough smoke samples", () => {
  const { samples, manifests } = cohort();
  const groups = verifyMutationCohort(samples, manifests, 1);
  expect(Object.keys(groups)).toHaveLength(6);
  expect(groups["ten-year/warm-after-clear-recovery"]).toEqual({
    count: 1,
    independentFixtures: 1,
    sampleCountSufficient: false,
  });
});

it.each(["repeat", "generation", "event", "seed", "page", "recovery"])(
  "rejects misleading mutation evidence: %s",
  (fault) => {
    const { samples, manifests } = cohort();
    if (fault === "repeat") samples.push(samples[0]);
    if (fault === "generation") samples[1].mutation.generationAfter = 1;
    if (fault === "event")
      samples[2].mutation.eventId = samples[0].mutation.eventId;
    if (fault === "seed") samples[3].mutation.seed.busyCount = 1;
    if (fault === "page")
      samples[0].http.push({
        endpoint: "/api/pulse/days/a/albums",
        query: "?limit=101",
      });
    if (fault === "recovery") samples[2].mutation.after.playedMs = 60000;
    expect(() => verifyMutationCohort(samples, manifests, 1)).toThrow();
  },
);

it("does not mark a stable old selection/statistics ready for a mutation", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div class="workspace"></div><button class="pulse-mode-toggle">Pulse</button>',
    );
    await page.evaluate(installUiProbe);
    await page.evaluate(() => {
      const state = window as typeof window & { __pulseUiProbe: any };
      state.__pulseUiProbe.expected = {
        selection: {
          albumId: "new",
          title: "New selection",
          day: "2026-01-05",
          stats: ["2 мин", "1", "0"],
        },
      };
      document.querySelector("button")!.addEventListener("click", () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<section class="pulse-mode">
            <div class="pulse-rail"><div data-day="2026-01-05"><button class="pulse-album" data-album-id="new" aria-pressed="true">Album</button></div></div>
            <div class="pulse-copy"><h2>Old selection</h2></div>
            <div class="pulse-stat-numbers"><strong>3 мин</strong><strong>1</strong><strong>1</strong></div>
            <div class="pulse-history-range"><input aria-valuetext="2026-01-01"></div>
          </section>`,
        );
      });
    });
    await page.click("button.pulse-mode-toggle");
    const readyAfterFrames = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
        return (window as typeof window & { __pulseUiProbe: any })
          .__pulseUiProbe.sample.coversReady;
      });
    expect(await readyAfterFrames()).toBeNull();
    await page.locator(".pulse-copy h2").evaluate((el) => {
      el.textContent = "New selection";
    });
    expect(await readyAfterFrames()).toBeNull();
    await page.locator(".pulse-stat-numbers").evaluate((el) => {
      el.innerHTML =
        "<strong>2 мин</strong><strong>1</strong><strong>0</strong>";
    });
    expect(await readyAfterFrames()).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});
