-- Faixa de idade do "quem ver": vão mínimo de 4 anos entre o "de" e o "até" (AGE_RANGE_MIN_GAP). Faixa estreita
-- ajudava a descobrir a idade de quem esconde — junto com o limite de 5 mudanças por dia (PATCH /me/settings) e o
-- bloco de 5 anos no filtro de quem esconde a idade (location/discovery-order.ts).
-- Quem já tinha faixa mais estreita ganha o vão no "até" (ou no "de", quando o "até" encosta em 99).
-- Idempotente: os UPDATEs só pegam linha fora da regra; o CHECK é derrubado e recriado.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
BEGIN;

UPDATE users SET age_max = LEAST(99, age_min + 4) WHERE age_max - age_min < 4;
UPDATE users SET age_min = age_max - 4 WHERE age_max - age_min < 4;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_age_range_chk;
ALTER TABLE users
  ADD CONSTRAINT users_age_range_chk CHECK (age_min >= 18 AND age_max - age_min >= 4 AND age_max <= 99);

COMMIT;
