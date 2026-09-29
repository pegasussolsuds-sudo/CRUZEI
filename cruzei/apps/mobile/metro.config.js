// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const projectRoot = __dirname;
// monorepo root
const monorepoRoot = path.resolve(projectRoot, '../..');

// Config padrão do Expo + Debug ID do Sentry no bundle/source maps (casa o stack trace com o upload do build).
// getDefaultConfig passado explícito: resolve o expo/metro-config a partir do app, não de dentro do pacote do Sentry.
const config = getSentryExpoConfig(projectRoot, {
  getDefaultConfig,
  // anotar componentes injeta sentry-label com o texto da tela (nomes de outras pessoas) — desligado
  annotateReactComponents: false,
  // opções do Sentry só no código (src/services/sentry.ts), nunca de um sentry.options.json solto
  optionsFile: false,
});

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
