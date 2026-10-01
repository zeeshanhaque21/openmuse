const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
// Static exports must not depend on a running desktop Watchman daemon.
if (process.env.CI) config.resolver.useWatchman = false;
const path = require("node:path");
config.watchFolders = [path.resolve(__dirname, "../..")];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "jose" || moduleName.startsWith("jose/")) {
    return context.resolveRequest(
      { ...context, unstable_conditionNames: ["browser", "require", "import"] },
      moduleName,
      platform,
    );
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
