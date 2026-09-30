-- Push social (03/10/2026): mensagem nova, curtida e match viram push (só push: NÃO entram na central de avisos),
-- com preferências próprias, e a comemoração do match pra QUEM RECEBE (quem curtiu primeiro), ao vivo pelo socket
-- 'match:new' ou depois, ao abrir o app/push (pendentes em match_celebrations).
-- Só ADITIVA e idempotente (IF NOT EXISTS), numa transação só.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)

BEGIN;

-- sem linha em notification_prefs continua valendo "recebe tudo" (prévia da mensagem ligada)
ALTER TABLE notification_prefs
  ADD COLUMN IF NOT EXISTS messages BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS likes BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS matches BOOLEAN NOT NULL DEFAULT true,
  -- texto da mensagem no push (o conteúdo fica escondido na tela bloqueada)
  ADD COLUMN IF NOT EXISTS message_preview BOOLEAN NOT NULL DEFAULT true;

-- comemoração pendente: user_id é quem RECEBE o match (curtiu primeiro); peer_id é quem completou.
-- Uma linha por par e direção; curtir de novo depois de 7 dias da vista reabre (created_at novo, seen_at null).
CREATE TABLE IF NOT EXISTS match_celebrations (
  user_id UUID NOT NULL,
  peer_id UUID NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- mostrada no app (POST /likes/matches/:userId/seen); null = pendente
  seen_at TIMESTAMPTZ(6),
  CONSTRAINT match_celebrations_pkey PRIMARY KEY (user_id, peer_id),
  CONSTRAINT match_celebrations_self_chk CHECK (user_id <> peer_id),
  CONSTRAINT match_celebrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT match_celebrations_peer_id_fkey FOREIGN KEY (peer_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS match_celebrations_pending_idx ON match_celebrations (user_id, created_at DESC) WHERE seen_at IS NULL;

COMMIT;
