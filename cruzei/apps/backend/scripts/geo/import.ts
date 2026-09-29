// Carrega no Postgres o que o overture_extract.py e o osm-fetch.ts baixaram (data/geo/*). Idempotente: pode rodar de novo
// quantas vezes quiser (upsert por id; o que sumiu da fonte no bbox sai da busca ou é recalculado). Só escreve em
// place_catalog, geo_areas e geo_names — nunca em pois/place_candidates.
// Uso (em apps/backend; lê DATABASE_URL do .env como o Prisma):
//   npx ts-node --transpile-only scripts/geo/import.ts                       # tudo, na ordem abaixo
//   npx ts-node --transpile-only scripts/geo/import.ts --only areas,names    # passos: areas, overture, osm, post, names
//   --bbox oeste,sul,leste,norte  (tem que ser o mesmo dos arquivos baixados)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { DATA_DIR, DEFAULT_BBOX, arg, chunk, coreSql, parseBBox, todayBrazil, type BBox } from './common';
import { classifyOsm, classifyOverture, type OvertureRow } from './taxonomy';

type Tx = Prisma.TransactionClient;

/** mesmo lugar: nome parecido a até 60 m (a mesma regra DUP_NAME_M da descoberta de lugares) */
const DUP_M = 60;
const DUP_SIM = 0.6;
/** OSM não traz confiança: mapeado à mão, sem sinal de frescor */
const OSM_CONFIDENCE = 0.6;
/** trechos da mesma rua a até ~150 m viram um nome só; mais longe (outra "Rua 10" da cidade) fica separado */
const STREET_EPS_DEG = 0.0015;
/** anel de fronteira aberto no OSM: fecha ligando as pontas se o buraco for até isto (ou 10% do perímetro) */
const AREA_GAP_M = 300;

/** código IBGE (2 primeiros dígitos) → UF */
const UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const prisma = new PrismaClient();
const TX = { timeout: 15 * 60_000, maxWait: 60_000 };

interface OsmFile<T> {
  bbox: BBox;
  osmBase: string | null;
  elements: T[];
}
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; ref: number; role: string; lat?: number; lon?: number; geometry?: ({ lat: number; lon: number } | null)[] }[];
}

function readOsm(theme: string, bbox: BBox): OsmFile<OsmElement> {
  const file = path.join(DATA_DIR, `osm-${theme}.json`);
  if (!fs.existsSync(file)) throw new Error(`falta ${file}: rode scripts/geo/osm-fetch.ts antes`);
  const f = JSON.parse(fs.readFileSync(file, 'utf8')) as OsmFile<OsmElement>;
  sameBBox(f.bbox, bbox, file);
  return f;
}

function sameBBox(a: BBox, b: BBox, file: string) {
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-9;
  if (!(eq(a.w, b.w) && eq(a.s, b.s) && eq(a.e, b.e) && eq(a.n, b.n))) {
    throw new Error(`${file} é do bbox ${a.w},${a.s},${a.e},${a.n}, não do pedido (${b.w},${b.s},${b.e},${b.n}): baixe de novo`);
  }
}

const envelope = (b: BBox) => Prisma.sql`ST_MakeEnvelope(${b.w}, ${b.s}, ${b.e}, ${b.n}, 4326)`;
const osmId = (e: { type: string; id: number | string }) => `osm:${e.type[0]}${e.id}`;
const line = (pts: ({ lat: number; lon: number } | null)[] | undefined) =>
  (pts ?? []).filter((p): p is { lat: number; lon: number } => p != null).map((p) => [p.lon, p.lat]);

// ---------------------------------------------------------------------------------------------
// áreas (município, setor/distrito, bairro)
// ---------------------------------------------------------------------------------------------

function areaKind(t: Record<string, string>): { kind: 'city' | 'district' | 'neighborhood'; level: number | null } | null {
  const level = t.admin_level ? Number(t.admin_level) : null;
  if (t.boundary === 'administrative' && level === 8) return { kind: 'city', level };
  if (t.boundary === 'administrative' && level === 9) return { kind: 'district', level };
  if (t.boundary === 'administrative' && level === 10) return { kind: 'neighborhood', level };
  if (/^(suburb|neighbourhood|quarter)$/.test(t.place ?? '')) return { kind: 'neighborhood', level };
  return null;
}

/** ponto de rótulo das áreas (membro admin_centre/label): a cidade "é" o centro, não o meio geométrico do município */
function labelPoints(f: OsmFile<OsmElement>): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const e of f.elements) {
    const m = e.members?.find((x) => x.type === 'node' && (x.role === 'admin_centre' || x.role === 'label') && x.lat != null);
    if (m?.lat != null && m.lon != null) out.set(osmId(e), [m.lon, m.lat]);
  }
  return out;
}

async function importAreas(bbox: BBox, today: string) {
  const f = readOsm('areas', bbox);
  const rows: { id: string; name: string; admin_level: number | null; kind: string; district_type: string | null; ibge_code: string | null; state: string | null; lines: string }[] = [];
  for (const e of f.elements) {
    const t = e.tags ?? {};
    const k = areaKind(t);
    const name = t.name?.trim();
    if (!k || !name) continue;
    const lines =
      e.type === 'relation'
        ? (e.members ?? []).filter((m) => m.type === 'way' && m.role !== 'subarea').map((m) => line(m.geometry)).filter((l) => l.length >= 2)
        : [line(e.geometry)].filter((l) => l.length >= 4);
    if (!lines.length) continue;
    const ibge = t['IBGE:GEOCODIGO'] ?? null;
    rows.push({
      id: osmId(e),
      name: name.slice(0, 150),
      admin_level: k.level,
      kind: k.kind,
      district_type: k.kind === 'district' ? (t.border_type ?? null) : null,
      ibge_code: ibge,
      state: k.kind === 'city' && ibge ? (UF[ibge.slice(0, 2)] ?? null) : null,
      lines: JSON.stringify({ type: 'MultiLineString', coordinates: lines }),
    });
  }

  let built = 0;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `CREATE TEMP TABLE tmp_areas (id text, name text, admin_level smallint, kind text, district_type text, ibge_code text, state text, geom geometry, forced boolean) ON COMMIT DROP`,
    );
    for (const part of chunk(rows, 200)) {
      // ST_BuildArea monta os anéis (outer/inner por par-ímpar) a partir dos trechos de fronteira (ST_Node: trechos que se
      // cruzam). Fronteira com buraco no OSM (anel aberto por poucos metros) fecha ligando as pontas, se o buraco for pequeno.
      await tx.$executeRawUnsafe(
        `INSERT INTO tmp_areas
         SELECT r.id, r.name, r.admin_level, r.kind, r.district_type, r.ibge_code, r.state,
                ST_Multi(ST_CollectionExtract(ST_MakeValid(COALESCE(b.area, f.area)), 3)), b.area IS NULL AND f.area IS NOT NULL
           FROM jsonb_to_recordset($1::jsonb) AS r(id text, name text, admin_level smallint, kind text, district_type text, ibge_code text, state text, lines text)
           CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_GeomFromGeoJSON(r.lines), 4326) AS g) l
           CROSS JOIN LATERAL (SELECT ST_LineMerge(l.g) AS m) mm
           CROSS JOIN LATERAL (SELECT CASE WHEN NOT ST_IsEmpty(x.a) THEN x.a END AS area FROM (SELECT ST_BuildArea(ST_Node(l.g)) AS a) x) b
           CROSS JOIN LATERAL (SELECT CASE WHEN b.area IS NULL AND ST_GeometryType(mm.m) = 'ST_LineString' AND ST_NPoints(mm.m) >= 3
                                            AND ST_Distance(ST_StartPoint(mm.m)::geography, ST_EndPoint(mm.m)::geography)
                                                <= GREATEST(${AREA_GAP_M}, 0.1 * ST_Length(mm.m::geography))
                                           THEN ST_MakePolygon(ST_AddPoint(mm.m, ST_StartPoint(mm.m))) END AS area) f`,
        JSON.stringify(part),
      );
    }
    const forced = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(`SELECT id, name FROM tmp_areas WHERE forced`);
    if (forced.length) console.warn(`  ${forced.length} áreas com anel aberto no OSM, fechadas ligando as pontas: ${forced.map((b) => `${b.name} ${b.id}`).join(', ')}`);
    built = Number(
      await tx.$executeRawUnsafe(
        `INSERT INTO geo_areas (id, name, admin_level, kind, district_type, ibge_code, state, geom, refreshed_on)
         SELECT id, name, admin_level, kind, district_type, ibge_code, state, geom, $1::date FROM tmp_areas WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, admin_level = EXCLUDED.admin_level, kind = EXCLUDED.kind,
           district_type = EXCLUDED.district_type, ibge_code = EXCLUDED.ibge_code, state = EXCLUDED.state, geom = EXCLUDED.geom,
           refreshed_on = EXCLUDED.refreshed_on`,
        today,
      ),
    );
    const broken = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(`SELECT id, name FROM tmp_areas WHERE geom IS NULL OR ST_IsEmpty(geom)`);
    if (broken.length) console.warn(`  ${broken.length} áreas sem anel fechado (ignoradas; a versão anterior, se houver, fica): ${broken.map((b) => `${b.name} ${b.id}`).join(', ')}`);
    // o que sumiu do OSM neste bbox sai (tabela derivada; nada aponta pra ela)
    const ids = rows.map((r) => r.id);
    await tx.$executeRaw`DELETE FROM geo_areas WHERE NOT (id = ANY(${ids}::text[])) AND ST_Intersects(geom, ${envelope(bbox)})`;
    // município de cada área e a área-mãe (menor área de nível acima que contém um ponto de dentro)
    await tx.$executeRaw`UPDATE geo_areas SET city = name WHERE kind = 'city' AND ST_Intersects(geom, ${envelope(bbox)})`;
    await tx.$executeRaw`
      UPDATE geo_areas a SET
        city = (SELECT c.name FROM geo_areas c WHERE c.kind = 'city' AND ST_Covers(c.geom, ST_PointOnSurface(a.geom)) ORDER BY ST_Area(c.geom) LIMIT 1),
        state = (SELECT c.state FROM geo_areas c WHERE c.kind = 'city' AND ST_Covers(c.geom, ST_PointOnSurface(a.geom)) ORDER BY ST_Area(c.geom) LIMIT 1),
        parent_id = (SELECT p.id FROM geo_areas p
                      WHERE p.id <> a.id AND COALESCE(p.admin_level, 11) < COALESCE(a.admin_level, 11) AND ST_Covers(p.geom, ST_PointOnSurface(a.geom))
                      ORDER BY p.admin_level DESC NULLS LAST, ST_Area(p.geom) LIMIT 1)
      WHERE a.kind <> 'city' AND ST_Intersects(a.geom, ${envelope(bbox)})`;
  }, TX);
  console.log(`áreas: ${built} gravadas (OSM ${f.osmBase ?? '?'})`);
}

// ---------------------------------------------------------------------------------------------
// lugares
// ---------------------------------------------------------------------------------------------

interface CatalogRow {
  id: string;
  source: 'overture' | 'osm';
  name: string;
  kind: string;
  chip: string | null;
  searchable: boolean;
  confidence: number | null;
  lon: number;
  lat: number;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  socials: string[] | null;
  opening_hours: string | null;
  raw_category: string | null;
  source_updated_on: string | null;
}

const uf = (s: string | null | undefined) => (s && /^[A-Za-z]{2}$/.test(s.trim()) ? s.trim().toUpperCase() : null);
const cut = (s: string | null | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);

async function upsertCatalog(source: 'overture' | 'osm', rows: CatalogRow[], bbox: BBox, today: string) {
  await prisma.$transaction(async (tx) => {
    for (const part of chunk(rows, 2000)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO place_catalog (id, source, name, kind, chip, confidence, geog, neighborhood, city, state, address, phone, website, socials,
                                    opening_hours, raw_category, searchable, source_updated_on, refreshed_on, gone_on)
         SELECT r.id, r.source, r.name, r.kind, r.chip, r.confidence, ST_SetSRID(ST_MakePoint(r.lon, r.lat), 4326)::geography,
                r.neighborhood, r.city, r.state, r.address, r.phone, r.website, r.socials, r.opening_hours, r.raw_category, r.searchable,
                r.source_updated_on, $2::date, NULL
           FROM jsonb_to_recordset($1::jsonb) AS r(id text, source text, name text, kind text, chip text, confidence real, lon float8, lat float8,
                neighborhood text, city text, state text, address text, phone text, website text, socials jsonb, opening_hours text,
                raw_category text, searchable boolean, source_updated_on date)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, kind = EXCLUDED.kind, chip = EXCLUDED.chip, confidence = EXCLUDED.confidence, geog = EXCLUDED.geog,
           neighborhood = EXCLUDED.neighborhood, city = EXCLUDED.city, state = EXCLUDED.state, address = EXCLUDED.address,
           phone = EXCLUDED.phone, website = EXCLUDED.website, socials = EXCLUDED.socials, opening_hours = EXCLUDED.opening_hours,
           raw_category = EXCLUDED.raw_category, searchable = EXCLUDED.searchable, source_updated_on = EXCLUDED.source_updated_on,
           refreshed_on = EXCLUDED.refreshed_on, gone_on = NULL`,
        JSON.stringify(part),
        today,
      );
    }
    // sumiu da fonte neste bbox: fica (id pode estar referenciado), mas sai da busca
    const ids = rows.map((r) => r.id);
    const gone = await tx.$executeRaw`
      UPDATE place_catalog SET searchable = false, gone_on = ${today}::date
       WHERE source = ${source} AND gone_on IS NULL AND NOT (id = ANY(${ids}::text[]))
         AND ST_Intersects(geog, ${envelope(bbox)}::geography)`;
    if (gone) console.log(`  ${gone} lugares ${source} sumiram da fonte (searchable=false)`);
  }, TX);
}

async function importOverture(bbox: BBox, today: string) {
  const file = path.join(DATA_DIR, 'overture-places.ndjson');
  if (!fs.existsSync(file)) throw new Error(`falta ${file}: rode scripts/geo/overture_extract.py antes`);
  const meta = JSON.parse(fs.readFileSync(file.replace(/\.ndjson$/, '.meta.json'), 'utf8')) as { release: string; bbox: number[] };
  sameBBox({ w: meta.bbox[0], s: meta.bbox[1], e: meta.bbox[2], n: meta.bbox[3] }, bbox, file);

  const rows: CatalogRow[] = [];
  let dropped = 0;
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as OvertureRow & {
      id: string; lon: number; lat: number; socials: string[] | null; websites: string[] | null; phones: string[] | null;
      address: { freeform?: string; locality?: string; region?: string } | null; updated: string | null;
    };
    const c = classifyOverture(r);
    if (!c || !Number.isFinite(r.lon) || !Number.isFinite(r.lat)) {
      dropped++;
      continue;
    }
    rows.push({
      id: `ovt:${r.id}`,
      source: 'overture',
      name: r.name!.trim().slice(0, 255),
      ...c,
      confidence: r.confidence,
      lon: r.lon,
      lat: r.lat,
      address: cut(r.address?.freeform, 500),
      neighborhood: null,
      city: cut(r.address?.locality, 100),
      state: uf(r.address?.region),
      phone: cut(r.phones?.[0], 40),
      website: cut(r.websites?.[0], 500),
      socials: r.socials?.length ? r.socials : null,
      opening_hours: null,
      raw_category: cut(r.category ?? r.basic_category, 80),
      source_updated_on: r.updated ? r.updated.slice(0, 10) : null,
    });
  }
  await upsertCatalog('overture', rows, bbox, today);
  console.log(`overture ${meta.release}: ${rows.length} lugares gravados, ${dropped} descartados (ruído, conteúdo adulto, residencial)`);
}

/** handle ou URL de rede social → URL */
function socialUrl(v: string | undefined, host: string): string | null {
  const s = v?.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^(www\.)?[a-z]+\.com\//i.test(s)) return `https://${s}`;
  return `https://www.${host}/${s.replace(/^@/, '')}`;
}

async function importOsm(bbox: BBox, today: string) {
  const f = readOsm('pois', bbox);
  const rows: CatalogRow[] = [];
  let dropped = 0;
  for (const e of f.elements) {
    const t = e.tags ?? {};
    const c = classifyOsm(t);
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!c || lat == null || lon == null) {
      dropped++;
      continue;
    }
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
    const socials = [
      socialUrl(t['contact:instagram'] ?? t.instagram, 'instagram.com'),
      socialUrl(t['contact:facebook'] ?? t.facebook, 'facebook.com'),
    ].filter((s): s is string => s != null);
    rows.push({
      id: osmId(e),
      source: 'osm',
      name: t.name.trim().slice(0, 255),
      kind: c.kind,
      chip: c.chip,
      searchable: c.searchable,
      confidence: OSM_CONFIDENCE,
      lon,
      lat,
      address: cut(street, 500),
      neighborhood: cut(t['addr:suburb'], 100),
      city: cut(t['addr:city'], 100),
      state: uf(t['addr:state']),
      phone: cut(t.phone ?? t['contact:phone'], 40),
      website: cut(t.website ?? t['contact:website'] ?? t.url, 500),
      socials: socials.length ? socials : null,
      opening_hours: cut(t.opening_hours, 1000),
      raw_category: c.rawCategory,
      source_updated_on: null,
    });
  }
  await upsertCatalog('osm', rows, bbox, today);
  console.log(`osm: ${rows.length} lugares gravados, ${dropped} descartados (OSM ${f.osmBase ?? '?'})`);
}

// ---------------------------------------------------------------------------------------------
// pós: duplicados entre fontes e bairro/cidade por polígono
// ---------------------------------------------------------------------------------------------

/** canônico: na busca > tipo conhecido > Overture (GERS estável, mais campos) > confiança > id */
const RANK = (t: string) =>
  `(${t}.searchable::int, (${t}.kind <> 'other')::int, (${t}.source = 'overture')::int, COALESCE(${t}.confidence, 0), ${t}.id)`;
/** contêiner (shopping, campus, parque, estádio) só casa com o mesmo tipo: "Cinemark Center Shopping" não é o shopping */
const CONTAINERS = `('mall', 'campus', 'park', 'stadium')`;
const CORE = coreSql('name_norm');

async function post(bbox: BBox) {
  await prisma.$transaction(async (tx: Tx) => {
    const inBox = (t: string) => `ST_Intersects(${t}.geog, ST_MakeEnvelope(${bbox.w}, ${bbox.s}, ${bbox.e}, ${bbox.n}, 4326)::geography)`;
    await tx.$executeRawUnsafe(`UPDATE place_catalog p SET dup_of = NULL, alt_ids = '{}', alt_names = '{}' WHERE ${inBox('p')}`);
    await tx.$executeRawUnsafe(
      `CREATE TEMP TABLE tmp_pc ON COMMIT DROP AS
       SELECT id, geog, kind, chip, name_norm, ${CORE} AS core, searchable, source, confidence FROM place_catalog WHERE gone_on IS NULL`,
    );
    await tx.$executeRawUnsafe(`CREATE INDEX ON tmp_pc USING GIST (geog)`);
    await tx.$executeRawUnsafe(`ANALYZE tmp_pc`);
    // mesmo lugar, a até 60 m: nome igual; ou núcleo do nome (sem palavras genéricas) com trigram >= 0,6; ou um núcleo
    // contido no outro com o mesmo chip ("Akkar" x "Akkar Restaurante"). Guarda só os pares em que b ganha de a no RANK.
    await tx.$executeRawUnsafe(
      `CREATE TEMP TABLE tmp_pairs ON COMMIT DROP AS
       SELECT a.id AS a_id, b.id AS b_id, ST_Distance(a.geog, b.geog) AS dist
         FROM tmp_pc a
         JOIN tmp_pc b ON b.id <> a.id AND ST_DWithin(a.geog, b.geog, ${DUP_M})
        WHERE ${inBox('a')} AND ${RANK('b')} > ${RANK('a')}
          AND ((a.kind NOT IN ${CONTAINERS} AND b.kind NOT IN ${CONTAINERS}) OR a.kind = b.kind)
          AND (
            a.name_norm = b.name_norm
            OR (least(length(a.core), length(b.core)) >= 4 AND similarity(a.core, b.core) >= ${DUP_SIM})
            OR (a.chip IS NOT NULL AND a.chip = b.chip AND (
                  (least(length(a.core), length(b.core)) >= 5
                    AND greatest(strict_word_similarity(a.core, b.core), strict_word_similarity(b.core, a.core)) >= 0.9)
                  OR (length(a.core) >= 2 AND a.core = b.core)))
          )`,
    );
    await tx.$executeRawUnsafe(`CREATE INDEX ON tmp_pairs (a_id)`);
    // canônico = quem não perde pra ninguém; cada duplicado aponta pro melhor canônico que casou com ele.
    // Sem corrente: a~b e b~c não fazem a virar c (se a só casou com b, que já é duplicado, a continua de pé).
    const dups = await tx.$executeRawUnsafe(
      `UPDATE place_catalog p SET dup_of = x.b_id
         FROM (SELECT DISTINCT ON (t.a_id) t.a_id, t.b_id
                 FROM tmp_pairs t JOIN tmp_pc b ON b.id = t.b_id
                WHERE NOT EXISTS (SELECT 1 FROM tmp_pairs l WHERE l.a_id = t.b_id)
                  AND NOT EXISTS (SELECT 1 FROM place_catalog q WHERE q.id = t.b_id AND q.dup_of IS NOT NULL) -- fora do bbox, já duplicado
                ORDER BY t.a_id, ${RANK('b')} DESC, t.dist) x
        WHERE p.id = x.a_id`,
    );
    // canônico herda o que falta (horário e contato do OSM) e guarda os ids/nomes dos duplicados
    await tx.$executeRawUnsafe(
      `UPDATE place_catalog c SET
         alt_ids = s.ids,
         alt_names = COALESCE(s.names, '{}'),
         opening_hours = COALESCE(c.opening_hours, s.opening_hours),
         website = COALESCE(c.website, s.website),
         phone = COALESCE(c.phone, s.phone),
         address = COALESCE(c.address, s.address),
         socials = CASE WHEN s.socials IS NULL THEN c.socials
                        ELSE (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements(COALESCE(c.socials, '[]'::jsonb) || s.socials) v) END
       FROM (
         SELECT d.dup_of,
                array_agg(d.id ORDER BY d.id) AS ids,
                array_agg(DISTINCT d.name) FILTER (WHERE d.name_norm <> k.name_norm) AS names,
                (array_agg(d.opening_hours) FILTER (WHERE d.opening_hours IS NOT NULL))[1] AS opening_hours,
                (array_agg(d.website) FILTER (WHERE d.website IS NOT NULL))[1] AS website,
                (array_agg(d.phone) FILTER (WHERE d.phone IS NOT NULL))[1] AS phone,
                (array_agg(d.address) FILTER (WHERE d.address IS NOT NULL))[1] AS address,
                (SELECT jsonb_agg(v) FROM place_catalog d2, jsonb_array_elements(d2.socials) v WHERE d2.dup_of = d.dup_of) AS socials
           FROM place_catalog d
           JOIN place_catalog k ON k.id = d.dup_of
          WHERE d.dup_of IS NOT NULL
          GROUP BY d.dup_of
       ) s
       WHERE c.id = s.dup_of`,
    );
    console.log(`duplicados: ${dups} registros apontam pra um canônico`);

    // bairro/cidade/UF por polígono (sobrepõe o endereço da fonte quando o ponto cai numa área conhecida)
    const filled = await tx.$executeRawUnsafe(
      `UPDATE place_catalog p SET
         neighborhood = COALESCE(nb.name, dist.name, p.neighborhood),
         city = COALESCE(ci.name, p.city),
         state = COALESCE(ci.state, p.state)
       FROM place_catalog p2
       LEFT JOIN LATERAL (SELECT a.name FROM geo_areas a WHERE a.kind = 'neighborhood' AND ST_Covers(a.geom, p2.geog::geometry)
                          ORDER BY a.admin_level DESC NULLS LAST, ST_Area(a.geom) LIMIT 1) nb ON true
       LEFT JOIN LATERAL (SELECT a.name FROM geo_areas a WHERE a.kind = 'district' AND a.district_type = 'district'
                          AND ST_Covers(a.geom, p2.geog::geometry) ORDER BY ST_Area(a.geom) LIMIT 1) dist ON true
       LEFT JOIN LATERAL (SELECT a.name, a.state FROM geo_areas a WHERE a.kind = 'city' AND ST_Covers(a.geom, p2.geog::geometry)
                          ORDER BY ST_Area(a.geom) LIMIT 1) ci ON true
       WHERE p.id = p2.id AND ${inBox('p2')}`,
    );
    console.log(`bairro/cidade: ${filled} lugares conferidos com os polígonos`);
  }, TX);
}

// ---------------------------------------------------------------------------------------------
// nomes pra "ir até lá"
// ---------------------------------------------------------------------------------------------

async function importNames(bbox: BBox, today: string) {
  const areasFile = readOsm('areas', bbox);
  const labels = [...labelPoints(areasFile)].map(([id, [lon, lat]]) => ({ id, lon, lat }));
  const places = readOsm('places', bbox).elements
    .filter((e) => e.tags?.name && e.lat != null && e.lon != null)
    .map((e) => ({ id: osmId(e), name: e.tags!.name.trim().slice(0, 200), place: e.tags!.place, lon: e.lon!, lat: e.lat! }));
  const streetsFile = readOsm('streets', bbox);
  const ways = streetsFile.elements
    .filter((e) => e.type === 'way' && e.tags?.name && !/^(private|no)$/.test(e.tags.access ?? ''))
    .map((e) => ({ id: e.id, name: e.tags!.name.trim().slice(0, 200), coords: line(e.geometry) }))
    .filter((w) => w.coords.length >= 2)
    .map((w) => ({ id: w.id, name: w.name, g: JSON.stringify({ type: 'LineString', coordinates: w.coords }) }));

  await prisma.$transaction(async (tx: Tx) => {
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE tmp_labels (id text PRIMARY KEY, pt geometry) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(
      `INSERT INTO tmp_labels SELECT r.id, ST_SetSRID(ST_MakePoint(r.lon, r.lat), 4326) FROM jsonb_to_recordset($1::jsonb) AS r(id text, lon float8, lat float8)`,
      JSON.stringify(labels),
    );
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE tmp_names (LIKE geo_names INCLUDING DEFAULTS) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(`ALTER TABLE tmp_names DROP COLUMN name_norm`);

    // 1) áreas: cidade no centro (admin_centre/label), bairro e distrito no rótulo ou num ponto de dentro
    await tx.$executeRawUnsafe(
      `INSERT INTO tmp_names (id, kind, name, neighborhood, city, state, geog, bbox, size_m, area_id, refreshed_on)
       SELECT a.id,
              CASE a.kind WHEN 'city' THEN 'city' WHEN 'neighborhood' THEN 'neighborhood' ELSE 'place' END,
              a.name, NULL, a.city, a.state,
              (CASE WHEN l.pt IS NOT NULL AND ST_Covers(a.geom, l.pt) THEN l.pt ELSE ST_PointOnSurface(a.geom) END)::geography,
              ARRAY[ST_XMin(a.geom), ST_YMin(a.geom), ST_XMax(a.geom), ST_YMax(a.geom)],
              sqrt(ST_Area(a.geom::geography)), a.id, $1::date
         FROM geo_areas a LEFT JOIN tmp_labels l ON l.id = a.id
        WHERE ST_Intersects(a.geom, ST_MakeEnvelope(${bbox.w}, ${bbox.s}, ${bbox.e}, ${bbox.n}, 4326))`,
      today,
    );

    // 2) pontos de lugar: vila/povoado/localidade viram 'place'; bairro e cidade só quando não existe o polígono de mesmo nome
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE tmp_places (id text, name text, place text, pt geometry) ON COMMIT DROP`);
    await tx.$executeRawUnsafe(
      `INSERT INTO tmp_places SELECT r.id, r.name, r.place, ST_SetSRID(ST_MakePoint(r.lon, r.lat), 4326)
         FROM jsonb_to_recordset($1::jsonb) AS r(id text, name text, place text, lon float8, lat float8)`,
      JSON.stringify(places),
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO tmp_names (id, kind, name, neighborhood, city, state, geog, refreshed_on)
       SELECT p.id,
              CASE WHEN p.place IN ('city', 'town') THEN 'city' WHEN p.place IN ('suburb', 'neighbourhood', 'quarter') THEN 'neighborhood' ELSE 'place' END,
              p.name, nb.name, ci.name, ci.state, p.pt::geography, $1::date
         FROM tmp_places p
         LEFT JOIN LATERAL (SELECT a.name FROM geo_areas a WHERE a.kind = 'neighborhood' AND ST_Covers(a.geom, p.pt)
                            ORDER BY a.admin_level DESC NULLS LAST, ST_Area(a.geom) LIMIT 1) nb ON true
         LEFT JOIN LATERAL (SELECT a.name, a.state FROM geo_areas a WHERE a.kind = 'city' AND ST_Covers(a.geom, p.pt) ORDER BY ST_Area(a.geom) LIMIT 1) ci ON true
        WHERE NOT EXISTS (
          SELECT 1 FROM geo_areas a
           WHERE a.name_norm = f_norm(p.name) AND ST_DWithin(a.geom::geography, p.pt::geography, 2000)
             AND (a.kind = CASE WHEN p.place IN ('city', 'town') THEN 'city' WHEN p.place IN ('suburb', 'neighbourhood', 'quarter') THEN 'neighborhood' ELSE a.kind END))`,
      today,
    );

    // 3) ruas: trechos com o mesmo nome na mesma cidade, agrupados por proximidade (DBSCAN); ponto em cima da rua,
    //    perto do meio; bairro desse ponto desambigua "Rua 10"
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE tmp_ways (id bigint, name text, geom geometry) ON COMMIT DROP`);
    for (const part of chunk(ways, 3000)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO tmp_ways SELECT r.id, r.name, ST_SetSRID(ST_GeomFromGeoJSON(r.g), 4326) FROM jsonb_to_recordset($1::jsonb) AS r(id bigint, name text, g text)`,
        JSON.stringify(part),
      );
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO tmp_names (id, kind, name, neighborhood, city, state, geog, bbox, size_m, refreshed_on)
       WITH w AS (
         SELECT t.id, t.name, f_norm(t.name) AS nn, t.geom, ci.name AS city, ci.state
           FROM tmp_ways t
           LEFT JOIN LATERAL (SELECT a.name, a.state FROM geo_areas a
                               WHERE a.kind = 'city' AND ST_Covers(a.geom, ST_LineInterpolatePoint(t.geom, 0.5))
                               ORDER BY ST_Area(a.geom) LIMIT 1) ci ON true
       ), c AS (
         SELECT w.*, ST_ClusterDBSCAN(w.geom, eps := ${STREET_EPS_DEG}, minpoints := 1) OVER (PARTITION BY w.nn, w.city) AS cid FROM w
       ), g AS (
         SELECT min(id) AS id, mode() WITHIN GROUP (ORDER BY name) AS name, city, min(state) AS state,
                ST_Collect(geom) AS geom, sum(ST_Length(geom::geography)) AS len
           FROM c GROUP BY nn, city, cid
       )
       SELECT 'osm:st' || g.id, 'street', g.name, nb.name, g.city, g.state,
              ST_ClosestPoint(g.geom, ST_Centroid(g.geom))::geography,
              ARRAY[ST_XMin(g.geom), ST_YMin(g.geom), ST_XMax(g.geom), ST_YMax(g.geom)], g.len, $1::date
         FROM g
         LEFT JOIN LATERAL (SELECT a.name FROM geo_areas a WHERE a.kind = 'neighborhood'
                             AND ST_Covers(a.geom, ST_ClosestPoint(g.geom, ST_Centroid(g.geom)))
                             ORDER BY a.admin_level DESC NULLS LAST, ST_Area(a.geom) LIMIT 1) nb ON true`,
      today,
    );

    // troca o conteúdo do bbox pelo recalculado (tabela derivada: ids determinísticos, nada aponta pra ela)
    await tx.$executeRawUnsafe(
      `DELETE FROM geo_names g WHERE ST_Intersects(g.geog, ST_MakeEnvelope(${bbox.w}, ${bbox.s}, ${bbox.e}, ${bbox.n}, 4326)::geography)
          AND NOT EXISTS (SELECT 1 FROM tmp_names t WHERE t.id = g.id)`,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO geo_names (id, kind, name, neighborhood, city, state, geog, bbox, size_m, area_id, refreshed_on)
       SELECT id, kind, name, neighborhood, city, state, geog, COALESCE(bbox, '{}'), size_m, area_id, refreshed_on FROM tmp_names
       ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, neighborhood = EXCLUDED.neighborhood, city = EXCLUDED.city,
         state = EXCLUDED.state, geog = EXCLUDED.geog, bbox = EXCLUDED.bbox, size_m = EXCLUDED.size_m, area_id = EXCLUDED.area_id,
         refreshed_on = EXCLUDED.refreshed_on`,
    );
  }, TX);
  console.log(`nomes: ${ways.length} trechos de rua lidos (OSM ${streetsFile.osmBase ?? '?'})`);
}

// ---------------------------------------------------------------------------------------------

async function summary(bbox: BBox) {
  const env = Prisma.sql`ST_MakeEnvelope(${bbox.w}, ${bbox.s}, ${bbox.e}, ${bbox.n}, 4326)`;
  const bySource = await prisma.$queryRaw<{ source: string; total: bigint; canonical: bigint; searchable: bigint }[]>`
    SELECT source, count(*) AS total, count(*) FILTER (WHERE dup_of IS NULL) AS canonical,
           count(*) FILTER (WHERE dup_of IS NULL AND searchable AND gone_on IS NULL) AS searchable
      FROM place_catalog WHERE ST_Intersects(geog, ${env}::geography) GROUP BY source ORDER BY source`;
  const byKind = await prisma.$queryRaw<{ kind: string; overture: bigint; osm: bigint }[]>`
    SELECT kind, count(*) FILTER (WHERE source = 'overture') AS overture, count(*) FILTER (WHERE source = 'osm') AS osm
      FROM place_catalog WHERE dup_of IS NULL AND searchable AND gone_on IS NULL AND ST_Intersects(geog, ${env}::geography)
     GROUP BY kind ORDER BY count(*) DESC`;
  const areas = await prisma.$queryRaw<{ kind: string; n: bigint }[]>`
    SELECT kind, count(*) AS n FROM geo_areas WHERE ST_Intersects(geom, ${env}) GROUP BY kind ORDER BY kind`;
  const names = await prisma.$queryRaw<{ kind: string; n: bigint }[]>`
    SELECT kind, count(*) AS n FROM geo_names WHERE ST_Intersects(geog, ${env}::geography) GROUP BY kind ORDER BY kind`;
  const num = (o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
  console.log('\nresumo do bbox');
  console.table(bySource.map(num));
  console.table(byKind.map(num));
  console.table(areas.map(num));
  console.table(names.map(num));
}

const STEPS = ['areas', 'overture', 'osm', 'post', 'names'] as const;

async function main() {
  const bbox = parseBBox(arg('bbox', DEFAULT_BBOX)!);
  const only = (arg('only') ?? STEPS.join(',')).split(',').map((s) => s.trim());
  for (const s of only) if (!(STEPS as readonly string[]).includes(s)) throw new Error(`passo desconhecido "${s}" (passos: ${STEPS.join(', ')})`);
  const today = todayBrazil();
  const t0 = Date.now();
  // ordem fixa: áreas antes dos lugares (bairro por polígono) e das ruas (cidade por polígono)
  for (const s of STEPS) {
    if (!only.includes(s)) continue;
    const t = Date.now();
    if (s === 'areas') await importAreas(bbox, today);
    if (s === 'overture') await importOverture(bbox, today);
    if (s === 'osm') await importOsm(bbox, today);
    if (s === 'post') await post(bbox);
    if (s === 'names') await importNames(bbox, today);
    console.log(`  (${s}: ${((Date.now() - t) / 1000).toFixed(1)} s)`);
  }
  await summary(bbox);
  console.log(`pronto em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
