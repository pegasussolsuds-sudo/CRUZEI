// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// monorepo root
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Force the Metro resolver to resolve modules from the monorepo root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 2. Watch the entire monorepo so changes in shared packages trigger reloads.
config.watchFolders = [monorepoRoot];

// 3. Enable Metro's symlink resolver so workspace packages resolve through pnpm symlinks.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
