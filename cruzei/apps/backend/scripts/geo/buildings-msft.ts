// Prédios extras: footprints da Microsoft (Global ML Building Footprints) onde o OSM NÃO tem prédio → extra_buildings.
// Nada do Google. O OSM entra só pra deduplicar (e calibrar); o mapa já desenha os prédios do OSM pelos tiles.
// Altura: heurística por área/forma (ver README). O 3D-GloBFP fica DESLIGADO por padrão: o modelo de altura dele foi
// treinado com referências que incluem o Google Open Buildings (regra do produto: nada do Google) e, em Uberlândia,
// nem bate com o OSM. Só entra com --with-3dg, para medir. Idempotente: pode rodar de novo.
// Uso (em apps/backend; lê DATABASE_URL do .env como o Prisma):
//   npx ts-node --transpile-only scripts/geo/buildings-msft.ts                 # baixa o que faltar e carrega
//   --only fetch | --only load        só baixa / só carrega (do que já está em data/geo)
//   --bbox oeste,sul,leste,norte      padrão Uberlândia e arredores
//   --refetch                         baixa de novo (MS, OSM e índices), mesmo se já tem
//   --height auto|3dglobfp|heuristic  auto (padrão): 3D-GloBFP só se passar na calibração contra o OSM
//   --with-3dg                        baixa e casa o 3D-GloBFP (só para medir; ver o aviso acima)
//   --overlap 0.2                     sobreposição com prédio OSM (fração da área do MENOR) que descarta o footprint
//   --osm-date ofm|now|<ISO>          OSM da dedupe: ofm (padrão) = mesma data dos tiles do OpenFreeMap (rode de novo
//                                     quando o OFM publicar versão nova: o cache do OSM se renova sozinho)
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';
import { Prisma, PrismaClient } from '@prisma/client';
import { DATA_DIR, DEFAULT_BBOX, arg, chunk, flag, overpass, overpassBBox, parseBBox, todayBrazil, type BBox } from './common';

const MS_DIR = path.join(DATA_DIR, 'msft');
const G3D_DIR = path.join(DATA_DIR, '3dglobfp');
const OSM_FILE = path.join(DATA_DIR, 'osm-buildings.json');
const MS_LINKS = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv';
/** 3D-GloBFP no figshare, em 10 partes por faixa de grid (readme/grade: doi.org/10.5281/zenodo.11319912) */
const G3D_ARTICLES = [28879733, 28881749, 28882700, 28889813, 28890593, 28891631, 28903454, 28903853, 28904453, 28906499];
const UA = 'metch-geo-import/1.0 (prédios do mapa do app Metch; contato: dev)';

/** lixo: footprint menor que isso (m²) não entra */
const MIN_AREA_M2 = 12;
/** altura do 3D-GloBFP só vale se os footprints dele cobrirem pelo menos isso do prédio */
const G3D_MIN_COVER = 0.5;
/** calibração do 3D-GloBFP contra prédios do OSM com altura/andares: mínimo de pares, correlação e erro mediano (m) */
const GATE = { minN: 50, minCorr: 0.5, maxMedErr: 3 };
/** índice de listagem/links: baixa de novo depois disso */
const INDEX_MAX_AGE_DAYS = 14;

const prisma = new PrismaClient();
const TX = { timeout: 30 * 60_000, maxWait: 60_000 };

type Coords = number[][][];
type Geo = { type: 'Polygon'; coordinates: Coords } | { type: 'MultiPolygon'; coordinates: Coords[] };

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const secs = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const boxHits = (b: BBox, w: number, s: number, e: number, n: number) => w <= b.e && e >= b.w && s <= b.n && n >= b.s;
const grow = (b: BBox, d: number): BBox => ({ w: b.w - d, s: b.s - d, e: b.e + d, n: b.n + d });
const envelope = (b: BBox) => Prisma.sql`ST_MakeEnvelope(${b.w}, ${b.s}, ${b.e}, ${b.n}, 4326)`;

function isFresh(file: string, days = INDEX_MAX_AGE_DAYS) {
  return fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < days * 86400_000;
}

/** baixa pra arquivo (via .tmp + rename); confere md5 se vier */
async function download(url: string, out: string, md5?: string) {
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`${url} → HTTP ${r.status}`);
  const tmp = `${out}.tmp`;
  const hash = createHash('md5');
  await pipeline(
    Readable.fromWeb(r.body as import('node:stream/web').ReadableStream),
    async function* (src) {
      for await (const c of src) {
        hash.update(c as Buffer);
        yield c;
      }
    },
    fs.createWriteStream(tmp),
  );
  const got = hash.digest('hex');
  if (md5 && got !== md5) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`${path.basename(out)}: md5 ${got} ≠ ${md5}`);
  }
  fs.renameSync(tmp, out);
  console.log(`  baixado ${path.basename(out)} (${mb(fs.statSync(out).size)}, ${secs(t0)})`);
}

// ---------------------------------------------------------------------------------------------
// Microsoft: dataset-links.csv → quadkeys (z9) que cobrem o bbox → csv.gz (uma Feature GeoJSON por linha)
// ---------------------------------------------------------------------------------------------

function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

function quadkey(x: number, y: number, z: number): string {
  let q = '';
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1);
    q += String((x & m ? 1 : 0) + (y & m ? 2 : 0));
  }
  return q;
}

export function bboxQuadkeys(b: BBox, z: number): string[] {
  const [x0, y0] = tileXY(b.w, b.n, z);
  const [x1, y1] = tileXY(b.e, b.s, z);
  const out: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(quadkey(x, y, z));
  return out;
}

/** linha de CSV com aspas opcionais */
function csvLine(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') out.push(cur), (cur = '');
    else cur += c;
  }
  out.push(cur);
  return out;
}

interface MsFile {
  file: string;
  url: string;
  location: string;
  quadkey: string;
  uploadDate: string;
}

async function fetchMsft(b: BBox, refetch: boolean): Promise<MsFile[]> {
  fs.mkdirSync(MS_DIR, { recursive: true });
  const linksFile = path.join(MS_DIR, 'dataset-links.csv');
  if (refetch || !isFresh(linksFile)) await download(MS_LINKS, linksFile);
  const lines = fs.readFileSync(linksFile, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = csvLine(lines[0]);
  const col = (n: string) => head.indexOf(n);
  const [iLoc, iQk, iUrl, iDate] = [col('Location'), col('QuadKey'), col('Url'), col('UploadDate')];
  const rows = lines.slice(1).map(csvLine);
  const z = rows[0][iQk].length;
  const want = new Set(bboxQuadkeys(b, z));
  const hits = rows.filter((r) => want.has(r[iQk]));
  if (!hits.length) throw new Error(`nenhum arquivo da Microsoft cobre o bbox (quadkeys z${z}: ${[...want].join(', ')})`);

  // meta: arquivo local → URL; URL nova (release nova) ou arquivo faltando = baixa de novo
  const metaFile = path.join(MS_DIR, 'files.json');
  const meta: Record<string, string> = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  const out: MsFile[] = [];
  const perQk = new Map<string, number>();
  for (const r of hits) {
    const n = perQk.get(r[iQk]) ?? 0;
    perQk.set(r[iQk], n + 1);
    const file = path.join(MS_DIR, n ? `${r[iQk]}-${n}.csv.gz` : `${r[iQk]}.csv.gz`);
    if (refetch || !fs.existsSync(file) || meta[path.basename(file)] !== r[iUrl]) {
      await download(r[iUrl], file);
      meta[path.basename(file)] = r[iUrl];
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
    }
    out.push({ file, url: r[iUrl], location: r[iLoc], quadkey: r[iQk], uploadDate: r[iDate] });
  }
  console.log(`msft: ${out.length} arquivo(s) — ${out.map((f) => `${f.location}/${f.quadkey} (${f.uploadDate})`).join(', ')}`);
  return out;
}

interface MsRow {
  id: number;
  g: string;
  c: number | null;
}

/** footprints cujo retângulo toca o bbox (o SQL aplica a regra exata: ponto de dentro do polígono no bbox) */
async function readMsft(files: MsFile[], b: BBox): Promise<{ rows: MsRow[]; lines: number }> {
  const rows: MsRow[] = [];
  const seen = new Set<number>();
  let lines = 0;
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(f.file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      lines++;
      const ft = JSON.parse(line) as { properties?: { confidence?: number }; geometry?: Geo };
      const g = ft.geometry;
      if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      const polys: Coords[] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of polys)
        for (const ring of p)
          for (const pt of ring) {
            pt[0] = r7(pt[0]);
            pt[1] = r7(pt[1]);
            if (pt[0] < w) w = pt[0];
            if (pt[0] > e) e = pt[0];
            if (pt[1] < s) s = pt[1];
            if (pt[1] > n) n = pt[1];
          }
      if (!boxHits(b, w, s, e, n)) continue;
      const coords = JSON.stringify(g.coordinates);
      // id estável: md5 da geometria (52 bits → cabe em número JS e no id de feição do MVT)
      const id = parseInt(createHash('md5').update(coords).digest('hex').slice(0, 13), 16);
      if (seen.has(id)) continue;
      seen.add(id);
      const c = ft.properties?.confidence;
      rows.push({ id, g: `{"type":"${g.type}","coordinates":${coords}}`, c: c != null && c >= 0 ? c : null });
    }
  }
  return { rows, lines };
}

// ---------------------------------------------------------------------------------------------
// OSM: prédios do bbox (Overpass), só pra deduplicar e calibrar
// ---------------------------------------------------------------------------------------------

interface OsmEl {
  type: 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}
interface OsmFile {
  bbox: BBox;
  fetchedAt: string;
  osmBase: string | null;
  /** data do OSM pedida ao Overpass ([date:]); null = atual */
  osmDate?: string | null;
  elements: OsmEl[];
}

/**
 * Data do OSM que os tiles do OpenFreeMap desenham (o nome da versão: planet/20260913_164504_pt → 2026-09-13T16:45:04Z).
 * A dedupe TEM que usar o mesmo OSM que o mapa mostra: com o OSM de hoje, prédio mapeado depois do tile some dos extras
 * e ainda não aparece no OFM (buraco). Em 29/09/2026: ~2,6 mil prédios do OSM mais novos que o tile (quase todos no
 * centro) e ~400 footprints a menos por causa deles.
 */
async function ofmOsmDate(): Promise<string> {
  const r = await fetch('https://tiles.openfreemap.org/planet', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`OpenFreeMap TileJSON → HTTP ${r.status} (use --osm-date now ou uma data ISO)`);
  const tj = (await r.json()) as { tiles?: string[] };
  const m = tj.tiles?.[0]?.match(/\/planet\/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
  if (!m) throw new Error(`OpenFreeMap TileJSON sem data da versão: ${tj.tiles?.[0]}`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

/** --osm-date: ofm (padrão) = data dos tiles do OFM; now = OSM atual; ou uma data ISO (2026-09-13T16:45:04Z) */
async function resolveOsmDate(opt: string): Promise<string | null> {
  if (opt === 'now') return null;
  if (opt === 'ofm') return ofmOsmDate();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(opt)) throw new Error(`--osm-date ${opt}: use ofm, now ou AAAA-MM-DDThh:mm:ssZ`);
  return opt;
}

async function fetchOsm(b: BBox, refetch: boolean, osmDate: string | null): Promise<void> {
  if (!refetch && fs.existsSync(OSM_FILE)) {
    const f = JSON.parse(fs.readFileSync(OSM_FILE, 'utf8')) as OsmFile;
    if (sameBox(f.bbox, b) && (f.osmDate ?? null) === osmDate)
      return void console.log(`osm: já tem ${path.basename(OSM_FILE)} (OSM ${f.osmDate ?? f.osmBase ?? '?'}; --refetch baixa de novo)`);
  }
  const t0 = Date.now();
  const q = `[out:json][timeout:300]${osmDate ? `[date:"${osmDate}"]` : ''};
(
  way["building"]["building"!="no"]({{bbox}});
  way["building:part"]["building:part"!="no"]({{bbox}});
  rel["building"]["building"!="no"]({{bbox}});
  rel["building:part"]({{bbox}});
);
out geom;`;
  // com data: só espelho cuja base já passou dessa data (senão o [date:] devolve o OSM de meses antes)
  const text = await overpass(q.split('{{bbox}}').join(overpassBBox(b)), undefined, osmDate ?? undefined);
  const json = JSON.parse(text) as { elements: OsmEl[]; osm3s?: { timestamp_osm_base?: string } };
  const f: OsmFile = { bbox: b, fetchedAt: new Date().toISOString(), osmBase: json.osm3s?.timestamp_osm_base ?? null, osmDate, elements: json.elements };
  fs.writeFileSync(`${OSM_FILE}.tmp`, JSON.stringify(f));
  fs.renameSync(`${OSM_FILE}.tmp`, OSM_FILE);
  console.log(`osm: ${json.elements.length} prédios (${mb(text.length)}, ${secs(t0)}, OSM ${osmDate ?? f.osmBase ?? '?'})`);
}

function sameBox(a: BBox, b: BBox) {
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-9;
  return eq(a.w, b.w) && eq(a.s, b.s) && eq(a.e, b.e) && eq(a.n, b.n);
}

/** número do começo da tag ("12", "12.5 m", "3,5") */
function num(s: string | undefined): number | null {
  const m = s?.match(/^\s*(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

interface OsmRow {
  id: string;
  g: string;
  rel: boolean;
  h: number | null;
  lv: number | null;
}

function readOsm(b: BBox): { rows: OsmRow[]; osmBase: string | null; osmDate: string | null } {
  if (!fs.existsSync(OSM_FILE)) throw new Error(`falta ${OSM_FILE}: rode sem --only load`);
  const f = JSON.parse(fs.readFileSync(OSM_FILE, 'utf8')) as OsmFile;
  if (!sameBox(f.bbox, b)) throw new Error(`${OSM_FILE} é de outro bbox: rode com --refetch`);
  const pts = (g: OsmEl['geometry']) => (g ?? []).filter((p): p is { lat: number; lon: number } => p != null).map((p) => [r7(p.lon), r7(p.lat)]);
  const rows: OsmRow[] = [];
  for (const e of f.elements) {
    const t = e.tags ?? {};
    const h = num(t.height);
    const lv = num(t['building:levels']);
    if (e.type === 'way') {
      const ring = pts(e.geometry);
      if (ring.length < 4 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) continue;
      rows.push({ id: `w${e.id}`, g: JSON.stringify({ type: 'Polygon', coordinates: [ring] }), rel: false, h, lv });
    } else {
      const lines = (e.members ?? []).filter((m) => m.type === 'way').map((m) => pts(m.geometry)).filter((l) => l.length >= 2);
      if (lines.length) rows.push({ id: `r${e.id}`, g: JSON.stringify({ type: 'MultiLineString', coordinates: lines }), rel: true, h, lv });
    }
  }
  return { rows, osmBase: f.osmBase, osmDate: f.osmDate ?? null };
}

// ---------------------------------------------------------------------------------------------
// 3D-GloBFP: índice do figshare → tiles (zip com shapefile) que cobrem o bbox → polígonos + Height
// ---------------------------------------------------------------------------------------------

interface G3dFile {
  name: string;
  url: string;
  md5: string;
  size: number;
}

async function fetchG3d(b: BBox, refetch: boolean): Promise<string[]> {
  fs.mkdirSync(G3D_DIR, { recursive: true });
  const idxFile = path.join(G3D_DIR, 'files.json');
  if (refetch || !isFresh(idxFile, 90)) {
    const all: G3dFile[] = [];
    for (const id of G3D_ARTICLES) {
      for (let page = 1; ; page++) {
        const r = await fetch(`https://api.figshare.com/v2/articles/${id}/files?page=${page}&page_size=1000`, { headers: { 'User-Agent': UA } });
        if (!r.ok) throw new Error(`figshare ${id} → HTTP ${r.status}`);
        const xs = (await r.json()) as { name: string; download_url: string; supplied_md5?: string; computed_md5?: string; size: number }[];
        all.push(...xs.map((x) => ({ name: x.name, url: x.download_url, md5: x.computed_md5 || x.supplied_md5 || '', size: x.size })));
        if (xs.length < 1000) break;
      }
    }
    fs.writeFileSync(idxFile, JSON.stringify(all));
    console.log(`3dglobfp: índice com ${all.length} arquivos`);
  }
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')) as G3dFile[];
  // nome: gridID_lon1_lat1_lon2_lat2_PAÍS[_PAÍS].zip (EUA/China vão por estado/província: não casam aqui)
  const re = /^(\d+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_[A-Z_]+\.zip$/;
  const hits = idx.filter((f) => {
    const m = f.name.match(re);
    return m && boxHits(b, +m[2], +m[3], +m[4], +m[5]);
  });
  const bases: string[] = [];
  for (const f of hits) {
    const zip = path.join(G3D_DIR, f.name);
    const base = zip.replace(/\.zip$/, '');
    if (!['.shp', '.shx', '.dbf'].every((x) => fs.existsSync(base + x))) {
      if (!fs.existsSync(zip) || fs.statSync(zip).size !== f.size) {
        console.log(`3dglobfp: baixando ${f.name} (${mb(f.size)})`);
        await download(f.url, zip, f.md5 || undefined);
      }
      unzip(zip, G3D_DIR, /\.(shp|shx|dbf|prj|cpg)$/i);
    }
    bases.push(base);
  }
  console.log(`3dglobfp: ${bases.length} tile(s) — ${hits.map((f) => f.name).join(', ') || 'nenhum cobre o bbox'}`);
  return bases;
}

/** zip mínimo (stored/deflate, sem zip64): extrai as entradas que casam com `want` */
function unzip(zipFile: string, outDir: string, want: RegExp) {
  const buf = fs.readFileSync(zipFile);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${zipFile}: zip inválido`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${zipFile}: diretório central inválido`);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (!want.test(name) || name.endsWith('/')) continue;
    if (csize === 0xffffffff || local === 0xffffffff) throw new Error(`${zipFile}: zip64 não suportado — extraia à mão em ${outDir}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    const out = method === 8 ? zlib.inflateRawSync(data) : method === 0 ? data : null;
    if (!out) throw new Error(`${zipFile}: compressão ${method} não suportada (${name})`);
    fs.writeFileSync(path.join(outDir, path.basename(name)), out);
  }
}

interface G3dRow {
  h: number;
  g: string;
}

/** shapefile (Polygon/PolygonZ/PolygonM) + dbf com Height; só registros cujo retângulo toca `b` */
function readG3d(base: string, b: BBox): { rows: G3dRow[]; total: number } {
  const shp = fs.readFileSync(`${base}.shp`);
  const shx = fs.readFileSync(`${base}.shx`);
  const dbf = fs.readFileSync(`${base}.dbf`);
  // dbf: cabeçalho + descritores de campo de 32 bytes até 0x0D
  const nRec = dbf.readUInt32LE(4);
  const headLen = dbf.readUInt16LE(8);
  const recLen = dbf.readUInt16LE(10);
  const fields: { name: string; off: number; len: number }[] = [];
  let off = 1; // byte 0 do registro = marca de apagado
  for (let p = 32; dbf[p] !== 0x0d; p += 32) {
    const name = dbf.toString('latin1', p, p + 11).replace(/\0.*$/, '');
    const len = dbf[p + 16];
    fields.push({ name, off, len });
    off += len;
  }
  const hf = fields.find((f) => f.name.toLowerCase() === 'height');
  if (!hf) throw new Error(`${base}.dbf sem campo Height (campos: ${fields.map((f) => f.name).join(', ')})`);

  const total = (shx.length - 100) / 8;
  if (total !== nRec) throw new Error(`${base}: shx (${total}) e dbf (${nRec}) com contagens diferentes`);
  const rows: G3dRow[] = [];
  for (let i = 0; i < total; i++) {
    const p = shx.readInt32BE(100 + i * 8) * 2 + 8; // conteúdo do registro (depois do cabeçalho de 8 bytes)
    const type = shp.readInt32LE(p);
    if (type !== 5 && type !== 15 && type !== 25) continue;
    const [w, s, e, n] = [shp.readDoubleLE(p + 4), shp.readDoubleLE(p + 12), shp.readDoubleLE(p + 20), shp.readDoubleLE(p + 28)];
    if (!boxHits(b, w, s, e, n)) continue;
    const r = headLen + i * recLen;
    if (dbf[r] === 0x2a) continue; // apagado
    const h = Number(dbf.toString('latin1', r + hf.off, r + hf.off + hf.len).trim());
    if (!Number.isFinite(h) || h <= 0) continue;
    const nParts = shp.readInt32LE(p + 36);
    const nPts = shp.readInt32LE(p + 40);
    const pts0 = p + 44 + nParts * 4;
    // anéis: horário = externo (novo polígono), anti-horário = buraco do último externo
    const polys: Coords[] = [];
    for (let k = 0; k < nParts; k++) {
      const a = shp.readInt32LE(p + 44 + k * 4);
      const z = k + 1 < nParts ? shp.readInt32LE(p + 44 + (k + 1) * 4) : nPts;
      const ring: number[][] = [];
      let area2 = 0;
      for (let j = a; j < z; j++) {
        const x = r7(shp.readDoubleLE(pts0 + j * 16));
        const y = r7(shp.readDoubleLE(pts0 + j * 16 + 8));
        if (ring.length) area2 += ring[ring.length - 1][0] * y - x * ring[ring.length - 1][1];
        ring.push([x, y]);
      }
      if (ring.length < 4) continue;
      if (area2 < 0 || !polys.length) polys.push([ring]);
      else polys[polys.length - 1].push(ring);
    }
    if (!polys.length) continue;
    const g = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
    rows.push({ h, g: JSON.stringify(g) });
  }
  return { rows, total };
}

// ---------------------------------------------------------------------------------------------
// carga no Postgres
// ---------------------------------------------------------------------------------------------

type HeightMode = 'auto' | '3dglobfp' | 'heuristic';

/** heurística de altura (m) por área e forma — calibrada com os andares do OSM em Uberlândia (README) */
const HEURISTIC_SQL = (a: string, elong: string) => `
  CASE WHEN ${elong} >= 4 THEN LEAST(4.5, h0) ELSE h0 END
  FROM (SELECT CASE WHEN ${a} < 80 THEN 3.5 WHEN ${a} < 150 THEN 4 WHEN ${a} < 250 THEN 5 WHEN ${a} < 500 THEN 6
                    ELSE LEAST(12, 6 + 2 * ln(${a} / 500.0) / ln(2)) END AS h0) h0q`;

async function load(b: BBox, mode: HeightMode, use3dg: boolean, overlap: number, ms: MsRow[], osm: OsmRow[], g3d: G3dRow[]) {
  const today = todayBrazil();
  const env = envelope(b);
  const t0 = Date.now();
  const q = <T>(tx: Prisma.TransactionClient, sql: Prisma.Sql) => tx.$queryRaw<T[]>(sql);
  const stats: Record<string, unknown> = {};

  await prisma.$transaction(async (tx) => {
    // --- OSM
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE t_osm (id text, geom geometry, ref_h real, levels real) ON COMMIT DROP`);
    for (const part of chunk(osm, 2000)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO t_osm
         SELECT r.id, ST_CollectionExtract(ST_MakeValid(CASE WHEN r.rel THEN ST_BuildArea(ST_Node(g.g)) ELSE g.g END), 3),
                COALESCE(r.h, r.lv * 3), r.lv
           FROM jsonb_to_recordset($1::jsonb) AS r(id text, g text, rel boolean, h real, lv real)
           CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_GeomFromGeoJSON(r.g), 4326) AS g) g`,
        JSON.stringify(part),
      );
    }
    await tx.$executeRawUnsafe(`DELETE FROM t_osm WHERE geom IS NULL OR ST_IsEmpty(geom)`);
    await tx.$executeRawUnsafe(`CREATE INDEX ON t_osm USING GIST (geom)`);
    await tx.$executeRawUnsafe(`ANALYZE t_osm`);
    console.log(`  osm carregado (${secs(t0)})`);

    // --- Microsoft: geometria válida (ST_MakeValid), área, alongamento; só o que tem o "ponto de dentro" no bbox
    await tx.$executeRawUnsafe(
      `CREATE TEMP TABLE t_ms (id bigint PRIMARY KEY, geom geometry, fixed boolean, conf real, area_m2 real, elong real,
                               osm boolean NOT NULL DEFAULT false, h3 real, cover real) ON COMMIT DROP`,
    );
    for (const part of chunk(ms, 5000)) {
      await tx.$executeRawUnsafe(
        `INSERT INTO t_ms (id, geom, fixed, conf)
         SELECT r.id, CASE WHEN ST_IsValid(g.g) THEN g.g ELSE ST_CollectionExtract(ST_MakeValid(g.g), 3) END, NOT ST_IsValid(g.g), r.c
           FROM jsonb_to_recordset($1::jsonb) AS r(id bigint, g text, c real)
           CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_GeomFromGeoJSON(r.g), 4326) AS g) g
         ON CONFLICT (id) DO NOTHING`,
        JSON.stringify(part),
      );
    }
    stats.msSent = ms.length;
    await tx.$executeRawUnsafe(`UPDATE t_ms SET geom = ST_GeometryN(geom, 1) WHERE ST_NumGeometries(geom) = 1 AND GeometryType(geom) = 'MULTIPOLYGON'`);
    const [emptyRow] = await q<{ n: bigint }>(tx, Prisma.sql`WITH d AS (DELETE FROM t_ms WHERE geom IS NULL OR ST_IsEmpty(geom) RETURNING 1) SELECT count(*) n FROM d`);
    await tx.$executeRaw`DELETE FROM t_ms WHERE NOT ST_Intersects(${env}, ST_PointOnSurface(geom))`;
    await tx.$executeRawUnsafe(
      `UPDATE t_ms SET area_m2 = ST_Area(geom::geography),
              elong = (SELECT GREATEST(a, c) / NULLIF(LEAST(a, c), 0)
                         FROM (SELECT ST_Distance(ST_PointN(r, 1)::geography, ST_PointN(r, 2)::geography) a,
                                      ST_Distance(ST_PointN(r, 2)::geography, ST_PointN(r, 3)::geography) c
                                 FROM (SELECT ST_ExteriorRing(ST_OrientedEnvelope(geom)) r) e WHERE r IS NOT NULL) s)`,
    );
    await tx.$executeRawUnsafe(`CREATE INDEX ON t_ms USING GIST (geom)`);
    await tx.$executeRawUnsafe(`ANALYZE t_ms`);
    // sobreposição com prédio do OSM: interseção > `overlap` da área do MENOR dos dois (área plana em graus: só a razão importa)
    await tx.$executeRawUnsafe(
      `UPDATE t_ms m SET osm = true
        WHERE area_m2 >= ${MIN_AREA_M2} AND EXISTS (
          SELECT 1 FROM t_osm o
           WHERE o.geom && m.geom AND ST_Intersects(o.geom, m.geom)
             AND ST_Area(ST_Intersection(o.geom, m.geom)) > $1 * LEAST(ST_Area(o.geom), ST_Area(m.geom)))`,
      overlap,
    );
    const [c] = await q<{ inbox: bigint; fixed: bigint; small: bigint; osm: bigint; keep: bigint }>(
      tx,
      Prisma.sql`SELECT count(*) inbox, count(*) FILTER (WHERE fixed) fixed, count(*) FILTER (WHERE area_m2 < ${MIN_AREA_M2}) small,
                        count(*) FILTER (WHERE osm) osm, count(*) FILTER (WHERE NOT osm AND area_m2 >= ${MIN_AREA_M2}) keep FROM t_ms`,
    );
    Object.assign(stats, { msInBox: Number(c.inbox), msFixed: Number(c.fixed), msEmpty: Number(emptyRow.n), msSmall: Number(c.small), msOsm: Number(c.osm), msKeep: Number(c.keep) });
    console.log(`  msft carregado e deduplicado (${secs(t0)})`);

    // --- 3D-GloBFP: altura casada por geometria (média ponderada pela área de interseção) e calibração contra o OSM
    let gate = { n: 0, corr: null as number | null, medErr: null as number | null, med1: null as number | null, pass: false };
    if (use3dg && g3d.length) {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE t_g3d (h real, geom geometry) ON COMMIT DROP`);
      for (const part of chunk(g3d, 5000)) {
        await tx.$executeRawUnsafe(
          `INSERT INTO t_g3d SELECT r.h, ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r.g), 4326)), 3)
             FROM jsonb_to_recordset($1::jsonb) AS r(h real, g text)`,
          JSON.stringify(part),
        );
      }
      await tx.$executeRawUnsafe(`DELETE FROM t_g3d WHERE geom IS NULL OR ST_IsEmpty(geom)`);
      await tx.$executeRawUnsafe(`CREATE INDEX ON t_g3d USING GIST (geom)`);
      await tx.$executeRawUnsafe(`ANALYZE t_g3d`);
      const match = (t: string, where: string) => `
        SELECT x.id, sum(g.h * i.a) / NULLIF(sum(i.a), 0) AS h3, sum(i.a) / NULLIF(max(ST_Area(x.geom)), 0) AS cover
          FROM ${t} x JOIN t_g3d g ON g.geom && x.geom AND ST_Intersects(g.geom, x.geom)
          CROSS JOIN LATERAL (SELECT ST_Area(ST_Intersection(g.geom, x.geom)) AS a) i
         WHERE ${where}
         GROUP BY x.id`;
      await tx.$executeRawUnsafe(
        `UPDATE t_ms m SET h3 = s.h3, cover = s.cover FROM (${match('t_ms', `NOT x.osm AND x.area_m2 >= ${MIN_AREA_M2}`)}) s WHERE s.id = m.id`,
      );
      // calibração: prédios do OSM com height/andares × 3D-GloBFP casado (mesma regra de cobertura)
      const [g] = await tx.$queryRawUnsafe<{ n: bigint; corr: number | null; med_err: number | null; med1: number | null }[]>(
        `SELECT count(*) n, corr(s.h3, o.ref_h) corr,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(s.h3 - o.ref_h)) med_err,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY s.h3) FILTER (WHERE o.levels = 1) med1
           FROM (${match('t_osm', 'x.ref_h > 0')}) s JOIN t_osm o ON o.id = s.id
          WHERE s.cover >= ${G3D_MIN_COVER}`,
      );
      gate = {
        n: Number(g.n),
        corr: g.corr,
        medErr: g.med_err,
        med1: g.med1,
        pass: Number(g.n) >= GATE.minN && (g.corr ?? 0) >= GATE.minCorr && (g.med_err ?? Infinity) <= GATE.maxMedErr,
      };
      console.log(`  3dglobfp casado (${secs(t0)})`);
    }
    stats.gate = gate;
    const use = mode === '3dglobfp' || (mode === 'auto' && gate.pass);
    stats.heightFrom = use ? `3D-GloBFP onde cobre ≥ ${G3D_MIN_COVER * 100}% do prédio, heurística no resto` : 'heurística em todos';

    // --- grava só a diferença (id = md5 da geometria: mesmo id = mesmo polígono). Rodar de novo com os mesmos dados não
    // reescreve nada (sem inchar a tabela); some da fonte ou virou duplicado do OSM → sai; altura mudou → atualiza.
    await tx.$executeRawUnsafe(
      `CREATE TEMP TABLE t_new (id bigint PRIMARY KEY, geom geometry, height real, height_src text, height_3dg real, area_m2 real, confidence real) ON COMMIT DROP`,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO t_new
       SELECT m.id, m.geom, round(hh.h * 2) / 2, hh.src, CASE WHEN m.cover >= ${G3D_MIN_COVER} THEN round(m.h3::numeric, 1) END,
              round(m.area_m2::numeric, 1), m.conf
         FROM t_ms m
         CROSS JOIN LATERAL (SELECT ${HEURISTIC_SQL('m.area_m2', 'COALESCE(m.elong, 1)')}) heur(h)
         CROSS JOIN LATERAL (SELECT CASE WHEN $1 AND m.cover >= ${G3D_MIN_COVER} THEN GREATEST(3, LEAST(m.h3, 300)) ELSE heur.h END AS h,
                                    CASE WHEN $1 AND m.cover >= ${G3D_MIN_COVER} THEN '3dglobfp' ELSE 'heuristic' END AS src) hh
        WHERE NOT m.osm AND m.area_m2 >= ${MIN_AREA_M2}`,
      use,
    );
    stats.removed = await tx.$executeRaw`
      DELETE FROM extra_buildings e
       WHERE e.source = 'msft' AND e.geom && ${env} AND ST_Intersects(${env}, ST_PointOnSurface(e.geom))
         AND NOT EXISTS (SELECT 1 FROM t_new n WHERE n.id = e.id)`;
    const [w] = await tx.$queryRawUnsafe<{ ins: bigint; upd: bigint }[]>(
      `WITH w AS (
         INSERT INTO extra_buildings (id, source, geom, height, min_height, height_src, height_3dg, area_m2, confidence, refreshed_on)
         SELECT n.id, 'msft', n.geom, n.height, 0, n.height_src, n.height_3dg, n.area_m2, n.confidence, $1::date
           FROM t_new n
          ORDER BY ST_GeoHash(ST_Centroid(n.geom), 8) -- vizinhos juntos no disco: tile lê menos páginas
         ON CONFLICT (id) DO UPDATE SET geom = EXCLUDED.geom, height = EXCLUDED.height, min_height = EXCLUDED.min_height,
                height_src = EXCLUDED.height_src, height_3dg = EXCLUDED.height_3dg, area_m2 = EXCLUDED.area_m2,
                confidence = EXCLUDED.confidence, refreshed_on = EXCLUDED.refreshed_on
          WHERE (extra_buildings.height, extra_buildings.height_src, extra_buildings.height_3dg, extra_buildings.area_m2, extra_buildings.confidence)
                IS DISTINCT FROM (EXCLUDED.height, EXCLUDED.height_src, EXCLUDED.height_3dg, EXCLUDED.area_m2, EXCLUDED.confidence)
         RETURNING (xmax = 0) AS ins)
       SELECT count(*) FILTER (WHERE ins) ins, count(*) FILTER (WHERE NOT ins) upd FROM w`,
      today,
    );
    Object.assign(stats, { inserted: Number(w.ins), updated: Number(w.upd), unchanged: Number(c.keep) - Number(w.ins) - Number(w.upd) });

    // --- diagnóstico: andares do OSM por faixa de área (base da heurística)
    stats.osmLevelsByArea = await tx.$queryRawUnsafe(
      `SELECT faixa, count(*)::int n, round(avg(levels)::numeric, 2)::float avg_levels,
              round(100.0 * count(*) FILTER (WHERE levels = 1) / count(*))::int pct_1, round(100.0 * count(*) FILTER (WHERE levels >= 4) / count(*))::int pct_4plus
         FROM (SELECT levels, CASE WHEN a < 80 THEN '1 <80' WHEN a < 150 THEN '2 80-150' WHEN a < 250 THEN '3 150-250' WHEN a < 500 THEN '4 250-500'
                                   WHEN a < 1000 THEN '5 500-1k' WHEN a < 3000 THEN '6 1k-3k' ELSE '7 >=3k' END faixa
                 FROM (SELECT levels, ST_Area(geom::geography) a FROM t_osm WHERE levels > 0) x) y
        GROUP BY faixa ORDER BY faixa`,
    );
    stats.osmBuildings = Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM t_osm`))[0].n);
  }, TX);
  // fora da transação: o DELETE + INSERT deixa tuplas mortas; VACUUM libera o espaço pro próximo import
  await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) extra_buildings`);
  console.log(`  gravado (${secs(t0)})`);
  return stats;
}

async function report(b: BBox) {
  const env = envelope(b);
  const inBox = Prisma.sql`source = 'msft' AND geom && ${env} AND ST_Intersects(${env}, ST_PointOnSurface(geom))`;
  const src = await prisma.$queryRaw<{ height_src: string; n: bigint; avg_h: number; with_3dg: bigint }[]>`
    SELECT height_src, count(*) n, round(avg(height)::numeric, 2)::float avg_h, count(height_3dg) with_3dg FROM extra_buildings WHERE ${inBox} GROUP BY 1 ORDER BY 1`;
  const hist = await prisma.$queryRaw<{ faixa: string; n: bigint }[]>`
    SELECT CASE WHEN height <= 3.5 THEN '<=3,5' WHEN height <= 4 THEN '4' WHEN height <= 5 THEN '4,5-5' WHEN height <= 6 THEN '5,5-6'
                WHEN height <= 8 THEN '6,5-8' WHEN height <= 10 THEN '8,5-10' WHEN height <= 12 THEN '10,5-12' WHEN height <= 20 THEN '12,5-20' ELSE '>20' END faixa,
           count(*) n
      FROM extra_buildings WHERE ${inBox} GROUP BY 1 ORDER BY min(height)`;
  const h3 = await prisma.$queryRaw<{ faixa: string; n: bigint }[]>`
    SELECT CASE WHEN height_3dg < 5 THEN '<5' WHEN height_3dg < 8 THEN '5-8' WHEN height_3dg < 10 THEN '8-10' WHEN height_3dg < 12 THEN '10-12'
                WHEN height_3dg < 15 THEN '12-15' WHEN height_3dg < 25 THEN '15-25' ELSE '>=25' END faixa, count(*) n
      FROM extra_buildings WHERE ${inBox} AND height_3dg IS NOT NULL GROUP BY 1 ORDER BY min(height_3dg)`;
  const [size] = await prisma.$queryRaw<{ rows: bigint; table_sz: string; idx_sz: string; all_sz: string }[]>`
    SELECT count(*) rows, pg_size_pretty(pg_relation_size('extra_buildings')) table_sz, pg_size_pretty(pg_indexes_size('extra_buildings')) idx_sz,
           pg_size_pretty(pg_total_relation_size('extra_buildings')) all_sz FROM extra_buildings`;
  return { src, hist, h3, size };
}

async function main() {
  const bbox = parseBBox(arg('bbox', DEFAULT_BBOX)!);
  const only = arg('only');
  const refetch = flag('refetch');
  const use3dg = flag('with-3dg');
  const mode = (arg('height', 'auto') as HeightMode) ?? 'auto';
  if (!['auto', '3dglobfp', 'heuristic'].includes(mode)) throw new Error(`--height ${mode}: use auto, 3dglobfp ou heuristic`);
  const overlap = Number(arg('overlap', '0.2'));
  if (!(overlap > 0 && overlap < 1)) throw new Error('--overlap entre 0 e 1');
  const t0 = Date.now();

  let msFiles: MsFile[] = [];
  let g3dBases: string[] = [];
  if (only !== 'load') {
    msFiles = await fetchMsft(bbox, refetch);
    await fetchOsm(bbox, refetch, await resolveOsmDate(arg('osm-date', 'ofm')!));
    if (use3dg) g3dBases = await fetchG3d(bbox, refetch);
    if (only === 'fetch') return;
  } else {
    // --only load: usa o que já está em data/geo
    const meta = JSON.parse(fs.readFileSync(path.join(MS_DIR, 'files.json'), 'utf8')) as Record<string, string>;
    msFiles = Object.keys(meta).map((f) => ({ file: path.join(MS_DIR, f), url: meta[f], location: '?', quadkey: f.replace(/[-.].*$/, ''), uploadDate: '?' }));
    const want = new Set(bboxQuadkeys(bbox, 9));
    msFiles = msFiles.filter((f) => want.has(f.quadkey));
    if (use3dg) g3dBases = await fetchG3d(bbox, false);
  }

  let t = Date.now();
  const ms = await readMsft(msFiles, bbox);
  console.log(`msft: ${ms.lines} footprints nos arquivos, ${ms.rows.length} tocam o bbox (${secs(t)})`);
  const osm = readOsm(bbox);
  console.log(`osm: ${osm.rows.length} prédios (OSM ${osm.osmDate ? `em ${osm.osmDate}` : (osm.osmBase ?? '?')})`);
  t = Date.now();
  let g3d: G3dRow[] = [];
  for (const base of g3dBases) {
    // margem de ~200 m: prédio na borda do bbox ainda acha o vizinho do 3D-GloBFP
    const r = readG3d(base, grow(bbox, 0.002));
    g3d = g3d.concat(r.rows);
    console.log(`3dglobfp: ${path.basename(base)}: ${r.total} registros, ${r.rows.length} no bbox (${secs(t)})`);
  }

  const stats = await load(bbox, mode, use3dg, overlap, ms.rows, osm.rows, g3d);
  const rep = await report(bbox);
  const out = { bbox, mode, overlap, ...stats, ...rep, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
