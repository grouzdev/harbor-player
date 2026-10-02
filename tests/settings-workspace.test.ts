import { describe, expect, it } from "vitest";
import { resizeSettingsPanels } from "../src/client/SettingsWorkspace";

describe("settings workspace adjacent resizing", () => {
  const equal: [number, number, number, number] = [0.25, 0.25, 0.25, 0.25];

  it.each([0, 1, 2] as const)(
    "transfers space only between pair %i and its neighbor",
    (index) => {
      const result = resizeSettingsPanels(equal, index, 60, 600);
      expect(result[index]).toBeCloseTo(0.35);
      expect(result[index + 1]).toBeCloseTo(0.15);
      for (let panel = 0; panel < equal.length; panel++) {
        if (panel !== index && panel !== index + 1) {
          expect(result[panel]).toBe(equal[panel]);
        }
      }
      expect(result.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
      expect(equal).toEqual([0.25, 0.25, 0.25, 0.25]);
    },
  );

  it.each([0, 1, 2] as const)(
    "clamps pair %i in both directions to panel minimums",
    (index) => {
      const positive = [...equal];
      positive[index] = 0.5;
      positive[index + 1] = 0;
      const negative = [...equal];
      negative[index] = 0;
      negative[index + 1] = 0.5;
      expect(resizeSettingsPanels(equal, index, 10000, 600)).toEqual(positive);
      expect(resizeSettingsPanels(equal, index, -10000, 600)).toEqual(negative);
    },
  );

  it("does not resize when the row is at its horizontal overflow minimum", () => {
    expect(resizeSettingsPanels(equal, 0, 40, 0)).toBe(equal);
    expect(resizeSettingsPanels(equal, 0, -40, -100)).toBe(equal);
  });
});
