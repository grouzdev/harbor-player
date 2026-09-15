import { describe, expect, it } from "vitest";
import { selectionScrollAnchor } from "../src/client/selection-scroll";

describe("selectionScrollAnchor", () => {
  it("uses the last retained selection after a panel input changes", () => {
    expect(selectionScrollAnchor("before", "after", ["first", "last"])).toBe(
      "last",
    );
  });

  it("does not scroll on initial load, an unchanged input, or no selection", () => {
    expect(selectionScrollAnchor(null, "after", ["album"])).toBeNull();
    expect(selectionScrollAnchor("same", "same", ["album"])).toBeNull();
    expect(selectionScrollAnchor("before", "after", [])).toBeNull();
  });
});
