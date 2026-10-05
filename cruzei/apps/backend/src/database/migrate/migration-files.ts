import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { findBackendRoot } from '../../config/env-files';

import { splitSql, SqlSplitError, SqlStatement } from './sql-split';

/**
 * Carga das migrations: prisma/migrations/<14 dígitos>_<nome>/migration.sql, em ordem de nome.
 * Tudo que dá pra barrar sem banco é barrado aqui, antes de tocar em qualquer coisa.
 */

export const MIGRATION_NAME_RE = /^\d{14}_[a-z0-9_]+$/;
/** diretiva numa linha de comentário do cabeçalho: roda sem transação (ex.: CREATE INDEX CONCURRENTLY) */
const NO_TRANSACTION_RE = /^--\s*migrate:no-transaction\s*$/;

// controle de transação é do executor: BEGIN no 1º comando e COMMIT no último são removidos; em outro lugar, erro
const TX_BEGIN_RE = /^(BEGIN|START\s+TRANSACTION)\b/i;
const TX_END_RE = /^(COMMIT|END)\b/i;
const TX_OTHER_RE =
  /^(ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION|COMMIT\s+PREPARED|ROLLBACK\s+PREPARED)\b/i;
// SET de sessão vazaria pras migrations seguintes (a conexão é uma só); SET LOCAL morre com a transação
const SESSION_SET_RE = /^(SET\b(?!\s+(LOCAL|CONSTRAINTS|TRANSACTION)\b)|RESET\b|DISCARD\b)/i;
// não rodam dentro de transação: só com a diretiva
const NEEDS_NO_TX: { re: RegExp; what: string }[] = [
  { re: /\bCONCURRENTLY\b/i, what: 'CONCURRENTLY' },
  { re: /^VACUUM\b/i, what: 'VACUUM' },
  { re: /^(CREATE|DROP)\s+DATABASE\b/i, what: 'CREATE/DROP DATABASE' },
  { re: /^ALTER\s+SYSTEM\b/i, what: 'ALTER SYSTEM' },
  { re: /^(CREATE|DROP)\s+TABLESPACE\b/i, what: 'CREATE/DROP TABLESPACE' },
  { re: /^REINDEX\b.*\b(DATABASE|SYSTEM)\b/i, what: 'REINDEX DATABASE/SYSTEM' },
];

export interface MigrationFile {
  /** nome da pasta, ex.: 20240923000000_init (é a chave em schema_migrations) */
  name: string;
  /** caminho do migration.sql */
  file: string;
  /** sha256 hex do texto normalizado (sem BOM, LF) */
  checksum: string;
  /** false = diretiva `-- migrate:no-transaction` (cada comando em autocommit; o arquivo tem que ser idempotente) */
  transactional: boolean;
  /** o arquivo tinha BEGIN/COMMIT próprios (removidos: quem abre e fecha é o executor) */
  hadOwnTransaction: boolean;
  statements: SqlStatement[];
}

export class MigrationFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationFileError';
  }
}

export function normalizeSql(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function checksumOf(raw: string): string {
  return createHash('sha256').update(normalizeSql(raw), 'utf8').digest('hex');
}

/** a diretiva vale em qualquer linha do bloco de comentários do topo (antes do 1º comando) */
function hasNoTransactionDirective(text: string): boolean {
  for (const raw of text.split('\n')) {
    const lineText = raw.trim();
    if (lineText === '') continue;
    if (!lineText.startsWith('--')) return false;
    if (NO_TRANSACTION_RE.test(lineText)) return true;
  }
  return false;
}

/** valida e prepara um arquivo (puro: dá pra testar sem disco) */
export function parseMigration(name: string, raw: string, file: string = name): MigrationFile {
  if (!MIGRATION_NAME_RE.test(name)) {
    throw new MigrationFileError(
      `${name}: nome inválido (esperado <14 dígitos>_<nome em minúsculas>)`,
    );
  }
  const text = normalizeSql(raw);
  let statements: SqlStatement[];
  try {
    statements = splitSql(text);
  } catch (e) {
    if (e instanceof SqlSplitError) throw new MigrationFileError(`${name}: ${e.message}`);
    throw e;
  }
  const transactional = !hasNoTransactionDirective(text);
  const where = (s: SqlStatement) => `${name} (linha ${s.line})`;

  let hadOwnTransaction = false;
  const first = statements[0];
  const last = statements[statements.length - 1];
  if (first && TX_BEGIN_RE.test(first.code)) {
    if (!transactional) {
      throw new MigrationFileError(
        `${where(first)}: BEGIN não combina com -- migrate:no-transaction`,
      );
    }
    if (statements.length < 2 || !TX_END_RE.test(last.code)) {
      throw new MigrationFileError(`${where(first)}: BEGIN sem COMMIT no fim do arquivo`);
    }
    statements = statements.slice(1, -1);
    hadOwnTransaction = true;
  }

  for (const s of statements) {
    if (TX_BEGIN_RE.test(s.code) || TX_END_RE.test(s.code) || TX_OTHER_RE.test(s.code)) {
      throw new MigrationFileError(
        `${where(s)}: controle de transação no meio do arquivo (${s.code.split(' ')[0]}). ` +
          'O executor abre e fecha a transação: tire BEGIN/COMMIT/ROLLBACK/SAVEPOINT',
      );
    }
    if (SESSION_SET_RE.test(s.code)) {
      throw new MigrationFileError(
        `${where(s)}: SET/RESET de sessão vaza pras migrations seguintes; use SET LOCAL (vale só nesta transação)`,
      );
    }
    if (transactional) {
      const hit = NEEDS_NO_TX.find((r) => r.re.test(s.code));
      if (hit) {
        throw new MigrationFileError(
          `${where(s)}: ${hit.what} não roda dentro de transação. Ponha "-- migrate:no-transaction" no topo ` +
            'e deixe o arquivo idempotente (IF NOT EXISTS), sem outros comandos que precisem de atomicidade',
        );
      }
    }
  }
  if (statements.length === 0)
    throw new MigrationFileError(`${name}: migration sem nenhum comando`);

  return { name, file, checksum: checksumOf(raw), transactional, hadOwnTransaction, statements };
}

const DML_RE = /^(INSERT|UPDATE|DELETE|WITH|SELECT|MERGE|TRUNCATE|COPY)\b/i;

/**
 * Só mexe em dados (INSERT/UPDATE/DELETE…; SET LOCAL não conta): não deixa rastro no catálogo, então o baseline não
 * consegue saber se rodou. DO $$ conta como estrutura (não dá pra saber o que tem dentro).
 */
export function isDataOnly(f: MigrationFile): boolean {
  const relevant = f.statements.filter((s) => !/^SET\b/i.test(s.code));
  return relevant.length > 0 && relevant.every((s) => DML_RE.test(s.code));
}

/** pastas <14 dígitos>_<nome>/migration.sql em ordem de nome; .sql solto na raiz é erro (não roda escondido) */
export function loadMigrations(dir: string): MigrationFile[] {
  if (!fs.existsSync(dir)) throw new MigrationFileError(`pasta de migrations não existe: ${dir}`);
  const out: MigrationFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (!MIGRATION_NAME_RE.test(entry.name)) {
        throw new MigrationFileError(`pasta com nome inválido em migrations: ${entry.name}`);
      }
      const file = path.join(dir, entry.name, 'migration.sql');
      if (!fs.existsSync(file))
        throw new MigrationFileError(`${entry.name}: pasta sem migration.sql`);
      out.push(parseMigration(entry.name, fs.readFileSync(file, 'utf8'), file));
    } else if (/\.sql$/i.test(entry.name)) {
      throw new MigrationFileError(
        `arquivo .sql solto em migrations (${entry.name}): o executor não roda arquivo fora de pasta. ` +
          'Crie com `pnpm --filter @cruzei/backend db:migrate:new <nome>`',
      );
    }
    // o resto (README, migration_lock.toml) é ignorado
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** apps/backend/prisma/migrations, achado a partir deste arquivo (src/ ou dist/src/) */
export function defaultMigrationsDir(): string {
  return path.join(findBackendRoot(__dirname), 'prisma', 'migrations');
}
