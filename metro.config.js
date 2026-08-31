const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// @nocturnalflow/design-system is consumed via a `file:` symlink to a sibling
// repo (../NocturnalFlowRN) that has its own node_modules. Every package it
// declares as a peerDependency (react, react-native, expo, reanimated, etc.)
// is installed separately there, so Metro's default hierarchical node_modules
// walk — which starts from the symlinked source file's real location — finds
// NocturnalFlowRN's copy before ever considering this app's. That gives two
// distinct module instances of singleton-dependent packages (breaks React
// hooks, Reanimated, gesture handler, etc). `extraNodeModules` alone can't
// fix this: it's only consulted as a fallback *after* the hierarchical walk
// fails, and the walk here always succeeds (just at the wrong path). Instead,
// force resolution of these package names to always start its walk from this
// app's own root, so it's this app's copy that wins.
const singletonPackages = new Set(
  Object.keys(
    require('../NocturnalFlowRN/packages/design-system/package.json').peerDependencies
  )
);

const anchorModulePath = path.join(projectRoot, 'package.json');
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const topLevelName = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];

  const resolveContext =
    singletonPackages.has(topLevelName) && context.originModulePath !== anchorModulePath
      ? { ...context, originModulePath: anchorModulePath }
      : context;

  if (defaultResolveRequest) {
    return defaultResolveRequest(resolveContext, moduleName, platform);
  }
  return resolveContext.resolveRequest(resolveContext, moduleName, platform);
};

module.exports = config;
