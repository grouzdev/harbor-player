import { describe, expect, it } from "vitest";
import { emptyFilter } from "../src/shared/contracts";
import {
  ratingRangeFromFilter,
  withSharedRatingRange,
} from "../src/client/CatalogUserFilters";

describe("catalog user filters", () => {
  it.each([
    [0, 5, null, null, false],
    [0, 0, null, null, true],
    [0, 3, null, 3, true],
    [3, 5, 3, null, false],
    [5, 5, 5, null, false],
  ] as const)(
    "maps %i–%i to both catalog rating filters",
    (minimum, maximum, ratingMin, ratingMax, unrated) => {
      const filter = withSharedRatingRange(emptyFilter, minimum, maximum);
      expect(filter).toMatchObject({
        albumRatingMin: ratingMin,
        albumRatingMax: ratingMax,
        albumUnrated: unrated,
        trackRatingMin: ratingMin,
        trackRatingMax: ratingMax,
        trackUnrated: unrated,
      });
      expect(ratingRangeFromFilter(filter)).toEqual([minimum, maximum]);
    },
  );

  it("clamps crossed and out-of-range handles", () => {
    expect(
      ratingRangeFromFilter(withSharedRatingRange(emptyFilter, 7, 2)),
    ).toEqual([2, 2]);
    expect(
      ratingRangeFromFilter(withSharedRatingRange(emptyFilter, -2, 9)),
    ).toEqual([0, 5]);
  });
});
