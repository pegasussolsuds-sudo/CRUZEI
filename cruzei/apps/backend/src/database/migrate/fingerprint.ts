import type { SqlConn } from './sql-conn';

/**
 * "Impressão" do catálogo do schema atual (current_schema()): uma linha de texto por objeto. Serve pro baseline
 * comparar o banco existente com um banco novo montado pelas migrations — se bater, dá pra marcar como aplicado.
 *
 * Entra: tabelas/views, colunas (sem a posição: ADD COLUMN em outra ordem não é diferença), índices, constraints,
 * gatilhos, enums, domínios, sequences, funções (md5 da definição) e extensões (sem versão).
 * Fica de fora: a tabela do executor e tudo que pertence a extensão (spatial_ref_sys e funções/views do PostGIS).
 * Limite: migration só de dados (backfill, UPDATE) não aparece aqui.
 */

const FINGERPRINT_SQL = `
WITH s AS (SELECT oid FROM pg_namespace WHERE nspname = current_schema()),
ext AS (SELECT classid, objid FROM pg_depend WHERE deptype = 'e'),
rel AS (
  SELECT c.oid, c.relname, c.relkind
    FROM pg_class c
   WHERE c.relnamespace = (SELECT oid FROM s)
     AND c.relname <> $1
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_class'::regclass AND ext.objid = c.oid)
)
SELECT line::text AS line FROM (
  SELECT 'relation ' || r.relname || ' ' || r.relkind::text AS line
    FROM rel r WHERE r.relkind IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  SELECT 'column ' || r.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
         || CASE WHEN a.attidentity <> '' THEN ' identity ' || a.attidentity::text ELSE '' END
         || CASE WHEN a.attgenerated <> '' THEN ' generated ' || a.attgenerated::text ELSE '' END
         || COALESCE(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
    FROM rel r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE r.relkind IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  SELECT 'index ' || pg_get_indexdef(i.indexrelid)
    FROM pg_index i JOIN rel r ON r.oid = i.indrelid
  UNION ALL
  SELECT 'constraint ' || r.relname || '.' || con.conname || ' ' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con JOIN rel r ON r.oid = con.conrelid
  UNION ALL
  SELECT 'trigger ' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN rel r ON r.oid = t.tgrelid
   WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'view ' || r.relname || ' ' || md5(pg_get_viewdef(r.oid))
    FROM rel r WHERE r.relkind IN ('v', 'm')
  UNION ALL
  SELECT 'sequence ' || r.relname || ' ' || format_type(sq.seqtypid, NULL) || ' +' || sq.seqincrement::text
    FROM rel r JOIN pg_sequence sq ON sq.seqrelid = r.oid
  UNION ALL
  SELECT 'enum ' || t.typname || ' (' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) || ')'
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typnamespace = (SELECT oid FROM s)
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_type'::regclass AND ext.objid = t.oid)
   GROUP BY t.typname
  UNION ALL
  SELECT 'domain ' || t.typname || ' ' || format_type(t.typbasetype, t.typtypmod)
         || CASE WHEN t.typnotnull THEN ' not null' ELSE '' END
    FROM pg_type t
   WHERE t.typtype = 'd' AND t.typnamespace = (SELECT oid FROM s)
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_type'::regclass AND ext.objid = t.oid)
  UNION ALL
  SELECT 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
         || md5(pg_get_functiondef(p.oid))
    FROM pg_proc p
   WHERE p.pronamespace = (SELECT oid FROM s) AND p.prokind IN ('f', 'p')
     AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_proc'::regclass AND ext.objid = p.oid)
  UNION ALL
  SELECT 'extension ' || x.extname FROM pg_extension x
) f
ORDER BY 1`;

/** nome da tabela sem schema (a impressão é do schema atual) */
function bareTable(table: string): string {
  const parts = table.split('.');
  return parts[parts.length - 1];
}

export async function schemaFingerprint(conn: SqlConn, migrationsTable: string): Promise<string[]> {
  const rows = await conn.query<{ line: string }>(FINGERPRINT_SQL, bareTable(migrationsTable));
  return rows.map((r) => r.line);
}

export interface FingerprintDiff {
  /** existe no banco e não sai das migrations */
  onlyInDb: string[];
  /** as migrations criam e o banco não tem */
  onlyInMigrations: string[];
}

export function diffFingerprints(db: string[], fromMigrations: string[]): FingerprintDiff {
  const a = new Set(db);
  const b = new Set(fromMigrations);
  return {
    onlyInDb: [...a].filter((l) => !b.has(l)).sort(),
    onlyInMigrations: [...b].filter((l) => !a.has(l)).sort(),
  };
}

export function isSameFingerprint(d: FingerprintDiff): boolean {
  return d.onlyInDb.length === 0 && d.onlyInMigrations.length === 0;
}
