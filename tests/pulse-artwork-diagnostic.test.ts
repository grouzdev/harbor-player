import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

test("artwork memory evidence preserves byte units without summing allocators", () => {
  const output = execFileSync(
    process.execPath,
    ["--test", "scripts/pulse-artwork-diagnostic-evidence.test.mjs"],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(output).toContain("fail 0");
});
