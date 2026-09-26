import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const placeholder = "__HARBOR_BUILD_COMMIT__";
const output = path.resolve("dist", "desktop", "main.js");

function buildCommit() {
  if (/^[0-9a-f]{7,}$/i.test(process.env.GITHUB_SHA || ""))
    return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  } catch {
    return "unknown";
  }
}

const source = await readFile(output, "utf8");
if (!source.includes(placeholder))
  throw new Error(`Build marker ${placeholder} was not found in ${output}`);
await writeFile(output, source.replaceAll(placeholder, buildCommit()));
