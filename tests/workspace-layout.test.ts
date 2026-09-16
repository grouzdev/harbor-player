import { describe, expect, it } from "vitest";
import {
  portraitWorkspaceWidth,
  usesPortraitWorkspaceLayout,
} from "../src/client/workspace-layout";

describe("workspace portrait layout", () => {
  it("uses fixed width thresholds for each visible panel count", () => {
    expect(portraitWorkspaceWidth(5)).toBe(1200);
    expect(portraitWorkspaceWidth(4)).toBe(1000);
    expect(portraitWorkspaceWidth(3)).toBe(800);
    expect(portraitWorkspaceWidth(2)).toBe(600);
    expect(portraitWorkspaceWidth(1)).toBe(400);
    expect(portraitWorkspaceWidth(0)).toBe(0);
  });

  it("switches only below the threshold and always follows a portrait window", () => {
    for (const [count, threshold] of [
      [5, 1200],
      [4, 1000],
      [3, 800],
      [2, 600],
      [1, 400],
    ]) {
      expect(usesPortraitWorkspaceLayout(false, threshold, count)).toBe(false);
      expect(usesPortraitWorkspaceLayout(false, threshold - 1, count)).toBe(
        true,
      );
    }

    expect(usesPortraitWorkspaceLayout(true, 1600, 1)).toBe(true);
    expect(usesPortraitWorkspaceLayout(false, 200, 0)).toBe(false);
  });
});
