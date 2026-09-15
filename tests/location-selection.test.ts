import { describe, expect, it } from "vitest";
import {
  folderSelectionKey,
  librarySelectionKey,
  locationsFromSelectionKeys,
} from "../src/client/location-selection";

describe("library tree selection", () => {
  it("keeps locations from different libraries as a union", () => {
    expect(
      locationsFromSelectionKeys([
        librarySelectionKey("first"),
        folderSelectionKey("second", "Rock"),
      ]),
    ).toEqual({
      libraryIds: ["first"],
      folders: [{ libraryId: "second", relativePath: "Rock" }],
    });
  });

  it("removes folders covered by a library or parent folder", () => {
    expect(
      locationsFromSelectionKeys([
        folderSelectionKey("first", "Rock"),
        folderSelectionKey("first", "Rock\\Live"),
        librarySelectionKey("second"),
        folderSelectionKey("second", "Jazz"),
      ]),
    ).toEqual({
      libraryIds: ["second"],
      folders: [{ libraryId: "first", relativePath: "Rock" }],
    });
  });
});
