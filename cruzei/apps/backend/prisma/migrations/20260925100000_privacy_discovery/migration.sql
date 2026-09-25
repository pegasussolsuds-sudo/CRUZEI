-- Privacidade de localização (brief PRIVACIDADE): modo de descoberta recíproco + áreas privadas do próprio usuário.
DO $$ BEGIN
  CREATE TYPE "DiscoveryMode" AS ENUM ('everyone', 'compatible', 'nobody');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discovery_mode" "DiscoveryMode" NOT NULL DEFAULT 'everyone';

CREATE TABLE IF NOT EXISTS "private_areas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "label" VARCHAR(40) NOT NULL,
  "latitude" DECIMAL(10, 8) NOT NULL,
  "longitude" DECIMAL(11, 8) NOT NULL,
  "radius_m" SMALLINT NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "private_areas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "private_areas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "private_areas_user_id_idx" ON "private_areas"("user_id");
