-- Índices pras consultas por lugar (vibe, contagem, quem está aqui): sem eles cada chamada varria a tabela inteira
CREATE INDEX IF NOT EXISTS "locations_poi_id_recorded_at_idx" ON "locations"("poi_id", "recorded_at" DESC);
CREATE INDEX IF NOT EXISTS "locations_poi_id_expires_at_idx" ON "locations"("poi_id", "expires_at");
