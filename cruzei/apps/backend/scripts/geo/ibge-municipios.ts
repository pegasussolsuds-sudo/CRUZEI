// Municípios do Brasil inteiro (IBGE) em geo_areas (city, nível 8, polígono) e geo_names (city, ponto na sede, com UF):
// "Cidade" no cabeçalho e "ir até lá" por cidade em qualquer lugar do país. Bairro, rua e lugares continuam vindo só do
// bbox do OSM/Overture (import.ts). Fontes públicas do IBGE: malha municipal 2022 (API de malhas v3, qualidade máxima),
// sedes municipais das Localidades 2022 (coordenada da sede) e nomes atuais (API de localidades v1).
// Idempotente: upsert por id 'ibge:<código>'; município que já veio do OSM com o mesmo código IBGE (Uberlândia, com os
// bairros) fica só com o do OSM. Só escreve em geo_areas e geo_names.
// Uso (em apps/backend; lê DATABASE_URL do .env como o Prisma):
//   npx ts-node --transpile-only scripts/geo/ibge-municipios.ts                # baixa o que faltar em data/geo e carrega
//   npx ts-node --transpile-only scripts/geo/ibge-municipios.ts --refetch      # baixa tudo de novo
//   --tolerance 0.001    simplificação em graus (padrão ~110 m; o rótulo é calculado por célula de ~1 km)
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import { DATA_DIR, UF_BY_IBGE, arg, chunk, flag, todayBrazil } from './common';

const MALHA_URL =
  'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=maxima&intrarregiao=municipio&periodo=2022';
const SEDES_URL = 'https://geoftp.ibge.gov.br/organizacao_do_territorio/estrutura_territorial/localidades/Localidades_do_Brasil/2022/Localidades_UFs_shp.zip';
const NOMES_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios';
const FILES = { malha: 'ibge-malha-municipios-2022.geojson', sedes: 'ibge-localidades-2022.zip', nomes: 'ibge-municipios.json' };
// só ASCII: com acento no cabeçalho a API do IBGE responde 400
const UA = 'metch-geo-import/1.0 (municipios do IBGE para o app Metch)';
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/** ~110 m: sobra pro rótulo (calculado no centro da célula geohash-6, ~1 km) e corta a malha de ~2,6 para ~1,1 milhão de vértices */
const DEFAULT_TOLERANCE = 0.001;
/** sede a mais disto do polígono (dado trocado): o ponto do "ir até lá" vai pra dentro do município */
const SEAT_MAX_DEG = 0.05;
/** o Brasil tem 5.570 municípios na malha 2022: bem menos que isso = arquivo errado ou formato novo */
const MIN_MUNICIPIOS = 5_000;

const prisma = new PrismaClient();
const TX = { timeout: 15 * 60_000, maxWait: 60_000 };

async function download(url: string, file: string, refetch: boolean): Promise<string> {
  const out = path.join(DATA_DIR, file);
  if (!refetch && fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const t = Date.now();
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // .part + rename: download pela metade nunca fica com o nome final
  fs.writeFileSync(`${out}.part`, buf);
  fs.renameSync(`${out}.part`, out);
  console.log(`  baixado ${file}: ${(buf.length / 1e6).toFixed(1)} MB em ${((Date.now() - t) / 1000).toFixed(1)} s`);
  return out;
}

/** arquivos de um .zip que `want` aceita (diretório central + deflate do zlib; sem dependência nova, sem zip64) */
function unzip(buf: Buffer, want: (name: string) => boolean): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip sem diretório central');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip corrompido (diretório central)');
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`zip corrompido (${name})`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, zlib.inflateRawSync(data));
    else throw new Error(`zip: compressão ${method} não suportada (${name})`);
  }
  return out;
}

/** registros de um .dbf (dBase III; o IBGE grava em UTF-8, conforme o .cpg), campos como texto */
function readDbf(buf: Buffer): Record<string, string>[] {
  const n = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields: { name: string; len: number }[] = [];
  for (let o = 32; o < headerLen - 1 && buf[o] !== 0x0d; o += 32) {
    fields.push({ name: buf.toString('latin1', o, o + 11).replace(/\0[\s\S]*$/, ''), len: buf[o + 16] });
  }
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    let o = headerLen + i * recLen;
    if (buf[o] === 0x2a) continue; // registro apagado
    o++;
    const r: Record<string, string> = {};
    for (const f of fields) {
      r[f.name] = buf.toString('utf8', o, o + f.len).trim();
      o += f.len;
    }
    rows.push(r);
  }
  return rows;
}

interface Sede {
  name: string;
  lon: number | null;
  lat: number | null;
}

/** sede de cada município (CD_LOCALID = CD_MUN: "Cidade" e o Distrito Estadual de Fernando de Noronha); capital vem 2x */
function readSedes(file: string): Map<string, Sede> {
  const out = new Map<string, Sede>();
  for (const dbf of unzip(fs.readFileSync(file), (n) => /_localidades_2022\.dbf$/i.test(n)).values()) {
    for (const r of readDbf(dbf)) {
      if (!/^\d{7}$/.test(r.CD_MUN ?? '') || r.CD_LOCALID !== r.CD_MUN || out.has(r.CD_MUN)) continue;
      const lat = Number(r.LAT_LOCALI);
      const lon = Number(r.LONG_LOCAL);
      const ok = Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0;
      out.set(r.CD_MUN, { name: r.NM_MUN, lat: ok ? lat : null, lon: ok ? lon : null });
    }
  }
  return out;
}

interface Row {
  code: string;
  name: string;
  state: string;
  lon: number | null;
  lat: number | null;
  geom: unknown;
}

async function load(rows: Row[], tolerance: number, today: string) {
  let skipped: { code: string; name: string }[] = [];
  let oldNames = 0;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE tmp_mun (code text PRIMARY KEY, name text NOT NULL, state text NOT NULL, seat geometry, geom geometry) ON COMMIT DROP`);
    // simplifica na entrada (a malha máxima tem ~2,6 milhões de vértices); se a simplificação esvaziar, fica a original
    for (const part of chunk(rows, 100)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO tmp_mun
         SELECT r.code, r.name, r.state,
                CASE WHEN r.lon IS NOT NULL AND r.lat IS NOT NULL THEN ST_SetSRID(ST_MakePoint(r.lon, r.lat), 4326) END,
                CASE WHEN s.g IS NULL OR ST_IsEmpty(s.g) THEN ST_Multi(ST_CollectionExtract(ST_MakeValid(raw.g), 3)) ELSE s.g END
           FROM jsonb_to_recordset($1::jsonb) AS r(code text, name text, state text, lon float8, lat float8, geom jsonb)
           CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_GeomFromGeoJSON(r.geom), 4326) AS g) raw
           CROSS JOIN LATERAL (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(raw.g, $2::float8)), 3)) AS g) s`,
        JSON.stringify(part),
        tolerance,
      );
    }
    // cidade que já veio do OSM (Uberlândia, com os bairros): fica a do OSM; sem código IBGE no OSM, casa nome + UF
    skipped = await tx.$queryRawUnsafe<{ code: string; name: string }[]>(
      `DELETE FROM tmp_mun t USING geo_areas a
        WHERE a.kind = 'city' AND a.id NOT LIKE 'ibge:%'
          AND (a.ibge_code = t.code OR (a.ibge_code IS NULL AND a.state = t.state AND a.name_norm = f_norm(t.name)))
       RETURNING t.code, t.name`,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO geo_areas (id, name, admin_level, kind, district_type, parent_id, city, state, ibge_code, geom, refreshed_on)
       SELECT 'ibge:' || code, name, 8, 'city', NULL, NULL, name, state, code, geom, $1::date FROM tmp_mun
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, admin_level = EXCLUDED.admin_level, kind = EXCLUDED.kind,
         district_type = NULL, parent_id = NULL, city = EXCLUDED.city, state = EXCLUDED.state, ibge_code = EXCLUDED.ibge_code,
         geom = EXCLUDED.geom, refreshed_on = EXCLUDED.refreshed_on`,
      today,
    );
    // ponto do "ir até lá" na sede (é onde a câmera pousa); sem sede ou sede fora do polígono, um ponto de dentro
    await tx.$executeRawUnsafe(
      `INSERT INTO geo_names (id, kind, name, neighborhood, city, state, geog, bbox, size_m, area_id, refreshed_on)
       SELECT 'ibge:' || t.code, 'city', t.name, NULL, t.name, t.state,
              (CASE WHEN t.seat IS NOT NULL AND ST_DWithin(t.geom, t.seat, $2::float8) THEN t.seat ELSE ST_PointOnSurface(t.geom) END)::geography,
              ARRAY[ST_XMin(t.geom), ST_YMin(t.geom), ST_XMax(t.geom), ST_YMax(t.geom)],
              sqrt(ST_Area(t.geom::geography)), 'ibge:' || t.code, $1::date
         FROM tmp_mun t
       ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, neighborhood = NULL, city = EXCLUDED.city,
         state = EXCLUDED.state, geog = EXCLUDED.geog, bbox = EXCLUDED.bbox, size_m = EXCLUDED.size_m, area_id = EXCLUDED.area_id,
         refreshed_on = EXCLUDED.refreshed_on`,
      today,
      SEAT_MAX_DEG,
    );
    // município que saiu da malha ou passou a vir do OSM
    await tx.$executeRawUnsafe(`DELETE FROM geo_names g WHERE g.id LIKE 'ibge:%' AND NOT EXISTS (SELECT 1 FROM tmp_mun t WHERE 'ibge:' || t.code = g.id)`);
    await tx.$executeRawUnsafe(`DELETE FROM geo_areas a WHERE a.id LIKE 'ibge:%' AND NOT EXISTS (SELECT 1 FROM tmp_mun t WHERE 'ibge:' || t.code = a.id)`);
    // ponto place=city/town do OSM com o mesmo nome dentro do município: fica o do IBGE (sede + polígono), sem duplicar
    oldNames = Number(
      await tx.$executeRawUnsafe(
        `DELETE FROM geo_names g USING tmp_mun t
          WHERE g.kind = 'city' AND g.id LIKE 'osm:n%' AND g.name_norm = f_norm(t.name) AND ST_Covers(t.geom, g.geog::geometry)`,
      ),
    );
  }, TX);
  if (skipped.length) console.log(`  ${skipped.length} já vêm do OSM (ficam com o polígono e os bairros do OSM): ${skipped.map((s) => `${s.name} ${s.code}`).join(', ')}`);
  if (oldNames) console.log(`  ${oldNames} pontos de cidade do OSM trocados pelo município do IBGE`);
  // o upsert reescreve as ~5.570 linhas: VACUUM devolve o espaço pra próxima carga (fora de transação)
  await prisma.$executeRawUnsafe('VACUUM (ANALYZE) geo_areas');
  await prisma.$executeRawUnsafe('VACUUM (ANALYZE) geo_names');
}

async function summary() {
  const areas = await prisma.$queryRawUnsafe<{ fonte: string; kind: string; n: bigint; vertices: bigint; geometria: string }[]>(
    `SELECT split_part(id, ':', 1) AS fonte, kind, count(*) AS n, sum(ST_NPoints(geom)) AS vertices,
            pg_size_pretty(sum(pg_column_size(geom))) AS geometria
       FROM geo_areas GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const names = await prisma.$queryRawUnsafe<{ fonte: string; kind: string; n: bigint }[]>(
    `SELECT split_part(id, ':', 1) AS fonte, kind, count(*) AS n FROM geo_names GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  // tamanho em disco inclui o espaço livre que a próxima carga reaproveita
  const size = await prisma.$queryRawUnsafe<{ geo_areas: string; geo_names: string }[]>(
    `SELECT pg_size_pretty(pg_total_relation_size('geo_areas')) AS geo_areas, pg_size_pretty(pg_total_relation_size('geo_names')) AS geo_names`,
  );
  const num = (o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
  console.log('\nresumo');
  console.table(areas.map(num));
  console.table(names.map(num));
  console.table(size);
}

async function main() {
  const refetch = flag('refetch');
  const tolerance = Number(arg('tolerance', String(DEFAULT_TOLERANCE)));
  if (!(tolerance >= 0 && tolerance <= 0.01)) throw new Error(`--tolerance inválida "${arg('tolerance')}": graus entre 0 e 0.01`);
  const t0 = Date.now();

  const malhaFile = await download(MALHA_URL, FILES.malha, refetch);
  const sedesFile = await download(SEDES_URL, FILES.sedes, refetch);
  const nomesFile = await download(NOMES_URL, FILES.nomes, refetch);
  const malha = JSON.parse(fs.readFileSync(malhaFile, 'utf8')) as { features?: { properties?: { codarea?: string }; geometry?: unknown }[] };
  const nomes = new Map((JSON.parse(fs.readFileSync(nomesFile, 'utf8')) as { id: number; nome: string }[]).map((m) => [String(m.id), m.nome.trim()]));
  const sedes = readSedes(sedesFile);

  const rows: Row[] = [];
  const bad: string[] = [];
  for (const f of malha.features ?? []) {
    const code = String(f.properties?.codarea ?? '');
    // nome atual (API de localidades); sem ele, o do Censo 2022
    const name = (nomes.get(code) ?? sedes.get(code)?.name ?? '').slice(0, 150);
    const state = UF_BY_IBGE[code.slice(0, 2)];
    if (!/^\d{7}$/.test(code) || !name || !state || !f.geometry) {
      bad.push(code || '?');
      continue;
    }
    const sede = sedes.get(code);
    rows.push({ code, name, state, lon: sede?.lon ?? null, lat: sede?.lat ?? null, geom: f.geometry });
  }
  if (rows.length < MIN_MUNICIPIOS) throw new Error(`só ${rows.length} municípios lidos da malha: confira ${malhaFile}`);
  if (bad.length) console.warn(`  ${bad.length} feições da malha sem código/nome/UF (ignoradas): ${bad.join(', ')}`);
  const noSeat = rows.filter((r) => r.lat == null).map((r) => `${r.name} ${r.code}`);
  if (noSeat.length) console.log(`  ${noSeat.length} sem sede nas Localidades 2022 (ponto dentro do polígono): ${noSeat.join(', ')}`);
  const inMalha = new Set(rows.map((r) => r.code));
  const noGeom = [...sedes.keys()].filter((c) => !inMalha.has(c)).map((c) => `${nomes.get(c) ?? sedes.get(c)?.name} ${c}`);
  if (noGeom.length) console.log(`  ${noGeom.length} municípios sem polígono na malha 2022 (ficam dentro do município de origem): ${noGeom.join(', ')}`);
  console.log(`malha 2022: ${rows.length} municípios, ${sedes.size} sedes (lido em ${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  const t = Date.now();
  await load(rows, tolerance, todayBrazil());
  console.log(`  (carga: ${((Date.now() - t) / 1000).toFixed(1)} s, simplificação ${tolerance}°)`);
  await summary();
  console.log(`pronto em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
