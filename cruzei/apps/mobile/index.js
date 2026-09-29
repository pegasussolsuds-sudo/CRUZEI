import { initSentry, wrapRoot } from './src/services/sentry';
import { registerRootComponent } from 'expo';

// Sentry antes de tudo: o init roda antes de o App (e tudo que ele importa) ser avaliado, pra pegar até erro de
// carga de módulo. Sem DSN não faz nada. Os imports acima são içados, então os polyfills do Expo (fetch, URL…)
// já estão de pé quando o init roda.
initSentry();

// require (não import) de propósito: import seria içado pra cima do initSentry()
const { App } = require('./src/App');

registerRootComponent(wrapRoot(App));
