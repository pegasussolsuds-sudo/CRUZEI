-- Moderação (papel, suspensão, banimento, fila), fotos em análise, aceite dos Termos e registros de acesso.
-- Aplicar com: docker exec -i cruzei-postgres psql -U cruzei -d cruzei < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations). Idempotente.

DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('user', 'moderator', 'admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AccountStatus" AS ENUM ('active', 'suspended', 'banned'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PhotoStatus" AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role "UserRole" NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS account_status "AccountStatus" NOT NULL DEFAULT 'active',
  -- suspensão com prazo; null com account_status = 'suspended' = até revisão
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS moderation_reason VARCHAR(255),
  -- fora da descoberta até um moderador revisar (denúncia de exploração infantil ou várias denúncias seguidas)
  ADD COLUMN IF NOT EXISTS review_hold_at TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP(6);

-- fotos que já existem continuam no ar (default approved); as novas nascem 'pending' quando a moderação está ligada
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS status "PhotoStatus" NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS moderation_labels JSONB,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID,
  ADD COLUMN IF NOT EXISTS reject_reason VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_photos_pending ON photos (created_at) WHERE status = 'pending';

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0,
  -- de onde veio: { source: profile|chat|matches|map, matchId?, messageId?, photoId? }
  ADD COLUMN IF NOT EXISTS context JSONB;
CREATE INDEX IF NOT EXISTS idx_reports_pending ON reports (priority DESC, created_at) WHERE status = 'pending';

-- trilha das decisões de moderação (humanas e automáticas). Sem FK no alvo: o registro sobrevive à exclusão da conta.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id BIGSERIAL PRIMARY KEY,
  moderator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID NOT NULL,
  action VARCHAR(40) NOT NULL,
  report_id UUID,
  photo_id UUID,
  note TEXT,
  created_at TIMESTAMP(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_modact_target ON moderation_actions (target_user_id, created_at DESC);

-- registros de acesso (Marco Civil da Internet, art. 15: data, hora e IP por 6 meses). Sem FK pelo mesmo motivo.
CREATE TABLE IF NOT EXISTS access_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  event VARCHAR(20) NOT NULL,
  ip VARCHAR(45),
  port INTEGER,
  user_agent VARCHAR(255),
  created_at TIMESTAMP(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_created ON access_logs USING BRIN (created_at);
