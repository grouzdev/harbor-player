const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

module.exports = async function afterPack(context) {
  const executable = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
  });
};
