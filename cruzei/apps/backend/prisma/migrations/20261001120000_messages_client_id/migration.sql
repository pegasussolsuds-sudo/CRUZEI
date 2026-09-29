-- Idempotência do envio (01/10/2026): o clientId que o app gera por mensagem passa a ser gravado na própria mensagem.
-- Uma chave só por REMETENTE, valendo para POST /conversations e POST /conversations/:id/messages: o reenvio com o
-- mesmo clientId (depois de timeout/queda) devolve a mensagem que já existe, em qualquer das duas rotas, sem prazo.
-- NULLs são distintos no Postgres: mensagens sem clientId (sistema, antigas) não colidem.
-- Idempotente. Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)

BEGIN;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_id VARCHAR(64);

-- alvo do INSERT ... ON CONFLICT (sender_id, client_id) DO NOTHING do InboxService
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_sender_client_id ON messages (sender_id, client_id);

COMMIT;
