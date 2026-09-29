-- Catálogo próprio de lugares, bairros e ruas (30/09/2026) — substitui o Mapbox na busca, no bairro e no "ir até lá".
-- Só ADITIVA e idempotente (IF NOT EXISTS / OR REPLACE). Dados: scripts/geo (Overture Places + OSM), nada do Google.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql
-- (o banco de dev não tem _prisma_migrations: `prisma migrate deploy` para no P3005; nunca migrate dev / db push)

CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- unaccent() é STABLE (depende do search_path) e não entra em índice nem coluna gerada; com o dicionário fixo é imutável
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- mesma regra do normalize() do places.ranking.ts: minúsculas, sem acento, só [a-z0-9] e espaço simples.
-- A busca normaliza o texto digitado com esta função (f_norm($q)) pra casar com name_norm.
CREATE OR REPLACE FUNCTION f_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT btrim(regexp_replace(lower(public.f_unaccent($1)), '[^a-z0-9]+', ' ', 'g')) $$;

-- ---------------------------------------------------------------------------------------------
-- place_catalog: lugares públicos da cidade (bar, balada, restaurante, parque…). Um registro por lugar de cada fonte;
-- o mesmo lugar em duas fontes fica com dup_of apontando pro canônico (a busca padrão lê só dup_of IS NULL).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS place_catalog (
  id                VARCHAR(80)  PRIMARY KEY,                -- 'ovt:<gers>' | 'osm:n123' | 'osm:w123' | 'osm:r123'
  source            VARCHAR(16)  NOT NULL,                   -- 'overture' | 'osm'
  name              VARCHAR(255) NOT NULL,
  name_norm         TEXT GENERATED ALWAYS AS (f_norm(name)) STORED,
  kind              VARCHAR(20)  NOT NULL,                   -- PlaceKind (shared-types)
  chip              VARCHAR(12),                             -- PlaceCategoryKey; null = não cai em nenhum chip
  confidence        REAL,                                    -- Overture 0..1; OSM sem sinal = 0.6
  geog              geography(Point, 4326) NOT NULL,
  neighborhood      VARCHAR(100),                            -- ST_Covers com geo_areas (bairro, ou distrito fora da sede)
  city              VARCHAR(100),
  state             CHAR(2),
  address           VARCHAR(500),
  phone             VARCHAR(40),
  website           VARCHAR(500),
  socials           JSONB,                                   -- lista de URLs (instagram, facebook…)
  opening_hours     TEXT,                                    -- sintaxe opening_hours do OSM
  raw_category      VARCHAR(80),                             -- 'cocktail_bar' (Overture) | 'amenity=bar' (OSM)
  searchable        BOOLEAN      NOT NULL DEFAULT true,      -- false = fora da busca padrão (buffet/chácara de festa, sumiu da fonte)
  dup_of            VARCHAR(80),                             -- mesmo lugar de outra fonte/registro: id do canônico
  alt_ids           TEXT[]       NOT NULL DEFAULT '{}',      -- ids que apontam pra este (dup_of)
  alt_names         TEXT[]       NOT NULL DEFAULT '{}',      -- nomes desses ids quando diferem
  source_updated_on DATE,                                    -- última atualização informada pela fonte
  refreshed_on      DATE         NOT NULL,                   -- último import que viu o lugar
  gone_on           DATE,                                    -- sumiu da fonte neste dia (searchable=false)
  CONSTRAINT place_catalog_source_chk CHECK (source IN ('overture', 'osm'))
);
CREATE INDEX IF NOT EXISTS place_catalog_geog_idx ON place_catalog USING GIST (geog);
CREATE INDEX IF NOT EXISTS place_catalog_name_trgm_idx ON place_catalog USING GIN (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS place_catalog_kind_idx ON place_catalog (kind);
CREATE INDEX IF NOT EXISTS place_catalog_alt_ids_idx ON place_catalog USING GIN (alt_ids);

-- ---------------------------------------------------------------------------------------------
-- geo_areas: polígonos administrativos do OSM (município 8, setor/distrito 9, bairro 10) pro "Cidade · Bairro"
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_areas (
  id           VARCHAR(40)  PRIMARY KEY,                     -- 'osm:r123' | 'osm:w123'
  name         VARCHAR(150) NOT NULL,
  name_norm    TEXT GENERATED ALWAYS AS (f_norm(name)) STORED,
  admin_level  SMALLINT,                                     -- null = place=suburb/neighbourhood sem boundary
  kind         VARCHAR(12)  NOT NULL,                        -- 'city' | 'district' | 'neighborhood'
  district_type VARCHAR(20),                                 -- border_type do OSM no nível 9 ('district' = distrito fora da sede)
  parent_id    VARCHAR(40),                                  -- menor área de nível acima que contém esta
  city         VARCHAR(100),                                 -- nome do município (o próprio, quando kind = 'city')
  state        CHAR(2),
  ibge_code    VARCHAR(12),                                  -- IBGE:GEOCODIGO (município: 7 dígitos)
  geom         geometry(MultiPolygon, 4326) NOT NULL,
  refreshed_on DATE         NOT NULL,
  CONSTRAINT geo_areas_kind_chk CHECK (kind IN ('city', 'district', 'neighborhood'))
);
CREATE INDEX IF NOT EXISTS geo_areas_geom_idx ON geo_areas USING GIST (geom);
CREATE INDEX IF NOT EXISTS geo_areas_kind_idx ON geo_areas (kind, admin_level);

-- ---------------------------------------------------------------------------------------------
-- geo_names: nomes pra "ir até lá" — rua (trechos com o mesmo nome agrupados), bairro, cidade e localidade (distrito, vila)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_names (
  id           VARCHAR(40)  PRIMARY KEY,                     -- 'osm:r123' (área) | 'osm:n123' (place) | 'osm:st<menor way id>' (rua)
  kind         VARCHAR(12)  NOT NULL,                        -- 'street' | 'neighborhood' | 'city' | 'place'
  name         VARCHAR(200) NOT NULL,
  name_norm    TEXT GENERATED ALWAYS AS (f_norm(name)) STORED,
  neighborhood VARCHAR(100),                                 -- bairro do ponto (rua: desambigua "Rua 10")
  city         VARCHAR(100),
  state        CHAR(2),
  geog         geography(Point, 4326) NOT NULL,              -- ponto representativo (em cima da rua / dentro da área)
  bbox         DOUBLE PRECISION[] NOT NULL DEFAULT '{}',        -- [oeste, sul, leste, norte] pro fitBounds; {} = sem
  size_m       REAL,                                         -- rua: comprimento; área: raiz da área (ordem de grandeza)
  area_id      VARCHAR(40),                                  -- geo_areas.id quando veio de um polígono
  refreshed_on DATE         NOT NULL,
  CONSTRAINT geo_names_kind_chk CHECK (kind IN ('street', 'neighborhood', 'city', 'place'))
);
CREATE INDEX IF NOT EXISTS geo_names_geog_idx ON geo_names USING GIST (geog);
CREATE INDEX IF NOT EXISTS geo_names_name_trgm_idx ON geo_names USING GIN (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS geo_names_kind_city_idx ON geo_names (kind, city);
