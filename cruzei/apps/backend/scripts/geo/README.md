# scripts/geo — catálogo próprio de lugares, bairros e ruas

Troca o Mapbox (busca de lugares, "Cidade · Bairro", "ir até lá") por dados abertos no nosso Postgres.
Fontes: **Overture Places** (principal; sem Google) e **OpenStreetMap** via Overpass. Nada do Google, nenhuma chamada ao Mapbox.

Tabelas (migration `prisma/migrations/20260930120000_geo_catalog`):

| tabela | o que é | id |
|---|---|---|
| `place_catalog` | lugar público (bar, balada, restaurante, parque, shopping…), um registro por lugar de cada fonte | `ovt:<gers>` · `osm:n123` / `osm:w123` / `osm:r123` |
| `geo_areas` | polígono administrativo do OSM: município (`city`, nível 8), setor/distrito (`district`, 9), bairro (`neighborhood`, 10); fora do bbox, município do IBGE | `osm:r123` · `ibge:<código>` |
| `geo_names` | nome pra "ir até lá": `street` (trechos com o mesmo nome agrupados), `neighborhood`, `city`, `place` (distrito, vila); cidades do Brasil inteiro (IBGE) | `osm:r123` · `osm:n123` · `osm:st<menor way id>` · `ibge:<código>` |

Funções SQL: `f_unaccent(text)` (unaccent imutável) e `f_norm(text)` (minúsculas, sem acento, só `[a-z0-9 ]` — a mesma regra do
`normalize()` do `places.ranking.ts`). `name_norm` é coluna gerada `f_norm(name)`, com índice GIN trigram.

## Rodar (em `apps/backend`, com o `.env` apontando pro banco)

```bash
# 0) uma vez: tabelas (o banco de dev não tem _prisma_migrations; `prisma migrate deploy` para no P3005)
docker exec -i cruzei-postgres psql -U cruzei -d cruzei -v ON_ERROR_STOP=1 < prisma/migrations/20260930120000_geo_catalog/migration.sql
npx prisma generate

# 1) baixar (só leitura na rede; grava em data/geo/, que está no .gitignore)
py -3.13 -m pip install --user duckdb                          # uma vez
py -3.13 scripts/geo/overture_extract.py                       # Overture: release mais recente, ~15 s
npx ts-node --transpile-only scripts/geo/osm-fetch.ts          # OSM: temas areas, pois, streets, places (~1 min)

# 2) carregar (idempotente; pode repetir)
npx ts-node --transpile-only scripts/geo/import.ts             # passos: areas, overture, osm, post, names
npx ts-node --transpile-only scripts/geo/import.ts --only post # só refaz duplicados + bairro/cidade

# 3) pois antigos do Mapbox: mostra o que re-casaria (dry-run); grava só com --apply
npx ts-node --transpile-only scripts/geo/rematch-mapbox-pois.ts

# 4) municípios do Brasil inteiro (IBGE): "Cidade" no cabeçalho e "ir até lá" por cidade fora do bbox (~30 s; idempotente)
npx ts-node --transpile-only scripts/geo/ibge-municipios.ts            # baixa o que faltar em data/geo (~63 MB) e carrega
npx ts-node --transpile-only scripts/geo/ibge-municipios.ts --refetch  # baixa de novo (malha/nomes novos)
```

**Municípios do IBGE** (`ibge-municipios.ts`): malha municipal 2022 (API de malhas v3, qualidade máxima) simplificada com
`ST_SimplifyPreserveTopology` (0,001° ≈ 110 m, `--tolerance`; ~1,1 milhão de vértices, ~16 MB de geometria) →
`geo_areas` (`ibge:<código>`, `city`, nível 8, UF); sede de cada município das Localidades 2022 → `geo_names` (`city`, ponto
na sede, contexto = UF; sem sede, um ponto de dentro). Nomes atuais da API de localidades v1. Cidade que já veio do OSM com
o mesmo `IBGE:GEOCODIGO` (Uberlândia, com os bairros) fica só com a do OSM, nos dois sentidos: o `import.ts` (passo areas)
apaga o `ibge:` repetido e o `ibge-municipios.ts` pula o código que o OSM já tem; fora isso o `import.ts` não mexe em linha
`ibge:`. A malha 2022 não tem Boa Esperança do Norte/MT (criada depois): o ponto fica no município de origem.
O backend avisa no boot quando `NODE_ENV=production` e `PHOTON_URL` está vazio (rua/bairro só no bbox importado), e
`GET /geo/coverage` diz ao app se a região tem lugares/ruas importados (fora dela o overlay mostra "ainda não temos").

Bbox padrão: Uberlândia e arredores `-48.40,-19.02,-48.15,-18.82` (oeste,sul,leste,norte). Pra outra região, passe
`--bbox` igual nos três scripts (o `import.ts` recusa arquivo baixado com outro bbox). Regiões diferentes convivem: o
import só mexe no que está dentro do bbox pedido.

Specs: `taxonomy.spec.ts` (mapeamento de categoria). Typecheck dos scripts: `npx tsc --noEmit -p scripts/geo/tsconfig.json`.

## O que o import faz

- **Overture → place_catalog**: `basic_category` / `taxonomy` → `kind` (PlaceKind) + `chip` (PlaceCategoryKey), em
  `taxonomy.ts`. Descarta conteúdo adulto/motel (mesma lista `BLOCKED` da busca), distribuidora/disk bebidas, condomínio/prédio
  residencial e `other` com confiança < 0,25. Buffet, chácara e espaço de festa (`event_or_party_service` e afins) entram com
  `searchable=false`.
- **OSM → place_catalog**: POIs com nome de noite, comida, cultura, parque, praça e shopping (`confidence` fixa 0,6).
- **post**: mesmo lugar = até 60 m e (nome igual, ou núcleo do nome sem palavras genéricas com trigram ≥ 0,6, ou um contido
  no outro com o mesmo chip). O melhor fica canônico (na busca > tipo conhecido > Overture > confiança); os outros ganham
  `dup_of` e o canônico herda horário/contato e guarda `alt_ids`/`alt_names`. Depois `neighborhood`/`city`/`state` saem de
  `ST_Covers` com `geo_areas` (bairro; fora dos bairros, o distrito).
- **areas**: relações `boundary=administrative` 8/9/10 que cruzam o bbox ou contêm seus cantos/centro, montadas com
  `ST_BuildArea`; anel aberto no OSM por até 300 m (ou 10% do perímetro) é fechado ligando as pontas. UF pelo `IBGE:GEOCODIGO`.
- **names**: cidade no `admin_centre`, bairro/distrito no `label` (ou ponto de dentro), pontos `place=*` sem polígono, e ruas
  agrupadas por nome + cidade com DBSCAN (~150 m), ponto em cima da rua perto do meio.
- Sumiu da fonte: em `place_catalog` vira `searchable=false` + `gone_on` (o id fica); em `geo_areas`/`geo_names` sai.

## Consultas de referência

```sql
-- busca por nome perto de um ponto (canônicos, na busca padrão)
SELECT id, name, kind, chip, neighborhood, city, ST_Distance(geog, :pt) AS m
  FROM place_catalog
 WHERE dup_of IS NULL AND searchable AND f_norm(:q) <% name_norm AND ST_DWithin(geog, :pt, 40000)
 ORDER BY word_similarity(f_norm(:q), name_norm) DESC, m LIMIT 20;

-- "Cidade · Bairro" de um ponto
SELECT kind, name FROM geo_areas WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))
 ORDER BY admin_level DESC NULLS LAST;

-- "ir até lá"
SELECT kind, name, neighborhood, city, ST_Y(geog::geometry) lat, ST_X(geog::geometry) lng, bbox
  FROM geo_names WHERE f_norm(:q) <% name_norm ORDER BY word_similarity(f_norm(:q), name_norm) DESC, size_m DESC NULLS LAST LIMIT 10;
```

## Atualização e atribuição

- Overture: mensal (ID GERS estável entre releases). OSM: semanal. Os dois são só rodar de novo os passos 1 e 2.
- Atribuição obrigatória no app/termos: "© OpenStreetMap contributors" (ODbL) e "Overture Maps Foundation" (Places:
  CDLA-Permissive-2.0 / Apache-2.0 conforme a fonte; docs.overturemaps.org/attribution). Base derivada do OSM é ODbL
  se for distribuída.
