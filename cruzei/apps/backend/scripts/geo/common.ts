import * as path from 'node:path';

/** Uberlândia e arredores (oeste, sul, leste, norte) — `--bbox` troca pra expandir depois */
export const DEFAULT_BBOX = '-48.40,-19.02,-48.15,-18.82';
export const DATA_DIR = path.resolve(__dirname, '..', '..', 'data', 'geo');

/** código IBGE (2 primeiros dígitos) → UF */
export const UF_BY_IBGE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export interface BBox {
  w: number;
  s: number;
  e: number;
  n: number;
}

/** `--nome valor` ou `--nome=valor`; flag sem valor vira 'true' */
export function arg(name: string, fallback?: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

export function flag(name: string): boolean {
  return arg(name) === 'true';
}

export function parseBBox(s: string): BBox {
  const [w, so, e, n] = s.split(',').map(Number);
  if (![w, so, e, n].every(Number.isFinite) || !(w < e && so < n)) throw new Error(`bbox inválido "${s}": use oeste,sul,leste,norte`);
  return { w, s: so, e, n };
}

/** bbox no formato do Overpass: sul,oeste,norte,leste */
export function overpassBBox(b: BBox): string {
  return `${b.s},${b.w},${b.n},${b.e}`;
}

/** data local de Brasília (AAAA-MM-DD), a mesma que o backend usa pra "dia" */
export function todayBrazil(now = new Date()): string {
  return new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * palavras que não identificam o lugar: saem do nome antes de comparar ("PH Veículos" x "WJ Veículos",
 * "Bella Restaurante" x "Restaurante Bela Brasa" não são o mesmo lugar só por dividir a palavra comum)
 */
export const GENERIC_WORDS = [
  'de', 'do', 'da', 'dos', 'das', 'e', 'the', 'o', 'a', 'uberlandia', 'udi', 'mg', 'shopping', 'center', 'centro', 'loja', 'lojas',
  'unidade', 'filial', 'restaurante', 'bar', 'lanchonete', 'lanches', 'pizzaria', 'churrascaria', 'cafe', 'cafeteria', 'sorveteria',
  'padaria', 'panificadora', 'confeitaria', 'veiculos', 'negocios', 'imobiliarios', 'imobiliaria', 'imoveis', 'grupo', 'espaco', 'casa',
];

/** SQL: "núcleo" de um nome já normalizado (f_norm), sem as palavras genéricas */
export function coreSql(normExpr: string): string {
  // \m e \M: começo e fim de palavra na regex do Postgres
  return `btrim(regexp_replace(regexp_replace(${normExpr}, '\\m(${GENERIC_WORDS.join('|')})\\M', '', 'g'), '\\s+', ' ', 'g'))`;
}

// ---------------------------------------------------------------------------------------------
// Overpass (osm-fetch.ts e buildings-msft.ts). Etiqueta: uma consulta por vez, pausa entre tentativas, User-Agent próprio.
// ---------------------------------------------------------------------------------------------

export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const OVERPASS_UA = 'metch-geo-import/1.0 (catálogo de lugares do app Metch; contato: dev)';
export const OVERPASS_PAUSE_MS = 4_000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * texto JSON da resposta; tenta os espelhos na ordem, 3 rodadas com espera crescente. `minBase` (ISO): recusa espelho
 * com base de dados mais velha que isso (há espelho parado meses atrás; consulta [date:] nele devolve o OSM velho).
 */
export async function overpass(query: string, mirrors: string[] = OVERPASS_MIRRORS, minBase?: string): Promise<string> {
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of mirrors) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': OVERPASS_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(360_000),
        });
        const text = await r.text();
        // o Overpass às vezes responde 200 com erro de runtime no JSON (remark) ou HTML de ocupado
        const base = text.slice(0, 2000).match(/"timestamp_osm_base":\s*"([^"]+)"/)?.[1];
        const stale = minBase && (!base || Date.parse(base) < Date.parse(minBase));
        if (r.ok && !stale && text.trimStart().startsWith('{') && !/"remark":\s*"runtime error/.test(text)) return text;
        lastErr = stale ? `${url} → base do OSM ${base ?? '?'} mais velha que ${minBase}` : `${url} → HTTP ${r.status} ${text.slice(0, 160).replace(/\s+/g, ' ')}`;
      } catch (e) {
        lastErr = `${url} → ${(e as Error).message}`;
      }
      console.warn(`  falhou: ${lastErr}`);
      await sleep(OVERPASS_PAUSE_MS);
    }
    await sleep(15_000 * (attempt + 1));
  }
  throw new Error(`Overpass indisponível: ${lastErr}`);
}
