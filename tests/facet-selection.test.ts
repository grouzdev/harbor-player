import { describe, expect, it } from "vitest";
import { selectFacetValue } from "../src/client/facet-selection";

describe("selectFacetValue", () => {
  it("replaces a multiple selection on a regular click", () => {
    expect(selectFacetValue(["Rock", "Jazz"], "Ambient", false)).toEqual([
      "Ambient",
    ]);
  });

  it("keeps the only selected value on a repeated regular click", () => {
    expect(selectFacetValue(["Ambient"], "Ambient", false)).toEqual([
      "Ambient",
    ]);
  });

  it("adds a value on an additive click", () => {
    expect(selectFacetValue(["Rock"], "Jazz", true)).toEqual(["Rock", "Jazz"]);
  });

  it("removes a selected value on an additive click", () => {
    expect(selectFacetValue(["Rock", "Jazz"], "Rock", true)).toEqual(["Jazz"]);
  });
});
