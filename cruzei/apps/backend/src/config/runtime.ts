import type { LogLevel } from '@nestjs/common';
import cluster from 'node:cluster';
import * as os from 'node:os';

/**
 * Parâmetros de execução lidos direto do process.env (antes do Nest existir): cluster, crons e logs.
 * Tudo aqui tem default igual ao comportamento antigo — sem nenhuma variável nova, o backend sobe como antes.
 */

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'sim']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'nao', 'não']);

function cpuCount(): number {
  return typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
}

/**
 * CLUSTER_WORKERS — nº de processos do backend (node:cluster).
 *   vazio/1 → processo único (comportamento de sempre)
 *   N > 1   → primário + N workers (limitado ao nº de CPUs lógicas)
 *   auto    → metade das CPUs lógicas (a outra metade fica pro Postgres, Redis e o gerador de carga na mesma máquina)
 */
export function clusterWorkerCount(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.CLUSTER_WORKERS ?? '').trim().toLowerCase();
  if (!raw) return 1;
  const max = cpuCount();
  if (raw === 'auto') return Math.max(1, Math.floor(max / 2));
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

/** Quantos processos dividem o banco/Redis a partir DESTE processo (1 fora do cluster). */
export function processesSharingResources(env: NodeJS.ProcessEnv = process.env): number {
  return cluster.isWorker ? clusterWorkerCount(env) : 1;
}

/** Índice 1..N do worker (0 = processo único/primário). O primário repassa o mesmo índice quando reinicia um worker. */
export function clusterWorkerIndex(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.CLUSTER_WORKER_INDEX ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Crons (@nestjs/schedule) rodam em UM processo só — senão cada worker purgaria locations / despausaria perfis em dobro.
 * IS_CRON_WORKER explícito vence (o primário do cluster marca só o worker 1; em vários hosts, marque 1 e desligue os
 * outros com IS_CRON_WORKER=0). Sem marcação: processo único roda, worker de cluster não roda.
 */
export function isCronWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.IS_CRON_WORKER ?? '').trim().toLowerCase();
  if (FALSE_VALUES.has(raw)) return false;
  if (TRUE_VALUES.has(raw)) return true;
  return !cluster.isWorker;
}

// ---- Logs ----

// do mais verboso pro mais grave (mesma ordem de severidade do Nest)
const LOG_LEVEL_ORDER: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];
const LOG_LEVEL_ALIASES: Record<string, LogLevel> = { info: 'log', warning: 'warn', trace: 'verbose' };

function toLogLevel(raw: string): LogLevel | null {
  const v = raw.trim().toLowerCase();
  const level = (LOG_LEVEL_ALIASES[v] ?? v) as LogLevel;
  return LOG_LEVEL_ORDER.includes(level) ? level : null;
}

/**
 * LOG_LEVEL → níveis do logger do Nest.
 *   "debug"            → debug e tudo acima (log, warn, error, fatal) — é um limiar
 *   "warn,error"       → lista explícita
 *   "off" / "silent"   → nada
 *   vazio              → development: todos (padrão do Nest, como antes); production: log e acima
 * `undefined` = não mexe no logger do Nest.
 */
export function resolveLogLevels(env: NodeJS.ProcessEnv = process.env): LogLevel[] | undefined {
  const raw = (env.LOG_LEVEL ?? '').trim().toLowerCase();
  if (!raw) return env.NODE_ENV === 'production' ? LOG_LEVEL_ORDER.slice(LOG_LEVEL_ORDER.indexOf('log')) : undefined;
  if (raw === 'off' || raw === 'silent' || raw === 'none') return [];
  if (raw.includes(',')) {
    const list = raw.split(',').map(toLogLevel).filter((l): l is LogLevel => l !== null);
    if (!list.includes('fatal') && list.includes('error')) list.push('fatal');
    return list.length ? list : undefined;
  }
  const threshold = toLogLevel(raw);
  return threshold ? LOG_LEVEL_ORDER.slice(LOG_LEVEL_ORDER.indexOf(threshold)) : undefined;
}

export type RequestLogMode = 'all' | 'slow' | 'off';

/**
 * LOG_REQUESTS — log por requisição HTTP.
 *   all  → toda requisição (padrão em development)
 *   slow → só as lentas (≥ LOG_SLOW_MS, padrão 1000 ms) ou com status ≥ 500 (padrão fora de development)
 *   off  → nenhuma (erros 5xx continuam no HttpExceptionFilter)
 */
export function resolveRequestLogMode(env: NodeJS.ProcessEnv = process.env): RequestLogMode {
  const raw = (env.LOG_REQUESTS ?? '').trim().toLowerCase();
  if (raw === 'all' || raw === 'slow' || raw === 'off') return raw;
  return (env.NODE_ENV ?? 'development') === 'development' ? 'all' : 'slow';
}

export function resolveSlowRequestMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.LOG_SLOW_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}
