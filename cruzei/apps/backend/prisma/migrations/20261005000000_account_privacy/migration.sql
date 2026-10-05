-- Conta e privacidade (05/10/2026): excluir conta pelo app com 30 dias de arrependimento, limpeza definitiva por
-- tarefa ("conta limpa": a linha de users FICA sem dado pessoal, porque o DELETE em cascata apagaria denúncias contra a
-- pessoa, provas da moderação e registro fiscal), exportar dados e apagar histórico de localização.
-- audit_log: o gatilho audit_log_no_update chamava update_updated_at() (a tabela nem tem updated_at) e barrava tudo
-- "por acidente". Agora a função audit_log_append_only barra UPDATE/DELETE com mensagem clara; a única exceção é o
-- GUC metch.audit_erasure='on', que vale só dentro da transação que o liga (limpeza da conta, linhas não-admin).
-- Só ADITIVA e idempotente (IF NOT EXISTS / duplicate_object), numa transação só. Segura antes do deploy do código.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)
-- Antes (diagnóstico):
--   SELECT status, count(*) FROM data_deletion_requests GROUP BY 1;                  -- esperado vazio
--   SELECT count(*) FROM users WHERE deleted_at IS NOT NULL;
--   SELECT action, count(*) FROM audit_log WHERE action NOT LIKE 'admin.%' GROUP BY 1; -- esperado só 'pass'

BEGIN;

-- ---------- audit_log só-anexar, com exceção transacional ----------
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('metch.audit_erasure', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log é só-anexar (% barrado)', TG_OP USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- "Passar" antigo (antes da tabela passes): o backfill 20261004000100 já copiou os recentes e a Política promete 30 dias
SELECT set_config('metch.audit_erasure', 'on', true);
DELETE FROM audit_log WHERE action = 'pass';
SELECT set_config('metch.audit_erasure', 'off', true);

-- ---------- pedidos de exclusão ----------
ALTER TABLE data_deletion_requests
  -- de onde veio: app (Perfil > Excluir conta), support (e-mail / exclusões manuais antigas), admin (painel)
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'app',
  -- motivo opcional escolhido no app (DELETION_REASONS)
  ADD COLUMN IF NOT EXISTS reason VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP(6),
  -- limpeza adiada: denúncia contra a pessoa em análise (open_reports) ou conta em revisão (review_hold)
  ADD COLUMN IF NOT EXISTS hold_reason VARCHAR(20),
  -- tentativas da limpeza e último erro (a tarefa é idempotente e tenta de novo)
  ADD COLUMN IF NOT EXISTS attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error VARCHAR(255),
  -- HMAC(PHONE_HASH_SECRET) do número, gravado na limpeza (o número em si sai de users)
  ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(64);

DO $$ BEGIN
  ALTER TABLE data_deletion_requests ADD CONSTRAINT ddr_status_chk CHECK (status IN ('pending', 'cancelled', 'completed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE data_deletion_requests ADD CONSTRAINT ddr_source_chk CHECK (source IN ('app', 'support', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE data_deletion_requests ADD CONSTRAINT ddr_reason_chk
    CHECK (reason IS NULL OR reason IN ('met_someone', 'not_useful', 'privacy', 'safety', 'taking_break', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE data_deletion_requests ADD CONSTRAINT ddr_hold_chk
    CHECK (hold_reason IS NULL OR hold_reason IN ('open_reports', 'review_hold'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE data_deletion_requests ADD CONSTRAINT ddr_done_chk
    CHECK (((status = 'completed') = (completed_at IS NOT NULL)) AND ((status = 'cancelled') = (cancelled_at IS NOT NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- um pedido pendente por pessoa (o POST é idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS ddr_one_pending_uq ON data_deletion_requests (user_id) WHERE status = 'pending';
-- fila da limpeza
CREATE INDEX IF NOT EXISTS ddr_due_idx ON data_deletion_requests (scheduled_for) WHERE status = 'pending';
-- retenção do phone_hash e busca por número
CREATE INDEX IF NOT EXISTS ddr_hash_expiry_idx ON data_deletion_requests (completed_at) WHERE phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ddr_phone_hash_idx ON data_deletion_requests (phone_hash) WHERE phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ddr_user_idx ON data_deletion_requests (user_id, requested_at DESC);

-- ---------- conta limpa (tombstone) ----------
-- quando a limpeza definitiva terminou; conta limpa não guarda telefone, e-mail, bio, @, orientação, avatar nem selfie
ALTER TABLE users ADD COLUMN IF NOT EXISTS purged_at TIMESTAMP(6);
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_purged_clean_chk CHECK (
    purged_at IS NULL OR (
      deleted_at IS NOT NULL AND phone IS NULL AND email IS NULL AND password_hash IS NULL AND bio IS NULL
      AND instagram_handle IS NULL AND orientation IS NULL AND orientation_consented_at IS NULL
      AND avatar_config IS NULL AND verification_selfie_url IS NULL
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS users_purged_idx ON users (purged_at) WHERE purged_at IS NOT NULL;

-- ---------- índices dos DELETE por pessoa da limpeza ----------
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_id) WHERE reporter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS passes_target_idx ON passes (target_id);
CREATE INDEX IF NOT EXISTS match_celebrations_peer_idx ON match_celebrations (peer_id);
CREATE INDEX IF NOT EXISTS place_votes_user_idx ON place_votes (user_id);
CREATE INDEX IF NOT EXISTS poi_reports_user_idx ON poi_reports (user_id);
CREATE INDEX IF NOT EXISTS boosts_user_idx ON boosts (user_id);

-- ---------- backfill ----------
-- exclusões feitas à mão entram na fila, com o prazo contado de quando foram excluídas (as velhas limpam na próxima rodada)
INSERT INTO data_deletion_requests (id, user_id, requested_at, scheduled_for, status, source)
SELECT gen_random_uuid(), u.id, u.deleted_at, GREATEST(u.deleted_at + interval '30 days', now() AT TIME ZONE 'UTC'),
       'pending', 'support'
  FROM users u
 WHERE u.deleted_at IS NOT NULL AND u.purged_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM data_deletion_requests d WHERE d.user_id = u.id AND d.status = 'pending');

COMMIT;
