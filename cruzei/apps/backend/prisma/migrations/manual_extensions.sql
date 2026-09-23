-- Habilita extensões espaciais que o Prisma não cria sozinho.
-- Roda antes de qualquer migration do Prisma.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Coluna geography na tabela locations (Prisma não modela PostGIS).
ALTER TABLE locations ADD COLUMN IF NOT EXISTS location geography(POINT, 4326);
CREATE INDEX IF NOT EXISTS idx_location_geo ON locations USING GIST (location);

-- Trigger genérica pra updated_at em tabelas que o Prisma não marca (locations, audit, etc.)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  -- locations não tem updated_at (histórico append-only) — trigger antiga removida
  DROP TRIGGER IF EXISTS locations_updated_at ON locations;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_no_update') THEN
    -- audit log é append-only
    CREATE TRIGGER audit_log_no_update
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END$$;

-- Mantém a coluna geography sincronizada com latitude/longitude (Prisma só escreve lat/lng).
CREATE OR REPLACE FUNCTION locations_sync_geography()
RETURNS TRIGGER AS $$
BEGIN
  NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude::float8, NEW.latitude::float8), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS locations_sync_geography ON locations;
CREATE TRIGGER locations_sync_geography
  BEFORE INSERT OR UPDATE OF latitude, longitude ON locations
  FOR EACH ROW EXECUTE FUNCTION locations_sync_geography();

-- backfill de linhas antigas
UPDATE locations SET location = ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326)::geography WHERE location IS NULL;
