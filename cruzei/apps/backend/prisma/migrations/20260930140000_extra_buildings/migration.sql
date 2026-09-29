-- Prédios extras (30/09/2026): footprints da Microsoft (Global ML Building Footprints, ODbL) onde o OSM não tem prédio.
-- O mapa desenha os prédios do OSM pelos tiles; esta tabela completa os que faltam. Nada do Google.
-- Só ADITIVA e idempotente (IF NOT EXISTS). Dados: scripts/geo/buildings-msft.ts.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (o banco de dev não tem _prisma_migrations: `prisma migrate deploy` para no P3005; nunca migrate dev / db push)

CREATE EXTENSION IF NOT EXISTS "postgis";

CREATE TABLE IF NOT EXISTS extra_buildings (
  id           BIGINT       PRIMARY KEY,                     -- md5 da geometria de origem (52 bits: cabe no id de feição do MVT e em número JS)
  source       VARCHAR(16)  NOT NULL DEFAULT 'msft',
  geom         geometry(Geometry, 4326) NOT NULL,            -- Polygon ou MultiPolygon (válido)
  height       REAL         NOT NULL,                        -- metros, múltiplo de 0,5 (o que o mapa extruda)
  min_height   REAL         NOT NULL DEFAULT 0,
  height_src   VARCHAR(16)  NOT NULL,                        -- '3dglobfp' | 'heuristic' (área/forma; ver README)
  height_3dg   REAL,                                         -- altura do 3D-GloBFP casada pela geometria (m), guardada mesmo quando não usada
  area_m2      REAL         NOT NULL,
  confidence   REAL,                                         -- confiança do modelo da Microsoft (0..1; NULL = não informada)
  refreshed_on DATE         NOT NULL,                        -- último import que gravou/mudou o prédio (igual = não reescreve)
  CONSTRAINT extra_buildings_source_chk CHECK (source IN ('msft')),
  CONSTRAINT extra_buildings_height_src_chk CHECK (height_src IN ('3dglobfp', 'heuristic')),
  CONSTRAINT extra_buildings_geom_chk CHECK (GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON'))
);
CREATE INDEX IF NOT EXISTS extra_buildings_geom_idx ON extra_buildings USING GIST (geom);
