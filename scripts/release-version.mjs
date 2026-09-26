export const stableVersion = /^\d+\.\d+\.\d+$/;
export const betaVersion = /^\d+\.\d+\.\d+-beta\.\d+$/;

export function releaseChannel(version) {
  if (stableVersion.test(version)) return "stable";
  if (betaVersion.test(version)) return "beta";
  return null;
}

export function assertReleaseVersion(version) {
  if (releaseChannel(version)) return;
  throw new Error(
    `Версия должна иметь вид X.Y.Z или X.Y.Z-beta.N, получено: ${version}`,
  );
}
