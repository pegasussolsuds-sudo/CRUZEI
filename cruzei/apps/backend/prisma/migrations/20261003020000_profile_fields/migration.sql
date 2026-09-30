-- Campos do perfil (03/10/2026): orientação sexual com 9 opções (opcional), exibir a orientação no perfil,
-- "mesma orientação primeiro", "Mostrar: Mulheres / Homens / Todos" (recíproco) e @ do Instagram (público).
-- Idempotente, numa transação só.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (nunca migrate dev / db push: o banco não tem _prisma_migrations)
-- Antes (diagnóstico): SELECT orientation, gender, count(*) FROM users GROUP BY 1, 2;

BEGIN;

-- ---------- orientação: o Postgres não remove valor de enum → tipo novo, converte, apaga o velho e renomeia ----------
-- heterosexual → straight · homosexual → lesbian (female) / gay (male) / NULL (non_binary, other)
-- bisexual e pansexual iguais · other → NULL (nenhuma opção nova cabe sem chutar: a pessoa escolhe de novo)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'Orientation' AND e.enumlabel = 'straight'
  ) THEN
    CREATE TYPE "Orientation_v2" AS ENUM ('straight', 'gay', 'lesbian', 'asexual', 'bisexual', 'demisexual', 'pansexual', 'queer', 'curious');
    ALTER TABLE users ALTER COLUMN orientation TYPE "Orientation_v2" USING (
      CASE orientation::text
        WHEN 'heterosexual' THEN 'straight'
        WHEN 'homosexual' THEN CASE gender::text WHEN 'female' THEN 'lesbian' WHEN 'male' THEN 'gay' END
        WHEN 'bisexual' THEN 'bisexual'
        WHEN 'pansexual' THEN 'pansexual'
      END
    )::"Orientation_v2";
    DROP TYPE "Orientation";
    ALTER TYPE "Orientation_v2" RENAME TO "Orientation";
  END IF;
END $$;

DO $$ BEGIN CREATE TYPE "ShowMe" AS ENUM ('women', 'men', 'everyone'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE users
  -- prova do consentimento específico (LGPD art. 11, I): carimbado quando a pessoa escolhe a orientação no app;
  -- os valores migrados ficam null (não se inventa consentimento)
  ADD COLUMN IF NOT EXISTS orientation_consented_at TIMESTAMP(6),
  -- exibir a orientação no cartão público (padrão: não)
  ADD COLUMN IF NOT EXISTS show_orientation BOOLEAN NOT NULL DEFAULT false,
  -- ver primeiro quem tem a MESMA orientação (só conta quem exibe a sua); é só ordenação, não filtro
  ADD COLUMN IF NOT EXISTS same_orientation_first BOOLEAN NOT NULL DEFAULT false,
  -- quem eu quero ver (recíproco); 'everyone' mantém o comportamento de quem já tem conta
  ADD COLUMN IF NOT EXISTS show_me "ShowMe" NOT NULL DEFAULT 'everyone',
  -- @ do Instagram sem o @, em minúsculas; visível pra todo mundo que abre o cartão
  ADD COLUMN IF NOT EXISTS instagram_handle VARCHAR(30);

-- sem orientação, as duas opções que dependem dela ficam desligadas (o servidor responde 400 orientation_required antes)
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_orientation_flags_chk
    CHECK (orientation IS NOT NULL OR (NOT show_orientation AND NOT same_orientation_first));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- regra do Instagram: a-z, 0-9, ponto e _ (1 a 30), sem ponto no início/fim e sem '..'
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_instagram_handle_chk
    CHECK (instagram_handle IS NULL OR (instagram_handle ~ '^[a-z0-9._]{1,30}$' AND instagram_handle !~ '(^\.)|(\.$)|(\.\.)'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
