/**
 * setupFiles do `test:db`: roda ANTES de qualquer import dos specs e aponta o Prisma pro banco de TESTE.
 *
 * URL: DATABASE_URL_TEST, se existir (CI); senão a DATABASE_URL do ambiente (ou dos .env, pelo mesmo carregador
 * do main.ts, que só preenche o que falta) trocando SÓ o nome do banco por cruzei_test — usuário, senha, host,
 * porta e parâmetros ficam iguais. Nada disso é impresso.
 *
 * Trava contra o dev: se o banco final não for cruzei_test, ABORTA (lança antes de qualquer spec rodar).
 * O Prisma lê process.env.DATABASE_URL na criação do client e o carregador de .env não sobrescreve o que já existe,
 * então definir aqui vence o .env. Recriar o banco: bash test/db/setup-test-db.sh
 */
import type { PrismaClient } from '@prisma/client';

import { loadEnvFiles } from '../../src/config/env-files';

export const TEST_DB_NAME = 'cruzei_test';

function dbNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('[test:db] ABORTADO: DATABASE_URL de teste inválida');
  }
}

function resolveTestUrl(): string {
  const explicit = process.env.DATABASE_URL_TEST;
  if (explicit) return explicit;
  loadEnvFiles();
  const base = process.env.DATABASE_URL;
  if (!base)
    throw new Error('[test:db] ABORTADO: sem DATABASE_URL_TEST nem DATABASE_URL no ambiente/.env');
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

export const TEST_DATABASE_URL = resolveTestUrl();

const target = dbNameOf(TEST_DATABASE_URL);
if (target !== TEST_DB_NAME) {
  throw new Error(
    `[test:db] ABORTADO: o banco dos testes tem que ser ${TEST_DB_NAME} (veio "${target}")`,
  );
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

/** Segunda trava, já conectado: confere o banco de verdade do outro lado da conexão. Chamar no beforeAll. */
export async function assertTestDatabase(prisma: PrismaClient): Promise<void> {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (row?.db !== TEST_DB_NAME) {
    throw new Error(`[test:db] ABORTADO: conectado em "${row?.db}", esperado ${TEST_DB_NAME}`);
  }
}
