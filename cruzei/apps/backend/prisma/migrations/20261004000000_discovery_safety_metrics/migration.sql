-- Leva de 04/10/2026: gênero sem "Não-binário", filtro de idade do "quem ver", "Passar" salvo, limite diário da super
-- curtida, prioridade da super curtida no deck, filtro de abuso (denúncia automática), botão de emergência (suporte
-- urgente) e métricas próprias (analytics_events).
-- Idempotente, numa transação só.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)
-- Antes (diagnóstico): SELECT gender, count(*) FROM users GROUP BY 1;

BEGIN;

-- ---------- gênero: só Mulher / Homem / Outro ----------
-- o Postgres não remove valor de enum → tipo novo, converte (non_binary → other), apaga o velho e renomeia
-- (mesmo caminho da orientação em 20261003020000_profile_fields). "Outro" continua só pra quem escolheu "Todos".
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'Gender' AND e.enumlabel = 'non_binary'
  ) THEN
    CREATE TYPE "Gender_v2" AS ENUM ('female', 'male', 'other');
    ALTER TABLE users ALTER COLUMN gender TYPE "Gender_v2" USING (
      CASE gender::text WHEN 'non_binary' THEN 'other' ELSE gender::text END
    )::"Gender_v2";
    DROP TYPE "Gender";
    ALTER TYPE "Gender_v2" RENAME TO "Gender";
  END IF;
END $$;

-- ---------- filtro de idade do "quem ver" (só o que EU vejo; não recíproco) ----------
-- 18–99 = sem limite (o topo do slider, "80+", grava 99). Quem esconde a idade é filtrado pela idade real no servidor.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age_min SMALLINT NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS age_max SMALLINT NOT NULL DEFAULT 99;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_age_range_chk
    CHECK (age_min >= 18 AND age_min <= age_max AND age_max <= 99);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- "Passar" salvo ----------
-- quem eu passei não volta no DECK por DISCOVERY_PASS_DAYS (padrão 30; o mapa continua mostrando). Passar de novo
-- renova created_at. Limpeza periódica apaga o que passou do prazo (índice por created_at). Passar não vai mais pro audit_log.
CREATE TABLE IF NOT EXISTS passes (
  user_id UUID NOT NULL,
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT passes_pkey PRIMARY KEY (user_id, target_id),
  CONSTRAINT passes_not_self_chk CHECK (user_id <> target_id),
  CONSTRAINT passes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT passes_target_id_fkey FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS passes_created_idx ON passes (created_at);
-- "Voltar" e a lista dos meus passes recentes
CREATE INDEX IF NOT EXISTS passes_user_recent_idx ON passes (user_id, created_at DESC);

-- ---------- super curtida: limite por dia (meia-noite de America/Sao_Paulo) ----------
-- grátis 1, Premium e Premium+ 7 (SUPER_LIKE_DAILY em shared-types). Contador por dia de São Paulo: desfazer a curtida
-- NÃO devolve o uso (senão dava pra mandar super curtida sem fim). Gasto atômico:
--   INSERT INTO super_like_uses (user_id, day, used) VALUES ($1, $2, 1)
--   ON CONFLICT (user_id, day) DO UPDATE SET used = super_like_uses.used + 1 WHERE super_like_uses.used < $limite
--   RETURNING used;   -- sem linha = acabou
-- Linhas com mais de 7 dias podem ser apagadas.
CREATE TABLE IF NOT EXISTS super_like_uses (
  user_id UUID NOT NULL,
  -- dia de São Paulo: (now() AT TIME ZONE 'America/Sao_Paulo')::date
  day DATE NOT NULL,
  used SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT super_like_uses_pkey PRIMARY KEY (user_id, day),
  CONSTRAINT super_like_uses_used_chk CHECK (used >= 0),
  CONSTRAINT super_like_uses_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS super_like_uses_day_idx ON super_like_uses (day);

-- super curtidas RECEBIDAS (prioridade no deck de quem recebeu): liked_id + is_super
CREATE INDEX IF NOT EXISTS likes_super_received_idx ON likes (liked_id, created_at DESC) WHERE is_super;

-- ---------- suporte: fila de urgência (botão de emergência) ----------
-- urgent fica marcado no atendimento (histórico); a fila põe no topo os urgentes NÃO resolvidos (urgent_at mais antigo
-- primeiro fica a critério da tela; o índice cobre os dois sentidos).
ALTER TABLE support_threads
  ADD COLUMN IF NOT EXISTS urgent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS urgent_at TIMESTAMPTZ(6);

DO $$ BEGIN
  ALTER TABLE support_threads ADD CONSTRAINT support_threads_urgent_chk CHECK (NOT urgent OR urgent_at IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS support_threads_urgent_idx ON support_threads (urgent_at DESC) WHERE urgent AND status <> 'resolved';

-- ---------- denúncias automáticas e de emergência ----------
-- reports.reason é VARCHAR(50) sem CHECK: 'emergency' (botão de emergência) entra sem mudar coluna. O filtro de abuso
-- grava golpe como reason 'scam', reporter_id NULL e context.source 'auto_filter'. Dedupe no banco: no máximo UMA
-- automática pendente por pessoa e motivo (INSERT ... ON CONFLICT (reported_id, reason) WHERE <mesmo predicado> DO UPDATE/NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS reports_auto_filter_pending_uq ON reports (reported_id, reason)
  WHERE status = 'pending' AND reporter_id IS NULL AND (context ->> 'source') = 'auto_filter';

-- ---------- métricas próprias (sem empresa de fora) ----------
-- lista FECHADA de eventos (ANALYTICS_EVENTS em shared-types; mudar os dois juntos). Antes da conta existir vale o
-- install_id (id anônimo da instalação); no cadastro/login os eventos daquela instalação ganham o user_id.
-- Sem localização. Retenção de 13 meses (limpeza periódica por created_at).
CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  install_id VARCHAR(64),
  name VARCHAR(40) NOT NULL,
  -- etapa do cadastro (ONBOARDING_STEPS) nos onboarding_step_*; nos outros, opcional
  step VARCHAR(40),
  -- miudezas (plataforma, versão do app…); objeto pequeno, nunca posição
  props JSONB,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT analytics_events_name_chk CHECK (name IN (
    'app_open',
    'onboarding_step_view',
    'onboarding_step_done',
    'signup_done',
    'map_tour_done',
    'map_tour_skipped'
  )),
  CONSTRAINT analytics_events_who_chk CHECK (user_id IS NOT NULL OR install_id IS NOT NULL),
  CONSTRAINT analytics_events_step_chk CHECK (name NOT IN ('onboarding_step_view', 'onboarding_step_done') OR step IS NOT NULL),
  CONSTRAINT analytics_events_props_chk CHECK (props IS NULL OR (jsonb_typeof(props) = 'object' AND pg_column_size(props) <= 1024)),
  -- conta apagada: o evento fica anônimo (conta no funil, não aponta pra ninguém)
  CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS analytics_events_name_created_idx ON analytics_events (name, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_user_created_idx ON analytics_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_install_idx ON analytics_events (install_id);
-- limpeza dos 13 meses
CREATE INDEX IF NOT EXISTS analytics_events_created_brin ON analytics_events USING BRIN (created_at);

COMMIT;
