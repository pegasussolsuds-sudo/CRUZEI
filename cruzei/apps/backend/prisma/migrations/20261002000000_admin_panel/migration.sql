-- Painel admin (02/10/2026): lugares ocultos, eventos, campanhas de push/aviso, suporte ao vivo, Premium manual,
-- estatística de "abriu" nas notificações, preferências de aviso e desfecho das denúncias de lugar.
-- Só ADITIVA e idempotente (IF NOT EXISTS), numa transação só.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)
-- Colunas de horário novas são TIMESTAMPTZ (o resto do banco é TIMESTAMP em UTC); as que entram em tabela antiga
-- seguem o tipo da tabela (notifications.opened_at).

BEGIN;

-- ---------- lugares: ocultar sem apagar ----------
-- lugar oculto some de TODA leitura do app (mapa, vibe, hotspots, detalhe, check-in, índice de presença) e continua
-- no painel; desocultar devolve com o mesmo id (check-ins, denúncias e candidatos continuam apontando pra ele)
ALTER TABLE pois ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ(6);

-- ---------- eventos ----------
-- evento publicado vira um POI de mapa (category event/show, pois.event_id) até terminar: o app já mostra
-- "⚡ Evento perto" e o filtro de eventos sem mudar nada. Cancelado/terminado → o POI fica oculto.
CREATE TABLE IF NOT EXISTS events (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR(120) NOT NULL,
  description TEXT,
  category VARCHAR(12) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'draft',
  starts_at TIMESTAMPTZ(6) NOT NULL,
  ends_at TIMESTAMPTZ(6) NOT NULL,
  venue_name VARCHAR(255),
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  address VARCHAR(500),
  city VARCHAR(100),
  cover_url VARCHAR(500),
  -- lugar que já existe onde o evento acontece (opcional)
  poi_id BIGINT,
  -- POI de mapa do evento (criado ao publicar)
  map_poi_id BIGINT,
  created_by UUID,
  published_at TIMESTAMPTZ(6),
  cancelled_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT events_pkey PRIMARY KEY (id),
  CONSTRAINT events_title_chk CHECK (char_length(btrim(title)) >= 1),
  CONSTRAINT events_description_chk CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT events_category_chk CHECK (category IN ('event', 'show', 'party', 'festival', 'sports', 'other')),
  CONSTRAINT events_status_chk CHECK (status IN ('draft', 'published', 'cancelled')),
  CONSTRAINT events_time_chk CHECK (ends_at > starts_at),
  CONSTRAINT events_lat_chk CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT events_lng_chk CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT events_poi_id_fkey FOREIGN KEY (poi_id) REFERENCES pois(id) ON DELETE SET NULL,
  CONSTRAINT events_map_poi_id_fkey FOREIGN KEY (map_poi_id) REFERENCES pois(id) ON DELETE SET NULL,
  CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS events_status_starts_idx ON events (status, starts_at);
CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at DESC);

ALTER TABLE pois ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;
-- um POI de mapa por evento (republicar atualiza o mesmo)
CREATE UNIQUE INDEX IF NOT EXISTS pois_event_id_uq ON pois (event_id) WHERE event_id IS NOT NULL;

-- ---------- campanhas (push + central de avisos) ----------
CREATE TABLE IF NOT EXISTS push_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR(80) NOT NULL,
  body VARCHAR(240) NOT NULL,
  -- NotificationTarget (destino do toque) ou null
  target JSONB,
  -- CampaignAudience
  audience JSONB NOT NULL,
  -- CampaignChannels {push, inbox}
  channels JSONB NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ(6),
  started_at TIMESTAMPTZ(6),
  sent_at TIMESTAMPTZ(6),
  cancelled_at TIMESTAMPTZ(6),
  event_id UUID,
  created_by UUID,
  target_count INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  push_sent INTEGER NOT NULL DEFAULT 0,
  push_failed INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  error VARCHAR(255),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT push_campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT push_campaigns_status_chk CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed')),
  CONSTRAINT push_campaigns_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT push_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
-- o cron do minuto só olha as agendadas vencidas
CREATE INDEX IF NOT EXISTS push_campaigns_due_idx ON push_campaigns (scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS push_campaigns_created_idx ON push_campaigns (created_at DESC);
CREATE INDEX IF NOT EXISTS push_campaigns_event_idx ON push_campaigns (event_id) WHERE event_id IS NOT NULL;

-- ---------- notificações: de qual campanha veio e se a pessoa abriu (tocou) ----------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES push_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP(6);
CREATE INDEX IF NOT EXISTS notifications_campaign_idx ON notifications (campaign_id) WHERE campaign_id IS NOT NULL;

-- preferências de aviso da pessoa (PATCH /notifications/settings). Sem linha = recebe tudo.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id UUID NOT NULL,
  -- avisos gerais e novidades mandados pelo painel
  campaigns BOOLEAN NOT NULL DEFAULT true,
  -- avisos de evento
  events BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT notification_prefs_pkey PRIMARY KEY (user_id),
  CONSTRAINT notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---------- suporte ao vivo ----------
CREATE TABLE IF NOT EXISTS support_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  -- open = esperando a equipe; pending = esperando a pessoa; resolved = encerrado
  status VARCHAR(10) NOT NULL DEFAULT 'open',
  assigned_to UUID,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- contadores transacionais (o app e o painel nunca calculam)
  user_unread INTEGER NOT NULL DEFAULT 0,
  staff_unread INTEGER NOT NULL DEFAULT 0,
  first_response_at TIMESTAMPTZ(6),
  rating SMALLINT,
  resolved_at TIMESTAMPTZ(6),
  CONSTRAINT support_threads_pkey PRIMARY KEY (id),
  CONSTRAINT support_threads_status_chk CHECK (status IN ('open', 'pending', 'resolved')),
  CONSTRAINT support_threads_unread_chk CHECK (user_unread >= 0 AND staff_unread >= 0),
  CONSTRAINT support_threads_rating_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT support_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT support_threads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
);
-- no máximo UM atendimento não resolvido por pessoa (duas mensagens ao mesmo tempo não abrem dois)
CREATE UNIQUE INDEX IF NOT EXISTS support_threads_one_open_uq ON support_threads (user_id) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS support_threads_queue_idx ON support_threads (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_threads_user_idx ON support_threads (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL,
  -- a pessoa ou o atendente; null em mensagem de sistema
  sender_id UUID,
  author VARCHAR(8) NOT NULL,
  body TEXT NOT NULL,
  -- nota interna: só a equipe vê (nunca vai pro app)
  internal BOOLEAN NOT NULL DEFAULT false,
  -- id que o cliente gerou (reenvio idempotente)
  client_id VARCHAR(64),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT support_messages_pkey PRIMARY KEY (id),
  CONSTRAINT support_messages_author_chk CHECK (author IN ('user', 'staff', 'system')),
  CONSTRAINT support_messages_body_chk CHECK (char_length(body) BETWEEN 1 AND 2000),
  -- só a equipe escreve nota interna
  CONSTRAINT support_messages_internal_chk CHECK (NOT internal OR author = 'staff'),
  CONSTRAINT support_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES support_threads(id) ON DELETE CASCADE,
  CONSTRAINT support_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS support_messages_thread_idx ON support_messages (thread_id, created_at);
-- alvo do INSERT ... ON CONFLICT (sender_id, client_id) DO NOTHING (NULLs distintos: sem clientId não colide)
CREATE UNIQUE INDEX IF NOT EXISTS support_messages_sender_client_uq ON support_messages (sender_id, client_id);

-- ---------- Premium manual ----------
ALTER TABLE subscriptions
  -- motivo (só nas manuais, platform 'manual')
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS granted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ---------- denúncias de lugar: desfecho da equipe ----------
-- resolvida (lugar oculto) ou descartada: sai da fila do painel e deixa de contar pra retirada automática.
-- Denunciar de novo reabre (o upsert do app zera resolved_at).
ALTER TABLE poi_reports
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution VARCHAR(10);
DO $$ BEGIN
  ALTER TABLE poi_reports ADD CONSTRAINT poi_reports_resolution_chk CHECK (resolution IS NULL OR resolution IN ('hidden', 'dismissed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- painel: séries de 30 dias sem varrer as tabelas grandes ----------
-- BRIN: essas tabelas crescem na ordem de created_at (quase só-anexar), o índice é minúsculo
CREATE INDEX IF NOT EXISTS idx_messages_created_brin ON messages USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_likes_created_brin ON likes USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at);

COMMIT;
