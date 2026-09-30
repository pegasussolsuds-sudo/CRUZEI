-- Número reciclado (03/10/2026): conta parada há >= AUTH_DORMANT_DAYS (padrão 90) não entra direto pelo SMS. A pessoa
-- confirma a data de nascimento ou diz "não é minha"; 3 erros (somados por conta, sem prazo) ou "não é minha" LIBERAM o número:
-- a conta antiga perde o telefone (histórico em phone_releases), fica pausada sem prazo e todas as sessões caem
-- (sessions_valid_after comparado ao iat do token no refresh, no Bearer e no socket).
-- Só ADITIVA e idempotente (IF NOT EXISTS), numa transação só.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)
-- Colunas novas em users seguem o tipo da tabela (TIMESTAMP em UTC); a tabela nova usa TIMESTAMPTZ.

BEGIN;

ALTER TABLE users
  -- quando o número saiu desta conta (badge "Número liberado" no painel); null = nunca liberado
  ADD COLUMN IF NOT EXISTS phone_released_at TIMESTAMP(6),
  -- token (access/refresh/socket) com iat anterior a isto é recusado (401 session_revoked); null = nenhum corte
  ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMP(6);

-- histórico oficial de cada liberação de número. Sem FK em users (sobrevive à exclusão da conta, como access_logs).
-- phone é o número INTEIRO da conta antiga (mesma sensibilidade de users.phone: inteiro só pra admin).
CREATE TABLE IF NOT EXISTS phone_releases (
  id BIGSERIAL PRIMARY KEY,
  -- conta antiga, que perdeu o número
  user_id UUID NOT NULL,
  phone VARCHAR(20) NOT NULL,
  -- not_mine: "não é minha" · birthdate_mismatch: errou a data 3x · account_deleted: conta apagada · admin: painel
  reason VARCHAR(20) NOT NULL,
  -- situação da conta antiga na hora (banida/suspensa → a conta nova nasce em revisão)
  account_status "AccountStatus" NOT NULL,
  -- último uso da conta antiga (GREATEST de last_active_at, created_at e access_logs)
  last_used_at TIMESTAMPTZ(6),
  -- de onde veio o pedido que liberou (Marco Civil)
  ip VARCHAR(45),
  port INTEGER,
  user_agent VARCHAR(255),
  -- admin que liberou pelo painel (reason 'admin'); null nos outros casos
  released_by UUID,
  -- conta criada depois com este número (preenchida no cadastro, até 1 dia depois)
  new_user_id UUID,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT phone_releases_reason_chk CHECK (reason IN ('not_mine', 'birthdate_mismatch', 'account_deleted', 'admin'))
);
CREATE INDEX IF NOT EXISTS phone_releases_user_idx ON phone_releases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_releases_phone_idx ON phone_releases (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_releases_new_user_idx ON phone_releases (new_user_id) WHERE new_user_id IS NOT NULL;

COMMIT;
