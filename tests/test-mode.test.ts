import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { modeForPaths, selectTestMode } from "../scripts/select-test-mode.mjs";

describe("conservative CI suite selection", () => {
  it.each([
    "src/client/RatingControl.tsx",
    "src/client/styles.css",
    "src/client/styles/panels.css",
    "README.md",
    "docs/testing.md",
    "docs/test-suites.md",
    "website/src/pages/index.astro",
  ])("permits fast for %s", (file) => {
    expect(modeForPaths([file]).mode).toBe("fast");
  });

  it.each([
    "src/server/catalog-migrations.ts",
    "src/server/tag-writer.ts",
    "src/shared/contracts.ts",
    "src/desktop/main.ts",
    "src/client/App.tsx",
    "src/client/Player.tsx",
    "src/client/pulse-recorder.ts",
    "src/client/workspace-session.ts",
    "src/client/NewComponent.tsx",
    "scripts/select-test-mode.mjs",
    "tests/browser/pulse.spec.ts",
    ".github/workflows/ci.yml",
    "package.json",
    "package-lock.json",
    "electron-builder.yml",
    "playwright.config.ts",
    "vitest.config.ts",
    "AGENTS.md",
    "src/client/../server/database.ts",
    "src\\client\\RatingControl.tsx",
  ])("requires full for %s even alongside a safe path", (file) => {
    expect(modeForPaths(["README.md", file]).mode).toBe("full");
  });

  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const event = { event: "push", ref: "refs/heads/main", base, head };

  it("defaults to full for empty changes, missing ranges and new branches", () => {
    expect(modeForPaths([]).mode).toBe("full");
    expect(selectTestMode({ ...event, base: "" }).mode).toBe("full");
    expect(selectTestMode({ ...event, base: "0".repeat(40) }).mode).toBe(
      "full",
    );
    expect(selectTestMode({ ...event, head: "--option" }).mode).toBe("full");
    expect(selectTestMode({ ...event, event: "unknown" }).mode).toBe("full");
  });

  it("falls back to full if Git cannot inspect the range", () => {
    expect(
      selectTestMode(event, () => {
        throw new Error("missing history");
      }),
    ).toEqual({ mode: "full", reason: "diff-unavailable" });
  });

  it("compares the complete push, not only the last commit", () => {
    const calls: string[][] = [];
    const result = selectTestMode(event, (args: string[]) => {
      calls.push(args);
      return "src/client/RatingControl.tsx\0README.md\0";
    });
    expect(result.mode).toBe("fast");
    expect(calls).toEqual([
      ["diff", "--name-only", "--no-renames", "-z", base, head],
    ]);
  });

  it("uses the PR merge base instead of unrelated base-branch changes", () => {
    const common = "c".repeat(40);
    const calls: string[][] = [];
    const result = selectTestMode(
      { ...event, event: "pull_request" },
      (args: string[]) => {
        calls.push(args);
        return args[0] === "merge-base" ? `${common}\n` : "README.md\0";
      },
    );
    expect(result.mode).toBe("fast");
    expect(calls).toEqual([
      ["merge-base", base, head],
      ["diff", "--name-only", "--no-renames", "-z", common, head],
    ]);
  });

  it("cannot hide a critical deleted/renamed path behind a safe new path", () => {
    expect(
      selectTestMode(event, () => "src/server/database.ts\0docs/old.ts\0").mode,
    ).toBe("full");
  });

  it("supports explicit manual choices and defaults invalid input to full", () => {
    for (const requested of ["fast", "full"]) {
      expect(
        selectTestMode({ event: "workflow_dispatch", requested }).mode,
      ).toBe(requested);
    }
    expect(selectTestMode({ event: "workflow_dispatch" }).mode).toBe("full");
  });

  it("always chooses full for a release tag, including a manual fast request", () => {
    expect(
      selectTestMode({
        event: "workflow_dispatch",
        ref: "refs/tags/v0.4.2-beta.3",
        requested: "fast",
      }),
    ).toEqual({ mode: "full", reason: "release-tag" });
  });

  it("keeps release checks unconditional and independent of fast selection", () => {
    const release = readFileSync(
      ".github/workflows/release.yml",
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(release).not.toContain("select-test-mode");
    expect(release).not.toContain("test:unit:fast");
    expect(release).not.toContain("test:e2e:fast");
    expect(
      release.match(
        /- run: npm test\n {6}- run: npm run build\n {6}- run: npm run test:e2e:built\n/g,
      ),
    ).toHaveLength(2);
  });

  it("runs full CI steps unless the selector explicitly chooses fast", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci.match(/if: steps.suite.outputs.mode != 'fast'/g)).toHaveLength(4);
    expect(ci.match(/if: steps.suite.outputs.mode == 'fast'/g)).toHaveLength(2);
  });
});
