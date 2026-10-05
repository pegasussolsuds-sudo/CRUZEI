#!/usr/bin/env bash
# Recria DO ZERO o banco de TESTE cruzei_test e aplica todas as migrations pelo executor (src/database/migrate):
# mesma ordem, mesmo checksum e mesma transação por arquivo do dev/produção. Prova que um banco NOVO sai completo.
# Idempotente: cada execução derruba e recria o banco. O executor só aceita apagar banco *_test/*_check.
#
# Uso (de qualquer pasta):  bash apps/backend/test/db/setup-test-db.sh
#   ou, em apps/backend:    pnpm test:db:setup
# URL: DATABASE_URL_TEST (CI) ou a DATABASE_URL do ambiente/.env trocando só o banco por cruzei_test
# (mesma regra do test/db/env.ts). Não precisa de psql nem de docker exec; nada de senha é impresso.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# node-linker=hoisted: o ts-node mora no node_modules da raiz do monorepo (ou no PATH, quando vem pelo pnpm)
TS_NODE=""
for candidate in "${BACKEND_DIR}/node_modules/.bin/ts-node" "${BACKEND_DIR}/../../node_modules/.bin/ts-node"; do
  if [ -f "${candidate}" ]; then TS_NODE="${candidate}"; break; fi
done
[ -n "${TS_NODE}" ] || TS_NODE="$(command -v ts-node || true)"
if [ -z "${TS_NODE}" ]; then
  echo "[test-db] ts-node não encontrado (rode pnpm install)" >&2
  exit 1
fi

cd "${BACKEND_DIR}"
exec "${TS_NODE}" --transpile-only src/database/migrate/cli.ts test-db
