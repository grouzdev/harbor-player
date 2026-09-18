import { spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FuseState, FuseV1Options, getCurrentFuseWire } from "@electron/fuses";

const packageInfo = JSON.parse(
  await readFile(path.resolve("package.json"), "utf8"),
);
const expectedPortable =
  process.env.HARBOR_PLAYER_SMOKE_EXPECT_PORTABLE === "1";
const executable = path.resolve(
  process.env.HARBOR_PLAYER_DESKTOP_EXECUTABLE ||
    (expectedPortable
      ? path.join(
          "release",
          `Harbor Player-${packageInfo.version}-x64-unsigned-portable.exe`,
        )
      : path.join("release", "win-unpacked", "Harbor Player.exe")),
);
const root = await mkdtemp(
  path.join(os.tmpdir(), "harbor-player-desktop-smoke-"),
);
const dataDir = path.join(root, "data");
const libraryDir = path.join(root, "library");
const fixture = path.join(libraryDir, "sample.mp3");
const report = path.join(root, "report.json");
if (!expectedPortable) {
  const fuseWire = await getCurrentFuseWire(executable);
  if (fuseWire[FuseV1Options.RunAsNode] !== FuseState.DISABLE)
    throw new Error("RunAsNode fuse is not disabled");
}
await mkdir(dataDir, { recursive: true });
await mkdir(libraryDir, { recursive: true });
await copyFile(path.resolve(".fixtures", "sample.mp3"), fixture);

try {
  const { exitCode, output } = await new Promise((resolve, reject) => {
    const child = spawn(executable, [`--smoke-test=${fixture}`], {
      env: {
        ...process.env,
        HARBOR_PLAYER_DATA_DIR: dataDir,
        HARBOR_PLAYER_SMOKE_REPORT: report,
        ELECTRON_ENABLE_LOGGING: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 90_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (timedOut) reject(new Error(`Packaged smoke timed out\n${output}`));
      else resolve({ exitCode: code, output });
    });
  });
  const result = JSON.parse(
    await readFile(report, "utf8").catch(() =>
      JSON.stringify({
        ok: false,
        error: `Smoke report was not created\n${output}`,
      }),
    ),
  );
  if (exitCode !== 0 || result.ok !== true)
    throw new Error(
      result.error ||
        `Harbor Player exited with code ${exitCode} at ${result.phase || "unknown"}\n${output}`,
    );
  if (result.portable !== expectedPortable)
    throw new Error(
      `Expected portable=${expectedPortable}, got ${String(result.portable)}`,
    );
  console.log("Packaged desktop smoke passed");
} finally {
  if (!root.startsWith(path.join(os.tmpdir(), "harbor-player-desktop-smoke-")))
    throw new Error("Unsafe smoke cleanup path");
  await rm(root, { recursive: true, force: true });
}
