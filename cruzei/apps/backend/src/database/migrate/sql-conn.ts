import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Conexão mínima que o executor usa. Em produção é um PrismaClient com UMA conexão (connection_limit=1): o advisory
 * lock de sessão e os comandos sem transação caem sempre na mesma conexão. Nos testes unitários, um falso.
 */
export interface SqlConn {
  exec(sql: string, ...params: unknown[]): Promise<number>;
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  /** transação interativa; o erro dentro de `fn` desfaz tudo */
  tx<T>(fn: (tx: SqlConn) => Promise<T>, timeoutMs: number): Promise<T>;
  close(): Promise<void>;
}

export type ConnectFn = (url: string) => SqlConn;

type RawRunner = Pick<Prisma.TransactionClient, '$executeRawUnsafe' | '$queryRawUnsafe'>;

function wrap(raw: RawRunner, client: PrismaClient | null): SqlConn {
  return {
    exec: (sql, ...params) => raw.$executeRawUnsafe(sql, ...params),
    query: <T>(sql: string, ...params: unknown[]) => raw.$queryRawUnsafe<T[]>(sql, ...params),
    tx: (fn, timeoutMs) => {
      if (!client) throw new Error('transação dentro de transação não é suportada');
      // maxWait: a conexão é uma só; se estiver presa, algo está errado — espera pouco
      return client.$transaction((t) => fn(wrap(t, null)), { timeout: timeoutMs, maxWait: 60_000 });
    },
    close: async () => {
      if (client) await client.$disconnect();
    },
  };
}

export const prismaConnect: ConnectFn = (url) => {
  const client = new PrismaClient({ datasources: { db: { url: singleConnectionUrl(url) } } });
  return wrap(client, client);
};

// ---------- URL ----------

const DB_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertDbName(name: string): string {
  if (!DB_NAME_RE.test(name))
    throw new Error(`nome de banco inválido: "${name}" (use [a-z0-9_], até 63)`);
  return name;
}

/** força connection_limit=1 (mantém o resto: schema, sslmode…) */
export function singleConnectionUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set('connection_limit', '1');
  return u.toString();
}

export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** mesma URL (usuário, senha, host, parâmetros) apontando pra outro banco */
export function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** só host:porta/banco — nunca usuário nem senha */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}/${databaseOf(url)}`;
  } catch {
    return '(URL inválida)';
  }
}

/** SQLSTATE e mensagem do Postgres a partir do erro do Prisma (P2010 traz meta.code/meta.message) */
export function pgErrorOf(e: unknown): { sqlstate?: string; message: string } {
  // a mensagem do Prisma começa com "Invalid `prisma.$executeRawUnsafe()` invocation:"; o que importa é a última linha
  const lastLine = (s: string) =>
    s
      .split('\n')
      .filter((l) => l.trim() !== '')
      .slice(-1)[0]
      ?.trim() ?? s;
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (e.meta ?? {}) as { code?: string; message?: string };
    const message = (meta.message ?? lastLine(e.message)).replace(/^ERROR:\s*/, '');
    return { sqlstate: meta.code, message };
  }
  if (e instanceof Error) return { message: lastLine(e.message) };
  return { message: String(e) };
}
