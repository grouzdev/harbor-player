import { execFileSync } from "node:child_process";
import { assertReleaseVersion } from "./release-version.mjs";

const version = process.argv[2];
if (!version)
  throw new Error("Укажите версию: npm run release:prepare -- X.Y.Z");
assertReleaseVersion(version);

function git(...args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

if (git("status", "--porcelain"))
  throw new Error("Подготовка релиза требует чистого рабочего дерева");
if (git("tag", "--list", `v${version}`))
  throw new Error(`Тег v${version} уже существует`);

const npmCli = process.env.npm_execpath;
if (!npmCli)
  throw new Error("Запускайте подготовку релиза через npm run release:prepare");
execFileSync(
  process.execPath,
  [npmCli, "version", version, "--no-git-tag-version", "--ignore-scripts"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  },
);
