import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  diffFingerprints,
  FingerprintDiff,
  isSameFingerprint,
  schemaFingerprint,
} from './fingerprint';
import {
  defaultMigrationsDir,
  isDataOnly,
  loadMigrations,
  MIGRATION_NAME_RE,
  MigrationFile,
} from './migration-files';
import {
  assertDbName,
  ConnectFn,
  databaseOf,
  pgErrorOf,
  prismaConnect,
  SqlConn,
  withDatabase,
} from './sql-conn';

/**
 * Executor de migrations do Metch (substitui o "docker exec psql < migration.sql" manual e o prisma migrate, que
 * apagaria o que o schema.prisma não modela: PostGIS, place_*, índices parciais, gatilhos).
 *
 * - histórico em schema_migrations (nome + sha256 do arquivo); arquivo alterado depois de aplicado = erro
 * - aplica em ordem de nome, UMA transação por arquivo (BEGIN/COMMIT do arquivo são ignorados), com lock_timeout
 * - advisory lock de sessão: duas execuções ao mesmo tempo (deploy em paralelo) não aplicam nada duas vezes
 * - baseline: marca como aplicado, sem executar, o que o banco já tem (confere o catálogo num banco temporário)
 */

export const DEFAULT_TABLE = 'schema_migrations';
export const DEFAULT_LOCK_TIMEOUT = '15s';
export const DEFAULT_TX_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_LOCK_WAIT_MS = 10 * 60_000;

const TABLE_RE = /^([a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*$/;
const LOCK_TIMEOUT_RE = /^\d+(ms|s|min)?$/;
// bancos que o executor recria/apaga: só de teste ou de conferência (nunca o dev/produção por engano)
const DISPOSABLE_DB_RE = /_(test|check)$/;

export type Logger = (msg: string) => void;

export type MigrateErrorCode =
  | 'usage'
  | 'plan'
  | 'untracked_db'
  | 'empty_db'
  | 'lock_wait'
  | 'statement'
  | 'baseline_mismatch'
  | 'not_applied'
  | 'baseline_refused';

export class MigrateError extends Error {
  constructor(
    readonly code: MigrateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MigrateError';
  }
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  appliedAt: Date | null;
  baseline: boolean;
  repaired: boolean;
}

export type PlanProblemKind = 'checksum_mismatch' | 'missing_file' | 'out_of_order';

export interface PlanProblem {
  kind: PlanProblemKind;
  name: string;
  /** out_of_order: a maior já aplicada */
  after?: string;
}

export interface MigrationPlan {
  pending: MigrationFile[];
  problems: PlanProblem[];
}

export interface PlanOptions {
  upTo?: string;
  allowOutOfOrder?: boolean;
}

/** puro: o que falta aplicar e o que impede (arquivo mudou, sumiu ou chegou fora de ordem) */
export function plan(
  files: MigrationFile[],
  applied: AppliedMigration[],
  opts: PlanOptions = {},
): MigrationPlan {
  const appliedByName = new Map(applied.map((a) => [a.name, a]));
  const fileNames = new Set(files.map((f) => f.name));
  const problems: PlanProblem[] = [];

  for (const a of applied)
    if (!fileNames.has(a.name)) problems.push({ kind: 'missing_file', name: a.name });
  for (const f of files) {
    const a = appliedByName.get(f.name);
    if (a && a.checksum !== f.checksum) problems.push({ kind: 'checksum_mismatch', name: f.name });
  }

  let pending = [...files].sort(byName).filter((f) => !appliedByName.has(f.name));
  if (opts.upTo) pending = pending.filter((f) => f.name <= (opts.upTo as string));

  const lastApplied = applied.reduce((max, a) => (a.name > max ? a.name : max), '');
  if (!opts.allowOutOfOrder) {
    for (const f of pending) {
      if (f.name < lastApplied)
        problems.push({ kind: 'out_of_order', name: f.name, after: lastApplied });
    }
  }
  problems.sort(byName);
  return { pending, problems };
}

function byName(x: { name: string }, y: { name: string }): number {
  return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
}

export function describeProblem(p: PlanProblem): string {
  switch (p.kind) {
    case 'checksum_mismatch':
      return (
        `${p.name}: o arquivo mudou depois de aplicado (checksum diferente). Não edite migration aplicada: crie outra. ` +
        `Se foi só comentário, revise e rode db:migrate:repair ${p.name}`
      );
    case 'missing_file':
      return `${p.name}: aplicada neste banco, mas o arquivo não existe (branch antigo? pasta apagada/renomeada?)`;
    case 'out_of_order':
      return (
        `${p.name}: pendente, mas é mais antiga que a última aplicada (${p.after}). Renomeie com um prefixo novo ` +
        '(db:migrate:new) ou, depois de conferir que não depende da ordem, rode com --allow-out-of-order'
      );
  }
}

// ---------- opções comuns ----------

export interface CommonOptions {
  url: string;
  /** pasta das migrations (padrão: apps/backend/prisma/migrations) */
  dir?: string;
  /** arquivos já carregados (em vez de ler `dir`) */
  files?: MigrationFile[];
  /** tabela do histórico; aceita schema.tabela (padrão schema_migrations no schema atual) */
  table?: string;
  log?: Logger;
  connect?: ConnectFn;
  /** espera máxima pelo advisory lock quando outra execução está rodando */
  lockWaitMs?: number;
  lockPollMs?: number;
}

export interface MigrateOptions extends CommonOptions {
  upTo?: string;
  dryRun?: boolean;
  /** SET LOCAL lock_timeout de cada migration (um ALTER TABLE não enfileira o app atrás dele) */
  lockTimeout?: string;
  /** timeout da transação interativa do Prisma por arquivo (o padrão do Prisma, 5 s, derrubaria o init) */
  txTimeoutMs?: number;
  allowOutOfOrder?: boolean;
  /** pula a trava "banco com tabelas e sem histórico" (testes com a tabela em outro schema) */
  allowUntrackedDb?: boolean;
}

export interface MigrateResult {
  applied: string[];
  pending: string[];
}

const noop: Logger = () => undefined;

function tableOf(opts: CommonOptions): string {
  const table = opts.table ?? DEFAULT_TABLE;
  if (!TABLE_RE.test(table)) throw new MigrateError('usage', `nome de tabela inválido: ${table}`);
  return table;
}

function bareName(table: string): string {
  const parts = table.split('.');
  return parts[parts.length - 1];
}

function filesOf(opts: CommonOptions): MigrationFile[] {
  return opts.files ?? loadMigrations(opts.dir ?? defaultMigrationsDir());
}

function assertUpTo(files: MigrationFile[], upTo?: string): void {
  if (upTo && !files.some((f) => f.name === upTo)) {
    throw new MigrateError('usage', `--up-to ${upTo}: não existe migration com esse nome`);
  }
}

export function checkLockTimeout(value: string): string {
  if (!LOCK_TIMEOUT_RE.test(value)) {
    throw new MigrateError('usage', `lock_timeout inválido: "${value}" (ex.: 15s, 500ms, 2min)`);
  }
  return value;
}

/** chave do advisory lock (int4 estável por tabela de histórico) */
export function lockKeyFor(table: string): number {
  return createHash('sha256').update(`metch:migrate:${table}`).digest().readInt32BE(0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- conexão ----------

async function withConn<T>(
  url: string,
  connect: ConnectFn,
  fn: (c: SqlConn) => Promise<T>,
): Promise<T> {
  const conn = connect(url);
  try {
    return await fn(conn);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

/** conexão única + advisory lock de sessão durante toda a execução */
async function withLockedSession<T>(
  opts: CommonOptions,
  fn: (c: SqlConn, table: string) => Promise<T>,
): Promise<T> {
  const table = tableOf(opts);
  const log = opts.log ?? noop;
  const key = lockKeyFor(table);
  return withConn(opts.url, opts.connect ?? prismaConnect, async (conn) => {
    const deadline = Date.now() + (opts.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS);
    let warned = false;
    for (;;) {
      const [row] = await conn.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(${key}) AS ok`);
      if (row?.ok) break;
      if (!warned) {
        log('outra execução do executor está rodando neste banco; aguardando ela terminar…');
        warned = true;
      }
      if (Date.now() > deadline) {
        throw new MigrateError(
          'lock_wait',
          'desisti de esperar o advisory lock (outra execução ainda está rodando)',
        );
      }
      await sleep(opts.lockPollMs ?? 500);
    }
    try {
      return await fn(conn, table);
    } finally {
      await conn.query(`SELECT pg_advisory_unlock(${key}) AS ok`).catch(() => undefined);
    }
  });
}

// ---------- tabela do histórico ----------

async function ensureTable(conn: SqlConn, table: string): Promise<void> {
  await conn.exec(`CREATE TABLE IF NOT EXISTS ${table} (
    name VARCHAR(255) PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    applied_by VARCHAR(128) NOT NULL DEFAULT current_user,
    duration_ms INTEGER,
    baseline BOOLEAN NOT NULL DEFAULT false,
    checksum_repaired_at TIMESTAMPTZ(6)
  )`);
}

async function tableExists(conn: SqlConn, table: string): Promise<boolean> {
  const [row] = await conn.query<{ t: string | null }>('SELECT to_regclass($1)::text AS t', table);
  return !!row?.t;
}

async function readApplied(conn: SqlConn, table: string): Promise<AppliedMigration[]> {
  if (!(await tableExists(conn, table))) return [];
  const rows = await conn.query<{
    name: string;
    checksum: string;
    applied_at: Date | null;
    baseline: boolean;
    repaired: boolean;
  }>(
    `SELECT name::text AS name, checksum::text AS checksum, applied_at, baseline,
            (checksum_repaired_at IS NOT NULL) AS repaired
       FROM ${table} ORDER BY name`,
  );
  return rows.map((r) => ({
    name: r.name,
    checksum: r.checksum.trim(),
    appliedAt: r.applied_at,
    baseline: r.baseline,
    repaired: r.repaired,
  }));
}

/** o banco tem tabela própria (fora a do executor e as de extensão, tipo spatial_ref_sys)? */
async function hasUserTables(conn: SqlConn, table: string): Promise<boolean> {
  const [row] = await conn.query<{ has: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class c
        WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
          AND c.relkind IN ('r', 'p') AND c.relname <> $1
          AND NOT EXISTS (SELECT 1 FROM pg_depend d
                           WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
     ) AS has`,
    bareName(table),
  );
  return !!row?.has;
}

async function isRecorded(conn: SqlConn, table: string, name: string): Promise<boolean> {
  const rows = await conn.query(`SELECT 1 AS one FROM ${table} WHERE name = $1`, name);
  return rows.length > 0;
}

// ---------- aplicar ----------

function preview(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}

async function runStatement(conn: SqlConn, f: MigrationFile, k: number): Promise<void> {
  const st = f.statements[k];
  try {
    await conn.exec(st.sql);
  } catch (e) {
    const { sqlstate, message } = pgErrorOf(e);
    const hint = /expired transaction|Transaction already closed/i.test(message)
      ? ' (passou do MIGRATE_TX_TIMEOUT_MS)'
      : '';
    throw new MigrateError(
      'statement',
      `${f.name}: comando ${k + 1}/${f.statements.length} (linha ${st.line}) falhou` +
        `${sqlstate ? ` [${sqlstate}]` : ''}: ${message}${hint}\n    ${preview(st.sql)}\n  ` +
        (f.transactional
          ? 'nada deste arquivo ficou no banco (rollback); as migrations anteriores continuam aplicadas'
          : 'arquivo sem transação: o que rodou antes deste comando ficou no banco (o arquivo tem que ser idempotente)'),
    );
  }
}

async function record(conn: SqlConn, table: string, f: MigrationFile, ms: number): Promise<void> {
  await conn.exec(
    `INSERT INTO ${table} (name, checksum, duration_ms) VALUES ($1, $2, $3)`,
    f.name,
    f.checksum,
    ms,
  );
}

/** aplica um arquivo; devolve a duração, ou null se outra execução já tinha registrado */
async function applyOne(
  conn: SqlConn,
  table: string,
  f: MigrationFile,
  lockTimeout: string,
  txTimeoutMs: number,
): Promise<number | null> {
  const t0 = Date.now();
  if (!f.transactional) {
    if (await isRecorded(conn, table, f.name)) return null;
    await conn.exec(`SET lock_timeout = '${lockTimeout}'`);
    try {
      for (let k = 0; k < f.statements.length; k++) await runStatement(conn, f, k);
    } finally {
      await conn.exec('SET lock_timeout TO DEFAULT').catch(() => undefined);
    }
    const ms = Date.now() - t0;
    await record(conn, table, f, ms);
    return ms;
  }
  return conn.tx(async (tx) => {
    await tx.exec(`SET LOCAL lock_timeout = '${lockTimeout}'`);
    if (await isRecorded(tx, table, f.name)) return null;
    for (let k = 0; k < f.statements.length; k++) await runStatement(tx, f, k);
    const ms = Date.now() - t0;
    await record(tx, table, f, ms);
    return ms;
  }, txTimeoutMs);
}

export async function migrate(opts: MigrateOptions): Promise<MigrateResult> {
  const log = opts.log ?? noop;
  const files = filesOf(opts);
  assertUpTo(files, opts.upTo);
  const lockTimeout = checkLockTimeout(opts.lockTimeout ?? DEFAULT_LOCK_TIMEOUT);
  const txTimeoutMs = opts.txTimeoutMs ?? DEFAULT_TX_TIMEOUT_MS;

  return withLockedSession(opts, async (conn, table) => {
    const applied = await readApplied(conn, table);
    if (applied.length === 0 && !opts.allowUntrackedDb && (await hasUserTables(conn, table))) {
      throw new MigrateError(
        'untracked_db',
        `o banco já tem tabelas e o histórico (${table}) está vazio: ele foi montado sem o executor. ` +
          'Rode db:migrate:baseline uma vez (marca o que já existe, sem executar) e depois db:migrate',
      );
    }
    // a tabela só nasce depois das travas: banco recusado fica como estava
    if (!opts.dryRun) await ensureTable(conn, table);
    const p = plan(files, applied, opts);
    if (p.problems.length) {
      throw new MigrateError(
        'plan',
        [
          'as migrations não batem com o banco:',
          ...p.problems.map((x) => `  - ${describeProblem(x)}`),
        ].join('\n'),
      );
    }
    const pendingNames = p.pending.map((f) => f.name);
    if (!p.pending.length) {
      log('nada a aplicar');
      return { applied: [], pending: [] };
    }
    if (opts.dryRun) {
      for (const f of p.pending)
        log(`pendente: ${f.name}${f.transactional ? '' : ' (sem transação)'}`);
      return { applied: [], pending: pendingNames };
    }
    const done: string[] = [];
    for (const f of p.pending) {
      const ms = await applyOne(conn, table, f, lockTimeout, txTimeoutMs);
      if (ms === null) log(`${f.name}: já registrada por outra execução`);
      else {
        log(`aplicada ${f.name} (${ms} ms)`);
        done.push(f.name);
      }
    }
    return { applied: done, pending: [] };
  });
}

// ---------- status ----------

export type StatusState = 'applied' | 'pending' | 'changed' | 'missing_file';

export interface StatusRow {
  name: string;
  state: StatusState;
  appliedAt?: Date | null;
  baseline?: boolean;
  repaired?: boolean;
}

export interface StatusResult {
  rows: StatusRow[];
  problems: PlanProblem[];
  tableExists: boolean;
  /** tudo aplicado e nenhum problema */
  clean: boolean;
}

export function statusRows(files: MigrationFile[], applied: AppliedMigration[]): StatusRow[] {
  const appliedMap = new Map(applied.map((a) => [a.name, a]));
  const rows: StatusRow[] = files.map((f) => {
    const a = appliedMap.get(f.name);
    if (!a) return { name: f.name, state: 'pending' };
    return {
      name: f.name,
      state: a.checksum === f.checksum ? 'applied' : 'changed',
      appliedAt: a.appliedAt,
      baseline: a.baseline,
      repaired: a.repaired,
    };
  });
  const fileNames = new Set(files.map((f) => f.name));
  for (const a of applied) {
    if (!fileNames.has(a.name))
      rows.push({ name: a.name, state: 'missing_file', appliedAt: a.appliedAt });
  }
  return rows.sort(byName);
}

/** só lê: não cria a tabela nem pega o lock */
export async function status(opts: CommonOptions): Promise<StatusResult> {
  const files = filesOf(opts);
  const table = tableOf(opts);
  return withConn(opts.url, opts.connect ?? prismaConnect, async (conn) => {
    const exists = await tableExists(conn, table);
    const applied = exists ? await readApplied(conn, table) : [];
    const rows = statusRows(files, applied);
    const { problems } = plan(files, applied);
    return {
      rows,
      problems,
      tableExists: exists,
      clean: !problems.length && rows.every((r) => r.state === 'applied'),
    };
  });
}

// ---------- baseline ----------

export interface BaselineOptions extends CommonOptions {
  upTo?: string;
  /** confere o catálogo num banco temporário antes de marcar (padrão true; exige CREATEDB) */
  verify?: boolean;
  /** obrigatório com verify=false */
  yes?: boolean;
  lockTimeout?: string;
  txTimeoutMs?: number;
  /** só de dados que a pessoa conferiu no banco e confirma que já rodaram (--assume-data; o catálogo não prova) */
  assumeData?: string[];
}

export interface BaselineResult {
  marked: string[];
  verified: boolean;
  /** linhas do catálogo comparadas (quando conferiu) */
  catalogLines?: number;
}

/** TODAS as só de dados entre as que seriam marcadas (no meio ou no fim), fora as confirmadas com --assume-data */
export function unprovenDataOnly(
  pending: MigrationFile[],
  assumed: Iterable<string> = [],
): MigrationFile[] {
  const ok = new Set(assumed);
  return pending.filter((f) => isDataOnly(f) && !ok.has(f.name));
}

/** --assume-data: cada nome tem que existir e ser só de dados (erro de digitação não confirma nada) */
export function checkAssumeData(files: MigrationFile[], names: string[]): string[] {
  const byName = new Map(files.map((f) => [f.name, f]));
  for (const n of names) {
    const f = byName.get(n);
    if (!f)
      throw new MigrateError('usage', `--assume-data ${n}: não existe migration com esse nome`);
    if (!isDataOnly(f)) {
      throw new MigrateError(
        'usage',
        `--assume-data ${n}: essa mexe em estrutura (o catálogo confere sozinho); tire do --assume-data`,
      );
    }
  }
  return [...new Set(names)];
}

export function formatDiff(d: FingerprintDiff, max = 40): string {
  const part = (title: string, lines: string[]) =>
    lines.length
      ? [
          `  ${title} (${lines.length}):`,
          ...lines.slice(0, max).map((l) => `    ${l}`),
          ...(lines.length > max ? [`    … mais ${lines.length - max}`] : []),
        ]
      : [];
  return [
    ...part('só no banco', d.onlyInDb),
    ...part('só nas migrations', d.onlyInMigrations),
  ].join('\n');
}

/** marca como aplicadas (sem executar) as migrations até `upTo` que o banco já tem */
export async function baseline(opts: BaselineOptions): Promise<BaselineResult> {
  const log = opts.log ?? noop;
  const verify = opts.verify ?? true;
  if (!verify && !opts.yes) {
    throw new MigrateError(
      'usage',
      '--no-verify só junto com --yes (marca sem conferir o catálogo)',
    );
  }
  const files = filesOf(opts);
  assertUpTo(files, opts.upTo);
  const assumed = checkAssumeData(files, opts.assumeData ?? []);
  const connect = opts.connect ?? prismaConnect;

  return withLockedSession(opts, async (conn, table) => {
    if (!(await hasUserTables(conn, table))) {
      throw new MigrateError(
        'empty_db',
        'banco vazio: não há o que marcar. Use db:migrate (aplica tudo)',
      );
    }
    // a tabela só é criada depois da conferência: se não bater, o banco fica como estava
    const applied = await readApplied(conn, table);
    const p = plan(files, applied, { upTo: opts.upTo, allowOutOfOrder: true });
    const blocking = p.problems.filter((x) => x.kind !== 'out_of_order');
    if (blocking.length) {
      throw new MigrateError(
        'plan',
        [
          'o histórico atual não bate com os arquivos:',
          ...blocking.map((x) => `  - ${describeProblem(x)}`),
        ].join('\n'),
      );
    }
    if (!p.pending.length) {
      log('nada a marcar: tudo já está no histórico');
      return { marked: [], verified: false };
    }
    // banco com histórico anda com db:migrate; baseline de novo só com alvo explícito (migration aplicada à mão)
    if (!opts.upTo && applied.length) {
      throw new MigrateError(
        'baseline_refused',
        `o banco já tem histórico (${applied.length} aplicadas): use db:migrate. ` +
          'Baseline de novo só com --up-to <nome> (migration aplicada à mão, já conferida)',
      );
    }
    // só de dados (no meio ou no fim) não deixa rastro no catálogo: marcar sem saber se rodou = ela nunca roda
    const pendingNames = new Set(p.pending.map((f) => f.name));
    const stray = assumed.filter((n) => !pendingNames.has(n));
    if (stray.length) {
      throw new MigrateError(
        'usage',
        `--assume-data ${stray.join(' ')}: não está entre as que este baseline marcaria (já no histórico ou depois do --up-to)`,
      );
    }
    const unproven = unprovenDataOnly(p.pending, assumed);
    if (unproven.length) {
      const first = unproven[0];
      const before = p.pending[p.pending.indexOf(first) - 1];
      const target = p.pending[p.pending.length - 1];
      // não rodou: marca até a anterior, aplica ela de verdade e (se sobrar) marca o resto
      const steps = [
        ...(before ? [`baseline --up-to ${before.name}`] : []),
        first === target ? 'db:migrate (aplica o resto)' : `db:migrate --up-to ${first.name}`,
        ...(first === target ? [] : [`baseline --up-to ${target.name} pro resto`]),
      ];
      throw new MigrateError(
        'baseline_refused',
        [
          'nada foi marcado: estas migrations só mexem em dados e o catálogo não mostra se rodaram neste banco:',
          ...unproven.map((f) => `  - ${f.name}`),
          'Confira cada uma no banco.',
          `  Já rodaram: repita com --assume-data ${unproven.map((f) => f.name).join(' ')}`,
          `  ${first.name} não rodou: ${steps.join(', depois ')}`,
        ].join('\n'),
      );
    }
    for (const n of assumed) log(`só de dados, confirmada à mão (--assume-data): ${n}`);

    let catalogLines: number | undefined;
    if (verify) {
      const dbName = databaseOf(opts.url);
      const tmp = assertDbName(`${dbName}_baseline_check`.slice(0, 63));
      const adminUrl = withDatabase(opts.url, 'postgres');
      const tmpUrl = withDatabase(opts.url, tmp);
      log(
        `conferindo: montando ${tmp} do zero pelas migrations${opts.upTo ? ` até ${opts.upTo}` : ''}…`,
      );
      await recreateDatabase(adminUrl, tmp, connect);
      let diff: FingerprintDiff;
      try {
        await migrate({
          url: tmpUrl,
          files,
          upTo: opts.upTo,
          table,
          connect,
          lockTimeout: opts.lockTimeout,
          txTimeoutMs: opts.txTimeoutMs,
        });
        const fresh = await withConn(tmpUrl, connect, (c) => schemaFingerprint(c, table));
        const current = await schemaFingerprint(conn, table);
        diff = diffFingerprints(current, fresh);
        catalogLines = current.length;
      } finally {
        await dropDatabase(adminUrl, tmp, connect).catch((e) =>
          log(`aviso: não consegui apagar ${tmp}: ${pgErrorOf(e).message}`),
        );
      }
      if (!isSameFingerprint(diff)) {
        throw new MigrateError(
          'baseline_mismatch',
          'o banco NÃO bate com as migrations; nada foi marcado.\n' +
            formatDiff(diff) +
            '\n  Aplique à mão o que falta (ou use --up-to com a última que o banco tem e deixe o db:migrate aplicar o resto).',
        );
      }
      log(`catálogo idêntico ao de um banco novo (${catalogLines} linhas)`);
    }

    await ensureTable(conn, table);
    await conn.tx(async (tx) => {
      for (const f of p.pending) {
        await tx.exec(
          `INSERT INTO ${table} (name, checksum, baseline) VALUES ($1, $2, true) ON CONFLICT (name) DO NOTHING`,
          f.name,
          f.checksum,
        );
      }
    }, 60_000);
    for (const f of p.pending) log(`marcada (baseline): ${f.name}`);
    return { marked: p.pending.map((f) => f.name), verified: verify, catalogLines };
  });
}

// ---------- repair ----------

/** depois de revisão humana (ex.: só mudou comentário): grava o checksum atual do arquivo */
export async function repair(
  opts: CommonOptions & { name: string },
): Promise<{ from: string; to: string }> {
  const files = filesOf(opts);
  const f = files.find((x) => x.name === opts.name);
  if (!f) throw new MigrateError('usage', `${opts.name}: não existe migration com esse nome`);
  return withLockedSession(opts, async (conn, table) => {
    const applied = (await readApplied(conn, table)).find((a) => a.name === f.name);
    if (!applied)
      throw new MigrateError('not_applied', `${f.name}: ainda não foi aplicada neste banco`);
    if (applied.checksum === f.checksum) return { from: applied.checksum, to: f.checksum };
    await conn.exec(
      `UPDATE ${table} SET checksum = $1, checksum_repaired_at = now() WHERE name = $2`,
      f.checksum,
      f.name,
    );
    return { from: applied.checksum, to: f.checksum };
  });
}

// ---------- bancos descartáveis (teste / conferência) ----------

function assertDisposable(adminUrl: string, name: string): void {
  assertDbName(name);
  if (!DISPOSABLE_DB_RE.test(name) || name === databaseOf(adminUrl)) {
    throw new MigrateError(
      'usage',
      `recuso recriar/apagar o banco "${name}": só bancos *_test ou *_check`,
    );
  }
}

/** DROP (com FORCE) + CREATE, fora de transação, pela URL de manutenção (/postgres) */
export async function recreateDatabase(
  adminUrl: string,
  name: string,
  connect: ConnectFn = prismaConnect,
) {
  assertDisposable(adminUrl, name);
  await withConn(adminUrl, connect, async (c) => {
    await c.exec(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.exec(`CREATE DATABASE "${name}"`);
  });
}

export async function dropDatabase(
  adminUrl: string,
  name: string,
  connect: ConnectFn = prismaConnect,
) {
  assertDisposable(adminUrl, name);
  await withConn(adminUrl, connect, (c) =>
    c.exec(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  );
}

// ---------- banco de teste ----------

export const TEST_DB_NAME = 'cruzei_test';

/** mesma regra do test/db/env.ts: DATABASE_URL_TEST, ou a DATABASE_URL trocando só o banco por cruzei_test */
export function testDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL_TEST) return env.DATABASE_URL_TEST;
  if (!env.DATABASE_URL) {
    throw new MigrateError(
      'usage',
      'sem DATABASE_URL_TEST nem DATABASE_URL (ambiente ou apps/backend/.env)',
    );
  }
  return withDatabase(env.DATABASE_URL, TEST_DB_NAME);
}

/** recria o banco de teste DO ZERO e aplica tudo pelo executor (prova que um banco novo sai completo) */
export async function resetTestDatabase(opts: MigrateOptions): Promise<MigrateResult> {
  const log = opts.log ?? noop;
  const name = databaseOf(opts.url);
  const connect = opts.connect ?? prismaConnect;
  // assertDisposable dentro: só *_test/*_check, nunca o dev/produção
  await recreateDatabase(withDatabase(opts.url, 'postgres'), name, connect);
  log(`recriado ${name}`);
  const r = await migrate({ ...opts, connect, upTo: undefined, dryRun: false });
  const s = await status({ ...opts, connect });
  if (!s.clean) throw new MigrateError('plan', `${name} não ficou em dia depois do migrate`);
  return r;
}

// ---------- nova migration ----------

function utcStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    p(d.getUTCFullYear(), 4) +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds())
  );
}

/**
 * Prefixo da próxima migration: o maior entre "agora" (UTC) e o último prefixo + 100. Os nomes do projeto estão à
 * frente do calendário (20261005… em 30/09); só "agora" criaria uma migration "antiga", barrada como fora de ordem.
 */
export function nextMigrationPrefix(existing: string[], now: Date = new Date()): string {
  const current = utcStamp(now);
  const last = existing
    .filter((n) => MIGRATION_NAME_RE.test(n))
    .map((n) => n.slice(0, 14))
    .sort()
    .pop();
  if (!last) return current;
  const bumped = String(Number(last) + 100).padStart(14, '0');
  return current > bumped ? current : bumped;
}

export function migrationSlug(raw: string): string {
  const slug = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  if (!slug) throw new MigrateError('usage', `nome de migration inválido: "${raw}"`);
  return slug;
}

/** cria <dir>/<prefixo>_<nome>/migration.sql com o modelo; devolve o caminho do arquivo */
export function newMigration(dir: string, rawName: string, now: Date = new Date()): string {
  const slug = migrationSlug(rawName);
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const folder = `${nextMigrationPrefix(existing, now)}_${slug}`;
  const file = path.join(dir, folder, 'migration.sql');
  const day = `${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      `-- ${slug.replace(/_/g, ' ')} (${day}): o que muda e por quê.`,
      '-- Uma transação por arquivo: o executor abre e fecha (sem BEGIN/COMMIT aqui). Idempotente quando der',
      '-- (IF NOT EXISTS / OR REPLACE / DO ... EXCEPTION WHEN duplicate_object). Depois de aplicada, não edite: crie outra.',
      '-- Aplicar: pnpm --filter @cruzei/backend db:migrate   (produção: db:migrate:prod, passo separado do deploy)',
      '',
      '',
    ].join('\n'),
    { flag: 'wx' },
  );
  return file;
}
