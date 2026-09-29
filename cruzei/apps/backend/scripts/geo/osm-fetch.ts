// Baixa do OSM (Overpass) os dados de um bbox, uma consulta por tema, e grava em data/geo/osm-<tema>.json.
// Só leitura na rede; não toca no banco (o import.ts lê esses arquivos).
// Uso (em apps/backend):
//   npx ts-node --transpile-only scripts/geo/osm-fetch.ts                         # todos os temas, bbox de Uberlândia
//   npx ts-node --transpile-only scripts/geo/osm-fetch.ts --only areas,pois --bbox -48.40,-19.02,-48.15,-18.82
//   --mirror https://overpass-api.de/api/interpreter   (senão tenta os espelhos na ordem abaixo)
// Etiqueta do Overpass: uma consulta por vez, pausa entre temas, User-Agent próprio, sem repetir à toa.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DATA_DIR, DEFAULT_BBOX, arg, overpassBBox, parseBBox, type BBox } from './common';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'metch-geo-import/1.0 (catálogo de lugares do app Metch; contato: dev)';
const PAUSE_MS = 4_000;

const ADMIN = '["boundary"="administrative"]["admin_level"~"^(8|9|10)$"]';

/** tema → consulta Overpass QL ({{bbox}} = sul,oeste,norte,leste) */
const THEMES: Record<string, (b: BBox) => string> = {
  // bairros/setores/município: relações que cruzam o bbox + as que CONTÊM os cantos e o centro (município inteiro
  // sem fronteira dentro do bbox não vem no filtro por bbox). `out geom` traz a geometria completa dos membros.
  areas: (b) => {
    const pts = [
      [b.s, b.w],
      [b.s, b.e],
      [b.n, b.w],
      [b.n, b.e],
      [(b.s + b.n) / 2, (b.w + b.e) / 2],
    ];
    return `[out:json][timeout:300];
(
  rel${ADMIN}({{bbox}});
  way${ADMIN}["name"]({{bbox}});
  way["place"~"^(suburb|neighbourhood|quarter)$"]["name"]({{bbox}});
  rel["place"~"^(suburb|neighbourhood|quarter)$"]["name"]({{bbox}});
)->.inside;
(${pts.map(([la, lo]) => `is_in(${la},${lo});`).join(' ')})->.around;
rel(pivot.around)${ADMIN}->.aroundRels;
(.inside; .aroundRels;);
out geom;`;
  },
  // lugares públicos de noite, comida, cultura, parques e shoppings (só com nome); ways/relações viram o centro
  pois: () => `[out:json][timeout:300];
(
  nwr["amenity"~"^(bar|pub|nightclub|biergarten|restaurant|cafe|fast_food|food_court|ice_cream|theatre|cinema|arts_centre|events_venue|conference_centre|music_venue|karaoke_box|hookah_lounge|university|college)$"]["name"]({{bbox}});
  nwr["leisure"~"^(park|garden|dance|stadium|water_park|amusement_arcade|bowling_alley|escape_game|beach_resort)$"]["name"]({{bbox}});
  nwr["shop"="mall"]["name"]({{bbox}});
  nwr["tourism"~"^(museum|gallery|attraction|zoo|theme_park|viewpoint|aquarium)$"]["name"]({{bbox}});
  nwr["natural"="beach"]["name"]({{bbox}});
  nwr["place"="square"]["name"]({{bbox}});
  nwr["craft"~"^(brewery|distillery|winery)$"]["name"]({{bbox}});
);
out center tags;`,
  // ruas com nome (o import agrupa os trechos por nome + cidade)
  streets: () => `[out:json][timeout:300];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|road|service|track)(_link)?$"]["name"]({{bbox}});
out geom;`,
  // pontos de lugar (cidade, vila, bairro sem polígono…)
  places: () => `[out:json][timeout:120];
node["place"~"^(city|town|village|hamlet|suburb|neighbourhood|quarter|locality)$"]["name"]({{bbox}});
out;`,
};

async function overpass(query: string, mirrors: string[]): Promise<string> {
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of mirrors) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(360_000),
        });
        const text = await r.text();
        // o Overpass às vezes responde 200 com erro de runtime no JSON (remark) ou HTML de ocupado
        if (r.ok && text.trimStart().startsWith('{') && !/"remark":\s*"runtime error/.test(text)) return text;
        lastErr = `${url} → HTTP ${r.status} ${text.slice(0, 160).replace(/\s+/g, ' ')}`;
      } catch (e) {
        lastErr = `${url} → ${(e as Error).message}`;
      }
      console.warn(`  falhou: ${lastErr}`);
      await sleep(PAUSE_MS);
    }
    await sleep(15_000 * (attempt + 1));
  }
  throw new Error(`Overpass indisponível: ${lastErr}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const bbox = parseBBox(arg('bbox', DEFAULT_BBOX)!);
  const only = (arg('only') ?? Object.keys(THEMES).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const mirror = arg('mirror');
  const mirrors = mirror ? [mirror] : MIRRORS;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const [i, theme] of only.entries()) {
    const q = THEMES[theme];
    if (!q) throw new Error(`tema desconhecido "${theme}" (temas: ${Object.keys(THEMES).join(', ')})`);
    if (i > 0) await sleep(PAUSE_MS);
    const t0 = Date.now();
    const text = await overpass(q(bbox).split('{{bbox}}').join(overpassBBox(bbox)), mirrors);
    const json = JSON.parse(text) as { elements: unknown[]; osm3s?: { timestamp_osm_base?: string } };
    const out = path.join(DATA_DIR, `osm-${theme}.json`);
    // bbox junto do dado: o import confere que o arquivo é do bbox pedido
    fs.writeFileSync(`${out}.tmp`, JSON.stringify({ bbox, fetchedAt: new Date().toISOString(), osmBase: json.osm3s?.timestamp_osm_base ?? null, elements: json.elements }));
    fs.renameSync(`${out}.tmp`, out);
    console.log(`${theme}: ${json.elements.length} elementos (${Math.round(text.length / 1024)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s, OSM ${json.osm3s?.timestamp_osm_base ?? '?'})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
