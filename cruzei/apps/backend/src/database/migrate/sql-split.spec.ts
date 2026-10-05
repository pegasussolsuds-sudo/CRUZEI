import * as fs from 'node:fs';
import * as path from 'node:path';

import { splitSql, SqlSplitError } from './sql-split';

const sqls = (text: string) => splitSql(text).map((s) => s.sql);

describe('splitSql', () => {
  it('separa por ; e guarda a linha onde cada comando começa', () => {
    const r = splitSql(
      'CREATE TABLE a (id int);\n\n  -- comentário\nCREATE TABLE b (id int);\nSELECT 1',
    );
    expect(r.map((s) => s.sql)).toEqual([
      'CREATE TABLE a (id int)',
      'CREATE TABLE b (id int)',
      'SELECT 1',
    ]);
    expect(r.map((s) => s.line)).toEqual([1, 4, 5]);
  });

  it('não divide em ; dentro de aspas, identificador, E-string, dollar-quote e comentário', () => {
    const text = [
      "SELECT 'a;b', 'it''s; ok';",
      'SELECT "col;x" FROM t;',
      "SELECT E'it\\'s; ok';",
      "DO $$ BEGIN RAISE NOTICE 'x;'; END $$;",
      'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN RETURN 1; END; $fn$;',
      'SELECT 1 /* a; /* aninhado; */ ainda comentário; */ + 1;',
      'SELECT 2 -- ; comentário de linha',
      ';',
    ].join('\n');
    expect(sqls(text)).toEqual([
      "SELECT 'a;b', 'it''s; ok'",
      'SELECT "col;x" FROM t',
      "SELECT E'it\\'s; ok'",
      "DO $$ BEGIN RAISE NOTICE 'x;'; END $$",
      'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN RETURN 1; END; $fn$',
      'SELECT 1 /* a; /* aninhado; */ ainda comentário; */ + 1',
      'SELECT 2 -- ; comentário de linha',
    ]);
  });

  it('em string comum a \\ não escapa (standard_conforming_strings)', () => {
    expect(sqls("SELECT 'a\\'; SELECT 1;")).toEqual(["SELECT 'a\\'", 'SELECT 1']);
  });

  it('$1 não abre dollar-quote (parâmetro de função SQL, corpo do f_unaccent)', () => {
    const text =
      'CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT\n' +
      "  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;\n" +
      "CREATE FUNCTION g(int) RETURNS int LANGUAGE sql AS 'SELECT $1 + 1';\n" +
      'PREPARE p AS SELECT $1::int; EXECUTE p(1);';
    const r = sqls(text);
    expect(r).toHaveLength(4);
    expect(r[0]).toContain('$1) $$');
    expect(r[2]).toBe('PREPARE p AS SELECT $1::int');
  });

  it('a regex do Instagram (profile_fields) passa intacta dentro do DO $$', () => {
    const body =
      'DO $$ BEGIN\n  ALTER TABLE users ADD CONSTRAINT users_instagram_handle_chk\n' +
      "    CHECK (instagram_handle IS NULL OR (instagram_handle ~ '^[a-z0-9._]{1,30}$' AND instagram_handle !~ '(^\\.)|(\\.$)|(\\.\\.)'));\n" +
      'EXCEPTION WHEN duplicate_object THEN NULL; END $$';
    expect(sqls(`${body};\nCOMMIT;`)).toEqual([body, 'COMMIT']);
  });

  it('descarta comando vazio ou só de comentário e aceita o último sem ;', () => {
    expect(sqls(';;\n-- só comentário\n/* bloco */;\nSELECT 1\n-- fim')).toEqual([
      'SELECT 1\n-- fim',
    ]);
    expect(splitSql('')).toEqual([]);
  });

  it('code tira strings, identificadores, corpos $$ e comentários (busca de palavra-chave)', () => {
    const [a, b] = splitSql('SELECT \'CONCURRENTLY\' AS "VACUUM" -- BEGIN\n;DO $x$ COMMIT $x$;');
    expect(a.code).not.toMatch(/CONCURRENTLY|VACUUM|BEGIN/);
    expect(b.code).toBe('DO $$');
  });

  it('conta linhas dentro de strings e comentários de várias linhas', () => {
    const r = splitSql("SELECT 'a\nb\nc';\n/* x\ny */\nSELECT $$\n$$;\nSELECT 3;");
    expect(r.map((s) => s.line)).toEqual([1, 6, 8]);
  });

  it.each([
    ["SELECT 'aberta", 'aspas simples sem fechar'],
    ['SELECT "aberta', 'aspas duplas sem fechar'],
    ['DO $$ BEGIN NULL; END', 'sem fechar'],
    ['SELECT 1 /* aberto', 'comentário /* sem fechar'],
    ['\\i outro.sql', 'meta-comando do psql'],
    ['CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;', 'BEGIN ATOMIC'],
  ])('erro: %s', (text, msg) => {
    expect(() => splitSql(text)).toThrow(SqlSplitError);
    expect(() => splitSql(text)).toThrow(msg);
  });

  it('todos os arquivos reais dividem sem erro e nenhum comando sobra com ; fora de string', () => {
    const dir = path.join(__dirname, '..', '..', '..', 'prisma', 'migrations');
    const folders = fs.readdirSync(dir).filter((n) => /^\d{14}_/.test(n));
    expect(folders.length).toBeGreaterThan(20);
    for (const folder of folders) {
      const text = fs
        .readFileSync(path.join(dir, folder, 'migration.sql'), 'utf8')
        .replace(/\r\n/g, '\n');
      const statements = splitSql(text);
      expect(statements.length).toBeGreaterThan(0);
      for (const s of statements) {
        expect(s.code).not.toContain(';');
        expect(s.sql.length).toBeGreaterThan(0);
      }
    }
  });
});
