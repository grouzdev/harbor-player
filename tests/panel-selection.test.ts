import { describe, expect, it } from "vitest";
import {
  addMarqueeSelection,
  isEmptySelectionSurfaceClick,
  resolveContextSelection,
  resolveSelectionClick,
} from "../src/client/panel-selection";

const order = ["a", "b", "c", "d"];

describe("panel selection", () => {
  it("replaces selection and establishes an anchor", () => {
    expect(
      resolveSelectionClick(["a", "b"], order, "c", null, {
        ctrl: false,
        shift: false,
      }),
    ).toEqual({ keys: ["c"], anchor: "c" });
  });

  it("toggles one key with Ctrl", () => {
    expect(
      resolveSelectionClick(["a", "b"], order, "b", "a", {
        ctrl: true,
        shift: false,
      }).keys,
    ).toEqual(["a"]);
  });

  it("replaces with a forward or backward Shift range", () => {
    expect(
      resolveSelectionClick(["a"], order, "d", "b", {
        ctrl: false,
        shift: true,
      }),
    ).toEqual({ keys: ["b", "c", "d"], anchor: "b" });
    expect(
      resolveSelectionClick(["d"], order, "a", "c", {
        ctrl: false,
        shift: true,
      }).keys,
    ).toEqual(["a", "b", "c"]);
  });

  it("adds a Shift range with Ctrl and keeps the anchor", () => {
    expect(
      resolveSelectionClick(["a"], order, "d", "b", {
        ctrl: true,
        shift: true,
      }),
    ).toEqual({ keys: ["a", "b", "c", "d"], anchor: "b" });
  });

  it("falls back to Ctrl toggle when the anchor is unavailable", () => {
    expect(
      resolveSelectionClick(["a"], order, "c", "missing", {
        ctrl: true,
        shift: true,
      }).keys,
    ).toEqual(["a", "c"]);
  });

  it("replaces or adds marquee hits", () => {
    expect(addMarqueeSelection(["a"], ["b", "c"], false)).toEqual(["b", "c"]);
    expect(addMarqueeSelection(["a", "b"], ["b", "c"], true)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps a context-menu target group only when the target is selected", () => {
    expect(resolveContextSelection(["a", "b"], "b")).toEqual(["a", "b"]);
    expect(resolveContextSelection(["a", "b"], "c")).toEqual(["c"]);
  });

  it("recognizes a click on empty panel space", () => {
    const target = (matches: string[]) => ({
      closest: (selector: string) =>
        matches.includes(selector) ? ({} as Element) : null,
    });

    expect(isEmptySelectionSurfaceClick(target([]))).toBe(true);
    expect(isEmptySelectionSurfaceClick(target(["[data-selection-key]"]))).toBe(
      false,
    );
    expect(
      isEmptySelectionSurfaceClick(
        target(["button,a,input,textarea,select,[role=button]"]),
      ),
    ).toBe(false);
  });
});
