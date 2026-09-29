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
