-- Número reciclado × conta limpa (05/10/2026): na limpeza de conta NÃO banida, o número inteiro que saiu dela
-- (phone_releases.user_id = conta) vira hash HMAC(PHONE_HASH_SECRET) em phone_hash e o phone fica NULL. O hash sai 6
-- meses depois da limpeza (ordem judicial ligada aos access_logs, como data_deletion_requests.phone_hash). O IP/porta/
-- app do pedido que a própria pessoa fez (new_user_id = conta, sem admin) saem quando passam dos 6 meses do Marco Civil.
-- Conta banida/suspensa (ou em revisão que passou do teto) continua com o número inteiro (evasão de banimento).
-- Só aditiva e idempotente. Uma transação por arquivo: o executor abre e fecha.
-- Aplicar: pnpm --filter @cruzei/backend db:migrate (produção: db:migrate:prod), nunca migrate dev / db push.

ALTER TABLE phone_releases ALTER COLUMN phone DROP NOT NULL;

-- HMAC-SHA256 (hex, 64) do número que saiu da linha na limpeza; null = número inteiro ainda na linha, ou hash vencido
ALTER TABLE phone_releases ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(64);

-- retenção diária do hash (só as linhas com hash)
CREATE INDEX IF NOT EXISTS phone_releases_hash_idx ON phone_releases (user_id) WHERE phone_hash IS NOT NULL;
