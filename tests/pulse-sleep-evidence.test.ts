import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  checkPhase,
  checkPowerCycle,
} from "../scripts/pulse-sleep-evidence.mjs";

const snapshot = (raw: number) => ({
  raw,
  days: raw,
  dayAlbums: raw,
  albumStats: raw,
  generation: 1,
  events: raw
    ? [
        {
          eventId: "one",
          revision: 1,
          playedMs: raw,
          sessionId: "session",
          visitId: "visit",
        },
      ]
    : [],
});
const sample = (
  name: string,
  mono: number,
  position: number,
  paused = false,
) => ({
  name,
  mono,
  wall: mono,
  position,
  paused,
  readyState: 4,
  rate: 1,
});
const power = [
  { name: "suspend", wall: 2000, source: "electron.powerMonitor" },
  { name: "resume", wall: 62000, source: "electron.powerMonitor" },
];
const samples = [
  sample("playing", 0, 0),
  sample("timeupdate", 1900, 1.9),
  sample("timeupdate", 62100, 2.1),
  sample("pause", 64000, 4, true),
];

describe("physical sleep evidence calculations (synthetic data, not an OS test)", () => {
  it("excludes a stopped decoder's sleep gap", () => {
    expect(
      checkPhase({
        before: snapshot(0),
        after: snapshot(4000),
        samples,
        power,
      }).differenceMs,
    ).toBeCloseTo(0);
  });
  it("keeps confirmed Modern Standby progression", () => {
    const continued = samples.map((item) =>
      item.mono >= 62000 ? { ...item, position: item.position + 60 } : item,
    );
    expect(
      checkPhase({
        before: snapshot(0),
        after: snapshot(64000),
        samples: continued,
        power,
      }).differenceMs,
    ).toBeCloseTo(0);
  });
  it("rejects counting the entire suspended gap without progression", () => {
    expect(() =>
      checkPhase({
        before: snapshot(0),
        after: snapshot(64000),
        samples,
        power,
      }),
    ).toThrow("fixed 1s");
  });
  it("requires exactly unchanged sums and events while paused", () => {
    expect(
      checkPhase({
        before: snapshot(4000),
        after: snapshot(4000),
        samples: [sample("boundary", 0, 4, true)],
        paused: true,
      }).deltaMs,
    ).toBe(0);
    expect(() =>
      checkPhase({
        before: snapshot(4000),
        after: snapshot(4001),
        samples: [sample("boundary", 0, 4, true)],
        paused: true,
      }),
    ).toThrow("Paused");
  });
  it("does not turn weak observations or missing power signals into PASS", () => {
    expect(() => checkPowerCycle([])).toThrow();
    expect(() => checkPowerCycle(power)).not.toThrow();
    expect(() =>
      checkPhase({
        before: snapshot(0),
        after: snapshot(4000),
        samples: samples.filter((item) => item.mono !== 1900),
        power,
      }),
    ).toThrow("INCONCLUSIVE");
  });
  it("detects inconsistent aggregates even if the timing oracle matches", () => {
    expect(() =>
      checkPhase({
        before: snapshot(0),
        after: { ...snapshot(4000), days: 3999 },
        samples,
        power,
      }),
    ).toThrow("Mismatched");
  });
  it("never includes commands that autonomously suspend or change power settings", () => {
    const harness = readFileSync("scripts/pulse-sleep-check.mjs", "utf8");
    expect(harness).toMatch(/execFileSync\(\s*"powercfg",\s*\["\/a"\]/);
    expect(harness).not.toMatch(
      /\b(SetSuspendState|rundll32|psshutdown|shutdown\.exe)\b/i,
    );
    expect(harness).not.toMatch(
      /powercfg["'`][\s\S]{0,30}\/(?:change|setactive|hibernate)/i,
    );
  });
  it("rejects an unexpected new visit in the short single-track scenario", () => {
    const after = snapshot(4000);
    after.events.push({
      ...after.events[0],
      eventId: "other",
      playedMs: 1000,
      visitId: "unexpected",
    });
    after.events[0].playedMs = 3000;
    expect(() =>
      checkPhase({
        before: snapshot(0),
        after,
        samples,
        power,
      }),
    ).toThrow("Unexpected visitId");
  });
});
