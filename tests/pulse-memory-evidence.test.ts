import assert from "node:assert/strict";
import { test } from "vitest";
import {
  checkPoint,
  durationSeconds,
  memoryFailureStatus,
  navigationTargets,
} from "../scripts/pulse-memory-evidence.mjs";

test("hidden foreground waits are inconclusive, not fixture or logic failures", () => {
  const hidden = {
    visible: true,
    focused: true,
    renderer: { visibility: "hidden" },
  };
  assert.equal(
    memoryFailureStatus(new Error("Timeout: isolated UI"), hidden),
    "INCONCLUSIVE",
  );
  assert.equal(
    memoryFailureStatus(new Error("Fixture sentinel"), hidden),
    "FAILED",
  );
  assert.equal(
    memoryFailureStatus(new Error("Timeout: reached date"), {
      visible: true,
      focused: true,
      renderer: { visibility: "visible" },
    }),
    "FAILED",
  );
});

test("memory durations distinguish smoke and reject invalid durations", () => {
  assert.equal(durationSeconds({}), 1800);
  assert.equal(durationSeconds({ smoke: true }), 10);
  assert.equal(durationSeconds({ "duration-seconds": "60" }), 60);
  for (const value of ["0", "-1", "NaN", "Infinity"])
    assert.throws(() => durationSeconds({ "duration-seconds": value }));
});

test("memory navigation has endpoints and intermediate year offsets", () => {
  assert.deepEqual(
    navigationTargets({ from: "2020-01-01", to: "2022-01-01" }),
    [0, 365, 730, 731],
  );
});

test("memory reached-date and bounded DOM checks cannot pass stale or foreign UI", () => {
  const manifest = { from: "2020-01-01", to: "2020-01-05", sentinel: "owned" };
  const point = {
    date: manifest.from,
    settled: true,
    viewport: 1000,
    days: 20,
    cards: 1,
    titles: ["owned album"],
  };
  assert.equal(checkPoint(point, manifest, 0), manifest.from);
  for (const change of [
    { date: manifest.to },
    { settled: false },
    { days: 999 },
    { cards: 999 },
    { titles: ["foreign"] },
  ])
    assert.throws(() => checkPoint({ ...point, ...change }, manifest, 0));
});
