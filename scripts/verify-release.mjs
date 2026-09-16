import { access, readFile } from "node:fs/promises";
import path from "node:path";

const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const version = packageInfo.version;
const tag =
  process.argv.slice(2).find((argument) => argument.startsWith("v")) ||
  process.env.GITHUB_REF_NAME;
const verifyArtifacts = process.argv.includes("--artifacts");

if (!tag) throw new Error("Pass the release tag or set GITHUB_REF_NAME");
if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version))
  throw new Error(
    `Only unsigned beta versions may be published, got ${version}`,
  );
if (tag !== `v${version}`)
  throw new Error(`Tag ${tag} must exactly match v${version}`);

if (verifyArtifacts) {
  const artifacts = [
    `MyMusicLib-${version}-x64-unsigned-Setup.exe`,
    `MyMusicLib-${version}-x64-unsigned-Setup.exe.blockmap`,
    `MyMusicLib-${version}-x64-unsigned-portable.exe`,
    "beta.yml",
  ];
  await Promise.all(
    artifacts.map((file) => access(path.join("release", file))),
  );
}

console.log(
  verifyArtifacts
    ? `Release ${tag} and its beta update assets are valid`
    : `Release ${tag} is valid`,
);
