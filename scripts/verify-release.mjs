import { access, readFile } from "node:fs/promises";
import path from "node:path";

const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const version = packageInfo.version;
const tag =
  process.argv.slice(2).find((argument) => argument.startsWith("v")) ||
  process.env.GITHUB_REF_NAME;
const verifyArtifacts = process.argv.includes("--artifacts");
const channelArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--channel="));
const channel = channelArgument?.slice("--channel=".length) || "beta";

if (!tag) throw new Error("Pass the release tag or set GITHUB_REF_NAME");
if (!new Set(["beta", "stable"]).has(channel))
  throw new Error(`Unknown release channel ${channel}`);
const isBeta = /^\d+\.\d+\.\d+-beta\.\d+$/.test(version);
const isStable = /^\d+\.\d+\.\d+$/.test(version);
if (channel === "beta" && !isBeta)
  throw new Error(`Beta releases require x.y.z-beta.n, got ${version}`);
if (channel === "stable" && !isStable)
  throw new Error(`Stable releases require x.y.z, got ${version}`);
if (tag !== `v${version}`)
  throw new Error(`Tag ${tag} must exactly match v${version}`);

if (verifyArtifacts) {
  const artifacts =
    channel === "beta"
      ? [
          `Harbor Player-${version}-x64-unsigned-Setup.exe`,
          `Harbor Player-${version}-x64-unsigned-Setup.exe.blockmap`,
          `Harbor Player-${version}-x64-unsigned-portable.exe`,
          "beta.yml",
        ]
      : [
          `Harbor Player-${version}-x64-Setup.exe`,
          `Harbor Player-${version}-x64-portable.exe`,
          "latest.yml",
        ];
  await Promise.all(
    artifacts.map((file) => access(path.join("release", file))),
  );
}

console.log(
  verifyArtifacts
    ? `Release ${tag} and its ${channel} update assets are valid`
    : `${channel} release ${tag} is valid`,
);
