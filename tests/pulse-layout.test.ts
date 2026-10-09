import { describe, expect, it } from "vitest";
import {
  ALBUM_WIDTH,
  DAY_PADDING,
  EMPTY_DAY_WIDTH,
  PulseLayout,
  calendarDay,
  calendarKey,
  dayWidth,
  wheelDistance,
} from "../src/client/pulse-layout";

describe("Pulse sparse calendar geometry", () => {
  it("uses a uniform calendar including leap days, independent of DST", () => {
    expect(calendarDay("2024-03-01") - calendarDay("2024-02-28")).toBe(2);
    expect(calendarKey(calendarDay("2024-10-27") + 1)).toBe("2024-10-28");
  });
  it("computes prefix sums and round-trips every day across ten years", () => {
    const from = "2015-01-01";
    const to = "2025-01-01";
    const entries = [
      { date: from, albumCount: 2, maxAlbumMs: 1000, playedMs: 2000 },
      {
        date: "2020-02-29",
        albumCount: 1000,
        maxAlbumMs: 9000,
        playedMs: 10000,
      },
      { date: to, albumCount: 1, maxAlbumMs: 3000, playedMs: 3000 },
    ];
    const layout = new PulseLayout(from, to, entries);
    let prefix = 0;
    for (let index = 0; index < layout.count; index++) {
      expect(layout.start(index)).toBe(prefix);
      expect(layout.locate(prefix)).toEqual({ index, offset: 0 });
      expect(layout.locate(prefix + layout.width(index) - 1)).toEqual({
        index,
        offset: layout.width(index) - 1,
      });
      prefix += dayWidth(
        entries.find((entry) => entry.date === layout.date(index))
          ?.albumCount ?? 0,
      );
    }
    expect(layout.totalWidth).toBe(prefix);
    expect(layout.width(layout.index("2020-02-29"))).toBe(
      1000 * ALBUM_WIDTH + 2 * DAY_PADDING,
    );
    expect(layout.maxAlbumMs).toBe(9000);
  });
  it("clamps positions and preserves empty days", () => {
    const layout = new PulseLayout("2025-01-01", "2025-01-03", []);
    expect(layout.totalWidth).toBe(3 * EMPTY_DAY_WIDTH);
    expect(layout.locate(-100)).toEqual({ index: 0, offset: 0 });
    expect(layout.locate(Infinity)).toEqual({
      index: 2,
      offset: EMPTY_DAY_WIDTH - 1,
    });
    expect(layout.index("2026-01-01")).toBe(2);
  });
  it("rejects duplicate sparse rows and reversed ranges", () => {
    const row = {
      date: "2025-01-01",
      albumCount: 1,
      maxAlbumMs: 1,
      playedMs: 1,
    };
    expect(() => new PulseLayout(row.date, row.date, [row, row])).toThrow(
      "Duplicate",
    );
    expect(() => new PulseLayout("2025-01-03", row.date, [])).toThrow(
      "Reversed",
    );
  });
  it("normalizes wheel units without adding trackpad axes", () => {
    expect(wheelDistance(20, 10, 0, 500)).toBe(20);
    expect(wheelDistance(1, -3, 1, 500)).toBe(-48);
    expect(wheelDistance(0, 1, 2, 500)).toBe(500);
  });
});
