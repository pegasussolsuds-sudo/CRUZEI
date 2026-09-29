#!/usr/bin/env bash
# Recria DO ZERO o banco de TESTE cruzei_test (no mesmo container do dev) com o init + todas as migrations em ordem.
# Idempotente: cada execução derruba e recria o banco. Só mexe no cruzei_test — o nome é fixo, nunca vem de fora.
# (o banco não tem _prisma_migrations: nada de migrate dev / db push / reset; é psql puro, como no dev)
#
# Uso (de qualquer pasta):  bash apps/backend/test/db/setup-test-db.sh
#   ou, em apps/backend:    pnpm test:db:setup
# Variáveis opcionais:
#   PG_CONTAINER=cruzei-postgres  PG_USER=cruzei       (padrão: docker exec no container do dev)
#   PSQL="psql -h localhost -p 5432 -U cruzei"        (CI sem docker: psql direto, senha em PGPASSWORD)
set -euo pipefail

TEST_DB=cruzei_test
PG_CONTAINER="${PG_CONTAINER:-cruzei-postgres}"
PG_USER="${PG_USER:-cruzei}"
PSQL="${PSQL:-docker exec -i ${PG_CONTAINER} psql -U ${PG_USER}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(cd "${SCRIPT_DIR}/../../prisma/migrations" && pwd)"
INIT_DIR="20240923000000_init"

# psql no banco de teste, SQL pela entrada padrão; para no primeiro erro e cala os NOTICEs de IF NOT EXISTS
run_sql_file() {
  echo "  -> $1"
  ${PSQL} -d "${TEST_DB}" -v ON_ERROR_STOP=1 -q -c "SET client_min_messages = warning" -f - < "$2" > /dev/null
}

echo "[test-db] recriando ${TEST_DB}"
${PSQL} -d postgres -v ON_ERROR_STOP=1 -q -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)"
${PSQL} -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE ${TEST_DB}"

echo "[test-db] aplicando migrations"
# 1) init (tabelas base)  2) manual_extensions (PostGIS, coluna geography de locations, triggers: precisa do init)
# 3) as demais em ordem de nome (= ordem de data)
run_sql_file "${INIT_DIR}" "${MIGRATIONS}/${INIT_DIR}/migration.sql"
run_sql_file "manual_extensions.sql" "${MIGRATIONS}/manual_extensions.sql"
for dir in $(cd "${MIGRATIONS}" && ls -d */ | sed 's#/$##' | sort); do
  [ "${dir}" = "${INIT_DIR}" ] && continue
  [ -f "${MIGRATIONS}/${dir}/migration.sql" ] || continue
  run_sql_file "${dir}" "${MIGRATIONS}/${dir}/migration.sql"
done

echo "[test-db] conferindo"
${PSQL} -d "${TEST_DB}" -v ON_ERROR_STOP=1 -At -c "
  SELECT 'banco=' || current_database()
      || ' conversations=' || (to_regclass('public.conversations') IS NOT NULL)
      || ' conversation_members=' || (to_regclass('public.conversation_members') IS NOT NULL)
      || ' messages.conversation_id=' || (SELECT is_nullable FROM information_schema.columns
                                           WHERE table_name = 'messages' AND column_name = 'conversation_id')
      || ' postgis=' || (SELECT count(*) FROM pg_extension WHERE extname = 'postgis');"
echo "[test-db] pronto: ${TEST_DB}"
