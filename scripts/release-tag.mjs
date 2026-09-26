import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assertReleaseVersion } from "./release-version.mjs";

function git(...args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

const packageInfo = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageInfo.version;
assertReleaseVersion(version);
const tag = `v${version}`;

if (git("status", "--porcelain"))
  throw new Error("Создание тега требует чистого рабочего дерева");
if (git("tag", "--list", tag)) throw new Error(`Тег ${tag} уже существует`);
if (git("tag", "--points-at", "HEAD"))
  throw new Error("Текущий commit уже помечен тегом");

execFileSync("git", ["tag", "-a", tag, "-m", `Release ${tag}`], {
  cwd: process.cwd(),
  stdio: "inherit",
  windowsHide: true,
});
