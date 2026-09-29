-- place_candidates: id genérico do lugar com a fonte (30/09/2026) — o candidato passa a apontar pro place_catalog.
-- Só ADITIVA e idempotente. A coluna antiga mapbox_id fica (o backend antigo ainda a lê); o código novo grava as duas
-- e lê ext_id (COALESCE com mapbox_id pras linhas gravadas pelo backend antigo). Apagar mapbox_id numa migration futura.
-- Aplicar: docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < migration.sql

ALTER TABLE place_candidates ADD COLUMN IF NOT EXISTS ext_id VARCHAR(120);  -- 'ovt:<gers>' | 'osm:n123' | legado 'mbx:<id>'
UPDATE place_candidates SET ext_id = mapbox_id WHERE ext_id IS NULL;
-- deixa de ser obrigatória: quando o código parar de gravar a coluna legada, a migration de remoção não quebra nada
ALTER TABLE place_candidates ALTER COLUMN mapbox_id DROP NOT NULL;
