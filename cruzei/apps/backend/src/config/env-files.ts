import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Carregamento determinístico dos .env (independe do cwd de quem sobe o processo).
 *
 * Prioridade (quem vem antes vence, chave a chave):
 *   1. variáveis reais do ambiente (shell, cluster primário → workers)
 *   2. apps/backend/.env   — config do backend (ex.: DATABASE_URL com connection_limit/pool_timeout)
 *   3. <raiz do monorepo>/.env — valores compartilhados, só preenche o que faltou
 *
 * Antes era `envFilePath: ['../../.env', '.env']` relativo ao cwd: a raiz vencia (first-file-wins do ConfigModule)
 * e o DATABASE_URL sem connection_limit dela ignorava o pool configurado no backend.
 */

const BACKEND_PACKAGE_NAME = '@cruzei/backend';

/** Sobe a partir deste arquivo (src/config ou dist/src/config) até achar o package.json do backend. */
export function findBackendRoot(start: string = __dirname): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        if ((JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string }).name === BACKEND_PACKAGE_NAME) return dir;
      } catch {
        /* package.json ilegível: segue subindo */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const BACKEND_ROOT = findBackendRoot();

/** Em ordem de prioridade — o mesmo array vai pro ConfigModule (lá também é first-file-wins). */
export const ENV_FILE_PATHS: string[] = [path.join(BACKEND_ROOT, '.env'), path.resolve(BACKEND_ROOT, '..', '..', '.env')];

type EnvParser = (content: string) => Record<string, string>;

// mesmo parser do @nestjs/config (dotenv) pra não haver diferença de aspas/multilinha entre os dois carregamentos;
// sem ele (layout de node_modules diferente), o parser nativo do Node (compatível com dotenv)
function resolveParser(): EnvParser {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require('dotenv') as { parse: (src: string | Buffer) => Record<string, string> };
    if (typeof dotenv.parse === 'function') return (content) => dotenv.parse(content);
  } catch {
    /* dotenv não resolvível daqui */
  }
  return (content) => parseEnv(content) as Record<string, string>;
}

/**
 * Preenche `target` (process.env) com os arquivos, sem sobrescrever o que já existe.
 * Chamado no topo do main.ts: o primário do cluster precisa de CLUSTER_WORKERS antes de subir o Nest,
 * e os workers herdam o ambiente já resolvido.
 * @returns os arquivos efetivamente lidos
 */
export function loadEnvFiles(paths: string[] = ENV_FILE_PATHS, target: NodeJS.ProcessEnv = process.env): string[] {
  const parse = resolveParser();
  const loaded: string[] = [];
  for (const file of paths) {
    if (!fs.existsSync(file)) continue;
    const parsed = parse(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in target)) target[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}
