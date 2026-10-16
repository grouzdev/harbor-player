import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

// Keep the worker/browser driver in Node's native test runner while making
// these regressions mandatory under the repository's normal npm test / CI.
test("checkpoint diagnostics retain partial evidence under controlled failures", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--test",
      "tests/pulse-process-diagnostics.test.mjs",
      "tests/pulse-process-diagnostics-browser.test.mjs",
    ],
    { encoding: "utf8", timeout: 20000 },
  );
  expect(output).toContain(
    "Injected failure evidence (not historical reproduction)",
  );
});
