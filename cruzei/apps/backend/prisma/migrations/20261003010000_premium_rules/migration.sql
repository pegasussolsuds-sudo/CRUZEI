-- Regras do Premium (03/10/2026): prazo do invisível grátis NO BANCO (antes só no Redis anon:free:until, que virava
-- invisível eterno), conta nova nasce VISÍVEL, teste grátis (trial) uma vez por conta E por telefone, e índices pra
-- tarefa periódica que rebaixa a assinatura vencida e devolve ao visível quem passou da janela grátis.
-- Invisível grátis: janela de 24 h e pode religar quando quiser (sem intervalo de espera — decisão do dono).
-- Só ADITIVA e idempotente (IF NOT EXISTS), numa transação só.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)
-- users/subscriptions são TIMESTAMP em UTC: comparar sempre com (now() AT TIME ZONE 'UTC'). Tabela nova: TIMESTAMPTZ.

BEGIN;

-- conta nova nasce visível (o cadastro grava a escolha; anônimo nasce com a janela de 24 h)
ALTER TABLE users ALTER COLUMN visibility_mode SET DEFAULT 'visible';

ALTER TABLE users
  -- fim da janela do invisível grátis (atual ou a última); null = sem janela (visível, ou Premium vigente)
  ADD COLUMN IF NOT EXISTS anonymous_until TIMESTAMP(6),
  -- quando a conta usou o teste grátis (qualquer 1ª assinatura paga consome); null = ainda pode
  ADD COLUMN IF NOT EXISTS trial_used_at TIMESTAMP(6);

-- fim do teste grátis desta assinatura; null = assinatura sem teste.
-- backfill 3 (o plano mensal sempre somou 7 dias de teste) SÓ quando a coluna nasce aqui: rodar de novo marcaria
-- "em teste" quem assinou o mensal depois, sem direito (trial_ends_at null gravado pelo código novo)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'subscriptions'
                    AND column_name = 'trial_ends_at') THEN
    ALTER TABLE subscriptions ADD COLUMN trial_ends_at TIMESTAMP(6);
    UPDATE subscriptions SET trial_ends_at = starts_at + interval '7 days' WHERE product_id = 'premium_monthly';
  END IF;
END $$;

-- teste grátis por TELEFONE: HMAC-SHA256 do número normalizado (segredo PHONE_HASH_SECRET), nunca o número cru.
-- Sem FK em users: sobrevive à exclusão da conta e à troca/liberação do número (é a trava anti-fraude).
CREATE TABLE IF NOT EXISTS trial_claims (
  phone_hash VARCHAR(64) NOT NULL,
  -- conta que usou o teste (informativo; sem FK)
  user_id UUID,
  claimed_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT trial_claims_pkey PRIMARY KEY (phone_hash)
);

-- tarefa periódica: quem está invisível e quem tem Premium com vencimento
CREATE INDEX IF NOT EXISTS users_anon_until_idx ON users (anonymous_until) WHERE visibility_mode = 'anonymous';
CREATE INDEX IF NOT EXISTS users_premium_expiry_idx ON users (premium_expires_at) WHERE premium_tier <> 'free';

-- backfill 1: quem está invisível sem Premium vigente ganha 24 h a partir de agora (os prazos do Redis se perdem;
-- depois disso a tarefa devolve ao visível e avisa 'anonymous_expired')
UPDATE users SET anonymous_until = (now() AT TIME ZONE 'UTC') + interval '24 hours'
 WHERE visibility_mode = 'anonymous'
   AND anonymous_until IS NULL
   AND NOT (premium_tier <> 'free' AND (premium_expires_at IS NULL OR premium_expires_at > (now() AT TIME ZONE 'UTC')));

-- backfill 2: quem já assinou (fora o Premium manual do painel) já usou o teste
UPDATE users u SET trial_used_at = s.first_at
  FROM (SELECT user_id, min(starts_at) AS first_at FROM subscriptions WHERE platform <> 'manual' GROUP BY user_id) s
 WHERE u.id = s.user_id AND u.trial_used_at IS NULL;

-- backfill 3: junto com a criação de subscriptions.trial_ends_at, lá em cima (só na 1ª vez)

COMMIT;
