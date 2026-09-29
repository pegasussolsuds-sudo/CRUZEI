// Re-casa os pois com source='mapbox' (lugares que a galera pôs no mapa a partir da busca do Mapbox) com o place_catalog:
// mesmo lugar = nome parecido a até 60 m (a regra do import). Faz o mesmo com as LÁPIDES 'mbx:' de place_candidates
// (recusado/retirado ou publicado): passam pro id do catálogo, pra continuar segurando o lugar pela chave.
//
// PADRÃO = DRY-RUN: só lê e imprime o que faria. Nada é apagado em modo nenhum.
//   npx ts-node --transpile-only scripts/geo/rematch-mapbox-pois.ts
//   npx ts-node --transpile-only scripts/geo/rematch-mapbox-pois.ts --apply    # grava (pede a flag explícita)
//   --source mapbox   (qual pois.source re-casar; padrão mapbox)
//
// --apply, pra cada poi casado (mesmo pois.id, então check-ins, locations e matches continuam apontando pra ele):
//   source = 'catalog', external_id = place_catalog.id (canônico) e nome/ponto/endereço/bairro/cidade/tipo trocados pelos do
//   catálogo (o dado do Mapbox não pode ficar guardado). Poi sem par fica como está e sai listado pra decidir à mão.
// --apply, pra cada lápide 'mbx:' casada (mesmo place_candidates.id: status, resolved_on, poi_id e votos ficam):
//   key/ext_id/mapbox_id = id canônico do catálogo; nome/ponto/célula/endereço/tipo trocados pelos do catálogo. Pula se
//   outro candidato já usa esse id ou se duas lápides caem no mesmo lugar (fica a recusada; empate, a mais nova). A lápide
//   que não migra continua valendo pela regra do lugar (60 m + nome parecido, ou 8 m) no place-discovery.service.
//   Pendentes/vencidos 'mbx:' não entram: o detector já os vence e a faxina apaga.
import { PrismaClient } from '@prisma/client';
import { arg, coreSql, flag } from './common';

const DUP_M = 60;
const DUP_SIM = 0.6;
const prisma = new PrismaClient();

interface MatchRow {
  poi_id: bigint;
  poi_name: string;
  category: string;
  catalog_id: string | null;
  catalog_name: string | null;
  kind: string | null;
  chip: string | null;
  dist_m: number | null;
  sim: number | null;
  taken_by: bigint | null;
}

/**
 * melhor par no catálogo (canônico) a até 60 m: nome igual > núcleo parecido/contido; desempate por distância.
 * taken: SQL (usa k.id e p.id) que devolve quem já ocupa esse id do catálogo (conflito)
 */
function matchSql(from: string, taken: string): string {
  const pcore = coreSql('p.nn');
  const ccore = coreSql('c.name_norm');
  return `
    WITH p AS (${from})
    SELECT p.id AS poi_id, p.name AS poi_name, p.category, k.id AS catalog_id, k.name AS catalog_name, k.kind, k.chip,
           round(m.dist)::int AS dist_m, round(m.sim::numeric, 2)::float8 AS sim,
           ${taken} AS taken_by
      FROM p
      LEFT JOIN LATERAL (
        SELECT COALESCE(c.dup_of, c.id) AS cid, ST_Distance(c.geog, p.g) AS dist,
               CASE WHEN c.name_norm = p.nn THEN 1 ELSE similarity(${ccore}, ${pcore}) END AS sim
          FROM place_catalog c
         WHERE ST_DWithin(c.geog, p.g, ${DUP_M}) AND c.gone_on IS NULL
           AND (c.name_norm = p.nn
                OR (least(length(${ccore}), length(${pcore})) >= 4 AND similarity(${ccore}, ${pcore}) >= ${DUP_SIM})
                OR (least(length(${ccore}), length(${pcore})) >= 5
                    AND greatest(strict_word_similarity(${ccore}, ${pcore}), strict_word_similarity(${pcore}, ${ccore})) >= 0.9)
                OR (length(${pcore}) >= 2 AND ${ccore} = ${pcore}))
         ORDER BY (c.name_norm = p.nn) DESC, sim DESC, dist
         LIMIT 1
      ) m ON true
      LEFT JOIN place_catalog k ON k.id = m.cid
     ORDER BY p.id`;
}

async function main() {
  const apply = flag('apply');
  const source = arg('source', 'mapbox')!;

  const pois = await prisma.$queryRawUnsafe<MatchRow[]>(
    matchSql(
      `SELECT id, name, f_norm(name) AS nn, category::text AS category,
              ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326)::geography AS g
         FROM pois WHERE source = $1`,
      `(SELECT o.id FROM pois o WHERE o.source = 'catalog' AND o.external_id = k.id AND o.id <> p.id LIMIT 1)`,
    ),
    source,
  );
  // lápides da era Mapbox (recusado/retirado ou publicado); 'category' carrega o status
  const candidates = await prisma.$queryRawUnsafe<MatchRow[]>(
    matchSql(
      `SELECT id, name, f_norm(name) AS nn, status AS category,
              ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326)::geography AS g
         FROM place_candidates WHERE key LIKE 'mbx:%' AND status IN ('rejected', 'promoted')`,
      `(SELECT o.id FROM place_candidates o WHERE o.key = k.id AND o.id <> p.id LIMIT 1)`,
    ),
  );
  const [{ n: otherMbx }] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM place_candidates WHERE key LIKE 'mbx:%' AND status NOT IN ('rejected', 'promoted')`,
  );

  const show = (rows: MatchRow[], what: 'poi' | 'candidato') =>
    console.table(
      rows.map((r) => ({
        id: Number(r.poi_id),
        nome: r.poi_name,
        'cat/status': r.category,
        '→ catálogo': r.catalog_id ?? '(sem par)',
        'nome no catálogo': r.catalog_name ?? '',
        kind: r.kind ?? '',
        m: r.dist_m ?? '',
        sim: r.sim ?? '',
        conflito: r.taken_by != null ? `${what} ${r.taken_by} já é esse lugar` : '',
      })),
    );

  // lápides que migram: casadas, sem conflito, uma por id do catálogo (recusada antes de publicada; empate, a mais nova)
  const tombs = candidates
    .filter((r) => r.catalog_id && r.taken_by == null)
    .sort((a, b) => Number(b.category === 'rejected') - Number(a.category === 'rejected') || Number(b.poi_id - a.poi_id));
  const seen = new Set<string>();
  const tombOk = tombs.filter((r) => !seen.has(r.catalog_id!) && seen.add(r.catalog_id!));
  const tombDup = tombs.length - tombOk.length;

  const ok = pois.filter((r) => r.catalog_id && r.taken_by == null);
  console.log(`\npois source='${source}': ${pois.length} | casam: ${pois.filter((r) => r.catalog_id).length} | sem par: ${pois.filter((r) => !r.catalog_id).length} | conflito: ${pois.filter((r) => r.taken_by != null).length}`);
  if (pois.length) show(pois, 'poi');
  console.log(
    `\nlápides 'mbx:' em place_candidates (recusado/publicado): ${candidates.length} | casam: ${candidates.filter((r) => r.catalog_id).length} | ` +
      `sem par: ${candidates.filter((r) => !r.catalog_id).length} | conflito: ${candidates.filter((r) => r.taken_by != null).length} | ` +
      `mesmo lugar de outra lápide: ${tombDup} | pendentes/vencidas 'mbx:' (fora, o detector vence): ${otherMbx}`,
  );
  if (candidates.length) show(candidates, 'candidato');

  if (!apply) {
    console.log(
      `\nDRY-RUN: nada foi gravado. Com --apply, ${ok.length} pois passam a source='catalog' com os dados do catálogo (${pois.length - ok.length} ficam como estão) ` +
        `e ${tombOk.length} lápides 'mbx:' passam pro id do catálogo (${candidates.length - tombOk.length} ficam como estão).`,
    );
    return;
  }

  // grava só os casados sem conflito, num lote; o chip do catálogo é um valor válido do enum POICategory
  const n = await prisma.$executeRawUnsafe(
    `UPDATE pois p SET
       source = 'catalog', external_id = k.id, name = k.name,
       latitude = round(ST_Y(k.geog::geometry)::numeric, 8), longitude = round(ST_X(k.geog::geometry)::numeric, 8),
       address = COALESCE(k.address, p.address), neighborhood = k.neighborhood, city = k.city, state = k.state,
       subcategory = k.kind, category = COALESCE(k.chip::"POICategory", p.category), updated_at = now()
     FROM jsonb_to_recordset($1::jsonb) AS r(poi_id bigint, catalog_id text)
     JOIN place_catalog k ON k.id = r.catalog_id
     WHERE p.id = r.poi_id AND p.source = $2
       AND NOT EXISTS (SELECT 1 FROM pois o WHERE o.source = 'catalog' AND o.external_id = k.id AND o.id <> p.id)`,
    JSON.stringify(ok.map((r) => ({ poi_id: Number(r.poi_id), catalog_id: r.catalog_id }))),
    source,
  );
  console.log(`\nAPLICADO: ${n} pois re-casados (source='catalog'). Sem par/conflito ficaram como estavam.`);

  // lápides: mesmo candidato (status/resolved_on/poi_id/votos ficam), chave = id do catálogo; célula = geohash-7 do ponto novo
  const t = await prisma.$executeRawUnsafe(
    `UPDATE place_candidates c SET
       key = k.id, ext_id = k.id, mapbox_id = k.id, name = k.name,
       latitude = round(ST_Y(k.geog::geometry)::numeric, 8), longitude = round(ST_X(k.geog::geometry)::numeric, 8),
       cell = ST_GeoHash(k.geog::geometry, 7), kind = k.kind, category = COALESCE(k.chip::"POICategory", c.category),
       address = k.address, neighborhood = k.neighborhood, city = k.city, state = k.state
     FROM jsonb_to_recordset($1::jsonb) AS r(cand_id bigint, catalog_id text)
     JOIN place_catalog k ON k.id = r.catalog_id
     WHERE c.id = r.cand_id AND c.key LIKE 'mbx:%' AND c.status IN ('rejected', 'promoted')
       AND NOT EXISTS (SELECT 1 FROM place_candidates o WHERE o.key = k.id)`,
    JSON.stringify(tombOk.map((r) => ({ cand_id: Number(r.poi_id), catalog_id: r.catalog_id }))),
  );
  console.log(`APLICADO: ${t} lápides 'mbx:' com o id do catálogo. Sem par/conflito/duplicadas ficaram como estavam (seguram pelo lugar).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
