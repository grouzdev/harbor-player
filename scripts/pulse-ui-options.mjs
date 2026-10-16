import assert from "node:assert/strict";

/** Diagnostic counts stay below cold acceptance counts and size retained fixtures. */
export function uiBenchmarkOptions(args) {
  assert(
    args.every(
      (a) =>
        a === "--smoke" ||
        a === "--latency-only" ||
        a === "--diagnostic" ||
        a === "--electron" ||
        /^--diagnostic-runs=[1-5]$/.test(a) ||
        /^--cold=(startup-overlap|ready-panels)$/.test(a) ||
        /^--channel=(chrome|msedge)$/.test(a),
    ),
    "Unknown argument",
  );
  const smoke = args.includes("--smoke");
  const diagnostic = args.includes("--diagnostic");
  assert(
    !diagnostic || smoke,
    "--diagnostic requires --smoke; not budget samples",
  );
  assert(
    !args.some((a) => a.startsWith("--diagnostic-runs=")) || diagnostic,
    "--diagnostic-runs requires --diagnostic --smoke",
  );
  const launches = smoke
    ? Number(
        args.find((a) => a.startsWith("--diagnostic-runs="))?.split("=")[1] ??
          1,
      )
    : 10;
  return {
    smoke,
    diagnostic,
    launches,
    retainedCopies: 2 * launches,
    latencyOnly: args.includes("--latency-only"),
    electron: args.includes("--electron"),
    coldScenario:
      args.find((a) => a.startsWith("--cold="))?.split("=")[1] ??
      "startup-overlap",
  };
}
