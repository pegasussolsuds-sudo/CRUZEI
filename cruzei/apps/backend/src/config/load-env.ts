// Importado PRIMEIRO no main.ts (efeito colateral): carrega os .env antes de qualquer módulo ler process.env.
// Várias constantes são lidas no import (ex.: PRIVACY em discovery-privacy.ts, cluster em config/runtime.ts);
// antes elas só enxergavam variáveis do shell, nunca as do .env.
import { loadEnvFiles } from './env-files';

loadEnvFiles();
