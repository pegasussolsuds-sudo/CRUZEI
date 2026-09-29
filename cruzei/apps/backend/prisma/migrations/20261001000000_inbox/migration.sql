-- Inbox (01/10/2026): Principal e Solicitações. O chat deixa de pertencer ao Match e passa a pertencer à conversa do par.
-- Uma conversa por par (user_low_id < user_high_id); pasta GRAVADA: promoted_at != null = principal.
-- Cada pessoa tem a sua linha em conversation_members: papel (quem pediu / quem recebeu), não lidas, silenciada, arquivada.
-- Idempotente, numa transação só (se o backfill falhar, nada muda).
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)
-- matches e o enum "MatchStatus" ficam CONGELADOS (ninguém lê nem grava); saem numa migration posterior.

BEGIN;

DO $$ BEGIN CREATE TYPE member_role AS ENUM ('REQUESTER', 'RECIPIENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_low_id UUID NOT NULL,
  user_high_id UUID NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TIMESTAMP(6),
  -- quando foi pra principal (curtida mútua, resposta dos dois lados ou "mover pra principal"); é permanente
  promoted_at TIMESTAMP(6),
  promoted_reason VARCHAR(16),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  -- par canônico: a ordem do uuid no Postgres é a mesma do [a, b].sort() em minúsculas no JS
  CONSTRAINT conv_pair_order CHECK (user_low_id < user_high_id),
  CONSTRAINT conv_pair_uq UNIQUE (user_low_id, user_high_id),
  CONSTRAINT conv_promoted_reason_chk CHECK (promoted_reason IS NULL OR promoted_reason IN ('mutual', 'bounce', 'manual')),
  CONSTRAINT conversations_user_low_id_fkey FOREIGN KEY (user_low_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT conversations_user_high_id_fkey FOREIGN KEY (user_high_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_high ON conversations (user_high_id);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations (last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  -- REQUESTER mandou a 1ª mensagem; Solicitações é só do RECIPIENT
  role member_role NOT NULL,
  -- contador transacional (o app nunca calcula)
  unread_count INTEGER NOT NULL DEFAULT 0,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  -- fora do inbox desta pessoa (bloqueio, banimento, "arquivar conversa")
  archived_at TIMESTAMP(6),
  CONSTRAINT conversation_members_pkey PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conv_members_unread_chk CHECK (unread_count >= 0),
  CONSTRAINT conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
);
-- lista do inbox: só as conversas não arquivadas de quem pede
CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members (user_id) WHERE archived_at IS NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS conversation_id UUID,
  -- mensagem de sistema ('mutual_like'); no máximo uma de cada tipo por conversa
  ADD COLUMN IF NOT EXISTS system_kind VARCHAR(32);

-- ---------- backfill: cada match (de qualquer status) vira a conversa do par, com o MESMO id ----------
-- (report.context.matchId, a moderação e o histórico continuam resolvendo). Todo match nasceu de curtida mútua.
INSERT INTO conversations (id, user_low_id, user_high_id, created_at, last_message_at, promoted_at, promoted_reason)
SELECT m.id,
       LEAST(m.user_a_id, m.user_b_id),
       GREATEST(m.user_a_id, m.user_b_id),
       m.matched_at,
       COALESCE((SELECT max(x.created_at) FROM messages x WHERE x.match_id = m.id), m.matched_at),
       m.matched_at,
       'mutual'
FROM matches m
WHERE m.user_a_id <> m.user_b_id
ON CONFLICT DO NOTHING;

-- pelo par (e não pelo id), pra não depender de a conversa ter o id do match
UPDATE messages x
SET conversation_id = c.id
FROM matches m
JOIN conversations c ON c.user_low_id = LEAST(m.user_a_id, m.user_b_id) AND c.user_high_id = GREATEST(m.user_a_id, m.user_b_id)
WHERE x.match_id = m.id AND x.conversation_id IS NULL;

-- membros: REQUESTER = quem mandou a 1ª mensagem; sem mensagem, quem curtiu primeiro.
-- blocked/unmatched (ou Block entre os dois) = arquivada pros dois; com bloqueio, não lidas zeradas.
-- expired volta ativa: o chat não expira mais.
WITH src AS (
  SELECT c.id AS conv_id, m.user_a_id AS a, m.user_b_id AS b, m.status,
         (SELECT x.sender_id FROM messages x
           WHERE x.conversation_id = c.id AND x.sender_id IN (m.user_a_id, m.user_b_id)
           ORDER BY x.created_at, x.id LIMIT 1) AS first_sender,
         (SELECT l.liker_id FROM likes l
           WHERE (l.liker_id = m.user_a_id AND l.liked_id = m.user_b_id) OR (l.liker_id = m.user_b_id AND l.liked_id = m.user_a_id)
           ORDER BY l.created_at, l.id LIMIT 1) AS first_liker,
         EXISTS (SELECT 1 FROM blocks bl
           WHERE (bl.blocker_id = m.user_a_id AND bl.blocked_id = m.user_b_id) OR (bl.blocker_id = m.user_b_id AND bl.blocked_id = m.user_a_id)) AS has_block
  FROM matches m
  JOIN conversations c ON c.user_low_id = LEAST(m.user_a_id, m.user_b_id) AND c.user_high_id = GREATEST(m.user_a_id, m.user_b_id)
)
INSERT INTO conversation_members (conversation_id, user_id, role, unread_count, archived_at)
SELECT s.conv_id,
       u.user_id,
       (CASE WHEN u.user_id = COALESCE(s.first_sender, s.first_liker, s.a) THEN 'REQUESTER' ELSE 'RECIPIENT' END)::member_role,
       CASE WHEN s.status = 'blocked' OR s.has_block THEN 0
            ELSE (SELECT count(*) FROM messages x
                   WHERE x.conversation_id = s.conv_id AND x.read_at IS NULL AND x.sender_id <> u.user_id)::int
       END,
       CASE WHEN s.status IN ('blocked', 'unmatched') OR s.has_block THEN (now() AT TIME ZONE 'UTC') END
FROM src s
CROSS JOIN LATERAL (VALUES (s.a), (s.b)) AS u(user_id)
ON CONFLICT DO NOTHING;

-- ---------- a mensagem passa a pertencer à conversa ----------
DO $$
DECLARE orphans INTEGER;
BEGIN
  SELECT count(*) INTO orphans FROM messages WHERE conversation_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'inbox: % mensagem(ns) sem conversa depois do backfill', orphans;
  END IF;
END $$;

ALTER TABLE messages ALTER COLUMN conversation_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_id_fkey') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

-- match_id congelado: só as mensagens de antes da inbox têm; sai junto com a tabela matches
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_match_id_fkey;
ALTER TABLE messages ALTER COLUMN match_id DROP NOT NULL;

-- NULLs são distintos no Postgres: as mensagens normais (system_kind nulo) não colidem
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conv_system_kind ON messages (conversation_id, system_kind);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages (conversation_id, created_at DESC);

COMMIT;
