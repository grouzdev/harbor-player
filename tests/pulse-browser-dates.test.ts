import { describe, expect, it } from "vitest";
import { pulseDayKey, pulseFixtureInstant } from "./browser/pulse-test-dates";

describe("Pulse browser fixture dates", () => {
  it("uses the history zone across local midnight rather than UTC today", () => {
    const instant = Date.parse("2026-10-15T21:30:00Z");
    expect(pulseDayKey(instant, "Europe/Moscow")).toBe("2026-10-16");
    expect(pulseDayKey(instant, "UTC")).toBe("2026-10-15");
    expect(
      pulseDayKey(Date.parse("2026-10-16T01:00:00Z"), "America/Los_Angeles"),
    ).toBe("2026-10-15");
  });

  it.each(["UTC", "Europe/Moscow", "Pacific/Kiritimati", "Etc/GMT+12"])(
    "keeps fixture intervals in their intended day in %s",
    (zone) => {
      for (const day of ["2024-02-29", "2026-01-01", "2026-10-15"]) {
        const instant = pulseFixtureInstant(day, zone);
        expect(pulseDayKey(instant, zone)).toBe(day);
        expect(pulseDayKey(instant + 60_000, zone)).toBe(day);
      }
    },
  );
});
