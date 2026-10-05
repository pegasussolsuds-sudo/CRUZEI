import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  checksumOf,
  defaultMigrationsDir,
  isDataOnly,
  loadMigrations,
  MigrationFileError,
  parseMigration,
} from './migration-files';

const N = '20990101000000_teste';

describe('migrations reais (prisma/migrations)', () => {
  const dir = defaultMigrationsDir();
  const files = loadMigrations(dir);
  const folders = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory());

  it('carrega todas as pastas, em ordem, com o manual_extensions logo depois do init', () => {
    expect(files.map((f) => f.name)).toEqual([...folders].sort());
    expect(files[0].name).toBe('20240923000000_init');
    expect(files[1].name).toBe('20240923000001_manual_extensions');
    expect(files.length).toBeGreaterThanOrEqual(26);
  });

  it('não sobra .sql solto na raiz', () => {
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.sql'))).toEqual([]);
  });

  it('BEGIN/COMMIT próprios são removidos exatamente nos arquivos que têm', () => {
    for (const f of files) {
      const raw = fs.readFileSync(f.file, 'utf8');
      expect({ name: f.name, own: f.hadOwnTransaction }).toEqual({
        name: f.name,
        own: /^BEGIN;\s*$/m.test(raw),
      });
      for (const s of f.statements) expect(s.code).not.toMatch(/^(BEGIN|COMMIT|END|ROLLBACK)\b/i);
    }
    expect(files.filter((f) => f.hadOwnTransaction).length).toBeGreaterThanOrEqual(14);
  });

  it('só de dados (o baseline não confere pelo catálogo): as de backfill sim, as de estrutura não', () => {
    const dataOnly = files.filter(isDataOnly).map((f) => f.name);
    expect(dataOnly).toEqual(
      expect.arrayContaining([
        '20261003040000_boost_no_coords',
        '20261004000100_passes_backfill',
        '20261005000200_photo_keys',
      ]),
    );
    // inbox e media_objects têm UPDATE/INSERT, mas também mexem em estrutura
    for (const n of [
      '20240923000000_init',
      '20261001000000_inbox',
      '20261005000100_media_objects',
    ]) {
      expect(dataOnly).not.toContain(n);
    }
  });

  it('todas rodam em transação (nenhuma usa CONCURRENTLY/VACUUM) e nenhuma sai vazia', () => {
    for (const f of files) {
      expect(f.transactional).toBe(true);
      expect(f.statements.length).toBeGreaterThan(0);
      expect(f.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('parseMigration', () => {
  it('checksum igual com CRLF e LF e ignora o BOM', () => {
    const lf = 'CREATE TABLE a (id int);\nSELECT 1;\n';
    const crlf = '\uFEFFCREATE TABLE a (id int);\r\nSELECT 1;\r\n';
    expect(checksumOf(crlf)).toBe(checksumOf(lf));
    expect(parseMigration(N, crlf).checksum).toBe(parseMigration(N, lf).checksum);
    expect(checksumOf(lf)).not.toBe(checksumOf(lf.replace('a (', 'b (')));
  });

  it('tira BEGIN do início e COMMIT do fim', () => {
    const m = parseMigration(N, '-- cabeçalho\nBEGIN;\nCREATE TABLE a (id int);\nCOMMIT;\n');
    expect(m.hadOwnTransaction).toBe(true);
    expect(m.statements.map((s) => s.sql)).toEqual(['CREATE TABLE a (id int)']);
  });

  it.each([
    [
      'BEGIN no meio',
      'CREATE TABLE a (id int);\nBEGIN;\nSELECT 1;\nCOMMIT;',
      'controle de transação',
    ],
    ['ROLLBACK', 'CREATE TABLE a (id int);\nROLLBACK;', 'controle de transação'],
    ['SAVEPOINT', 'BEGIN;\nSAVEPOINT x;\nSELECT 1;\nCOMMIT;', 'controle de transação'],
    ['BEGIN sem COMMIT', 'BEGIN;\nCREATE TABLE a (id int);', 'BEGIN sem COMMIT'],
    ['CONCURRENTLY', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON a (id);', 'CONCURRENTLY'],
    ['VACUUM', 'VACUUM a;', 'VACUUM'],
    ['CREATE DATABASE', 'CREATE DATABASE x;', 'CREATE/DROP DATABASE'],
    ['SET de sessão', 'SET search_path = x;\nSELECT 1;', 'SET LOCAL'],
    ['RESET', 'RESET ALL;', 'SET LOCAL'],
    ['vazia', '-- nada\n', 'sem nenhum comando'],
    ['meta do psql', '\\set ON_ERROR_STOP 1\nSELECT 1;', 'psql'],
  ])('erro: %s', (_label, sql, msg) => {
    expect(() => parseMigration(N, sql)).toThrow(MigrationFileError);
    expect(() => parseMigration(N, sql)).toThrow(msg);
  });

  it('isDataOnly: só DML (SET LOCAL não conta); DDL ou DO $$ = estrutura', () => {
    expect(
      isDataOnly(parseMigration(N, "SET LOCAL lock_timeout = '1s';\nUPDATE a SET x = 1;")),
    ).toBe(true);
    expect(isDataOnly(parseMigration(N, 'WITH t AS (SELECT 1) DELETE FROM a;'))).toBe(true);
    expect(isDataOnly(parseMigration(N, 'UPDATE a SET x = 1;\nCREATE INDEX i ON a (x);'))).toBe(
      false,
    );
    expect(isDataOnly(parseMigration(N, 'DO $$ BEGIN UPDATE a SET x = 1; END $$;'))).toBe(false);
  });

  it('SET LOCAL e palavra-chave dentro de string passam', () => {
    const m = parseMigration(
      N,
      "SET LOCAL lock_timeout = '5s';\nCOMMENT ON TABLE a IS 'CONCURRENTLY; VACUUM';",
    );
    expect(m.statements).toHaveLength(2);
  });

  it('reconhece a diretiva -- migrate:no-transaction no cabeçalho', () => {
    const m = parseMigration(
      N,
      '-- índice grande\n-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS i ON a (id);',
    );
    expect(m.transactional).toBe(false);
    expect(m.statements).toHaveLength(1);
    // depois do 1º comando a linha não vale como diretiva
    expect(() => parseMigration(N, 'SELECT 1;\n-- migrate:no-transaction\nVACUUM a;')).toThrow(
      'VACUUM',
    );
    // sem transação não aceita BEGIN/COMMIT
    expect(() =>
      parseMigration(N, '-- migrate:no-transaction\nBEGIN;\nSELECT 1;\nCOMMIT;'),
    ).toThrow('BEGIN');
  });

  it('nome da pasta tem que ser <14 dígitos>_<nome>', () => {
    expect(() => parseMigration('2099_x', 'SELECT 1;')).toThrow('nome inválido');
    expect(() => parseMigration('20990101000000_Maiuscula', 'SELECT 1;')).toThrow('nome inválido');
  });
});

describe('loadMigrations (pasta temporária)', () => {
  let dir: string;
  const put = (rel: string, content: string) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metch-migr-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('ordena por nome e ignora README/migration_lock.toml', () => {
    put('20990102000000_b/migration.sql', 'SELECT 2;');
    put('20990101000000_a/migration.sql', 'SELECT 1;');
    put('README.md', '# oi');
    put('migration_lock.toml', 'provider = "postgresql"');
    expect(loadMigrations(dir).map((m) => m.name)).toEqual([
      '20990101000000_a',
      '20990102000000_b',
    ]);
  });

  it('.sql solto na raiz é erro', () => {
    put('20990101000000_a/migration.sql', 'SELECT 1;');
    put('manual_extensions.sql', 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow('arquivo .sql solto');
  });

  it('pasta sem migration.sql é erro', () => {
    fs.mkdirSync(path.join(dir, '20990101000000_vazia'));
    expect(() => loadMigrations(dir)).toThrow('pasta sem migration.sql');
  });

  it('pasta com nome fora do padrão é erro', () => {
    put('rascunho/migration.sql', 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow('nome inválido');
  });
});
