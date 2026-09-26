import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const version = packageInfo.version;

if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
  throw new Error(`Beta update metadata requires x.y.z-beta.n, got ${version}`);
}

const fileName = `Harbor Player-${version}-x64-unsigned-Setup.exe`;
const publishedFileName = fileName.replaceAll(" ", ".");
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
  `  - url: ${publishedFileName}`,
  `    sha512: ${sha512}`,
  `    size: ${artifactStats.size}`,
  `path: ${publishedFileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  "",
].join("\n");

await writeFile(path.join("release", "beta.yml"), metadata, "utf8");
console.log(`Generated release/beta.yml for ${publishedFileName}`);
