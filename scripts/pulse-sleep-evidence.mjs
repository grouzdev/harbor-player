import assert from "node:assert/strict";

export function checkTotals(snapshot) {
  for (const name of ["raw", "days", "dayAlbums", "albumStats"])
    assert.equal(snapshot[name], snapshot.raw, `Mismatched ${name} total`);
  assert(snapshot.events.every((event) => Number.isInteger(event.playedMs)));
}

export function checkPhase({
  before,
  after,
  samples,
  power = [],
  paused = false,
}) {
  checkTotals(before);
  checkTotals(after);
  assert.equal(
    after.generation,
    before.generation,
    "History generation changed",
  );
  const deltaMs = after.raw - before.raw;
  assert(deltaMs >= 0, "Accepted time decreased");
  for (const old of before.events) {
    const current = after.events.find((event) => event.eventId === old.eventId);
    assert(current, "A confirmed interval disappeared");
    assert(current.revision >= old.revision, "Accepted revision decreased");
    assert(
      current.playedMs >= old.playedMs,
      "A checkpoint lost confirmed time",
    );
  }
  for (const identity of ["sessionId", "visitId"])
    assert(
      new Set(after.events.map((event) => event[identity])).size <= 1,
      `Unexpected ${identity} change in the short single-track scenario`,
    );
  if (paused) {
    assert(samples.length > 0, "Missing actual idle audio observations");
    assert.equal(deltaMs, 0, "Paused time was counted");
    assert.equal(
      after.events.length,
      before.events.length,
      "Idle added intervals",
    );
    assert(
      samples.every((sample) => sample.paused),
      "Idle audio resumed by itself",
    );
    return { deltaMs, expectedMs: 0, differenceMs: 0 };
  }
  assert(deltaMs > 0, "Observed playback created no accepted time");

  let active = null;
  let expectedMs = 0;
  const activeRanges = [];
  for (const sample of samples) {
    assert.equal(sample.rate, 1, "Use 1x for the independent elapsed oracle");
    if (sample.name === "playing" && active === null) active = sample.mono;
    if (
      ["pause", "waiting", "seeking", "emptied", "error", "ended"].includes(
        sample.name,
      )
    ) {
      if (active !== null) {
        assert(sample.mono >= active, "Monotonic clock moved backwards");
        expectedMs += sample.mono - active;
        activeRanges.push([active, sample.mono]);
      }
      active = null;
    }
    assert(
      !["seeking", "emptied", "error", "ended"].includes(sample.name),
      `Unexpected media event ${sample.name}`,
    );
  }
  assert.equal(active, null, "Phase must end with real pause");
  assert(expectedMs > 0, "No observed playback");

  const bridges = [];
  for (let i = 0; i < power.length; i += 2) {
    const suspend = power[i],
      resume = power[i + 1];
    assert.equal(suspend?.name, "suspend");
    assert.equal(resume?.name, "resume");
    assert.equal(suspend.source, "electron.powerMonitor");
    assert.equal(resume.source, "electron.powerMonitor");
    assert(resume.wall > suspend.wall, "Invalid power cycle");
    const left = samples.findLast((sample) => sample.wall <= suspend.wall);
    const right = samples.find((sample) => sample.wall >= resume.wall);
    assert(left && right, "Missing media observations around OS sleep");
    const uncertaintyMs = suspend.wall - left.wall + right.wall - resume.wall;
    assert(
      uncertaintyMs <= 1000,
      "INCONCLUSIVE: boundary observations cannot support the 1s budget",
    );
    const gapMs = right.mono - left.mono;
    const progressedMs = (right.position - left.position) * 1000;
    assert(
      gapMs >= 0 && progressedMs >= 0,
      "Media/monotonic clock moved backwards",
    );
    // A paused-before-suspend segment already excludes the whole clock gap.
    // Otherwise replace only this uncertain bridge with confirmed progression.
    // Modern Standby may legitimately advance media; never subtract all sleep.
    const activeGapMs = activeRanges.reduce(
      (sum, [start, end]) =>
        sum +
        Math.max(0, Math.min(end, right.mono) - Math.max(start, left.mono)),
      0,
    );
    assert(
      activeGapMs === 0 || Math.abs(activeGapMs - gapMs) < 1,
      "INCONCLUSIVE: playback state changed inside an unobserved sleep bridge",
    );
    if (activeGapMs > 0) expectedMs += progressedMs - gapMs;
    bridges.push({
      sleepWallMs: resume.wall - suspend.wall,
      progressedMs,
      uncertaintyMs,
    });
  }
  const differenceMs = deltaMs - expectedMs;
  assert(
    Math.abs(differenceMs) <= 1000,
    `Listening discrepancy ${differenceMs.toFixed(3)}ms exceeds the fixed 1s budget`,
  );
  return { deltaMs, expectedMs, differenceMs, bridges };
}

export function checkPowerCycle(power) {
  assert.equal(power.length, 2, "Need one physical suspend/resume pair");
  assert.equal(power[0].name, "suspend");
  assert.equal(power[1].name, "resume");
  assert(power.every((event) => event.source === "electron.powerMonitor"));
  assert(
    power[1].wall - power[0].wall >= 60_000,
    "Sleep must last at least 60s",
  );
}
