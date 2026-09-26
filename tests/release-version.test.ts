import { describe, expect, it } from "vitest";
import {
  assertReleaseVersion,
  releaseChannel,
} from "../scripts/release-version.mjs";

describe("release versions", () => {
  it("classifies stable and beta release versions", () => {
    expect(releaseChannel("0.2.0")).toBe("stable");
    expect(releaseChannel("0.2.0-beta.3")).toBe("beta");
  });

  it("rejects unsupported release versions", () => {
    expect(() => assertReleaseVersion("0.2")).toThrow("X.Y.Z");
    expect(() => assertReleaseVersion("0.2.0-rc.1")).toThrow("X.Y.Z");
  });
});
