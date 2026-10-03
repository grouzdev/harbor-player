import { describe, expect, it } from "vitest";
import {
  minimalRevealScrollTop,
  preservedScrollTop,
} from "../src/client/panel-scroll";
import { firstRelevantGenre } from "../src/client/useArtistGenreReveal";

describe("panel click scroll preservation", () => {
  it("retains the item's viewport position when its data offset changes", () => {
    const viewportY = 72;
    expect(preservedScrollTop(3600, viewportY, 5000)).toBe(3528);
    expect(3600 - preservedScrollTop(3600, viewportY, 5000)).toBe(viewportY);
  });

  it("clamps at the beginning instead of scrolling beyond the panel", () => {
    expect(preservedScrollTop(30, 72, 5000)).toBe(0);
  });

  it("clamps at the end when exact viewport positioning is impossible", () => {
    expect(preservedScrollTop(3600, 72, 3000)).toBe(3000);
  });

  it("does not scroll a panel whose content fits inside its viewport", () => {
    expect(preservedScrollTop(30, 72, -200)).toBe(0);
  });
});

describe("minimal panel reveal", () => {
  it("leaves fully visible rows still, including rows flush with either edge", () => {
    expect(minimalRevealScrollTop(100, 30, 100, 200, 1000)).toBe(100);
    expect(minimalRevealScrollTop(270, 30, 100, 200, 1000)).toBe(100);
    expect(minimalRevealScrollTop(180, 30, 100, 200, 1000)).toBe(100);
  });

  it("reveals above at the top edge with an inset, never centered", () => {
    expect(minimalRevealScrollTop(90, 30, 100, 200, 1000)).toBe(82);
  });

  it("reveals below at the bottom edge with an inset, never centered", () => {
    expect(minimalRevealScrollTop(290, 30, 100, 200, 1000)).toBe(128);
    expect(minimalRevealScrollTop(900, 30, 100, 200, 1000)).toBe(738);
  });

  it("clamps at both ends and when the content fits", () => {
    expect(minimalRevealScrollTop(2, 30, 100, 200, 1000)).toBe(0);
    expect(minimalRevealScrollTop(1180, 20, 100, 200, 1000)).toBe(1000);
    expect(minimalRevealScrollTop(0, 30, 100, 200, -20)).toBe(0);
  });

  it("uses the nearest edge for an oversized row spanning the viewport", () => {
    expect(minimalRevealScrollTop(90, 300, 100, 200, 1000)).toBe(82);
    expect(minimalRevealScrollTop(0, 310, 100, 200, 1000)).toBe(118);
  });
});

describe("artist genre reveal order", () => {
  const genres = [{ name: "Rock" }, { name: "" }, { name: "Jazz" }];

  it("uses displayed order, not relevance response order", () => {
    expect(firstRelevantGenre(genres, ["Jazz", "Rock"])).toBe("Rock");
  });

  it("ignores relevant genres absent from the displayed list", () => {
    expect(firstRelevantGenre(genres, ["Absent", "Jazz"])).toBe("Jazz");
    expect(firstRelevantGenre(genres, ["Absent"])).toBeUndefined();
  });

  it("supports the unnamed genre", () => {
    expect(firstRelevantGenre(genres, [""])).toBe("");
  });
});
