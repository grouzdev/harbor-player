import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Only known presentation-only paths may choose fast. New or ambiguous paths
// default to full; do not try to infer transitive safety from an extension.
const presentationFiles = new Set([
  "AlbumHeader.tsx",
  "AppearanceSettingsPanels.tsx",
  "AutocompleteInput.tsx",
  "BookmarkToggle.tsx",
  "CatalogSidebar.tsx",
  "CatalogStateIndicators.tsx",
  "CatalogUserFilters.tsx",
  "CollapseToggle.tsx",
  "ContextMenu.tsx",
  "CoverPlaceholder.tsx",
  "DiscHeader.tsx",
  "ExpandingSearch.tsx",
  "IconToggle.tsx",
  "ListTile.tsx",
  "Modal.tsx",
  "RangeSlider.tsx",
  "RatingControl.tsx",
  "ValueBubble.tsx",
  "appearance.ts",
  "background-presets.ts",
]);

export function modeForPaths(paths) {
  if (!paths.length) return { mode: "full", reason: "empty-diff" };
  const safe = paths.every((file) => {
    if (!file || file.includes("..") || file.includes("\\")) return false;
    return (
      /^(docs\/|website\/)/.test(file) ||
      /^(README\.md|concept\.md|LICENSE|THIRD_PARTY_NOTICES\.md)$/.test(file) ||
      /^src\/client\/(?:styles\/[^/]+\.css|styles\.css|fonts\.css)$/.test(
        file,
      ) ||
      (file.startsWith("src/client/") &&
        presentationFiles.has(file.slice("src/client/".length)))
    );
  });
  return {
    mode: safe ? "fast" : "full",
    reason: safe ? "presentation-or-docs" : "critical-or-unknown-path",
  };
}

export function selectTestMode(
  { event, ref, requested, base, head },
  git = (args) => execFileSync("git", args, { encoding: "utf8" }),
) {
  if (ref?.startsWith("refs/tags/"))
    return { mode: "full", reason: "release-tag" };
  if (event === "workflow_dispatch")
    return requested === "fast" || requested === "full"
      ? { mode: requested, reason: "manual" }
      : { mode: "full", reason: "invalid-manual-mode" };
  if (
    !["push", "pull_request"].includes(event) ||
    !/^[a-f0-9]{40}$/i.test(base ?? "") ||
    !/^[a-f0-9]{40}$/i.test(head ?? "") ||
    /^0+$/.test(base) ||
    /^0+$/.test(head)
  )
    return { mode: "full", reason: "unknown-range" };
  try {
    const from =
      event === "pull_request" ? git(["merge-base", base, head]).trim() : base;
    if (!/^[a-f0-9]{40}$/i.test(from)) throw new Error("Invalid merge base");
    // Disable rename detection: both the deleted and added paths must be safe.
    const paths = git(["diff", "--name-only", "--no-renames", "-z", from, head])
      .split("\0")
      .filter(Boolean);
    return modeForPaths(paths);
  } catch {
    return { mode: "full", reason: "diff-unavailable" };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = selectTestMode({
    event: process.env.CI_EVENT,
    ref: process.env.CI_REF,
    requested: process.env.CI_REQUESTED_MODE,
    base: process.env.CI_BASE_SHA,
    head: process.env.CI_HEAD_SHA,
  });
  console.log(`Test suite: ${result.mode} (${result.reason})`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Test suite\n\n${result.mode}: ${result.reason}\n`,
    );
}
