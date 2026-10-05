/* Executor de migrations — linha de comando.
 *
 *   up        aplica as pendentes, em ordem, uma transação por arquivo      (pnpm db:migrate; produção: db:migrate:prod)
 *   status    lista aplicadas/pendentes/alteradas; --check sai com 1 se não estiver tudo aplicado
 *   baseline  marca como aplicado, SEM executar, o que o banco já tem (uma vez por banco montado à mão com psql)
 *   repair    grava o checksum atual de uma migration já aplicada (só depois de revisar: ex. mudou só comentário)
 *   new       cria prisma/migrations/<prefixo>_<nome>/migration.sql
 *   test-db   recria o banco de TESTE (cruzei_test) do zero e aplica tudo   (pnpm test:db:setup)
 *
 * URL: MIGRATE_DATABASE_URL (papel com DDL, conexão direta, sem pgbouncer) ou DATABASE_URL, dos .env do backend.
 * test-db: DATABASE_URL_TEST, ou a DATABASE_URL trocando só o banco por cruzei_test (igual ao test/db/env.ts).
 * Nunca imprime usuário/senha: só host:porta/banco.
 */
import { loadEnvFiles } from '../../config/env-files';

import { defaultMigrationsDir } from './migration-files';
import {
  baseline,
  DEFAULT_LOCK_TIMEOUT,
  DEFAULT_TX_TIMEOUT_MS,
  migrate,
  MigrateError,
  newMigration,
  repair,
  resetTestDatabase,
  status,
  StatusRow,
  testDatabaseUrl,
} from './runner';
import { describeUrl } from './sql-conn';

const USAGE = `uso: migrate <comando> [opções]
  up        [--dry-run] [--up-to <nome>] [--allow-out-of-order]
  status    [--check]
  baseline  [--up-to <nome>] [--assume-data <nome>…] [--no-verify --yes]
            (--assume-data: migration só de dados que você conferiu e já rodou; aceita vários nomes ou a,b)
  repair    <nome>
  new       <nome>
  test-db   (recria cruzei_test do zero e aplica tudo)
opções gerais: --dir <pasta das migrations>`;

export interface Args {
  command?: string;
  positional: string[];
  flags: Set<string>;
  values: Map<string, string>;
  /** flags de lista (repetíveis): --assume-data */
  lists: Map<string, string[]>;
}

const VALUE_FLAGS = new Set(['--up-to', '--dir']);
const LIST_FLAGS = new Set(['--assume-data']);
// depois do 1º valor de uma lista, só segue pegando o que tem cara de nome de migration (o resto é comando)
const LIST_MORE_RE = /^\d{14}_/;
const BOOL_FLAGS = new Set([
  '--dry-run',
  '--check',
  '--no-verify',
  '--yes',
  '--allow-out-of-order',
]);

export class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const args: Args = { positional: [], flags: new Set(), values: new Map(), lists: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new UsageError(`${a} precisa de um valor`);
      args.values.set(a, v);
    } else if (LIST_FLAGS.has(a)) {
      // "--assume-data a b", "--assume-data a,b" ou o flag repetido
      const got: string[] = [];
      for (let first = true; i + 1 < argv.length && !argv[i + 1].startsWith('--'); first = false) {
        if (!first && !LIST_MORE_RE.test(argv[i + 1])) break;
        got.push(...argv[++i].split(',').filter(Boolean));
      }
      if (!got.length) throw new UsageError(`${a} precisa de um valor`);
      args.lists.set(a, [...(args.lists.get(a) ?? []), ...got]);
    } else if (BOOL_FLAGS.has(a)) {
      args.flags.add(a);
    } else if (a.startsWith('--')) {
      throw new UsageError(`opção desconhecida: ${a}`);
    } else if (!args.command) {
      args.command = a;
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

const out = (msg: string) => console.info(msg);

function formatStatusRow(r: StatusRow): string {
  const when = r.appliedAt ? r.appliedAt.toISOString().replace('T', ' ').slice(0, 16) : '';
  const tags = [r.baseline ? 'baseline' : '', r.repaired ? 'checksum reparado' : '']
    .filter(Boolean)
    .join(', ');
  const label = {
    applied: 'aplicada ',
    pending: 'PENDENTE ',
    changed: 'ALTERADA ',
    missing_file: 'SEM ARQUIVO',
  }[r.state];
  return `  ${label.padEnd(11)} ${r.name.padEnd(48)} ${when}${tags ? ` (${tags})` : ''}`;
}

function databaseUrl(): string {
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url)
    throw new UsageError(
      'sem MIGRATE_DATABASE_URL nem DATABASE_URL (ambiente ou apps/backend/.env)',
    );
  return url;
}

function txTimeoutMs(): number {
  const raw = process.env.MIGRATE_TX_TIMEOUT_MS;
  if (!raw) return DEFAULT_TX_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1000)
    throw new UsageError(`MIGRATE_TX_TIMEOUT_MS inválido: ${raw}`);
  return n;
}

export async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    console.error(USAGE);
    return 2;
  }
  const dir = args.values.get('--dir') ?? defaultMigrationsDir();
  const upTo = args.values.get('--up-to');
  const assumeData = args.lists.get('--assume-data');

  try {
    if (assumeData && args.command !== 'baseline') {
      throw new UsageError('--assume-data só vale no baseline');
    }
    if (args.command === 'new') {
      const name = args.positional.join(' ');
      if (!name) throw new UsageError('new precisa de um nome: migrate new <nome>');
      out(`criada: ${newMigration(dir, name)}`);
      return 0;
    }

    loadEnvFiles();
    const lockTimeout = process.env.MIGRATE_LOCK_TIMEOUT || DEFAULT_LOCK_TIMEOUT;

    if (args.command === 'test-db') {
      const testUrl = testDatabaseUrl(process.env);
      out(`[migrate] banco de teste ${describeUrl(testUrl)}: recriando do zero`);
      const r = await resetTestDatabase({
        url: testUrl,
        dir,
        log: out,
        lockTimeout,
        txTimeoutMs: txTimeoutMs(),
      });
      out(`[migrate] pronto: ${r.applied.length} migration(s) aplicada(s), em dia`);
      return 0;
    }

    const url = databaseUrl();
    const common = { url, dir, log: out };

    switch (args.command) {
      case 'up': {
        out(`[migrate] ${describeUrl(url)}${args.flags.has('--dry-run') ? ' (dry-run)' : ''}`);
        const r = await migrate({
          ...common,
          upTo,
          dryRun: args.flags.has('--dry-run'),
          allowOutOfOrder: args.flags.has('--allow-out-of-order'),
          lockTimeout,
          txTimeoutMs: txTimeoutMs(),
        });
        if (!args.flags.has('--dry-run')) out(`[migrate] ok: ${r.applied.length} aplicada(s)`);
        return 0;
      }
      case 'status': {
        out(`[migrate] ${describeUrl(url)}`);
        const s = await status(common);
        if (!s.tableExists) out('  (sem schema_migrations: banco novo ou montado sem o executor)');
        for (const r of s.rows) out(formatStatusRow(r));
        for (const p of s.problems) {
          if (p.kind === 'out_of_order')
            out(`  aviso: ${p.name} está pendente mas é mais antiga que ${p.after}`);
        }
        const count = (st: StatusRow['state']) => s.rows.filter((r) => r.state === st).length;
        const broken = count('changed') + count('missing_file');
        out(
          s.clean
            ? `[migrate] em dia (${s.rows.length} migrations)`
            : `[migrate] ${count('pending')} pendente(s)${broken ? `, ${broken} com problema` : ''}`,
        );
        return args.flags.has('--check') && !s.clean ? 1 : 0;
      }
      case 'baseline': {
        out(`[migrate] baseline em ${describeUrl(url)}${upTo ? ` até ${upTo}` : ''}`);
        const r = await baseline({
          ...common,
          upTo,
          verify: !args.flags.has('--no-verify'),
          yes: args.flags.has('--yes'),
          assumeData,
          lockTimeout,
          txTimeoutMs: txTimeoutMs(),
        });
        out(
          `[migrate] baseline: ${r.marked.length} marcada(s)${r.verified ? ' (catálogo conferido)' : ''}`,
        );
        return 0;
      }
      case 'repair': {
        const name = args.positional[0];
        if (!name) throw new UsageError('repair precisa do nome da migration');
        out(`[migrate] repair em ${describeUrl(url)}`);
        const r = await repair({ ...common, name });
        out(
          r.from === r.to
            ? `${name}: checksum já batia`
            : `${name}: checksum ${r.from.slice(0, 12)}… → ${r.to.slice(0, 12)}…`,
        );
        return 0;
      }
      default:
        throw new UsageError(
          args.command ? `comando desconhecido: ${args.command}` : 'falta o comando',
        );
    }
  } catch (e) {
    if (e instanceof UsageError || (e instanceof MigrateError && e.code === 'usage')) {
      console.error(e.message);
      console.error(USAGE);
      return 2;
    }
    console.error(`[migrate] ERRO: ${(e as Error).message}`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}
