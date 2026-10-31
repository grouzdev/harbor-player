import { access, readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const version = packageInfo.version;
const tag =
  process.argv.slice(2).find((argument) => argument.startsWith("v")) ||
  process.env.GITHUB_REF_NAME;
const verifyArtifacts = process.argv.includes("--artifacts");
const verifyPublished = process.argv.includes("--published");
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
if (verifyPublished && !verifyArtifacts)
  throw new Error("--published requires --artifacts");

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
  if (channel === "beta") {
    const metadata = await readFile(path.join("release", "beta.yml"), "utf8");
    const publishedSetup = artifacts[0].replaceAll(" ", ".");
    if (
      !metadata.includes(`  - url: ${publishedSetup}`) ||
      !metadata.includes(`path: ${publishedSetup}`)
    )
      throw new Error(
        `beta.yml must reference the published setup asset ${publishedSetup}`,
      );
  }
  if (verifyPublished) {
    const repository = "grouzdev/harbor-player";
    const gh = (...args) =>
      execFileSync("gh", args, { encoding: "utf8", windowsHide: true });
    const release = JSON.parse(
      gh(
        "release",
        "view",
        tag,
        "--repo",
        repository,
        "--json",
        "tagName,isDraft,isPrerelease,assets,url",
      ),
    );
    if (
      release.tagName !== tag ||
      release.isDraft ||
      release.isPrerelease !== (channel === "beta")
    )
      throw new Error(
        "The expected release has not been published in its channel",
      );
    for (const file of artifacts) {
      const name = file.replaceAll(" ", ".");
      const asset = release.assets.find((item) => item.name === name);
      const local = await stat(path.join("release", file));
      if (!asset || asset.state !== "uploaded" || asset.size !== local.size)
        throw new Error(`Published asset missing or wrong size: ${name}`);
    }
    const metadataName = channel === "beta" ? "beta.yml" : "latest.yml";
    const publishedMetadata = gh(
      "release",
      "download",
      tag,
      "--repo",
      repository,
      "--pattern",
      metadataName,
      "--output",
      "-",
    );
    if (
      publishedMetadata !==
      (await readFile(path.join("release", metadataName), "utf8"))
    )
      throw new Error(
        "Published updater metadata differs from the checked build",
      );
    console.log(
      `Published release and uploaded assets verified: ${release.url}`,
    );
  }
}

console.log(
  verifyArtifacts
    ? `Release ${tag} and its ${channel} update assets are valid`
    : `${channel} release ${tag} is valid`,
);
