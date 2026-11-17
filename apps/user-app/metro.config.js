const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Keep Metro out of the sibling apps (admin is React 18 / Next, api is Node).
const escape = (p) => p.replace(/[/\\]/g, '[/\\\\]');
config.resolver.blockList = [
  new RegExp(escape(path.resolve(monorepoRoot, 'apps/admin')) + '[/\\\\].*'),
  new RegExp(escape(path.resolve(monorepoRoot, 'apps/api')) + '[/\\\\].*'),
];

// pnpm builds a second peer-variant of react-native for apps/admin (react 18),
// and some packages resolve to it. Metro then bundles TWO react-native copies,
// so registerRootComponent writes into one AppRegistry while native reads the
// other — the app boots to a black screen with `"main" has not been registered`.
// extraNodeModules can't fix it (only consulted when normal resolution fails),
// so rewrite every react / react-native request to this app's single copy.
const pinned = {
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  react: path.resolve(projectRoot, 'node_modules/react'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [name, base] of Object.entries(pinned)) {
    if (moduleName === name || moduleName.startsWith(name + '/')) {
      const subpath = moduleName.slice(name.length);
      return context.resolveRequest(context, base + subpath, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
