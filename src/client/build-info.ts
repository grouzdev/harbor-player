declare const __HARBOR_BUILD_VERSION__: string;
declare const __HARBOR_BUILD_COMMIT__: string;

export const browserBuildInfo = {
  version: __HARBOR_BUILD_VERSION__,
  commit: __HARBOR_BUILD_COMMIT__,
};
