import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { diffFingerprints, isSameFingerprint } from './fingerprint';
import { MigrationFile, parseMigration } from './migration-files';
import {
  AppliedMigration,
  baseline,
  checkLockTimeout,
  lockKeyFor,
  migrate,
  MigrateError,
  migrationSlug,
  newMigration,
  nextMigrationPrefix,
  plan,
  repair,
  resetTestDatabase,
  status,
  statusRows,
  testDatabaseUrl,
  unprovenDataOnly,
} from './runner';
import { describeUrl, singleConnectionUrl, SqlConn, withDatabase } from './sql-conn';

const file = (name: string, sql = `CREATE TABLE t_${name.slice(-1)} (id int);`) =>
  parseMigration(name, sql);
const applied = (f: MigrationFile, checksum = f.checksum): AppliedMigration => ({
  name: f.name,
  checksum,
  appliedAt: new Date('2026-09-30T12:00:00Z'),
  baseline: false,
  repaired: false,
});

const A = file('20990101000000_a');
const B = file('20990102000000_b');
const C = file('20990103000000_c');

describe('plan', () => {
  it('banco vazio: tudo pendente, em ordem', () => {
    const p = plan([A, B, C], []);
    expect(p.pending.map((f) => f.name)).toEqual([A.name, B.name, C.name]);
    expect(p.problems).toEqual([]);
  });

  it('idempotente: com tudo aplicado não sobra nada', () => {
    expect(plan([A, B, C], [applied(A), applied(B), applied(C)])).toEqual({
      pending: [],
      problems: [],
    });
  });

  it('só as que faltam, respeitando --up-to', () => {
    expect(plan([A, B, C], [applied(A)]).pending.map((f) => f.name)).toEqual([B.name, C.name]);
    expect(plan([A, B, C], [applied(A)], { upTo: B.name }).pending.map((f) => f.name)).toEqual([
      B.name,
    ]);
  });

  it('arquivo alterado depois de aplicado = checksum_mismatch', () => {
    const p = plan([A, B], [applied(A, 'f'.repeat(64)), applied(B)]);
    expect(p.problems).toEqual([{ kind: 'checksum_mismatch', name: A.name }]);
  });

  it('aplicada sem arquivo = missing_file', () => {
    expect(plan([A], [applied(A), applied(B)]).problems).toEqual([
      { kind: 'missing_file', name: B.name },
    ]);
  });

  it('pendente mais antiga que a última aplicada = out_of_order (libera com allowOutOfOrder)', () => {
    const p = plan([A, B, C], [applied(A), applied(C)]);
    expect(p.problems).toEqual([{ kind: 'out_of_order', name: B.name, after: C.name }]);
    const ok = plan([A, B, C], [applied(A), applied(C)], { allowOutOfOrder: true });
    expect(ok.problems).toEqual([]);
    expect(ok.pending.map((f) => f.name)).toEqual([B.name]);
  });
});

describe('statusRows', () => {
  it('aplicada, pendente, alterada e sem arquivo', () => {
    const rows = statusRows(
      [A, B, C],
      [applied(A), applied(B, '0'.repeat(64)), applied(file('20990104000000_d'))],
    );
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      [A.name, 'applied'],
      [B.name, 'changed'],
      [C.name, 'pending'],
      ['20990104000000_d', 'missing_file'],
    ]);
  });
});

describe('nextMigrationPrefix / newMigration', () => {
  const now = new Date(Date.UTC(2026, 8, 30, 12, 0, 0)); // 20260930120000

  it('nomes à frente do calendário: último + 100', () => {
    expect(nextMigrationPrefix(['20240923000000_init', '20261004000300_age_range_gap'], now)).toBe(
      '20261004000400',
    );
  });

  it('calendário à frente: usa agora (UTC)', () => {
    expect(nextMigrationPrefix(['20240923000000_init'], now)).toBe('20260930120000');
    expect(nextMigrationPrefix([], now)).toBe('20260930120000');
  });

  it('slug sem acento, minúsculo, só [a-z0-9_]', () => {
    expect(migrationSlug('Índice de Fotos!')).toBe('indice_de_fotos');
    expect(() => migrationSlug('!!!')).toThrow(MigrateError);
  });

  it('cria a pasta com o modelo, que ainda não carrega (sem comando)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metch-new-'));
    try {
      fs.mkdirSync(path.join(dir, '20261004000300_age_range_gap'));
      const created = newMigration(dir, 'teste x', now);
      expect(path.basename(path.dirname(created))).toBe('20261004000400_teste_x');
      const text = fs.readFileSync(created, 'utf8');
      expect(text).toContain('sem BEGIN/COMMIT');
      expect(() => parseMigration('20261004000400_teste_x', text)).toThrow('sem nenhum comando');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('diffFingerprints', () => {
  it('separa o que só está no banco do que só sai das migrations', () => {
    const d = diffFingerprints(
      ['column a.id int4', 'index x', 'extension postgis'],
      ['column a.id int4', 'index y'],
    );
    expect(d).toEqual({
      onlyInDb: ['extension postgis', 'index x'],
      onlyInMigrations: ['index y'],
    });
    expect(isSameFingerprint(d)).toBe(false);
    expect(isSameFingerprint(diffFingerprints(['a', 'b'], ['b', 'a']))).toBe(true);
  });
});

describe('utilitários', () => {
  it('lock_timeout validado antes de ir pro SQL', () => {
    expect(checkLockTimeout('15s')).toBe('15s');
    expect(checkLockTimeout('500ms')).toBe('500ms');
    expect(() => checkLockTimeout("1s'; DROP TABLE users; --")).toThrow(MigrateError);
  });

  it('chave do lock é estável e cabe em int4', () => {
    expect(lockKeyFor('schema_migrations')).toBe(lockKeyFor('schema_migrations'));
    expect(lockKeyFor('schema_migrations')).not.toBe(lockKeyFor('outra.schema_migrations'));
    expect(Math.abs(lockKeyFor('schema_migrations'))).toBeLessThan(2 ** 31);
  });

  it('URL: nunca mostra usuário/senha; troca só o banco; força 1 conexão', () => {
    const url = 'postgresql://u:segredo@db.local:5544/cruzei?schema=public&connection_limit=40';
    expect(describeUrl(url)).toBe('db.local:5544/cruzei');
    expect(withDatabase(url, 'postgres')).toBe(
      'postgresql://u:segredo@db.local:5544/postgres?schema=public&connection_limit=40',
    );
    expect(new URL(singleConnectionUrl(url)).searchParams.get('connection_limit')).toBe('1');
  });
});

// ---------- migrate/baseline/status/repair com um banco falso ----------

interface FakeRow {
  name: string;
  checksum: string;
  baseline: boolean;
  repaired: boolean;
}

/** "Postgres" em memória: entende só o SQL do executor; o resto é comando de migration (FAIL no texto = erro) */
class FakeDb {
  rows: FakeRow[] = [];
  executed: string[] = [];
  hasTable = false;
  userTables = false;
  lockHeld = false;
  txCount = 0;

  connect = () => this.conn(null);

  private conn(stage: { rows: FakeRow[]; executed: string[] } | null): SqlConn {
    const state = () => stage ?? this;
    const run = async (sql: string, params: unknown[]): Promise<unknown[]> => {
      const s = sql.trim();
      if (/^SELECT pg_try_advisory_lock/.test(s)) {
        if (this.lockHeld) return [{ ok: false }];
        this.lockHeld = true;
        return [{ ok: true }];
      }
      if (/^SELECT pg_advisory_unlock/.test(s)) {
        this.lockHeld = false;
        return [{ ok: true }];
      }
      if (/^CREATE TABLE IF NOT EXISTS schema_migrations/.test(s)) {
        this.hasTable = true;
        return [];
      }
      if (/^SELECT to_regclass/.test(s)) return [{ t: this.hasTable ? 'schema_migrations' : null }];
      if (/^SELECT EXISTS/.test(s)) return [{ has: this.userTables }];
      if (/^SET (LOCAL )?lock_timeout/.test(s)) return [];
      if (/^SELECT name::text/.test(s)) {
        return [...state().rows]
          .sort((a, b) => (a.name < b.name ? -1 : 1))
          .map((r) => ({ ...r, applied_at: new Date(0) }));
      }
      if (/^SELECT 1 AS one FROM schema_migrations/.test(s))
        return state().rows.filter((r) => r.name === params[0]);
      if (/^INSERT INTO schema_migrations/.test(s)) {
        if (!state().rows.some((r) => r.name === params[0])) {
          state().rows.push({
            name: String(params[0]),
            checksum: String(params[1]),
            baseline: /baseline/.test(s),
            repaired: false,
          });
        }
        return [];
      }
      if (/^UPDATE schema_migrations SET checksum/.test(s)) {
        const r = state().rows.find((x) => x.name === params[1]);
        if (r) Object.assign(r, { checksum: String(params[0]), repaired: true });
        return [];
      }
      if (s.includes('FAIL')) throw new Error(`erro de sintaxe perto de "FAIL"`);
      state().executed.push(s);
      return [];
    };
    return {
      exec: async (sql, ...params) => (await run(sql, params)).length,
      query: async <T>(sql: string, ...params: unknown[]) => (await run(sql, params)) as T[],
      tx: async (fn) => {
        if (stage) throw new Error('tx aninhada');
        this.txCount++;
        const staged = { rows: this.rows.map((r) => ({ ...r })), executed: [...this.executed] };
        const result = await fn(this.conn(staged));
        this.rows = staged.rows; // commit
        this.executed = staged.executed;
        return result;
      },
      close: async () => undefined,
    };
  }
}

describe('migrate (banco falso)', () => {
  const X = parseMigration(
    '20990101000000_x',
    'BEGIN;\nCREATE TABLE x (id int);\nCREATE INDEX x_i ON x (id);\nCOMMIT;',
  );
  const Y = parseMigration('20990102000000_y', 'CREATE TABLE y (id int);');
  // entre X e Y na ordem de nome
  const Z = parseMigration('20990101500000_z', 'CREATE TABLE z (id int);\nSELECT FAIL;');
  const opts = (db: FakeDb, files: MigrationFile[]) => ({
    url: 'postgresql://x@h/db',
    files,
    connect: db.connect,
  });

  it('aplica em ordem, uma transação por arquivo, e registra cada uma', async () => {
    const db = new FakeDb();
    const r = await migrate(opts(db, [Y, X]));
    expect(r.applied).toEqual([X.name, Y.name]);
    expect(db.executed).toEqual([
      'CREATE TABLE x (id int)',
      'CREATE INDEX x_i ON x (id)',
      'CREATE TABLE y (id int)',
    ]);
    expect(db.rows.map((row) => [row.name, row.checksum])).toEqual([
      [X.name, X.checksum],
      [Y.name, Y.checksum],
    ]);
    expect(db.txCount).toBe(2);
    expect(db.lockHeld).toBe(false);
  });

  it('segunda execução não faz nada (idempotente)', async () => {
    const db = new FakeDb();
    await migrate(opts(db, [X, Y]));
    const before = db.executed.length;
    const r = await migrate(opts(db, [X, Y]));
    expect(r).toEqual({ applied: [], pending: [] });
    expect(db.executed).toHaveLength(before);
  });

  it('erro num comando: para ali, desfaz o arquivo e não registra; as anteriores ficam', async () => {
    const db = new FakeDb();
    const err = await migrate(opts(db, [X, Z, Y])).catch((e) => e);
    expect(err).toBeInstanceOf(MigrateError);
    expect(err.code).toBe('statement');
    expect(err.message).toContain(`${Z.name}: comando 2/2 (linha 2)`);
    expect(db.rows.map((row) => row.name)).toEqual([X.name]);
    expect(db.executed).not.toContain('CREATE TABLE z (id int)');
    expect(db.executed).not.toContain('CREATE TABLE y (id int)');
    expect(db.lockHeld).toBe(false);
  });

  it('arquivo alterado depois de aplicado: recusa sem executar nada; repair resolve', async () => {
    const db = new FakeDb();
    await migrate(opts(db, [X]));
    const X2 = parseMigration(
      X.name,
      '-- comentário novo\nBEGIN;\nCREATE TABLE x (id int);\nCREATE INDEX x_i ON x (id);\nCOMMIT;',
    );
    const err = await migrate(opts(db, [X2, Y])).catch((e) => e);
    expect(err.code).toBe('plan');
    expect(err.message).toContain('checksum diferente');
    expect(db.executed).not.toContain('CREATE TABLE y (id int)');

    const fixed = await repair({ ...opts(db, [X2, Y]), name: X.name });
    expect(fixed).toEqual({ from: X.checksum, to: X2.checksum });
    expect((await migrate(opts(db, [X2, Y]))).applied).toEqual([Y.name]);
  });

  it('banco com tabelas e sem histórico: pede baseline', async () => {
    const db = new FakeDb();
    db.userTables = true;
    const err = await migrate(opts(db, [X])).catch((e) => e);
    expect(err.code).toBe('untracked_db');
    expect(db.executed).toEqual([]);
    // recusado = banco como estava (nem a tabela do histórico nasce)
    expect(db.hasTable).toBe(false);
  });

  it('dry-run lista sem executar nem criar a tabela', async () => {
    const db = new FakeDb();
    const r = await migrate({ ...opts(db, [X, Y]), dryRun: true });
    expect(r.pending).toEqual([X.name, Y.name]);
    expect(db.hasTable).toBe(false);
    expect(db.executed).toEqual([]);
  });

  it('sem transação: roda comando a comando fora de tx e registra no fim', async () => {
    const db = new FakeDb();
    const N = parseMigration(
      '20990104000000_n',
      '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS n ON x (id);',
    );
    await migrate(opts(db, [N]));
    expect(db.txCount).toBe(0);
    expect(db.executed).toEqual(['CREATE INDEX CONCURRENTLY IF NOT EXISTS n ON x (id)']);
    expect(db.rows.map((row) => row.name)).toEqual([N.name]);
  });

  it('espera o lock de outra execução e desiste no prazo', async () => {
    const db = new FakeDb();
    db.lockHeld = true;
    const err = await migrate({ ...opts(db, [X]), lockWaitMs: 30, lockPollMs: 5 }).catch((e) => e);
    expect(err.code).toBe('lock_wait');
    expect(db.executed).toEqual([]);
  });
});

describe('baseline e status (banco falso)', () => {
  const X = parseMigration('20990101000000_x', 'CREATE TABLE x (id int);');
  const Y = parseMigration('20990102000000_y', 'CREATE TABLE y (id int);');
  const opts = (db: FakeDb) => ({ url: 'postgresql://x@h/db', files: [X, Y], connect: db.connect });

  it('marca sem executar (--no-verify --yes), respeitando --up-to', async () => {
    const db = new FakeDb();
    db.userTables = true;
    const r = await baseline({ ...opts(db), upTo: X.name, verify: false, yes: true });
    expect(r.marked).toEqual([X.name]);
    expect(db.executed).toEqual([]);
    expect(db.rows).toEqual([
      { name: X.name, checksum: X.checksum, baseline: true, repaired: false },
    ]);

    const s = await status(opts(db));
    expect(s.rows.map((row) => row.state)).toEqual(['applied', 'pending']);
    expect(s.clean).toBe(false);

    // o resto vem pelo migrate normal
    expect((await migrate(opts(db))).applied).toEqual([Y.name]);
    expect((await status(opts(db))).clean).toBe(true);
  });

  it('--no-verify sem --yes é recusado; banco vazio também', async () => {
    const db = new FakeDb();
    await expect(baseline({ ...opts(db), verify: false })).rejects.toThrow('--yes');
    await expect(baseline({ ...opts(db), verify: false, yes: true })).rejects.toThrow(
      'banco vazio',
    );
  });

  it('depois do baseline, o arquivo alterado também é barrado (checksum gravado é o do arquivo)', async () => {
    const db = new FakeDb();
    db.userTables = true;
    await baseline({ ...opts(db), verify: false, yes: true });
    const X2 = parseMigration(X.name, 'CREATE TABLE x (id bigint);');
    const err = await migrate({ ...opts(db), files: [X2, Y] }).catch((e) => e);
    expect(err.code).toBe('plan');
    expect(db.executed).toEqual([]);
  });

  it('só de dados no fim (o catálogo não mostra se rodou): recusa sem --up-to e não marca nada', async () => {
    const D = parseMigration('20990103000000_d', 'UPDATE x SET id = 2;');
    const db = new FakeDb();
    db.userTables = true;
    const err = await baseline({ ...opts(db), files: [X, Y, D], verify: false, yes: true }).catch(
      (e) => e,
    );
    expect(err.code).toBe('baseline_refused');
    expect(err.message).toContain(D.name);
    expect(err.message).toContain(`--up-to ${Y.name}`);
    expect(db.rows).toEqual([]);
    expect(db.hasTable).toBe(false);

    // com o alvo explícito marca até ali, e o db:migrate RODA a de dados
    await baseline({ ...opts(db), files: [X, Y, D], upTo: Y.name, verify: false, yes: true });
    expect((await migrate({ ...opts(db), files: [X, Y, D] })).applied).toEqual([D.name]);
    expect(db.executed).toEqual(['UPDATE x SET id = 2']);
  });

  it('banco que já tem histórico: baseline só com --up-to explícito', async () => {
    const db = new FakeDb();
    db.userTables = true;
    await baseline({ ...opts(db), upTo: X.name, verify: false, yes: true });
    const err = await baseline({ ...opts(db), verify: false, yes: true }).catch((e) => e);
    expect(err.code).toBe('baseline_refused');
    expect(err.message).toContain('use db:migrate');
    expect(db.rows.map((r) => r.name)).toEqual([X.name]);
  });

  it('unprovenDataOnly pega TODAS as de dados (meio e fim), fora as confirmadas', () => {
    const D1 = parseMigration('20990103000000_d1', 'UPDATE x SET id = 2;');
    const D2 = parseMigration('20990104000000_d2', 'DELETE FROM x;');
    expect(unprovenDataOnly([X, D1, Y, D2]).map((f) => f.name)).toEqual([D1.name, D2.name]);
    expect(unprovenDataOnly([X, D1, Y, D2], [D1.name]).map((f) => f.name)).toEqual([D2.name]);
    expect(unprovenDataOnly([X, D1, Y, D2], [D1.name, D2.name])).toEqual([]);
    expect(unprovenDataOnly([X, Y])).toEqual([]);
  });

  describe('só de dados no MEIO (ex.: passes_backfill entre migrations de estrutura)', () => {
    // X (estrutura) → M (dados) → Y (estrutura) → Z (estrutura)
    const M = parseMigration('20990101500000_m_backfill', 'UPDATE x SET id = id + 1;');
    const Z = parseMigration('20990103000000_z', 'CREATE TABLE z (id int);');
    const all = [X, M, Y, Z];
    const base = (db: FakeDb) => ({ ...opts(db), files: all, verify: false, yes: true });

    it('sem confirmação: recusa, lista a do meio e não marca nada (nem cria a tabela)', async () => {
      const db = new FakeDb();
      db.userTables = true;
      const err = await baseline(base(db)).catch((e) => e);
      expect(err).toBeInstanceOf(MigrateError);
      expect(err.code).toBe('baseline_refused');
      expect(err.message).toContain(`  - ${M.name}`);
      expect(err.message).toContain(`--assume-data ${M.name}`);
      // passos de quem não rodou: marca até a anterior, aplica ela e marca o resto
      expect(err.message).toContain(`baseline --up-to ${X.name}`);
      expect(err.message).toContain(`db:migrate --up-to ${M.name}`);
      expect(err.message).toContain(`baseline --up-to ${Z.name}`);
      expect(db.rows).toEqual([]);
      expect(db.hasTable).toBe(false);
    });

    it('--up-to que passa por ela também exige a confirmação', async () => {
      const db = new FakeDb();
      db.userTables = true;
      const err = await baseline({ ...base(db), upTo: Y.name }).catch((e) => e);
      expect(err.code).toBe('baseline_refused');
      expect(err.message).toContain(M.name);
      expect(db.rows).toEqual([]);
    });

    it('lista TODAS as de dados pendentes, no meio e no fim', async () => {
      const D = parseMigration('20990104000000_d', 'DELETE FROM z;');
      const db = new FakeDb();
      db.userTables = true;
      const err = await baseline({ ...base(db), files: [...all, D] }).catch((e) => e);
      expect(err.code).toBe('baseline_refused');
      expect(err.message).toContain(`  - ${M.name}\n  - ${D.name}`);
      expect(err.message).toContain(`--assume-data ${M.name} ${D.name}`);
      // confirmar só uma não basta
      const err2 = await baseline({ ...base(db), files: [...all, D], assumeData: [M.name] }).catch(
        (e) => e,
      );
      expect(err2.code).toBe('baseline_refused');
      expect(err2.message).toContain(D.name);
      expect(err2.message).not.toContain(`  - ${M.name}`);
      expect(db.rows).toEqual([]);
    });

    it('com --assume-data marca tudo (a confirmada inclusive) e o db:migrate não roda nada', async () => {
      const db = new FakeDb();
      db.userTables = true;
      const logs: string[] = [];
      const r = await baseline({ ...base(db), assumeData: [M.name], log: (m) => logs.push(m) });
      expect(r.marked).toEqual([X.name, M.name, Y.name, Z.name]);
      expect(db.rows.every((row) => row.baseline)).toBe(true);
      expect(logs.some((l) => l.includes('--assume-data') && l.includes(M.name))).toBe(true);
      expect((await migrate({ ...opts(db), files: all })).applied).toEqual([]);
      expect(db.executed).toEqual([]);
    });

    it('não rodou: o caminho da mensagem aplica a de dados de verdade', async () => {
      const db = new FakeDb();
      db.userTables = true;
      await baseline({ ...base(db), upTo: X.name });
      expect((await migrate({ ...opts(db), files: all, upTo: M.name })).applied).toEqual([M.name]);
      expect(db.executed).toEqual(['UPDATE x SET id = id + 1']);
      const r = await baseline({ ...base(db), upTo: Z.name });
      expect(r.marked).toEqual([Y.name, Z.name]);
      expect((await status({ ...opts(db), files: all })).clean).toBe(true);
    });

    it('--assume-data com nome errado, de estrutura ou fora do que seria marcado: erro de uso, nada marcado', async () => {
      const db = new FakeDb();
      db.userTables = true;
      const typo = await baseline({ ...base(db), assumeData: ['20990101500000_m_bakfill'] }).catch(
        (e) => e,
      );
      expect(typo).toMatchObject({ code: 'usage' });
      expect(typo.message).toContain('não existe');
      const ddl = await baseline({ ...base(db), assumeData: [M.name, Y.name] }).catch((e) => e);
      expect(ddl).toMatchObject({ code: 'usage' });
      expect(ddl.message).toContain(Y.name);
      // depois do --up-to: não seria marcada
      const D = parseMigration('20990104000000_d', 'DELETE FROM z;');
      const after = await baseline({
        ...base(db),
        files: [...all, D],
        upTo: Z.name,
        assumeData: [M.name, D.name],
      }).catch((e) => e);
      expect(after).toMatchObject({ code: 'usage' });
      expect(after.message).toContain(D.name);
      expect(db.rows).toEqual([]);
      expect(db.hasTable).toBe(false);
    });
  });
});

describe('banco de teste', () => {
  it('URL: DATABASE_URL_TEST vence; senão a DATABASE_URL trocando só o banco', () => {
    const base = 'postgresql://u:s@h:5544/cruzei?schema=public';
    expect(
      testDatabaseUrl({ DATABASE_URL: base, DATABASE_URL_TEST: 'postgresql://u:s@ci/x_test' }),
    ).toBe('postgresql://u:s@ci/x_test');
    expect(testDatabaseUrl({ DATABASE_URL: base })).toBe(
      'postgresql://u:s@h:5544/cruzei_test?schema=public',
    );
    expect(() => testDatabaseUrl({})).toThrow(MigrateError);
  });

  it('recria do zero, aplica tudo e confere que ficou em dia', async () => {
    const db = new FakeDb();
    const X = parseMigration('20990101000000_x', 'CREATE TABLE x (id int);');
    const Y = parseMigration('20990102000000_y', 'CREATE TABLE y (id int);');
    const r = await resetTestDatabase({
      url: 'postgresql://u@h/cruzei_test',
      files: [X, Y],
      connect: db.connect,
    });
    expect(r.applied).toEqual([X.name, Y.name]);
    expect(db.executed).toEqual([
      'DROP DATABASE IF EXISTS "cruzei_test" WITH (FORCE)',
      'CREATE DATABASE "cruzei_test"',
      'CREATE TABLE x (id int)',
      'CREATE TABLE y (id int)',
    ]);
  });

  it('recusa apagar banco que não é *_test/*_check (dev, produção)', async () => {
    const db = new FakeDb();
    for (const url of [
      'postgresql://u@h/cruzei',
      'postgresql://u@h/postgres',
      'postgresql://u@h/cruzei_test_x',
    ]) {
      await expect(resetTestDatabase({ url, files: [], connect: db.connect })).rejects.toThrow(
        'recuso',
      );
    }
    expect(db.executed).toEqual([]);
  });
});
