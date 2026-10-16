import assert from "node:assert/strict";

export const mutationKinds = [
  "warm-after-listening",
  "warm-after-clear",
  "warm-after-clear-recovery",
];

/** Reject repeated warm clicks masquerading as independent mutation samples. */
export function verifyMutationCohort(samples, manifests, launches) {
  const groups = {};
  const allChains = new Set();
  const allEvents = new Set();
  for (const dataset of ["ordinary", "ten-year"]) {
    const fixtures = manifests.filter(
      (manifest) => manifest.dataset === dataset,
    );
    assert.equal(fixtures.length, launches, "Fresh fixture count");
    assert.equal(new Set(fixtures.map((f) => f.sentinel)).size, launches);
    for (const fixture of fixtures) {
      assert(!allChains.has(fixture.runRoot), "Fixture root reused");
      allChains.add(fixture.runRoot);
      const chain = samples.filter(
        (sample) =>
          sample.dataset === dataset &&
          mutationKinds.includes(sample.kind) &&
          sample.mutation?.chainId === fixture.runRoot,
      );
      assert.equal(chain.length, 3, "One real mutation chain per fixture");
      for (const kind of mutationKinds)
        assert.equal(chain.filter((sample) => sample.kind === kind).length, 1);
      const [listening, cleared, recovery] = mutationKinds.map((kind) =>
        chain.find((sample) => sample.kind === kind),
      );
      for (const sample of chain) {
        const proof = sample.mutation;
        assert.equal(proof.baselineVerified, true);
        assert.equal(proof.sentinel, fixture.sentinel);
        assert.deepEqual(proof.seed, {
          from: fixture.from,
          to: fixture.to,
          busyCount: fixture.busyCount,
          historyDays: fixture.historyDays,
        });
        assert(Number.isFinite(sample.dataReady) && sample.dataReady >= 0);
        assert(
          Number.isFinite(sample.coversReady) &&
            sample.coversReady >= sample.dataReady,
        );
        assert(
          sample.http.every(
            (request) =>
              !/\/days\/.*\/albums/.test(request.endpoint) ||
              Number(new URLSearchParams(request.query).get("limit") || 20) <=
                100,
          ),
          "Bounded card page requests",
        );
      }
      const l = listening.mutation;
      const c = cleared.mutation;
      const r = recovery.mutation;
      assert.equal(l.historyState, "seeded-plus-event");
      assert.equal(l.generationAfter, l.generationBefore);
      assert.equal(l.after.playedMs, l.before.playedMs + 90000);
      assert.equal(l.after.dayTotalMs, l.before.dayTotalMs + 90000);
      assert.equal(c.historyState, "empty-after-clear");
      assert.equal(c.generationBefore, l.generationBefore);
      assert.equal(c.generationAfter, l.generationAfter + 1);
      assert.equal(c.range.firstDay, null);
      assert.equal(c.range.lastDay, null);
      assert.equal(cleared.fixture.empty, true);
      assert.equal(r.historyState, "single-recovered-album");
      assert.equal(r.generationAfter, c.generationAfter);
      assert.notEqual(r.after.albumId, r.previousAlbumId);
      for (const key of ["playedMs", "dayPlayedMs", "dayTotalMs"])
        assert.equal(r.after[key], 90000);
      assert.equal(r.after.dayCount, 1);
      assert.equal(r.after.sameDayReturns, 0);
      for (const proof of [l, r]) {
        assert.equal(typeof proof.eventId, "string");
        assert(
          proof.eventId && !allEvents.has(proof.eventId),
          "New real ingest per sample",
        );
        allEvents.add(proof.eventId);
      }
    }
    for (const kind of mutationKinds) {
      const count = samples.filter(
        (sample) => sample.dataset === dataset && sample.kind === kind,
      ).length;
      assert.equal(count, launches, "Mutation sample count");
      groups[`${dataset}/${kind}`] = {
        count,
        independentFixtures: launches,
        sampleCountSufficient: launches >= 30,
      };
    }
  }
  return groups;
}
