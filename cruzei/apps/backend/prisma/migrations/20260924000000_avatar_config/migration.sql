-- Avatar Cruzei: config JSON (slot -> id) por usuario
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_config" JSONB;
