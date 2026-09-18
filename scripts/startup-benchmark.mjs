// @ts-check
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const runs = 5;
const root = await mkdtemp(path.resolve(".test-data/startup-benchmark-"));
const executable = path.resolve("node_modules/electron/dist/electron.exe");
if (process.platform !== "win32")
  throw new Error("Startup benchmark is defined for the Windows desktop shell");
if (!root.startsWith(path.resolve(".test-data") + path.sep))
  throw new Error("Unsafe startup benchmark path");

await mkdir(root, { recursive: true });

/** @param {number} run */
async function measure(run) {
  const report = path.join(root, `run-${run}.json`);
  const dataDir = path.join(root, `data-${run}`);
  await mkdir(dataDir, { recursive: true });
  const output = await new Promise((resolve, reject) => {
    const child = spawn(executable, ["."], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HARBOR_PLAYER_DATA_DIR: dataDir,
        HARBOR_PLAYER_PORT: "0",
        HARBOR_PLAYER_STARTUP_BENCHMARK_REPORT: report,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.stderr.on("data", (chunk) => (text += chunk));
    const timeout = setTimeout(() => child.kill(), 60_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(text);
      else
        reject(
          new Error(`Startup benchmark exited with code ${code}\n${text}`),
        );
    });
  });
  return JSON.parse(
    await readFile(report, "utf8").catch(() => {
      throw new Error(`Startup benchmark did not create ${report}\n${output}`);
    }),
  );
}

const results = [];
for (let run = 1; run <= runs; run++) results.push(await measure(run));
/** @param {number[]} values */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const summary = {
  runs: results,
  median: {
    mainEntryToReadyToShowMs: median(
      results.map((result) => result.mainEntryToReadyToShowMs),
    ),
    mainEntryToClientShellMs: median(
      results.map((result) => result.mainEntryToClientShellMs),
    ),
  },
};
await writeFile(
  path.join(root, "report.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(`Startup benchmark report: ${path.join(root, "report.json")}`);
console.log(JSON.stringify(summary.median));
