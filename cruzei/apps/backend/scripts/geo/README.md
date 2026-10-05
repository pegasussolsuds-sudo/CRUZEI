# scripts/geo — catálogo próprio de lugares, bairros e ruas

Troca o Mapbox (busca de lugares, "Cidade · Bairro", "ir até lá") por dados abertos no nosso Postgres.
Fontes: **Overture Places** (principal; sem Google) e **OpenStreetMap** via Overpass; prédios extras da **Microsoft** (+ 3D-GloBFP).
Nada do Google, nenhuma chamada ao Mapbox.

Tabelas (migration `prisma/migrations/20260930120000_geo_catalog`):

| tabela | o que é | id |
|---|---|---|
| `place_catalog` | lugar público (bar, balada, restaurante, parque, shopping…), um registro por lugar de cada fonte | `ovt:<gers>` · `osm:n123` / `osm:w123` / `osm:r123` |
| `geo_areas` | polígono administrativo do OSM: município (`city`, nível 8), setor/distrito (`district`, 9), bairro (`neighborhood`, 10); fora do bbox, município do IBGE | `osm:r123` · `ibge:<código>` |
| `geo_names` | nome pra "ir até lá": `street` (trechos com o mesmo nome agrupados), `neighborhood`, `city`, `place` (distrito, vila); cidades do Brasil inteiro (IBGE) | `osm:r123` · `osm:n123` · `osm:st<menor way id>` · `ibge:<código>` |
| `extra_buildings` | prédio da Microsoft onde o OSM não tem prédio: footprint + altura (migration `20260930140000_extra_buildings`; ver "Prédios extras") | md5 da geometria (52 bits) |

Funções SQL: `f_unaccent(text)` (unaccent imutável) e `f_norm(text)` (minúsculas, sem acento, só `[a-z0-9 ]` — a mesma regra do
`normalize()` do `places.ranking.ts`). `name_norm` é coluna gerada `f_norm(name)`, com índice GIN trigram.

## Rodar (em `apps/backend`, com o `.env` apontando pro banco)

```bash
# 0) uma vez: tabelas (pelo executor de migrations; nunca prisma migrate/db push — ver README da raiz)
pnpm db:migrate
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

# 5) prédios extras da Microsoft onde o OSM não tem prédio (~70 s; idempotente; baixa ~24 MB MS + 17 MB OSM + 158 MB 3D-GloBFP,
#    ~700 MB em disco com o shapefile extraído; só com --with-3dg; desligado por padrão: o modelo de altura dele usa referências do Google Open Buildings)
pnpm db:migrate                                                          # tabela extra_buildings, se ainda não tiver
npx ts-node --transpile-only scripts/geo/buildings-msft.ts               # baixa o que faltar e carrega
npx ts-node --transpile-only scripts/geo/buildings-msft.ts --only load   # só recarrega do que já está em data/geo
#   --refetch (MS/OSM/índices de novo) · --height auto|3dglobfp|heuristic · --with-3dg · --overlap 0.2 · --bbox …
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

## Prédios extras (`buildings-msft.ts` → `extra_buildings`)

O mapa desenha os prédios do OSM pelos tiles (OpenFreeMap). Em Uberlândia o OSM tem ~23,8 mil prédios; a Microsoft tem
~184 mil no mesmo bbox. Esta tabela guarda só os da Microsoft que o OSM **não** tem. **Nada do Google**: nem Google Open
Buildings, nem prédio do Overture (lá ~85% da geometria em Uberlândia é do Google).

**Fontes**
- **Microsoft Global ML Building Footprints** (ODbL; github.com/microsoft/GlobalMLBuildingFootprints): `dataset-links.csv`
  → arquivos dos quadkeys z9 que cobrem o bbox (Uberlândia inteira cabe no `210133033`, release 2026-02-23) → `data/geo/msft/`.
  Um GeoJSON por linha; no Brasil `height` vem sempre -1 e a confiança fica entre 0,87 e 1 (p1), então não filtramos por ela.
- **OSM** (Overpass, `way/rel` com `building` ou `building:part`) → `data/geo/osm-buildings.json`. Só pra deduplicar e calibrar.
  **Na data dos tiles do OpenFreeMap** (`--osm-date ofm`, o padrão: `[date:]` do Overpass com a data da versão do TileJSON,
  ex. `planet/20260913_164504_pt` → 2026-09-13T16:45:04Z). A dedupe tem que usar o mesmo OSM que o mapa desenha: com o OSM
  de hoje, prédio mapeado depois do tile tira o footprint da Microsoft e ainda não aparece no OFM (buraco). Em 29/09/2026
  eram ~2,6 mil prédios do OSM mais novos que o tile, quase todos no centro; com a data do OFM voltaram ~400 footprints
  (239 só nos 4 tiles z14 do centro) e a sobreposição com os prédios do tile não mudou (1 footprint com > 20%). Espelho
  do Overpass com base mais velha que a data é recusado (o kumi.systems estava parado em 2026-06-01). `--osm-date now`
  usa o OSM atual; uma data ISO também vale. Quando o OFM publica versão nova, rodar de novo baixa o OSM da data nova.
- **3D-GloBFP** (Che et al., 2024, ESSD 16:5357; CC BY 4.0): altura por footprint da Microsoft (ano-base 2020), shapefile por
  tile de 2,5° no figshare (10 artigos, índice em `data/geo/3dglobfp/files.json`; Uberlândia: `498_-50.0_-20.0_-47.5_-17.5_BR`,
  158 MB zipado, 2,05 milhões de prédios, md5 conferido). Os footprints dele são da Microsoft (seção 2.1 do artigo). O
  modelo de altura treinou com referências de terceiros (a ONEGEO agrega mais de 40 fontes, **entre elas o Google Open
  Buildings**) e foi validado com imagens do Google Earth. Nenhum polígono vem do Google; a altura dele só fica em
  `height_3dg` (não vai pro tile). Sem `--with-3dg` (padrão) essa coluna fica vazia.

**Regras**
- Região: fica o footprint cujo `ST_PointOnSurface` cai no bbox. Uma região nova não apaga a outra, e rodar de novo troca só o
  que está no bbox, na mesma transação.
- Lixo: `ST_MakeValid` nos inválidos (9 em Uberlândia) e descarte abaixo de **12 m²**.
- Duplicado do OSM: o footprint sai se a interseção com algum prédio do OSM passar de **20% da área do menor** dos dois
  (`--overlap`). Isso cobre os dois casos: um bloco da Microsoft sobre várias casas do OSM e um pedaço dentro de um prédio
  grande. A escolha do limiar mexe pouco no resultado:

  | limiar | footprints descartados | medido em |
  |---|---|---|
  | > 5% | 17.433 | import real |
  | > 20% (padrão), OSM de hoje | 16.708 | import real |
  | > 20% (padrão), OSM na data do OFM | 16.310 | import real (fica 167.153) |
  | qualquer toque | ~17.600 | snapshot de exploração |
  | > 50% | ~15.000 | snapshot de exploração |
- Altura: `height` é múltiplo de 0,5 m e `min_height` = 0. O `height_3dg` guarda a altura casada do 3D-GloBFP, que é a média
  ponderada pela área de interseção quando os polígonos dele cobrem ≥ 50% do prédio. Ela é guardada mesmo quando não é usada.
- **Uso do 3D-GloBFP** (`--height auto`, o padrão): antes de usar, o script calibra contra os prédios do OSM que têm
  `height` ou `building:levels`×3. Com n ≥ 50, correlação ≥ 0,5 e erro mediano ≤ 3 m, `height` vem do 3D-GloBFP. Senão, vem
  da heurística.
  - **Em Uberlândia a calibração não passou**: 9.920 pares, r = 0,22, erro mediano de 6,2 m.
  - Casa térrea do OSM sai com 9,3 m (mediana) no 3D-GloBFP.
  - Nos prédios com ≥ 8 andares do OSM, a mediana do 3D-GloBFP é 13 m, contra 36 m reais.
  - Por isso tudo aqui está como `heuristic`. `--height 3dglobfp` força o uso.
- **Heurística** (área em m², forma), calibrada pelos andares do OSM em Uberlândia:

  | área | OSM (média de andares; % térreo) | altura |
  |---|---|---|
  | < 80 | 1,01; 99% | 3,5 m |
  | 80–150 | 1,07; 95% | 4 m |
  | 150–250 | 1,65; 72% | 5 m |
  | 250–500 | 3,2; 41% (os altos daqui já estão quase todos no OSM do centro) | 6 m |
  | ≥ 500 | galpão, loja grande, prédio | 6 + 2·log₂(área/500), teto de 12 m (1.000 → 8 m; 2.000 → 10 m) |

  Footprint alongado (lado maior / lado menor do `ST_OrientedEnvelope` ≥ 4, como casas geminadas coladas ou galpão estreito)
  fica com no máximo 4,5 m.

**Resultado em 29/09/2026** (bbox padrão; OSM de 2026-09-29T07:22Z; MS 2026-02-23):

| etapa | footprints |
|---|---|
| MS no bbox | 183.592 |
| geometria corrigida | 9 |
| < 12 m² | 129 |
| sobrepostos ao OSM (descartados) | 16.708 |
| **ficaram** | **166.755** |

Com a dedupe na data do OFM (`--osm-date ofm`, padrão desde então; OSM de 2026-09-13T16:45Z): 16.310 descartados e
**167.153** ficaram (média 4,64 m, todos `heuristic`; 154.136 com `height_3dg`). As faixas de altura abaixo são da primeira
rodada e mudam pouco.

- Com `height_3dg`: 153.780. Se esses usassem o 3D-GloBFP (`--height 3dglobfp`), a média deles iria para 9,26 m.
- Altura, todos `heuristic` (média de 4,63 m):

  | altura | prédios |
  |---|---|
  | 3,5 m | 53.864 |
  | 4 m | 45.187 |
  | 4,5–5 m | 32.320 |
  | 5,5–6 m | 22.226 |
  | 6,5–8 m | 7.772 |
  | 8,5–10 m | 3.433 |
  | 10,5–12 m | 1.953 |
- Tabela: 36 MB + 10 MB de índice (47 MB no total). Import: ~70 s.
- Rodar de novo com os mesmos dados não grava nada (0 novos, 0 alterados, 0 removidos). Só a diferença é escrita, e o
  `VACUUM` no fim evita que a tabela inche.

**Tiles pro mapa: `GET /v1/tiles/bld/{z}/{x}/{y}.mvt`** (`src/modules/tiles/`). A rota é pública, porque o MapLibre
busca tile sem o JWT.
- Camada `bld` com `height` e `min_height` em metros. Extent 4096, buffer 64. Não tem id de feição: o id ocupava ~37%
  do tile gzipado e o mapa não usa.
- Serve de z13 a z16. Fora disso devolve 204, e o MapLibre faz overzoom do z16. Tile sem prédio, fora da caixa dos
  dados ou num banco sem a tabela também é 204.
- No z13 só entra footprint ≥ 250 m², simplificado em 2 unidades do tile. Do z14 em diante vai tudo.
- Respostas: `application/vnd.mapbox-vector-tile`, gzip quando o cliente aceita, `Cache-Control: public, max-age=86400`,
  ETag fraca (If-None-Match dá 304) e z/x/y inválido dá 400.
- Cache no Redis por tile (`tiles:bld:<versão>:z/x/y`, 7 dias). A versão junta `BLD_TILES_VERSION` com uma impressão
  digital da tabela (contagem, data, ids, alturas), refeita a cada 5 min. Import novo troca a versão sozinho.
- Rate limit de 3000/min por IP, só nesta rota.
- Medido em 29/09/2026 (dados acima; gzip, frio → quente no servidor):

  | tile | prédios | gzip | cru | frio | quente |
  |---|---|---|---|---|---|
  | z13 `13/2997/4534` (centro) | 5.730 | 120 KB | 209 KB | ~330 ms | 2–3 ms |
  | z14 `14/5994/9069` (centro) | 3.394 | 56 KB | 103 KB | ~120 ms | 1 ms |
  | z15 `15/11989/18138` (centro) | 311 | 7,9 KB | 11,8 KB | ~40 ms | 1 ms |
  | z16 `16/23979/36276` (centro, quase tudo já é OSM) | 17 | 0,7 KB | 0,8 KB | ~5 ms | 1 ms |
  | z16 `16/23996/36275` (o mais denso) | 1.323 | 21 KB | 37 KB | ~48 ms | 1 ms |

No estilo do MapLibre: fonte `vector` com `tiles: ['<API>/v1/tiles/bld/{z}/{x}/{y}.mvt']`, `minzoom: 13`, `maxzoom: 16`
e camada `fill-extrusion` com `source-layer: 'bld'` lendo `height`/`min_height`.

## Atualização e atribuição

- Overture: mensal (ID GERS estável entre releases). OSM: semanal. Os dois são só rodar de novo os passos 1 e 2.
- Atribuição obrigatória no app/termos: "© OpenStreetMap contributors" (ODbL) e "Overture Maps Foundation" (Places:
  CDLA-Permissive-2.0 / Apache-2.0 conforme a fonte; docs.overturemaps.org/attribution). Base derivada do OSM é ODbL
  se for distribuída.
- Prédios extras: rodar de novo a cada versão nova do OpenFreeMap (a dedupe segue a data dele; até lá, prédio novo no OSM
  pode ficar sobreposto a um extra). A Microsoft solta release algumas vezes por ano; o `dataset-links.csv` é baixado de novo a cada 14 dias,
  e URL nova num quadkey força o download. Atribuição quando o mapa mostrar `extra_buildings`: "Building footprints ©
  Microsoft (ODbL)". Se `height_src = '3dglobfp'` entrar em uso, some-se "Alturas: 3D-GloBFP (Che et al., 2024), CC BY 4.0".
  Os tiles gerados dessa tabela são base derivada ODbL.
