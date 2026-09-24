import { describe, expect, it } from "vitest";
import { duration } from "../src/client/api";

describe("duration formatting", () => {
  it("uses minutes and seconds below one hour", () => {
    expect(duration(0)).toBe("0:00");
    expect(duration(59)).toBe("0:59");
    expect(duration(60)).toBe("1:00");
    expect(duration(61)).toBe("1:01");
    expect(duration(3599)).toBe("59:59");
  });

  it("includes hours for durations of one hour or longer", () => {
    expect(duration(3600)).toBe("1:00:00");
    expect(duration(3661)).toBe("1:01:01");
  });

  it("falls back to zero for non-finite values", () => {
    expect(duration(Number.NaN)).toBe("0:00");
    expect(duration(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
