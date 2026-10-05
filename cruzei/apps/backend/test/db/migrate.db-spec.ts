import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadMigrations, MigrationFile } from '../../src/database/migrate/migration-files';
import {
  dropDatabase,
  migrate,
  MigrateError,
  recreateDatabase,
  status,
} from '../../src/database/migrate/runner';
import { prismaConnect, SqlConn, withDatabase } from '../../src/database/migrate/sql-conn';

import { TEST_DATABASE_URL } from './env';

// Executor de migrations contra um Postgres de verdade (o unitário usa banco falso): transação por arquivo,
// rollback, checksum, advisory lock entre duas execuções e lock_timeout. Usa um banco PRÓPRIO, descartável
// (cruzei_migrate_check), no mesmo servidor do cruzei_test — nunca o dev.

const DB = 'cruzei_migrate_check';
const ADMIN_URL = withDatabase(TEST_DATABASE_URL, 'postgres');
const DB_URL = withDatabase(TEST_DATABASE_URL, DB);

let dir: string;
const put = (name: string, sql: string) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'migration.sql'), sql);
};
const files = (): MigrationFile[] => loadMigrations(dir);

let conn: SqlConn;
const one = async <T>(sql: string, ...params: unknown[]) =>
  (await conn.query<T>(sql, ...params))[0];
const exists = async (rel: string) =>
  !!(await one<{ t: string | null }>('SELECT to_regclass($1)::text AS t', rel))?.t;

// DROP DATABASE pede um checkpoint imediato: depois da suíte inteira (muito buffer sujo no servidor) passa dos 30 s
const DB_HOOK_TIMEOUT_MS = 180_000;

beforeAll(async () => {
  await recreateDatabase(ADMIN_URL, DB);
  conn = prismaConnect(DB_URL);
}, DB_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await conn?.close();
  await dropDatabase(ADMIN_URL, DB);
}, DB_HOOK_TIMEOUT_MS);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metch-migrate-db-'));
  await conn.exec('DROP SCHEMA public CASCADE');
  await conn.exec('CREATE SCHEMA public');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('executor de migrations (Postgres real)', () => {
  it('aplica em ordem, registra nome+checksum e a segunda execução não faz nada', async () => {
    put('20990102000000_b', 'BEGIN;\nALTER TABLE a ADD COLUMN nome text;\nCOMMIT;\n');
    put('20990101000000_a', 'CREATE TABLE a (id int PRIMARY KEY);\nINSERT INTO a VALUES (1);');

    const r = await migrate({ url: DB_URL, files: files() });
    expect(r.applied).toEqual(['20990101000000_a', '20990102000000_b']);
    const rows = await conn.query<{ name: string; checksum: string; baseline: boolean }>(
      'SELECT name::text AS name, checksum::text AS checksum, baseline FROM schema_migrations ORDER BY name',
    );
    expect(rows.map((x) => [x.name, x.checksum, x.baseline])).toEqual(
      files().map((f) => [f.name, f.checksum, false]),
    );

    expect(await migrate({ url: DB_URL, files: files() })).toEqual({ applied: [], pending: [] });
    expect((await status({ url: DB_URL, files: files() })).clean).toBe(true);
  });

  it('erro no meio do arquivo: rollback dele inteiro, sem registro; as anteriores ficam', async () => {
    put('20990101000000_a', 'CREATE TABLE a (id int);');
    put('20990102000000_b', 'CREATE TABLE b (id int);\nINSERT INTO nao_existe VALUES (1);');
    put('20990103000000_c', 'CREATE TABLE c (id int);');

    const err = await migrate({ url: DB_URL, files: files() }).catch((e) => e);
    expect(err).toBeInstanceOf(MigrateError);
    expect(err.message).toContain('20990102000000_b: comando 2/2 (linha 2)');
    expect(err.message).toContain('42P01');
    expect(await exists('a')).toBe(true);
    expect(await exists('b')).toBe(false);
    expect(await exists('c')).toBe(false);
    const names = await conn.query<{ name: string }>(
      'SELECT name::text AS name FROM schema_migrations',
    );
    expect(names.map((x) => x.name)).toEqual(['20990101000000_a']);
  });

  it('arquivo aplicado e depois alterado: recusa sem rodar nada', async () => {
    put('20990101000000_a', 'CREATE TABLE a (id int);');
    await migrate({ url: DB_URL, files: files() });
    put('20990101000000_a', 'CREATE TABLE a (id bigint);');
    put('20990102000000_b', 'CREATE TABLE b (id int);');

    const err = await migrate({ url: DB_URL, files: files() }).catch((e) => e);
    expect(err.code).toBe('plan');
    expect(err.message).toContain('checksum diferente');
    expect(await exists('b')).toBe(false);
  });

  it('duas execuções ao mesmo tempo: o advisory lock serializa e cada arquivo roda uma vez só', async () => {
    put(
      '20990101000000_a',
      'CREATE TABLE a (id int);\nSELECT pg_sleep(1.5);\nINSERT INTO a VALUES (1);',
    );
    put('20990102000000_b', 'INSERT INTO a VALUES (2);');

    const logs: string[][] = [[], []];
    const run = (k: number) =>
      migrate({ url: DB_URL, files: files(), lockPollMs: 50, log: (m) => logs[k].push(m) });
    const [r1, r2] = await Promise.all([run(0), run(1)]);

    expect([...r1.applied, ...r2.applied].sort()).toEqual(['20990101000000_a', '20990102000000_b']);
    expect(logs.flat().some((m) => m.includes('aguardando'))).toBe(true);
    const counted = await one<{ n: number }>('SELECT count(*)::int AS n FROM a');
    expect(counted?.n).toBe(2);
  });

  it('lock_timeout: ALTER atrás de uma tabela travada desiste em vez de enfileirar o app', async () => {
    put('20990101000000_a', 'CREATE TABLE a (id int);');
    await migrate({ url: DB_URL, files: files() });
    put('20990102000000_b', 'ALTER TABLE a ADD COLUMN x int;');

    // outra sessão segura a tabela (como uma transação longa do app)
    const holder = prismaConnect(DB_URL);
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const isLocked = new Promise<void>((r) => (locked = r));
    const holding = holder.tx(async (tx) => {
      await tx.exec('LOCK TABLE a IN ACCESS SHARE MODE');
      locked();
      await held;
    }, 20_000);
    try {
      await isLocked;
      const t0 = Date.now();
      const err = await migrate({ url: DB_URL, files: files(), lockTimeout: '300ms' }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(MigrateError);
      expect(err.message).toContain('55P03');
      expect(Date.now() - t0).toBeLessThan(10_000);
    } finally {
      release();
      await holding;
      await holder.close();
    }
    // depois que a trava sai, a mesma migration passa
    expect((await migrate({ url: DB_URL, files: files() })).applied).toEqual(['20990102000000_b']);
  });

  it('banco com tabelas e sem histórico: recusa e não cria a tabela do histórico', async () => {
    await conn.exec('CREATE TABLE legado (id int)');
    put('20990101000000_a', 'CREATE TABLE a (id int);');
    const err = await migrate({ url: DB_URL, files: files() }).catch((e) => e);
    expect(err.code).toBe('untracked_db');
    expect(await exists('schema_migrations')).toBe(false);
  });
});
