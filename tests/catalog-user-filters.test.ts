import { describe, expect, it } from "vitest";
import { emptyFilter, filterSchema } from "../src/shared/contracts";
import {
  recentlyAddedFilterLabel,
  ratingFilterLabel,
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

  it.each([
    [0, 0, "Без рейтинга"],
    [0, 3, "Рейтинг: от 0 до 3"],
    [3, 4, "Рейтинг: от 3 до 4"],
  ] as const)(
    "formats %i–%i active rating label",
    (minimum, maximum, label) => {
      expect(ratingFilterLabel(minimum, maximum)).toBe(label);
    },
  );

  it.each([
    [1, "Добавлено 1 день назад"],
    [2, "Добавлено 2 дня назад"],
    [3, "Добавлено 3 дня назад"],
    [4, "Добавлено 4 дня назад"],
    [5, "Добавлено 5 дней назад"],
    [7, "Добавлено 7 дней назад"],
    [11, "Добавлено 11 дней назад"],
    [12, "Добавлено 12 дней назад"],
    [13, "Добавлено 13 дней назад"],
    [14, "Добавлено 14 дней назад"],
    [20, "Добавлено 20 дней назад"],
    [21, "Добавлено 21 день назад"],
    [22, "Добавлено 22 дня назад"],
    [23, "Добавлено 23 дня назад"],
    [24, "Добавлено 24 дня назад"],
    [25, "Добавлено 25 дней назад"],
    [30, "Добавлено 30 дней назад"],
  ] as const)("formats the %i-day recent filter label", (days, label) => {
    expect(recentlyAddedFilterLabel(days)).toBe(label);
  });

  it("accepts every whole-day recent period from 1 to 30", () => {
    for (let days = 1; days <= 30; days++) {
      expect(
        filterSchema.parse({ recentlyAddedDays: days }).recentlyAddedDays,
      ).toBe(days);
    }
    expect(filterSchema.parse({}).recentlyAddedDays).toBeNull();
    expect(
      filterSchema.parse({ recentlyAddedDays: null }).recentlyAddedDays,
    ).toBeNull();
  });

  it.each([0, 31, 1.5])("rejects an invalid recent period of %s", (days) => {
    expect(filterSchema.safeParse({ recentlyAddedDays: days }).success).toBe(
      false,
    );
  });
});
