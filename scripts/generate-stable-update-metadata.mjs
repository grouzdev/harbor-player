import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const version = packageInfo.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Stable update metadata requires x.y.z, got ${version}`);
}

const fileName = `MyMusicLib-${version}-x64-Setup.exe`;
const artifactPath = path.join("release", fileName);
const [artifact, artifactStats] = await Promise.all([
  readFile(artifactPath),
  stat(artifactPath),
]);
const sha512 = createHash("sha512").update(artifact).digest("base64");
const releaseDate = new Date().toISOString();
const metadata = [
  `version: ${version}`,
  "files:",
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${artifactStats.size}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  "",
].join("\n");

await writeFile(path.join("release", "latest.yml"), metadata, "utf8");
console.log(`Generated release/latest.yml for ${fileName}`);
