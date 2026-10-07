// Anatomia do avatar: métricas do corpo por tipo, juntas/pivôs do esqueleto, repouso de cada pessoa, geometria da
// cabeça por formato de rosto (e posição dos traços por tipo de olho, sobrancelha e nariz) e helpers de contorno que as
// partes (roupas, cabelo, chapéus…) usam pra desenhar EM CIMA do corpo sem números mágicos.
// Dono: diretor de arte. Direção visual e regras: STYLE.md (mesma pasta).
//
// Proporção (corpo "regular", estatura 1): ~5 cabeças de ADULTO. Crânio de y≈11,9 ao queixo y=36,3 (cabeça ≈ 24,4),
// olhos na metade da cabeça, ombros ≈ 2× a largura das maçãs, cintura em y≈65,2, junta do quadril y≈74,8 (sai da
// proporção da perna de cada corpo, BodySpec.leg), joelho y≈100,9 (canela ≈ coxa), tornozelo y≈128,5, sola em y=134 e
// chão em y=135 (o mapa depende disso). A estatura de cada tipo de corpo estica a figura em volta da sola (0,955–1,05):
// os pés nunca saem do lugar. O pé é um volume 3D pequeno projetado na câmera do avatar (footFrame/footHull).
//
// REPOUSO POR PESSOA (restOf): a pose zero() continua neutra (tudo 0), mas a geometria de repouso muda por pessoa —
// contrapposto sem "X" (peso numa perna, quadril inclinado ~5°, ombro em contra-inclinação, pélvis pro lado do apoio,
// joelho livre só um pouco pra dentro e calcanhar dele erguido) e o que cada braço faz (solto, mão na cintura, mão
// apoiada na frente da coxa, polegar no passante). O braço tem comprimento fixo (dois ossos, ik2).
// A variante sai de um hash dos traços de identidade (corpo + rosto), então a pessoa mantém o jeito de ficar em pé
// quando troca de roupa. Quando a cena ocupa as mãos (volante, guidão, pet no colo, objeto, bandeirinha) ou o avatar
// está montado/sentado, o braço envolvido volta pro "solto" (as poses da cena e dos itens partem dele).
// Quem veste usa os contornos daqui e acompanha o repouso automaticamente.
//
// Contrato:
//   - tudo em unidades do viewBox 0 0 100 140;
//   - as funções de contorno devolvem paths SVG no espaço do GRUPO onde a peça vai (braço em armX, antebraço em foreX,
//     coxa em legX, canela/pé em shinX, tronco em body, cabeça em head) — o espaço do grupo é o do avatar em repouso;
//   - `ease` (folga) afasta o contorno pra fora em unidades (roupa por cima da pele: 0,4–1,2; negativo encolhe);
//   - lado 'L' = esquerda da tela.

import type { AvatarConfig, AvatarPetPose } from '@cruzei/shared-types';

import { ellipse, fmt } from './geometry';
import { hatFlattensCrest, hatLiftOf } from './parts/hat-modes';
import type { AvatarRig, AvatarSceneInfo, Pt } from './types';

export type Side = 'L' | 'R';

/**
 * quanto o tronco desce quando o avatar está sentado (cadeira de rodas); a pose da cena soma isso em body.dy. O quadril
 * fica na altura do joelho (coxa vindo pra frente, horizontal), a cabeça desce ~22 em relação à pessoa em pé.
 */
export const SEAT_DROP = 22;

/**
 * quanto o tronco desce sentado PRA ESTA PESSOA: perna longa (esguio, atlético) senta ~0,8–1,3 mais fundo (o quadril
 * fica na altura do joelho dela). Pedido ao dono do scene.ts: guardar isto em `scene.seatDrop` (resolveScene) e somar
 * em body.dy no lugar do SEAT_DROP fixo; a anatomia já lê `scene.seatDrop` quando ele existe (sem ele, SEAT_DROP).
 */
export function seatDropFor(cfg: Partial<Pick<AvatarConfig, 'body'>>): number {
  const leg = bodySpec(cfg.body).leg;
  return SEAT_DROP + Math.max(0, Math.min(1.5, (leg - 0.485) * 110));
}

/** queda do tronco sentado que a cena aplica (scene.seatDrop quando existir; senão o SEAT_DROP fixo) */
function seatDropOf(scene: Partial<AvatarSceneInfo> | null | undefined): number {
  const v = (scene as { seatDrop?: number } | null | undefined)?.seatDrop;
  return typeof v === 'number' && Number.isFinite(v) ? v : SEAT_DROP;
}

/** sentado: a sola fica no apoio de pé, um pouco acima do chão */
export const SEAT_SOLE_Y = 132.4;

/** sola e chão (fixos pra todo tipo de corpo) */
export const SOLE_Y = 134;
export const GROUND_Y = 135;

/**
 * escala extra da cabeça sugerida pro raster do mapa (figura de ~48 px): o grupo 'head' inteiro (rosto, cabelo, chapéu)
 * cresce em volta do pivô da cabeça. Pedido ao dono do draw.ts; o desenho do rosto já engrossa os traços no 'lite'.
 */
export const MAP_HEAD_SCALE = 1.24;

// ---------------------------------------------------------------------------------------------------------------
// Paths suaves (Catmull-Rom → Bézier), traços afilados e deslocamento de contorno
// ---------------------------------------------------------------------------------------------------------------

/** ponto de contorno: [x, y] ou [x, y, s] — s = suavidade naquele ponto (1 padrão, 0 = quina viva) */
export type SP = readonly [number, number] | readonly [number, number, number];

const sOf = (p: SP, d: number): number => (p.length > 2 ? (p[2] as number) : d);

/**
 * Path suave que passa por todos os pontos (spline de Catmull-Rom convertida em Béziers cúbicas).
 * `s` = suavidade global (1 = Catmull-Rom padrão; 0 = polígono). Ponto com 3º valor 0 vira quina.
 */
export function smoothPath(pts: readonly SP[], closed = true, s = 1): string {
  const n = pts.length;
  if (n < 2) return '';
  const P = (i: number): SP => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const s1 = sOf(p1, s) / 6;
    const s2 = sOf(p2, s) / 6;
    const c1x = p1[0] + (p2[0] - p0[0]) * s1;
    const c1y = p1[1] + (p2[1] - p0[1]) * s1;
    const c2x = p2[0] - (p3[0] - p1[0]) * s2;
    const c2y = p2[1] - (p3[1] - p1[1]) * s2;
    d += `C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2[0])},${fmt(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}

/** ponto da spline de Catmull-Rom entre p1 e p2 (t 0..1) */
function crAt(p0: SP, p1: SP, p2: SP, p3: SP, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, e: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** amostra uma spline aberta pelos pontos em `n` pontos igualmente espaçados no parâmetro */
export function sampleSpline(pts: readonly SP[], n: number): Pt[] {
  if (pts.length === 1) return [[pts[0][0], pts[0][1]]];
  const P = (i: number): SP => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const segs = pts.length - 1;
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const u = (k / (n - 1)) * segs;
    const i = Math.min(segs - 1, Math.floor(u));
    out.push(crAt(P(i - 1), P(i), P(i + 1), P(i + 2), u - i));
  }
  return out;
}

/**
 * Traço afilado como FORMA preenchida (cílio, sobrancelha, mecha de cabelo, dobra de tecido, vinco).
 * `spine` = pontos do eixo; `w` = espessura no início, (meio,) fim — ou função de t 0..1; pontas finas por padrão.
 * `round` arredonda as pontas (senão afinam até 0 nos extremos quando a espessura lá é 0).
 */
export function taperPath(spine: readonly SP[], w: readonly number[] | ((t: number) => number), opts: { n?: number; round?: boolean } = {}): string {
  // amostras proporcionais ao comprimento (traço curto não precisa de 12 Béziers por lado)
  let len = 0;
  for (let i = 1; i < spine.length; i++) len += Math.hypot(spine[i][0] - spine[i - 1][0], spine[i][1] - spine[i - 1][1]);
  const n = Math.max(3, opts.n ?? Math.min(12, Math.max(4 + spine.length, Math.round(4 + len / 1.4))));
  const pts = sampleSpline(spine, n);
  const wf =
    typeof w === 'function'
      ? w
      : (t: number) => {
          if (w.length === 1) return w[0];
          const u = t * (w.length - 1);
          const i = Math.min(w.length - 2, Math.floor(u));
          return w[i] + (w[i + 1] - w[i]) * (u - i);
        };
  const left: SP[] = [];
  const right: SP[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const hw = Math.max(0, wf(i / (n - 1))) / 2;
    left.push([pts[i][0] - dy * hw, pts[i][1] + dx * hw]);
    right.push([pts[i][0] + dy * hw, pts[i][1] - dx * hw]);
  }
  const round = !!opts.round;
  const tip = (p: Pt): SP => (round ? p : [p[0], p[1], 0]);
  const out: SP[] = [tip(pts[0]), ...left.slice(1, -1), tip(pts[n - 1]), ...right.slice(1, -1).reverse()];
  return smoothPath(out, true);
}

/** área com sinal (positiva = horário na tela, y pra baixo) */
function signedArea(pts: readonly SP[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** desloca um contorno fechado `d` unidades pra fora (normal aproximada pelos vizinhos); preserva a suavidade */
export function offsetPts(pts: readonly SP[], d: number): SP[] {
  if (!d) return pts.slice();
  const cw = signedArea(pts) > 0;
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    tx /= L;
    ty /= L;
    // horário na tela: a normal pra fora é (ty, -tx)
    const nx = cw ? -ty : ty;
    const ny = cw ? tx : -tx;
    return p.length > 2 ? ([p[0] - nx * d, p[1] - ny * d, p[2] as number] as SP) : ([p[0] - nx * d, p[1] - ny * d] as SP);
  });
}

/** espelha pontos em volta do eixo x = cx (ordem invertida, pra manter o sentido do contorno) */
export function mirrorPts(pts: readonly SP[], cx: number): SP[] {
  return pts.map((p) => (p.length > 2 ? ([2 * cx - p[0], p[1], p[2] as number] as SP) : ([2 * cx - p[0], p[1]] as SP))).reverse();
}

/** 0..1 determinístico (FNV-1a) — sementes de variação por pessoa */
export function hashUnit(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}

// ---------------------------------------------------------------------------------------------------------------
// Tipos de corpo
// ---------------------------------------------------------------------------------------------------------------

/** medidas de um tipo de corpo: meias-larguras (do eixo até a borda) e estatura */
export interface BodySpec {
  id: string;
  /** estatura: escala vertical em volta da sola (1 = padrão) */
  k: number;
  neck: number;
  /** borda externa do deltoide */
  shoulder: number;
  /** caixa torácica (axila) */
  chest: number;
  waist: number;
  /** barriga/flanco (somado à cintura um pouco abaixo dela) */
  belly: number;
  hip: number;
  upperArm: number;
  elbow: number;
  forearm: number;
  wrist: number;
  /** escala da mão */
  hand: number;
  thigh: number;
  knee: number;
  calf: number;
  ankle: number;
  /** distância do eixo ao centro da perna no quadril */
  legSep: number;
  /** volume do peito 0..1 (peitoral/busto, neutro): muda o perfil lateral e a sombra embaixo do peito */
  chestVol: number;
  /** queda extra do ombro (trapézio mais inclinado), em unidades */
  slope: number;
  /**
   * proporção da perna: (sola − junta do quadril) / altura nominal (122). 0,46 (perna mais curta, tronco longo) …
   * 0,50 (perna longa). Muda a altura da cintura, do quadril, do gancho e do joelho.
   */
  leg: number;
  /** escala do pé (calçado) */
  foot: number;
  /** relevo muscular 0..1 (deltoide, peitoral, panturrilha marcados por sombra de forma) */
  muscle: number;
  /** espessura do trapézio na base do pescoço (corpo largo: trapézio mais espesso e inclinado) */
  trap: number;
}

/**
 * Seis silhuetas com diferenças reais de largura, volume, proporção de perna e estatura — nenhuma associada a gênero.
 * Medidas em meia-largura (unidades do viewBox).
 *   slim      esguio e alto, ombro estreito, membros finos, perna longa
 *   regular   médio
 *   broad     estrutura grande: pescoço grosso, tronco quase sem cintura, mãos e pés maiores
 *   plus      volume no corpo todo, barriga e quadril cheios, ombro macio, perna mais curta
 *   curvy     cintura marcada, quadril e coxas cheios, mais baixo
 *   athletic  V marcado: ombro e peitoral largos, cintura enxuta, quadril estreito, panturrilha alta; o mais alto
 */
export const BODY_SPECS: Record<string, BodySpec> = {
  // ombros de adulto: ~2,2 (esguio) … 2,8 (largo/atlético) larguras de cabeça; pescoço fino (0,6–0,7 da mandíbula no
  // esguio, curvilíneo e médio; ~0,8 só no largo/atlético: NECK_JAW); o antebraço nunca é mais grosso que o bíceps
  // (cotovelo com "cintura" ≈ 0,8 do braço). Estatura 0,953 (curvilíneo) … 1,045 (atlético): ~11 de diferença no topo
  // da cabeça, visível lado a lado sem sair do viewBox
  slim: { id: 'slim', k: 1.04, leg: 0.497, neck: 3.8, shoulder: 16.6, chest: 12.0, waist: 9.6, belly: 0, hip: 11.2, upperArm: 2.75, elbow: 2.1, forearm: 2.45, wrist: 1.55, hand: 1.1, thigh: 4.9, knee: 3.15, calf: 3.5, ankle: 1.85, legSep: 5.2, chestVol: 0.1, slope: 0.7, foot: 0.98, muscle: 0, trap: 0 },
  regular: { id: 'regular', k: 1, leg: 0.485, neck: 4.1, shoulder: 18.6, chest: 14.3, waist: 11.9, belly: 0.3, hip: 13.0, upperArm: 3.45, elbow: 2.65, forearm: 3.0, wrist: 1.8, hand: 1.17, thigh: 6.0, knee: 3.7, calf: 4.1, ankle: 2.1, legSep: 6.1, chestVol: 0.35, slope: 0.4, foot: 1, muscle: 0.2, trap: 0.2 },
  broad: { id: 'broad', k: 1.03, leg: 0.47, neck: 5.2, shoulder: 21.2, chest: 18.4, waist: 17.2, belly: 1.2, hip: 15.8, upperArm: 4.8, elbow: 3.75, forearm: 3.75, wrist: 2.4, hand: 1.34, thigh: 7.4, knee: 4.5, calf: 5.1, ankle: 2.65, legSep: 7.4, chestVol: 0.5, slope: 1.25, foot: 1.09, muscle: 0.3, trap: 1.3 },
  plus: { id: 'plus', k: 0.958, leg: 0.462, neck: 4.6, shoulder: 19.4, chest: 17.6, waist: 18.2, belly: 3.0, hip: 19.0, upperArm: 5.2, elbow: 4.05, forearm: 3.95, wrist: 2.35, hand: 1.25, thigh: 9.0, knee: 5.1, calf: 5.7, ankle: 2.8, legSep: 8.7, chestVol: 0.7, slope: 1.0, foot: 1.03, muscle: 0, trap: 0.6 },
  curvy: { id: 'curvy', k: 0.953, leg: 0.478, neck: 3.8, shoulder: 16.8, chest: 14.4, waist: 10.2, belly: 0.25, hip: 17.4, upperArm: 3.55, elbow: 2.65, forearm: 2.9, wrist: 1.74, hand: 1.12, thigh: 7.9, knee: 4.05, calf: 4.65, ankle: 2.15, legSep: 7.9, chestVol: 0.75, slope: 0.8, foot: 0.96, muscle: 0, trap: 0 },
  athletic: { id: 'athletic', k: 1.045, leg: 0.492, neck: 4.85, shoulder: 21.6, chest: 17.6, waist: 11.2, belly: 0, hip: 12.6, upperArm: 4.85, elbow: 3.35, forearm: 3.8, wrist: 2.1, hand: 1.25, thigh: 6.6, knee: 3.95, calf: 5.35, ankle: 2.2, legSep: 6.0, chestVol: 0.55, slope: 0.1, foot: 1.04, muscle: 1, trap: 0.9 },
};

/**
 * teto da largura do pescoço em relação à meia-largura da mandíbula (no gônio), por tipo de corpo: pescoço da largura da
 * mandíbula vira tubo/"polegar" e masculiniza; só o largo e o atlético chegam a ~0,8
 */
export const NECK_JAW: Record<string, number> = { slim: 0.64, curvy: 0.64, regular: 0.7, plus: 0.74, broad: 0.8, athletic: 0.8 };

export function bodySpec(id: string | null | undefined): BodySpec {
  return (id && BODY_SPECS[id]) || BODY_SPECS.regular;
}

// ---------------------------------------------------------------------------------------------------------------
// Cabeça (formato do rosto) e posição dos traços
// ---------------------------------------------------------------------------------------------------------------

/** medidas do rosto relativas ao centro da cabeça (hc = [cx, hy]) numa cabeça unitária; meias-larguras */
export interface FaceSpec {
  id: string;
  /** largura do crânio (acima da sobrancelha) */
  cranium: number;
  temple: number;
  /** maçãs do rosto (zigomático) e a altura delas */
  cheek: number;
  cheekY: number;
  /** ângulo da mandíbula: meia-largura, altura e quão marcado ele é (0 macio … 1 anguloso) */
  jaw: number;
  jawY: number;
  jawSharp: number;
  chinW: number;
  /** y da ponta do queixo (relativo a hy) */
  chinY: number;
  /** queixo reto (quadrado) em vez de arredondado */
  flatChin?: boolean;
  /** ajustes de posição dos traços (unidades da cabeça): olhos, boca e largura da boca */
  eyeDy: number;
  mouthW: number;
}

/**
 * Seis formatos com silhueta própria (contorno numa spline única, tangente contínua). O maxilar (jaw/jawY/jawSharp) é
 * controlado separado das maçãs (cheek/cheekY): é isso que dá estrutura óssea.
 */
export const FACE_SPECS: Record<string, FaceSpec> = {
  // rosto ADULTO: olhos na metade da cabeça (topo do crânio → queixo), terço de baixo (nariz → queixo) maior que o do
  // meio, mandíbula com ângulo e queixo com plano — nada de bochecha de criança. Rodada 5: queixo 0,25 mais longo em
  // todos e mais largo no coração e no diamante (queixo pontudo e curto lia adolescente). Correção final: contraste
  // maior entre os formatos (redondo mais largo e curto, longo mais estreito e comprido, coração de queixo fino, quadrado
  // com o ângulo da mandíbula quase na linha da maçã, diamante de testa estreita) — cada um tem de se ler no busto de 56 px
  oval: { id: 'oval', cranium: 8.25, temple: 8, cheek: 8.25, cheekY: 2.2, jaw: 7.0, jawY: 8.5, jawSharp: 0.38, chinW: 2.65, chinY: 13.05, eyeDy: 0, mouthW: 0 },
  // redondo: largo nas maçãs, mandíbula macia que já começa a fechar alto (U), queixo pequeno — nada de "buldogue"
  round: { id: 'round', cranium: 8.75, temple: 8.7, cheek: 9.45, cheekY: 2.8, jaw: 8.1, jawY: 7.5, jawSharp: 0.05, chinW: 3.3, chinY: 11.85, eyeDy: 0.15, mouthW: -0.1 },
  // quadrado: ângulo da mandíbula marcado mas um pouco DENTRO da maçã (jaw ≈ cheek − 0,6) e queixo que recua depois do
  // gônio (largo e reto, mas não uma caixa)
  square: { id: 'square', cranium: 8.45, temple: 8.4, cheek: 8.6, cheekY: 2.2, jaw: 8.1, jawY: 9.3, jawSharp: 1, chinW: 3.75, chinY: 13.2, flatChin: true, eyeDy: 0, mouthW: 0.2 },
  heart: { id: 'heart', cranium: 9.0, temple: 8.9, cheek: 8.45, cheekY: 1.8, jaw: 5.8, jawY: 8.4, jawSharp: 0.25, chinW: 1.75, chinY: 13.4, eyeDy: -0.1, mouthW: -0.25 },
  long: { id: 'long', cranium: 7.6, temple: 7.4, cheek: 7.7, cheekY: 3.0, jaw: 6.75, jawY: 10.5, jawSharp: 0.5, chinW: 2.85, chinY: 14.55, eyeDy: -0.1, mouthW: 0 },
  diamond: { id: 'diamond', cranium: 7.25, temple: 7.0, cheek: 9.1, cheekY: 2.3, jaw: 6.4, jawY: 9.0, jawSharp: 0.55, chinW: 2.0, chinY: 13.7, eyeDy: 0, mouthW: -0.05 },
};

export function faceSpec(id: string | null | undefined): FaceSpec {
  return (id && FACE_SPECS[id]) || FACE_SPECS.oval;
}

/** posição/tamanho dos olhos por tipo (cabeça unitária): espaçamento extra, altura e escala */
export const EYE_PLACE: Record<string, { dx: number; dy: number; size: number }> = {
  // escala POR TIPO (× EYE_SCALE): o redondo é o que mais "infantiliza", então é o menor no tamanho (0,85 no total)
  almond: { dx: 0, dy: 0, size: 1 },
  round: { dx: -0.2, dy: 0.05, size: 0.97 },
  upturned: { dx: 0.15, dy: -0.08, size: 0.98 },
  downturned: { dx: 0.05, dy: 0.12, size: 0.98 },
  monolid: { dx: 0.5, dy: 0, size: 1.02 },
  hooded: { dx: 0.1, dy: 0.15, size: 0.95 },
};

/** escala geral dos olhos do adulto (olho menor em relação ao rosto que o de criança) */
export const EYE_SCALE = 0.94;

/** distância da sobrancelha ao olho por tipo (cabeça unitária) */
export const BROW_GAP: Record<string, number> = { soft: 2.4, thick: 2.15, thin: 2.7, arched: 2.65, straight: 2.1, bushy: 2.05 };

/** nariz por tipo: comprimento (ponta mais baixa = +) e meia-largura das asas (cabeça unitária) */
export const NOSE_PLACE: Record<string, { len: number; alar: number }> = {
  soft: { len: 0, alar: 2.05 },
  button: { len: -0.55, alar: 1.85 },
  straight: { len: 0.35, alar: 1.75 },
  wide: { len: 0.1, alar: 2.85 },
  aquiline: { len: 1.05, alar: 1.95 },
  small: { len: -0.7, alar: 1.55 },
};

/** lábios por tipo de nariz (dá variedade sem slot novo): espessura de cima/baixo e largura extra (cabeça unitária) */
export const LIP_PLACE: Record<string, { up: number; lo: number; w: number }> = {
  soft: { up: 0.72, lo: 1.0, w: 0 },
  button: { up: 0.7, lo: 0.98, w: -0.35 },
  straight: { up: 0.55, lo: 0.85, w: 0.15 },
  wide: { up: 0.95, lo: 1.25, w: 0.55 },
  aquiline: { up: 0.5, lo: 0.82, w: 0.25 },
  small: { up: 0.66, lo: 0.95, w: -0.5 },
};

/** topo do crânio relativo a hy (em unidades da cabeça: multiplique por an.head.s) */
export const CROWN_DY = -11.1;

/**
 * escala da cabeça: as medidas do rosto (FaceSpec, olhos, nariz, boca) são de uma cabeça "unitária" e multiplicam por
 * isto. 0,92 dá ~5,5 cabeças de altura (cabeça ≈ 22 do topo do crânio ao queixo): proporção ADULTA, sem cara de criança.
 * A leitura no mapa vem do MAP_HEAD_SCALE (a cabeça cresce só no raster do mapa) e do nível de detalhe 'lite'.
 */
export const HEAD_SCALE = 0.92;

/** altura nominal do corpo (topo do crânio → sola) usada pela proporção da perna (BodySpec.leg) */
export const NOMINAL_H = 122;

/** altura do tornozelo (pivô de baixo da canela) em pé, antes da estatura */
const ANKLE_Y = 128.5;

/**
 * o queixo fica sempre no mesmo lugar (em cima do pescoço); a cabeça cresce pra cima conforme o formato do rosto. 34,6
 * deixa ~1,7 a mais de pescoço visível que a rodada 3 (pescoço curto = cara de criança).
 */
const CHIN_Y = 34.6;

// ---------------------------------------------------------------------------------------------------------------
// Repouso por pessoa
// ---------------------------------------------------------------------------------------------------------------

/** o que o braço faz em repouso */
export type ArmRest = 'hang' | 'soft' | 'hip' | 'pocket' | 'lap';

export interface RestSpec {
  /** variante 0..7 (pra prova e testes) */
  id: number;
  /** perna de apoio (o quadril desse lado sobe e sai; o ombro desse lado desce) — null = postura simétrica */
  weight: Side | null;
  armL: ArmRest;
  armR: ArmRest;
  /** pés mais afastados */
  wide: boolean;
}

/**
 * 8 variantes: 5 com os DOIS braços soltos (~62%: o gesto de mão na cintura/no bolso/no passante não se repete no elenco
 * inteiro). A variante sai do hash dos traços de identidade (restOf).
 */
const REST_VARIANTS: readonly Omit<RestSpec, 'id'>[] = [
  { weight: 'R', armL: 'hang', armR: 'hang', wide: false },
  { weight: 'L', armL: 'hang', armR: 'hang', wide: false },
  { weight: 'L', armL: 'soft', armR: 'hang', wide: true },
  { weight: 'L', armL: 'hang', armR: 'pocket', wide: false },
  { weight: 'L', armL: 'hip', armR: 'hang', wide: false },
  { weight: 'R', armL: 'hang', armR: 'hang', wide: true },
  { weight: 'L', armL: 'hang', armR: 'hang', wide: true },
  { weight: 'R', armL: 'hang', armR: 'hang', wide: false },
];

type RestCfg = Partial<Pick<AvatarConfig, 'body' | 'faceShape' | 'eyes' | 'brows' | 'nose' | 'held' | 'pride'>>;

/**
 * repouso da pessoa: variante pelo hash dos traços de identidade (corpo + rosto) e restrições da cena (mãos ocupadas,
 * objeto na mão direita, bandeirinha na esquerda, montado/sentado → braço solto e postura simétrica).
 */
export function restOf(cfg: RestCfg, scene?: Partial<AvatarSceneInfo> | null): RestSpec {
  const key = `${cfg.body ?? 'regular'}|${cfg.faceShape ?? 'oval'}|${cfg.eyes ?? 'almond'}|${cfg.brows ?? 'soft'}|${cfg.nose ?? 'soft'}`;
  const id = Math.floor(hashUnit(key) * REST_VARIANTS.length) % REST_VARIANTS.length;
  const v: RestSpec = { id, ...REST_VARIANTS[id] };
  const sc = scene ?? null;
  const mounted = !!(sc && (sc.mount || sc.seated));
  const busyHands = !!(sc && sc.hands && sc.hands !== 'free');
  // sentado (cadeira) com as mãos livres: mãos apoiadas no colo
  if (sc && sc.seated && !busyHands) return { id, weight: null, armL: 'lap', armR: 'lap', wide: false };
  if (mounted || busyHands) return { id, weight: mounted ? null : v.weight, armL: 'hang', armR: 'hang', wide: false };
  const held = cfg.held && cfg.held !== 'none' && (sc ? sc.showHeld !== false : true);
  const flag = cfg.pride === 'flag' && (sc ? sc.showLeftHandFlag !== false : true);
  if (held) v.armR = 'hang';
  if (flag) v.armL = 'hang';
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// Anatomia montada
// ---------------------------------------------------------------------------------------------------------------

export interface Joints {
  shoulderL: Pt;
  shoulderR: Pt;
  elbowL: Pt;
  elbowR: Pt;
  wristL: Pt;
  wristR: Pt;
  hipL: Pt;
  hipR: Pt;
  kneeL: Pt;
  kneeR: Pt;
  ankleL: Pt;
  ankleR: Pt;
}

/** traços do rosto que mudam a geometria (vêm da config) */
export interface FaceFeatures {
  eyes: string;
  brows: string;
  nose: string;
  /** idade aparente 0 (sem marcas) · 0,5 (suaves) · 1 (marcadas) */
  age: number;
  /** variação fina determinística por pessoa (-1..1): espaçamento dos olhos, boca, assimetria */
  jit: { eye: number; mouth: number; brow: number; asym: number; size: number; lip: number; lipLo: number; nose: number };
}

export interface Anatomy {
  /** id do tipo de corpo (slim/regular/broad/plus/curvy/athletic) */
  bodyId: string;
  spec: BodySpec;
  face: FaceSpec;
  feat: FaceFeatures;
  rest: RestSpec;
  /** eixo vertical do corpo */
  cx: number;
  /** escala vertical da estatura (em volta da sola) */
  k: number;
  /** largura do tronco na caixa torácica (legado: = 2·chest) */
  torsoW: number;
  /** borda esquerda e direita do tronco na caixa torácica */
  x0: number;
  x1: number;
  /** cabeça: centro (cx, cy), meia-altura r (legado) e escala s. A forma real vem de headAnchors/headPath. */
  head: { cx: number; cy: number; r: number; s: number };
  /** pescoço: retângulo de referência (x, y = embaixo do queixo, w, h até a base) */
  neck: { x: number; y: number; w: number; h: number };
  /** topo dos ombros (linha do acrômio) */
  shoulderY: number;
  /** linha da axila */
  armpitY: number;
  /** cintura (a mais fina) */
  waistY: number;
  /** quadril (o mais largo) */
  hipY: number;
  /** base do tronco (gancho) */
  torsoBottom: number;
  /** decote careca (gola redonda): y no centro e meia-largura nos lados */
  collarY: number;
  collarW: number;
  joints: Joints;
  /** meias-larguras do tronco */
  w: { neck: number; shoulder: number; chest: number; waist: number; belly: number; hip: number };
  /** inclinação do quadril e do ombro em repouso (unidades: quanto o lado L sobe; negativo = L desce) */
  tilt: { hip: number; shoulder: number };
  /** cotovelos e pulsos do braço "solto" desta pessoa (base de restArmDelta) */
  hangArms: { elbowL: Pt; wristL: Pt; elbowR: Pt; wristR: Pt };
  arm: {
    /** largura da manga (legado) */
    w: number;
    /** largura do braço de pele (legado) */
    skinW: number;
    /** topo do braço */
    top: number;
    /** cotovelo (pivô do antebraço) — média dos dois lados */
    elbowY: number;
    /** pulso */
    wristY: number;
    /** base do antebraço (encontra a mão) */
    bottom: number;
    /** centro da mão (palma L) e raio aproximado */
    handY: number;
    handR: number;
    /** x do centro das palmas (o palco usa [xL, handY] / [xR, handY] como âncora das mãos) */
    xL: number;
    xR: number;
  };
  leg: {
    /** largura da coxa (legado) */
    w: number;
    /** topo da coxa (junta do quadril) */
    top: number;
    /** joelho (pivô da canela) */
    kneeY: number;
    /** tornozelo */
    bottom: number;
    /** borda esquerda de cada perna no quadril (legado) */
    xL: number;
    xR: number;
    /** centro de cada perna no quadril */
    cxL: number;
    cxR: number;
  };
  foot: {
    /** sola (base do pé) */
    soleY: number;
    /** chão (sombra) */
    groundY: number;
  };
  /** sentado: quanto o tronco desce (0 em pé) */
  seatDrop: number;
  seated: boolean;
  /**
   * proporção vertical do corpo: `hj` = junta do quadril em pé (já com estatura), `lowK` = quanto o tronco de baixo
   * (axila → gancho) estica ou encolhe em relação ao desenho de referência (perna longa = tronco mais curto)
   */
  hj: number;
  lowK: number;
  /** deslocamento lateral da pélvis pro lado da perna de apoio (o peso cai sobre o pé) */
  pelvis: number;
  /** comprimento do braço (ombro → cotovelo) e do antebraço (cotovelo → pulso), iguais em todo repouso */
  armLen: [number, number];
}

type AnatomyCfg = Pick<AvatarConfig, 'body'> & Partial<AvatarConfig>;

function featuresOf(cfg: Partial<AvatarConfig>): FaceFeatures {
  const lines = cfg.lines;
  const age = lines === 'marked' ? 1 : lines === 'soft' ? 0.5 : 0;
  const key = `${cfg.faceShape ?? 'oval'}|${cfg.eyes ?? 'almond'}|${cfg.brows ?? 'soft'}|${cfg.nose ?? 'soft'}`;
  const j = (salt: string) => hashUnit(key + '#' + salt) * 2 - 1;
  return {
    eyes: cfg.eyes && EYE_PLACE[cfg.eyes] ? cfg.eyes : 'almond',
    brows: cfg.brows && BROW_GAP[cfg.brows] != null ? cfg.brows : 'soft',
    nose: cfg.nose && NOSE_PLACE[cfg.nose] ? cfg.nose : 'soft',
    age,
    jit: { eye: j('e'), mouth: j('m'), brow: j('b'), asym: j('a'), size: j('s'), lip: j('lu'), lipLo: j('ll'), nose: j('n') },
  };
}

/**
 * desenho de referência → esta pessoa: o tronco de baixo (axila → gancho) estica ou encolhe conforme a proporção da
 * perna (BodySpec.leg) e tudo escala em volta da sola pela estatura. Acima da axila (pescoço, ombros) só a estatura.
 */
export function bodyY(an: Pick<Anatomy, 'k' | 'lowK'>, y: number): number {
  const r = y <= 50.5 ? y : 50.5 + (y - 50.5) * an.lowK;
  return SOLE_Y - (SOLE_Y - r) * an.k;
}

/**
 * dois ossos (ombro → cotovelo → pulso) com comprimentos fixos: o pulso vai o mais perto possível do alvo e o cotovelo
 * dobra pro lado `bendX` (−1 = esquerda da tela, +1 = direita). Assim o braço tem o mesmo tamanho em todo repouso.
 */
function ik2(a: Pt, t: Pt, l1: number, l2: number, bendX: number): { el: Pt; wr: Pt } {
  const dx = t[0] - a[0];
  const dy = t[1] - a[1];
  const d = Math.hypot(dx, dy) || 1e-6;
  const dc = Math.max(Math.abs(l1 - l2) + 0.5, Math.min((l1 + l2) * 0.998, d));
  const ux = dx / d;
  const uy = dy / d;
  const x = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let nx = -uy;
  let ny = ux;
  if (Math.sign(nx || 1) !== Math.sign(bendX)) {
    nx = -nx;
    ny = -ny;
  }
  return { el: [a[0] + ux * x + nx * h, a[1] + uy * x + ny * h], wr: [a[0] + ux * dc, a[1] + uy * dc] };
}

/** métricas pra uma config (tipo de corpo + rosto) e cena (sentado muda as pernas; mãos ocupadas mudam o repouso) */
export function buildAnatomy(cfg: AnatomyCfg, scene?: Partial<AvatarSceneInfo> | null): Anatomy {
  const sp = bodySpec(cfg.body);
  const fc = faceSpec(cfg.faceShape);
  const feat = featuresOf(cfg);
  const k = sp.k;
  const cx = 50;
  const seated = !!scene?.seated;
  const rest = restOf(cfg, scene);
  const wL = rest.weight === 'L' ? 1 : rest.weight === 'R' ? -1 : 0; // +1 = peso na perna esquerda

  // proporção vertical: a junta do quadril sai da proporção da perna; o tronco de baixo se ajusta (perna longa = tronco
  // mais curto). Y = desenho de referência → esta pessoa; YS = só a estatura (perna e pé têm medidas próprias)
  const hjN = SOLE_Y - sp.leg * NOMINAL_H;
  const lowK = (hjN - 50.5) / (76.6 - 50.5);
  const Y = (y: number) => bodyY({ k, lowK }, y);
  const YS = (y: number) => SOLE_Y - (SOLE_Y - y) * k;

  // a cabeça acompanha um pouco a estatura (k^0,7): corpo baixo não ganha cabeça proporcionalmente grande (cara de
  // criança) e todo tipo de corpo fica entre ~5,45 e ~5,6 cabeças
  const hs = HEAD_SCALE * Math.pow(k, 0.7);
  // pescoço: no máximo NECK_JAW (0,64–0,8) da largura da mandíbula no gônio (pescoço da largura da mandíbula vira tubo)
  const nk = Math.min(sp.neck, fc.jaw * hs * (NECK_JAW[sp.id] ?? 0.72) + 0.1);
  // idade: postura levemente assentada — ombro um pouco mais baixo e pra frente (mais estreito de frente), leve cifose
  // (cabeça 0,4 mais baixa: pescoço visível mais curto) e cintura um pouco mais cheia
  const age = feat.age;
  const hy = Y(CHIN_Y + age * 0.4) - fc.chinY * hs;
  const shoulderY = Y(42.5 + age * 0.3);
  const armpitY = Y(50.5);
  const waistY = Y(66.3);
  const hipY = Y(77);
  const crotchY = Y(81.8);
  const hj = Y(76.6);
  const kneeY = YS(hjN + (ANKLE_Y - hjN) * 0.48);
  // tornozelo: a bola do pé pousa na sola (y 134) com o pé do tamanho desta pessoa
  const ankleY = SOLE_Y - ankleAboveSole(footScale({ spec: sp, k, seated: false }));

  // contrapposto: quadril do lado do peso sobe ~5°, ombro do mesmo lado desce ~2,5°, a pélvis vai pro lado do apoio
  const hipTilt = wL * 1.45;
  // ombro do lado do apoio 0,8 mais baixo (contra-inclinação do contrapposto)
  const shTilt = -wL * 1.6;
  const pelvis = -wL * 1.2;

  const sideOf = (s: Side) => (s === 'L' ? -1 : 1);
  const shX = sp.shoulder - sp.upperArm - 0.15 - age * 0.25;
  const shYOf = (s: Side) => Y(45.6 + sp.slope * 0.45 + age * 0.3) - (s === 'L' ? shTilt : -shTilt) * 0.5;
  const shoulderOf = (s: Side): Pt => [cx + sideOf(s) * shX, shYOf(s)];
  // braço com comprimento fixo (ombro → cotovelo → pulso); o repouso só escolhe onde o pulso fica
  const L1 = 18.2 * k;
  const L2 = 15.6 * k;
  const DEG = Math.PI / 180;
  // dois ossos por ângulo: a1 = abertura do braço (graus, pra fora), a2 = antebraço voltando pra dentro (graus); k2 =
  // escorço do antebraço (1 = de lado; < 1 = vindo pra frente)
  const byAngles = (s: Side, a1: number, a2: number, k2 = 1): { el: Pt; wr: Pt } => {
    const g = sideOf(s);
    const sh = shoulderOf(s);
    const el: Pt = [sh[0] + g * L1 * Math.sin(a1 * DEG), sh[1] + L1 * Math.cos(a1 * DEG)];
    return { el, wr: [el[0] - g * L2 * k2 * Math.sin(a2 * DEG), el[1] + L2 * k2 * Math.cos(a2 * DEG)] };
  };
  // pulso do braço solto (alvo lateral, a partir do quadril): ~0,8–1,5 da lateral da coxa, um pouco À FRENTE da costura
  // da calça (o antebraço vem levemente pra frente). Quadril largo (curvilíneo) ou barriga cheia (plus): a mão ENCOSTA
  // na lateral do quadril, um pouco à frente (gapK → 0) — senão o braço abre como asa pra contornar o quadril
  const gapK = Math.max(0, Math.min(1, 1 - Math.max(0, sp.hip - sp.waist - 4) * 0.25 - sp.belly * 0.3));
  const hangTarget = (s: Side) => {
    const up = (s === 'L' ? hipTilt : -hipTilt) > 0;
    return sp.hip + sp.wrist + 0.75 + (0.95 + (up ? 0.9 : -0.2)) * gapK - (1 - gapK) * 0.6 - Math.min(1.4, sp.belly * 0.5);
  };
  const arm = (s: Side, kind: ArmRest): { el: Pt; wr: Pt } => {
    const g = sideOf(s);
    const sh = shoulderOf(s);
    const up = (s === 'L' ? hipTilt : -hipTilt) > 0; // lado do quadril que sobe (perna de apoio)
    switch (kind) {
      case 'hip': {
        // mão na cintura: pulso FORA da silhueta do tronco, em cima da crista ilíaca; o cotovelo vai pro lado (nunca cruza
        // o tronco). A mão desce pela LATERAL do quadril em escorço (dedos pra frente e pra baixo, polegar pra trás —
        // ver handShapes): nada de dedos descendo pela frente da barriga
        const t: Pt = [cx + g * (sp.waist + sp.belly * 0.85 + Math.max(0, sp.hip - sp.waist - 3) * 0.25 + 2.0) + pelvis * 0.4, Y(68.6)];
        return ik2(sh, t, L1, L2, g);
      }
      case 'pocket': {
        // polegar no bolso da frente, resolvido por ÂNGULOS (não por IK lateral): o braço quase cai reto (a1 9–14°,
        // cotovelo no máximo ~3 além do ombro) e o antebraço vem PRA FRENTE em escorço até a mão pousar na frente do
        // bolso, na parte de fora da coxa (só os dedos pendem diante do bolso; nada de mão na virilha)
        const a1 = 9 + Math.max(0, sp.waist + sp.belly - 12) * 0.35;
        const el: Pt = [sh[0] + g * L1 * Math.sin(a1 * DEG), sh[1] + L1 * Math.cos(a1 * DEG)];
        const tx = cx + g * (sp.legSep + sp.thigh * 0.45 + sp.belly * 0.3 + 2.1) + pelvis * 0.6;
        const ty = Y(75.6);
        let vx = tx - el[0];
        let vy = ty - el[1];
        const d = Math.hypot(vx, vy) || 1;
        if (d > L2) {
          vx = (vx / d) * L2;
          vy = (vy / d) * L2;
        }
        return { el, wr: [el[0] + vx, el[1] + vy] };
      }
      case 'lap': {
        // sentado: cotovelo ao lado da cintura, antebraço vindo pra frente e pra dentro (encurtado pela perspectiva) até
        // a mão pousar em cima da coxa — cotovelo a ~80° no espaço, ~50° de frente; nada de braço-tubo até o joelho
        const a1 = 9 + Math.max(0, sp.waist + sp.belly - 12) * 0.9;
        return byAngles(s, a1, 40, 0.86);
      }
      case 'soft': {
        // polegar no passante da FRENTE: o braço quase cai (a1 ~11°) e o antebraço vem pra frente em escorço até o polegar
        // enganchar no cós, um pouco pra dentro da lateral — gesto relaxado, diferente da mão na cintura (cotovelo não
        // abre em "asa")
        const a1 = 11 + Math.max(0, sp.waist + sp.belly - 12) * 0.5;
        const el: Pt = [sh[0] + g * L1 * Math.sin(a1 * DEG), sh[1] + L1 * Math.cos(a1 * DEG)];
        const tx = cx + g * (sp.waist + sp.belly * 0.7 + 0.4) + pelvis * 0.4;
        const ty = Y(71.6);
        let vx = tx - el[0];
        let vy = ty - el[1];
        const d = Math.hypot(vx, vy) || 1;
        if (d > L2) {
          vx = (vx / d) * L2;
          vy = (vy / d) * L2;
        }
        return { el, wr: [el[0] + vx, el[1] + vy] };
      }
      default: {
        // solto: braço quase reto ao lado do corpo. A dobra principal do cotovelo é pra FRENTE (escorço do antebraço,
        // k2 0,9); de frente, a dobra lateral fica em 15° (19° do lado do quadril alto) — nada de cotovelo espetado
        // ("pistoleiro") nem soldadinho. O braço abre ~6–10° no corpo médio (até ~20° no plus, contornando a barriga) e a
        // mão segue o antebraço com o pulso reto
        const bend = up ? 19 : 15;
        const k2 = 0.9;
        const dX = hangTarget(s) - shX + g * pelvis * 0.8;
        // L1·sen(a1) − L2·k2·sen(bend − a1) = dX (cresce com a1): bisseção
        let lo = 2;
        let hi = 45;
        for (let i = 0; i < 28; i++) {
          const a = (lo + hi) / 2;
          if (L1 * Math.sin(a * DEG) - L2 * k2 * Math.sin((bend - a) * DEG) < dX) lo = a;
          else hi = a;
        }
        const a1 = (lo + hi) / 2;
        return byAngles(s, a1, bend - a1, k2);
      }
    }
  };
  const aL = arm('L', rest.armL);
  const aR = arm('R', rest.armR);
  const hL = arm('L', 'hang');
  const hR = arm('R', 'hang');

  // pernas sem "X": a de apoio quase reta, com o pé embaixo do corpo; a livre com o joelho só um pouco pra dentro, o
  // tornozelo um pouco pra fora e o calcanhar levemente erguido (o relaxado vem da flexão, não do joelho valgo)
  const heelRaise = 0.6;
  const legOf = (s: Side): { hip: Pt; knee: Pt; ankle: Pt } => {
    const g = sideOf(s);
    const sep = sp.legSep;
    const wide = rest.wide ? 1.1 : 0;
    if (wL === 0) return { hip: [cx + g * sep, hj], knee: [cx + g * (sep - 0.2), kneeY], ankle: [cx + g * (sep + 0.2 + wide), ankleY] };
    const support = (s === 'L' && wL > 0) || (s === 'R' && wL < 0);
    const hipDy = support ? -Math.abs(hipTilt) : Math.abs(hipTilt);
    if (support) return { hip: [cx + g * (sep + 0.5) + pelvis, hj + hipDy], knee: [cx + g * (sep - 0.45) + pelvis * 0.5, kneeY - 0.2], ankle: [cx + g * (sep - 1.9 + wide * 0.5), ankleY] };
    return { hip: [cx + g * (sep - 0.25) + pelvis, hj + hipDy], knee: [cx + g * (sep - 1.2) + pelvis * 0.5, kneeY + 0.8], ankle: [cx + g * (sep + 1.0 + wide), ankleY - heelRaise] };
  };
  const lL = legOf('L');
  const lR = legOf('R');

  const joints: Joints = {
    shoulderL: shoulderOf('L'),
    shoulderR: shoulderOf('R'),
    elbowL: aL.el,
    elbowR: aR.el,
    wristL: aL.wr,
    wristR: aR.wr,
    hipL: lL.hip,
    hipR: lR.hip,
    kneeL: lL.knee,
    kneeR: lR.knee,
    ankleL: lL.ankle,
    ankleR: lR.ankle,
  };
  const seatDrop = seated ? seatDropOf(scene) : 0;
  if (seated) {
    // sentado: o quadril desce até a altura do joelho; a coxa vem pra frente (vista de cima, curta, com o colo
    // iluminado e o joelho redondo de frente pra gente) e a canela desce vertical até o pé no apoio. Perna longa
    // (esguio, atlético): o colo visto de cima fica mais comprido e a canela mais curta — senão parece em pé atrás da
    // cadeira
    const top = hj + seatDrop;
    const sep = sp.legSep + 0.3;
    const lap = 6.8 + Math.max(0, Math.min(1.2, (sp.leg - 0.48) * 70));
    joints.hipL = [cx - sep, top];
    joints.hipR = [cx + sep, top];
    joints.kneeL = [cx - sep - 0.4, top + lap];
    joints.kneeR = [cx + sep + 0.4, top + lap];
    const aY = SEAT_SOLE_Y - 0.6 - ankleAboveSole(footScale({ spec: sp, k, seated: true }));
    joints.ankleL = [cx - sep - 0.3, aY];
    joints.ankleR = [cx + sep + 0.3, aY];
  }

  const an: Anatomy = {
    bodyId: sp.id,
    spec: sp,
    face: fc,
    feat,
    rest,
    cx,
    k,
    torsoW: sp.chest * 2,
    x0: cx - sp.chest,
    x1: cx + sp.chest,
    head: { cx, cy: hy, r: 11.5 * hs, s: hs },
    neck: { x: cx - nk, y: Y(31.5), w: nk * 2, h: Y(41.5) - Y(31.5) },
    shoulderY,
    armpitY,
    waistY,
    hipY,
    torsoBottom: crotchY,
    collarY: Y(42.8),
    collarW: nk + 2.6 + sp.trap * 0.3,
    joints,
    w: { neck: nk, shoulder: sp.shoulder, chest: sp.chest, waist: sp.waist + age * 0.4, belly: sp.belly + age * 0.3, hip: sp.hip },
    tilt: { hip: hipTilt, shoulder: shTilt },
    hangArms: { elbowL: hL.el, wristL: hL.wr, elbowR: hR.el, wristR: hR.wr },
    arm: {
      w: sp.upperArm * 2 + 1,
      skinW: sp.upperArm * 2,
      top: Math.min(joints.shoulderL[1], joints.shoulderR[1]) - sp.upperArm,
      elbowY: (joints.elbowL[1] + joints.elbowR[1]) / 2,
      wristY: (joints.wristL[1] + joints.wristR[1]) / 2,
      bottom: (joints.wristL[1] + joints.wristR[1]) / 2 + 0.8,
      handY: 0,
      handR: 2.6 * sp.hand,
      xL: 0,
      xR: 0,
    },
    leg: {
      w: sp.thigh * 2,
      top: (joints.hipL[1] + joints.hipR[1]) / 2,
      kneeY: (joints.kneeL[1] + joints.kneeR[1]) / 2,
      bottom: (joints.ankleL[1] + joints.ankleR[1]) / 2,
      xL: joints.hipL[0] - sp.thigh,
      xR: joints.hipR[0] - sp.thigh,
      cxL: joints.hipL[0],
      cxR: joints.hipR[0],
    },
    foot: { soleY: seated ? SEAT_SOLE_Y : SOLE_Y, groundY: GROUND_Y },
    seatDrop,
    seated,
    hj,
    lowK,
    pelvis: seated ? 0 : pelvis,
    armLen: [L1, L2],
  };
  const pL = palmOf(an, 'L');
  const pR = palmOf(an, 'R');
  an.arm.xL = pL[0];
  an.arm.xR = pR[0];
  an.arm.handY = (pL[1] + pR[1]) / 2;
  return an;
}

/**
 * giros (graus, horário na tela, como a Pose) que levam os braços do repouso desta pessoa de volta pro braço "solto":
 * uma animação que mexe nos braços pode somar isto (addPose) pra partir sempre de braços soltos, seja qual for o repouso
 * (mão na cintura, na coxa, no passante). Zero quando o braço já está solto.
 */
export function restArmDelta(an: Anatomy): { armL: number; foreL: number; armR: number; foreR: number } {
  const ang = (a: Pt, b: Pt) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  const j = an.joints;
  const h = an.hangArms;
  const side = (sh: Pt, el: Pt, wr: Pt, hel: Pt, hwr: Pt) => {
    const arm = wrap(ang(sh, hel) - ang(sh, el));
    const fore = wrap(ang(hel, hwr) - (ang(el, wr) + arm));
    return { arm: Math.abs(arm) < 1e-9 ? 0 : arm, fore: Math.abs(fore) < 1e-9 ? 0 : fore };
  };
  const L = side(j.shoulderL, j.elbowL, j.wristL, h.elbowL, h.wristL);
  const R = side(j.shoulderR, j.elbowR, j.wristR, h.elbowR, h.wristR);
  return { armL: L.arm, foreL: L.fore, armR: R.arm, foreR: R.fore };
}

/** onde o pet fica (pivô do grupo 'pet') pra cada posição */
export function petAnchor(an: Anatomy, pose: AvatarPetPose | null): Pt {
  switch (pose) {
    case 'arms':
      return [an.cx, an.waistY + 1];
    case 'shoulder':
      return [an.cx + an.w.shoulder - 3.2, an.shoulderY - 1];
    case 'float':
      return [Math.min(90, an.cx + an.w.shoulder + 13), an.head.cy - 3];
    case 'side':
      return [Math.min(92, an.cx + an.w.hip + 19), an.foot.soleY];
    default:
      return [an.cx, an.foot.soleY];
  }
}

/** y do pivô da cabeça (alto do pescoço, logo acima do queixo): o queixo gira sem descolar do pescoço */
export function headPivotY(an: Anatomy): number {
  return an.head.cy + an.face.chinY * an.head.s - 2.0;
}

/** pivôs do esqueleto (tudo vem da anatomia) */
export function rigFromAnatomy(an: Anatomy, scene: AvatarSceneInfo | null): AvatarRig {
  const petPose = scene?.petPose ?? null;
  const j = an.joints;
  const rig: AvatarRig = {
    body: [an.cx, (j.hipL[1] + j.hipR[1]) / 2 - an.seatDrop],
    head: [an.cx, headPivotY(an)],
    armL: j.shoulderL,
    armR: j.shoulderR,
    foreL: j.elbowL,
    foreR: j.elbowR,
    legL: j.hipL,
    legR: j.hipR,
    shinL: j.kneeL,
    shinR: j.kneeR,
    mount: [an.cx, 118],
    pet: petAnchor(an, petPose),
    petAttach: scene?.petAttach ?? 'root',
  };
  if (scene) rig.scene = scene;
  return rig;
}

// ---------------------------------------------------------------------------------------------------------------
// Âncoras do corpo
// ---------------------------------------------------------------------------------------------------------------

export interface BodyAnchors {
  /** base do pescoço (centro) */
  neck: Pt;
  /** fundo da gola redonda (centro) e as pontas dela no ombro */
  collar: Pt;
  collarL: Pt;
  collarR: Pt;
  /** topo do ombro de cada lado (acrômio) */
  shoulderL: Pt;
  shoulderR: Pt;
  /** centro do peito (pin, broche, estampa) */
  chest: Pt;
  /** cintura e quadril (centro) */
  waist: Pt;
  hip: Pt;
  /** pulsos e centro das palmas (no espaço do antebraço) */
  wristL: Pt;
  wristR: Pt;
  palmL: Pt;
  palmR: Pt;
  /** colo (onde um pet no colo fica) */
  lap: Pt;
  /** ombro direito da tela (pet no ombro, alça) */
  shoulderPerch: Pt;
  /** centro da sola de cada pé (no espaço da canela) */
  footL: Pt;
  footR: Pt;
}

/** centro da palma (no espaço do antebraço): um pouco depois do pulso, no sentido do antebraço */
function palmOf(an: Anatomy, s: Side): Pt {
  const j = an.joints;
  const wr = s === 'L' ? j.wristL : j.wristR;
  const el = s === 'L' ? j.elbowL : j.elbowR;
  const dx = wr[0] - el[0];
  const dy = wr[1] - el[1];
  const L = Math.hypot(dx, dy) || 1;
  const r = 4.2 * an.spec.hand;
  return [wr[0] + (dx / L) * r, wr[1] + (dy / L) * r];
}

export function bodyAnchors(an: Anatomy): BodyAnchors {
  const { cx, joints: j, w } = an;
  const shY = (s: Side) => an.shoulderY - (s === 'L' ? an.tilt.shoulder : -an.tilt.shoulder) * 0.5;
  return {
    neck: [cx, an.neck.y + an.neck.h],
    collar: [cx, an.collarY],
    collarL: [cx - an.collarW, an.collarY - 2.6],
    collarR: [cx + an.collarW, an.collarY - 2.6],
    shoulderL: [cx - w.shoulder + 2.4, shY('L')],
    shoulderR: [cx + w.shoulder - 2.4, shY('R')],
    chest: [cx, an.armpitY + 2.5],
    waist: [cx, an.waistY],
    hip: [cx, an.hipY],
    wristL: j.wristL,
    wristR: j.wristR,
    palmL: palmOf(an, 'L'),
    palmR: palmOf(an, 'R'),
    lap: [cx, an.hj + 1],
    shoulderPerch: [cx + w.shoulder - 3.2, shY('R') - 1],
    footL: footFrame(an, 'L').P(0, 6, 0),
    footR: footFrame(an, 'R').P(0, 6, 0),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tronco
// ---------------------------------------------------------------------------------------------------------------

/** perfil de um lado do tronco, de cima (pescoço) pra baixo (gancho); y cresce sempre */
export function torsoProfile(an: Anatomy, side: Side): SP[] {
  const { cx, w, spec: sp } = an;
  const sg = side === 'L' ? -1 : 1;
  const Y = (y: number) => bodyY(an, y);
  // contrapposto: quadril do lado do peso mais alto e pra fora (a cintura desse lado aperta); ombro desse lado desce;
  // a pélvis inteira vai pro lado do apoio (some do meio da cintura pra baixo)
  const up = side === 'L' ? an.tilt.hip : -an.tilt.hip; // >0: este lado sobe
  const hipDy = -up;
  const hipDx = up > 0 ? 0.9 : up < 0 ? -0.25 : 0;
  const waistDx = up > 0 ? -0.35 : up < 0 ? 0.3 : 0;
  const shDy = -(side === 'L' ? an.tilt.shoulder : -an.tilt.shoulder) * 0.5 + an.feat.age * 0.3;
  const pv = an.pelvis;
  const X = (d: number, pk = 0) => cx + sg * d + pv * pk;
  const sl = sp.slope;
  const tr = sp.trap;
  // o tronco vai até o acrômio; o deltoide (a parte mais larga do ombro) é a ponta redonda do braço
  const acr = sp.shoulder - sp.upperArm * 0.82;
  const cv = sp.chestVol;
  // sentado: o quadril espalha no assento (lados saem em curva pra fora)
  const seat = an.seated ? 1.1 : 0;
  // tronco largo (broad/plus): quase não afina na cintura — o perfil fica arredondado
  return [
    // pescoço até ~Y(36,6); o trapézio começa a descer CEDO (perto de Y(37,2)) em diagonal até o acrômio — coluna visível
    // curta, sem "polegar" (corpo largo: trapézio mais espesso e inclinado)
    [X(w.neck - 0.05), Y(35.6)],
    [X(w.neck + 0.3 + tr * 0.35), Y(37.2) + shDy * 0.3],
    [X(w.neck + 2.0 + tr * 0.6), Y(38.7 + sl * 0.3 - tr * 0.25) + shDy * 0.6],
    [X((w.neck + 2.0 + acr) / 2 + 0.3 + tr * 0.3), Y(40.5 + sl * 0.7 - tr * 0.1) + shDy],
    [X(acr), Y(42.4 + sl) + shDy],
    [X(acr + sp.upperArm * 0.55), Y(44.0 + sl * 0.8) + shDy],
    [X(Math.max(w.chest + 0.7, acr + sp.upperArm * 0.35)), Y(47.6)],
    [X(w.chest + 0.15 + cv * 0.45), Y(51.6)],
    [X(w.chest - 0.15 + cv * 0.25), Y(56.4)],
    [X((w.chest + w.waist) / 2 - 0.15 + waistDx * 0.5, 0.15), Y(61.5)],
    [X(w.waist + waistDx, 0.35), Y(66.3) + hipDy * 0.25],
    // cintura → quadril numa curva contínua: o marco do meio já leva metade da diferença (com 0,38 o quadril abria tarde,
    // em degrau reto embaixo de uma cintura em vinco, no Curvilíneo)
    [X(w.waist + w.belly * 0.85 + (w.hip - w.waist) * 0.5 + hipDx * 0.6 + seat * 0.4, 0.7), Y(71.2) + hipDy * 0.6],
    [X(w.hip + hipDx + seat, 1), Y(76.8) + hipDy],
    [X(w.hip - 0.9 + hipDx * 0.7 + seat * 1.2, 1), Y(80.6) + hipDy],
  ];
}

/** x do perfil num y (interpolação nos marcos; serve pra posicionar bolsos, barras, cintos) */
export function torsoXAt(an: Anatomy, side: Side, y: number, ease = 0): number {
  const p = torsoProfile(an, side);
  const sg = side === 'L' ? -1 : 1;
  if (y <= p[0][1]) return p[0][0] + sg * ease;
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][1]) {
      const a = p[i - 1];
      const b = p[i];
      const t = (y - a[1]) / (b[1] - a[1] || 1);
      return a[0] + (b[0] - a[0]) * t + sg * ease;
    }
  }
  return p[p.length - 1][0] + sg * ease;
}

function sliceProfile(prof: readonly SP[], y0: number, y1: number): SP[] {
  const out: SP[] = [];
  const at = (y: number): SP => {
    for (let i = 1; i < prof.length; i++) {
      if (y <= prof[i][1]) {
        const a = prof[i - 1];
        const b = prof[i];
        const t = Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1] || 1)));
        return [a[0] + (b[0] - a[0]) * t, y];
      }
    }
    const l = prof[prof.length - 1];
    return [l[0], y];
  };
  out.push(at(Math.max(y0, prof[0][1])));
  for (const p of prof) if (p[1] > y0 + 0.6 && p[1] < y1 - 0.6) out.push(p);
  out.push(at(Math.min(y1, prof[prof.length - 1][1] + 2)));
  return out;
}

/** puxa os marcos entre a caixa torácica e o quadril pra linha reta entre eles (só pra fora: nunca aperta) */
function drapeProfile(prof: SP[], k: number): SP[] {
  if (k <= 0) return prof;
  const iA = 7; // peito (marco do perfil)
  const iH = prof.length - 2; // quadril
  const a = prof[iA];
  const h = prof[iH];
  return prof.map((p, i) => {
    if (i <= iA || i >= iH) return p;
    const t = (p[1] - a[1]) / (h[1] - a[1] || 1);
    const xs = a[0] + (h[0] - a[0]) * t;
    const out = Math.abs(xs - 50) > Math.abs(p[0] - 50) ? p[0] + (xs - p[0]) * k : p[0];
    return [out, p[1]] as SP;
  });
}

export interface TorsoOpts {
  /** topo do recorte (padrão: desde o pescoço, com a linha dos ombros) */
  top?: number;
  /** base (padrão: gancho, com a virilha) */
  bottom?: number;
  /** folga: afasta pra fora (roupa) */
  ease?: number;
  /** curvatura da barra (positivo desce no meio) */
  hem?: number;
  /** compat: encolhe a largura dos dois lados (negativo alarga) = ease negativo */
  inset?: number;
  /**
   * roupa: o topo segue o decote em vez de subir pelo pescoço. true = gola careca; número = profundidade extra do
   * decote no meio (V/canoa). O pescoço (etapa 16) cobre acima da curva do decote.
   */
  collar?: boolean | number;
  /**
   * caimento 0..1: a roupa deixa de seguir a cintura e cai reta do peito ao quadril (camiseta, camisa solta: 0,7–1;
   * peça justa: 0). Só afeta a parte entre o peito e o quadril.
   */
  drape?: number;
  /** legado (ignorado: o tronco novo não tem cantos) */
  radii?: [number, number, number, number];
  /**
   * barra com canto arredondado (raio aproximado, unidades; 0 = canto vivo). Com raio, as pontas da barra sobem um
   * pouco nas laterais e a curva segue a barriga/quadril — nada de "bloco" com canto reto.
   */
  round?: number;
}

/** pontos do contorno do tronco (horário: lado esquerdo descendo, barra, lado direito subindo, ombros/pescoço) */
export function torsoPts(an: Anatomy, o: TorsoOpts = {}): SP[] {
  const ease = (o.ease ?? 0) - (o.inset ?? 0);
  const L = drapeProfile(torsoProfile(an, 'L'), o.drape ?? 0);
  const R = drapeProfile(torsoProfile(an, 'R'), o.drape ?? 0);
  // sentado: o tronco termina no assento (as coxas vêm pra frente e cobrem o resto); a barra curva de leve no colo
  const full = o.bottom == null && !an.seated;
  const y0 = o.top ?? L[0][1];
  const y1 = o.bottom ?? (an.seated ? an.hj + 1.6 : an.torsoBottom);
  // cortes abaixo da cintura acompanham a inclinação do quadril (barra da camiseta, cós, cinto)
  const tiltAt = (y: number) => an.tilt.hip * 0.5 * Math.max(0, Math.min(1, (y - an.waistY + 2) / (an.hipY - an.waistY)));
  const left = sliceProfile(L, o.top != null ? y0 - tiltAt(y0) : y0, o.bottom != null ? y1 - tiltAt(y1) : y1);
  const right = sliceProfile(R, o.top != null ? y0 + tiltAt(y0) : y0, o.bottom != null ? y1 + tiltAt(y1) : y1);
  const pts: SP[] = [];
  const sharp = (p: SP): SP => [p[0], p[1], 0];
  const top = o.top == null;
  const collar = top && o.collar != null && o.collar !== false;
  // com gola: começa no ombro, ao lado do pescoço (o 3º marco do perfil)
  if (collar) {
    const l0 = left.filter((p, i) => i === 0 || p[1] >= L[2][1] - 0.01).slice(1);
    const r0 = right.filter((p, i) => i === 0 || p[1] >= R[2][1] - 0.01).slice(1);
    left.splice(0, left.length, ...l0);
    right.splice(0, right.length, ...r0);
  }
  pts.push(collar ? [left[0][0], left[0][1], 0.5] : sharp(left[0]), ...left.slice(1, -1));
  const lb = left[left.length - 1];
  const rb = right[right.length - 1];
  if (full) {
    // virilha: as coxas saem daqui (a calça/pele da perna fica por baixo)
    const mid = (lb[1] + rb[1]) / 2;
    const pc = an.cx + an.pelvis;
    pts.push(lb, [pc - 2.2, mid - 0.1 + 0.5], [pc, an.torsoBottom + 0.9], [pc + 2.2, mid - 0.1 + 0.5], rb);
  } else {
    const hem = o.hem ?? (o.bottom == null ? 0.6 : 0.8);
    const tl = lb[1] - y1;
    const tr = rb[1] - y1;
    const r = o.round ?? 0;
    if (r > 0) {
      // canto arredondado: a lateral termina r acima da barra e vira pra dentro numa curva; o ponto da barra perto do
      // canto fica r pra dentro (Catmull-Rom faz o raio)
      const lp = left[left.length - 2];
      const rp = right[right.length - 2];
      const along = (a: SP, b: SP, d: number): SP => {
        const L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        return [b[0] + ((a[0] - b[0]) / L) * d, b[1] + ((a[1] - b[1]) / L) * d];
      };
      const lUp = along(lp, lb, r * 1.1);
      const rUp = along(rp, rb, r * 1.1);
      const lIn: SP = [lb[0] + r * 1.2, lb[1] + hem * 0.25 + 0.15];
      const rIn: SP = [rb[0] - r * 1.2, rb[1] + hem * 0.25 + 0.15];
      pts.push(lUp, [lb[0] + r * 0.28, lb[1] - r * 0.05 + hem * 0.05, 0.9], lIn, [an.cx - (an.cx - lb[0]) * 0.45, y1 + hem * 0.85 + tl * 0.45], [an.cx, y1 + hem], [an.cx + (rb[0] - an.cx) * 0.45, y1 + hem * 0.85 + tr * 0.45], rIn, [rb[0] - r * 0.28, rb[1] - r * 0.05 + hem * 0.05, 0.9], rUp);
    } else {
      pts.push(sharp(lb), [an.cx - (an.cx - lb[0]) * 0.5, y1 + hem * 0.8 + tl * 0.5], [an.cx, y1 + hem], [an.cx + (rb[0] - an.cx) * 0.5, y1 + hem * 0.8 + tr * 0.5], sharp(rb));
    }
  }
  pts.push(...right.slice(1, -1).reverse(), collar ? [right[0][0], right[0][1], 0.5] : sharp(right[0]));
  const out = ease ? offsetPts(pts, ease) : pts;
  if (collar) {
    // decote (sem folga: a borda tem de bater com a base do pescoço)
    const depth = typeof o.collar === 'number' ? o.collar : 0;
    const cw = an.collarW;
    const yS = an.collarY - 2.6;
    const yC = an.collarY + depth;
    out.push([an.cx + cw * 0.62, yS + (yC - yS) * 0.72], [an.cx, yC], [an.cx - cw * 0.62, yS + (yC - yS) * 0.72]);
  }
  return out;
}

/** contorno do tronco (grupo 'body') — pele ou roupa (com `ease`) */
export function torsoPath(an: Anatomy, o: TorsoOpts = {}): string {
  return smoothPath(torsoPts(an, o), true);
}

/**
 * Curva do decote (gola redonda por padrão) de um lado ao outro, aberta: use pra gola/ribana da roupa.
 * `depth` aprofunda o centro (V/canoa: 4–8); `wide` alarga pros ombros.
 */
export function necklinePath(an: Anatomy, o: { depth?: number; wide?: number; v?: boolean } = {}): string {
  const { cx } = an;
  const w = an.collarW + (o.wide ?? 0);
  const yS = an.collarY - 2.6 + (o.wide ?? 0) * 0.25;
  const yC = an.collarY + (o.depth ?? 0);
  if (o.v) return `M${fmt(cx - w)},${fmt(yS)}L${fmt(cx)},${fmt(yC)}L${fmt(cx + w)},${fmt(yS)}`;
  return smoothPath(
    [
      [cx - w, yS],
      [cx - w * 0.62, yS + (yC - yS) * 0.72],
      [cx, yC],
      [cx + w * 0.62, yS + (yC - yS) * 0.72],
      [cx + w, yS],
    ],
    false,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Membros (braço, antebraço, coxa, canela, pé, mão)
// ---------------------------------------------------------------------------------------------------------------

/** larguras de um lado do membro ao longo do eixo: pares [t 0..1, meia-largura] */
type WProf = readonly (readonly [number, number])[];

function wAt(prof: WProf, t: number): number {
  if (t <= prof[0][0]) return prof[0][1];
  for (let i = 1; i < prof.length; i++) {
    if (t <= prof[i][0]) {
      const a = prof[i - 1];
      const b = prof[i];
      const u = (t - a[0]) / (b[0] - a[0] || 1);
      // suaviza (cosseno) pra não marcar quina no músculo
      const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
      return a[1] + (b[1] - a[1]) * s;
    }
  }
  return prof[prof.length - 1][1];
}

interface LimbSpec2 {
  a: Pt;
  b: Pt;
  /** meia-largura do lado esquerdo da TELA e do direito */
  wl: WProf;
  wr: WProf;
  /** pontas: 'round' (meio círculo em volta da junta, raio = largura ali) | 'flat' | 'ext' (prolonga além da junta) */
  capA: 'round' | 'flat' | 'ext';
  capB: 'round' | 'flat' | 'ext';
  /** quanto prolonga numa ponta 'ext' */
  ext?: number;
  /** achata a ponta redonda A (1 = meio círculo; 0,7 = copa baixa do ombro, não sobe acima da linha do ombro) */
  capAScale?: number;
  ease?: number;
  /** alarga progressivamente até a ponta b (calça reta/boca de sino): soma flare·t na meia-largura */
  flare?: number;
  /** amostras ao longo do eixo */
  n?: number;
  /** qual lado (da tela) é o de fora do corpo — pra boca inclinada */
  outer?: 'l' | 'r';
  /** boca inclinada na ponta b (flat): o lado de fora desce `slant`, o de dentro sobe (manga de camiseta) */
  slant?: number;
}

function limbPts(sp: LimbSpec2): SP[] {
  const n = sp.n ?? 5;
  const e = sp.ease ?? 0;
  const dx = sp.b[0] - sp.a[0];
  const dy = sp.b[1] - sp.a[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  // normal pro lado esquerdo da tela (andando no sentido a→b)
  const nlx = -uy;
  const nly = ux;
  // garante que "esquerda" é a esquerda da TELA mesmo com o membro de cabeça pra baixo
  const flip = nlx > 0 ? -1 : 1;
  const lx = nlx * flip;
  const ly = nly * flip;
  const left: SP[] = [];
  const right: SP[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const px = sp.a[0] + dx * t;
    const py = sp.a[1] + dy * t;
    const fl = (sp.flare ?? 0) * t;
    const l = wAt(sp.wl, t) + e + fl;
    const r = wAt(sp.wr, t) + e + fl;
    left.push([px + lx * l, py + ly * l]);
    right.push([px - lx * r, py - ly * r]);
  }
  if (sp.slant && sp.capB === 'flat') {
    const kl = sp.outer === 'l' ? 0.6 : -0.4;
    const kr = sp.outer === 'l' ? -0.4 : 0.6;
    const L0 = left[n - 1];
    const R0 = right[n - 1];
    left[n - 1] = [L0[0] + ux * sp.slant * kl, L0[1] + uy * sp.slant * kl];
    right[n - 1] = [R0[0] + ux * sp.slant * kr, R0[1] + uy * sp.slant * kr];
  }
  const cap = (c: Pt, rad: number, dirx: number, diry: number, from: 'L' | 'R', k = 1): SP[] => {
    // meio círculo (ou meia elipse achatada por k) do lado `dir` (fora do membro), de um lado ao outro
    const out: SP[] = [];
    const sx = from === 'L' ? lx : -lx;
    const sy = from === 'L' ? ly : -ly;
    for (const ang of [0.3, 0.5, 0.7]) {
      const th = Math.PI * ang;
      const cxp = Math.cos(th);
      const sxp = Math.sin(th) * k;
      out.push([c[0] + (sx * cxp + dirx * sxp) * rad, c[1] + (sy * cxp + diry * sxp) * rad]);
    }
    return out;
  };
  const pts: SP[] = [];
  // ponta A (topo): vai da direita pra esquerda passando "antes" de a
  const wa = (wAt(sp.wl, 0) + wAt(sp.wr, 0)) / 2 + e;
  const wb = (wAt(sp.wl, 1) + wAt(sp.wr, 1)) / 2 + e + (sp.flare ?? 0);
  const ext = sp.ext ?? 4;
  if (sp.capA === 'round') {
    pts.push(...cap(sp.a, wa, -ux, -uy, 'R', sp.capAScale ?? 1));
  } else if (sp.capA === 'ext') {
    // prolonga pra dentro do tronco afinando (cunha): cobre o pulo do tronco sem vazar pelos lados ao andar
    const ax = sp.a[0];
    const ay = sp.a[1];
    const inw = (p: SP): SP => [ax + (p[0] - ax) * 0.55 - ux * ext, ay + (p[1] - ay) * 0.55 - uy * ext, 0];
    // o lado de FORA quase não sobe (senão a coxa espia pela lateral do quadril/camiseta); o de dentro sobe pro gancho
    const kr = sp.outer === 'r' ? 0.15 : 0.6;
    const kl = sp.outer === 'l' ? 0.15 : 0.6;
    pts.push([right[0][0] - ux * ext * kr, right[0][1] - uy * ext * kr], inw(right[0]), inw(left[0]), [left[0][0] - ux * ext * kl, left[0][1] - uy * ext * kl]);
  }
  pts.push(...left);
  if (sp.capB === 'round') pts.push(...cap(sp.b, wb, ux, uy, 'L'));
  else if (sp.capB === 'ext') pts.push([left[n - 1][0] + ux * ext, left[n - 1][1] + uy * ext, 0], [right[n - 1][0] + ux * ext, right[n - 1][1] + uy * ext, 0]);
  pts.push(...right.slice().reverse());
  if (sp.capA === 'flat') {
    pts[pts.length - 1] = [pts[pts.length - 1][0], pts[pts.length - 1][1], 0];
    pts[0] = [pts[0][0], pts[0][1], 0];
  }
  return pts;
}

export interface LimbOpts {
  /** folga (manga/calça por cima da pele) */
  ease?: number;
  /** alarga até a ponta de baixo (calça reta, pantalona, manga boca de sino) */
  flare?: number;
  /** quanto a ponta prolongada passa da junta de baixo (canela: padrão 2,2 além do tornozelo; barra da calça ~0,9) */
  endExt?: number;
  /** compat com o contorno antigo: largura fixa (ignorado) */
  w?: number;
  /** compat: prolonga a ponta da junta (padrão: ponta redonda centrada na junta, sem fresta ao girar) */
  overlap?: number;
  /** recorta o membro em t0..t1 do eixo (manga curta = upperArmPath(an, s, { to: 0.55 })) */
  from?: number;
  to?: number;
  /** boca inclinada no corte `to`: o lado de fora desce, o de dentro sobe (unidades; manga de camiseta ~1,5) */
  slant?: number;
  /** achata a copa do ombro (ponta de cima do braço): 1 = meio círculo, 0,5 = copa baixa (manga sem "balão") */
  capScale?: number;
  /** compat (ignorados) */
  top?: number;
  bottom?: number;
  inset?: number;
  radii?: [number, number, number, number];
}

function cut(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function sliceW(w: WProf, t0: number, t1: number): WProf {
  const out: [number, number][] = [[0, wAt(w, t0)]];
  for (const [t, v] of w) if (t > t0 + 0.02 && t < t1 - 0.02) out.push([(t - t0) / (t1 - t0), v]);
  out.push([1, wAt(w, t1)]);
  return out;
}

/** lado de fora do membro (longe do eixo do corpo) é a esquerda da tela no lado L */
function outIsLeft(side: Side): boolean {
  return side === 'L';
}

/** perfis do braço (lado de fora = deltoide/tríceps; de dentro = bíceps) */
function upperArmSpec(an: Anatomy, side: Side): LimbSpec2 {
  const s = an.spec;
  const j = an.joints;
  // lado de fora: massa do deltoide no alto (+~0,6 no corpo médio), vale da inserção, curva do tríceps e cotovelo; lado
  // de dentro: barriga do bíceps no meio. Erguido, o braço continua com volume (nada de graveto)
  const dl = Math.min(0.95, 0.55 + s.upperArm * 0.08);
  const outer: WProf = [
    [0, s.upperArm * 1.04],
    [0.15, s.upperArm + dl],
    [0.38, s.upperArm * 0.95],
    [0.58, s.upperArm * 0.99],
    [0.84, s.elbow * 1.1],
    [1, s.elbow],
  ];
  const inner: WProf = [
    [0, s.upperArm * 0.86],
    [0.3, s.upperArm * 0.98],
    [0.52, s.upperArm * 1.03],
    [0.8, s.elbow * 1.04],
    [1, s.elbow],
  ];
  const a = side === 'L' ? j.shoulderL : j.shoulderR;
  const b = side === 'L' ? j.elbowL : j.elbowR;
  const o = outIsLeft(side);
  return { a, b, wl: o ? outer : inner, wr: o ? inner : outer, capA: 'round', capAScale: 0.72, capB: 'round', n: 7, outer: o ? 'l' : 'r' };
}

function forearmSpec(an: Anatomy, side: Side): LimbSpec2 {
  const s = an.spec;
  const j = an.joints;
  // mais largo perto do cotovelo (braquiorradial), afinando até o pulso sem degrau
  const outer: WProf = [
    [0, s.elbow],
    [0.15, s.forearm * 1.12],
    [0.42, s.forearm * 0.96],
    [0.78, s.wrist * 1.1],
    [1, s.wrist],
  ];
  const inner: WProf = [
    [0, s.elbow * 0.96],
    [0.22, s.forearm * 1.0],
    [0.56, s.forearm * 0.8],
    [0.86, s.wrist * 1.02],
    [1, s.wrist],
  ];
  const a = side === 'L' ? j.elbowL : j.elbowR;
  const b = side === 'L' ? j.wristL : j.wristR;
  const o = outIsLeft(side);
  return { a, b, wl: o ? outer : inner, wr: o ? inner : outer, capA: 'round', capB: 'round', n: 7, outer: o ? 'l' : 'r' };
}

function thighSpec(an: Anatomy, side: Side): LimbSpec2 {
  const s = an.spec;
  const j = an.joints;
  const seated = an.seated;
  // coxa afinando até o joelho (vasto lateral por fora, adutores por dentro no alto)
  // sentado: a coxa vem pra frente, vista de cima e encurtada — um TRAPÉZIO curto (largo no quadril, estreito no joelho)
  const outer: WProf = seated
    ? [
        [0, s.thigh * 1.1],
        [0.7, s.knee * 1.08],
        [1, s.knee * 0.84],
      ]
    : [
        [0, s.thigh * 1.05],
        [0.25, s.thigh * 1.0],
        [0.6, s.thigh * 0.84],
        [0.9, s.knee * 1.08],
        [1, s.knee],
      ];
  const inner: WProf = seated
    ? [
        [0, s.thigh * 1.08],
        [0.45, s.thigh * 0.88],
        [1, s.knee * 0.84],
      ]
    : [
        [0, s.thigh * 0.96],
        [0.3, s.thigh * 0.86],
        [0.72, s.knee * 1.14],
        [1, s.knee * 1.02],
      ];
  const a = side === 'L' ? j.hipL : j.hipR;
  const b = side === 'L' ? j.kneeL : j.kneeR;
  const o = outIsLeft(side);
  // topo curto (4): some sob o quadril da roupa sem espiar acima da barra da camiseta nem pela cintura
  return { a, b, wl: o ? outer : inner, wr: o ? inner : outer, capA: 'ext', ext: 4, capB: 'round', n: 7, outer: o ? 'l' : 'r' };
}

function shinSpec(an: Anatomy, side: Side): LimbSpec2 {
  const s = an.spec;
  const j = an.joints;
  const k0 = an.seated ? s.knee * 0.86 : s.knee;
  // panturrilha saliente por fora no alto (y≈112), por dentro mais baixa; tornozelo fino
  const outer: WProf = [
    [0, k0],
    [0.1, s.knee * 1.05],
    [0.3, s.calf * 1.07],
    [0.56, s.calf * 0.86],
    [0.86, s.ankle * 1.14],
    [1, s.ankle],
  ];
  const inner: WProf = [
    [0, k0 * 1.02],
    [0.2, s.calf * 0.9],
    [0.42, s.calf * 0.95],
    [0.7, s.calf * 0.66],
    [1, s.ankle],
  ];
  const a = side === 'L' ? j.kneeL : j.kneeR;
  const b = side === 'L' ? j.ankleL : j.ankleR;
  const o = outIsLeft(side);
  return { a, b, wl: o ? outer : inner, wr: o ? inner : outer, capA: 'round', capB: 'ext', ext: 2.2, n: 8, outer: o ? 'l' : 'r' };
}

function limbPathFrom(spec: LimbSpec2, o: LimbOpts): string {
  const t0 = o.from ?? 0;
  const t1 = o.to ?? 1;
  let sp: LimbSpec2 = { ...spec, ease: o.ease ?? 0, flare: o.flare ?? 0, slant: o.slant, ...(o.capScale != null ? { capAScale: o.capScale } : {}), ...(o.endExt != null && spec.capB === 'ext' ? { ext: o.endExt } : {}) };
  if (t0 > 0 || t1 < 1) {
    const a = cut(spec.a, spec.b, t0);
    const b = cut(spec.a, spec.b, t1);
    sp = { ...sp, a, b, wl: sliceW(spec.wl, t0, t1), wr: sliceW(spec.wr, t0, t1), capA: t0 > 0 ? 'flat' : spec.capA, capB: t1 < 1 ? 'flat' : spec.capB };
  }
  return smoothPath(limbPts(sp), true);
}

/** braço do ombro ao cotovelo (grupo armX); ponta de baixo = meio círculo centrado no cotovelo (gira sem fresta) */
export function upperArmPath(an: Anatomy, side: Side, o: LimbOpts = {}): string {
  return limbPathFrom(upperArmSpec(an, side), o);
}

/** antebraço do cotovelo ao pulso (grupo foreX); ponta de cima = meio círculo centrado no cotovelo */
export function forearmPath(an: Anatomy, side: Side, o: LimbOpts = {}): string {
  return limbPathFrom(forearmSpec(an, side), o);
}

/** coxa do quadril ao joelho (grupo legX); o topo prolonga pra dentro do quadril (some por baixo do tronco) */
export function thighPath(an: Anatomy, side: Side, o: LimbOpts = {}): string {
  return limbPathFrom(thighSpec(an, side), o);
}

/** canela do joelho ao tornozelo (grupo shinX); ponta de cima = meio círculo centrado no joelho */
export function shinPath(an: Anatomy, side: Side, o: LimbOpts = {}): string {
  return limbPathFrom(shinSpec(an, side), o);
}

/** meia-largura do membro em t 0..1 (lado esquerdo e direito da tela) — pra barras, punhos e bainhas */
export function limbWidthAt(an: Anatomy, limb: 'upperArm' | 'forearm' | 'thigh' | 'shin', side: Side, t: number): { l: number; r: number; at: Pt; dir: Pt } {
  const sp = limb === 'upperArm' ? upperArmSpec(an, side) : limb === 'forearm' ? forearmSpec(an, side) : limb === 'thigh' ? thighSpec(an, side) : shinSpec(an, side);
  const L = Math.hypot(sp.b[0] - sp.a[0], sp.b[1] - sp.a[1]) || 1;
  return { l: wAt(sp.wl, t), r: wAt(sp.wr, t), at: cut(sp.a, sp.b, t), dir: [(sp.b[0] - sp.a[0]) / L, (sp.b[1] - sp.a[1]) / L] };
}

/**
 * eixo da perna inteira em repouso (quadril → tornozelo): use pro gradiente da calça/pele da coxa E da canela, assim
 * as duas metades têm a mesma cor na emenda do joelho (perna contínua, sem "joelheira") e só divergem ao dobrar.
 */
export function legAxis(an: Anatomy, side: Side): { a: Pt; b: Pt; wl: number; wr: number } {
  const j = an.joints;
  const a = side === 'L' ? j.hipL : j.hipR;
  const b = side === 'L' ? j.ankleL : j.ankleR;
  const s = an.spec;
  return { a, b, wl: s.thigh * 0.9, wr: s.thigh * 0.9 };
}

/** eixo do braço inteiro em repouso (ombro → pulso): mesmo papel do legAxis pra manga longa e pele */
export function armAxis(an: Anatomy, side: Side): { a: Pt; b: Pt; wl: number; wr: number } {
  const j = an.joints;
  const a = side === 'L' ? j.shoulderL : j.shoulderR;
  const b = side === 'L' ? j.wristL : j.wristR;
  return { a, b, wl: an.spec.upperArm, wr: an.spec.upperArm };
}

// ---- pé em 3D simplificado -------------------------------------------------------------------------------------
// O pé (e o calçado) é um volume 3D pequeno projetado na câmera do avatar: de frente, um pouco de cima (7°), girado pra
// fora `yaw` graus. Isso dá o pé certo em qualquer ângulo — o de apoio quase de frente (~9°), o da perna livre a ~20° e
// com o calcanhar erguido, sentado apontando pra gente — sem desenhar à mão cada caso. Coordenadas do pé "unitário":
//   u = lateral (+ = lado de fora do corpo), v = pra frente a partir do calcanhar (0 … 11,6), h = altura do chão.

/** amostras do pé unitário ao longo de v: meia-largura da sola do lado de fora / de dentro e altura do cabedal */
const FOOT_V = [0, 0.6, 2.0, 4.0, 6.2, 7.8, 9.2, 10.4, 11.2, 11.6];
const FOOT_OUT = [0.75, 1.25, 1.35, 1.5, 1.9, 2.0, 1.75, 1.25, 0.65, 0.12];
const FOOT_IN = [0.75, 1.2, 1.3, 1.15, 1.9, 2.15, 1.95, 1.45, 0.8, 0.25];
const FOOT_TOP = [2.8, 4.0, 4.6, 4.3, 3.6, 2.9, 2.25, 1.75, 1.2, 0.72];
/** posição do tornozelo no pé unitário (v, h) e da bola do pé (onde o pé gira quando o calcanhar sobe) */
const FOOT_VA = 2.9;
const FOOT_HA = 4.0;
const FOOT_VB = 8.0;
/** comprimento do pé unitário (faixa de v das tabelas) */
export const FOOT_LEN = 11.6;
/**
 * o pé unitário é esticado no comprimento (v) e na altura (h) na projeção: pé de adulto com ~13,6% da altura do corpo
 * (FOOT_LENGTH ≈ 16,6 no corpo médio) e cabedal mais alto — de frente o calçado não vira "pastilha" embaixo da perna
 */
export const FOOT_SV = 1.17;
export const FOOT_SH = 1.12;
/** escala base do pé (unidades do viewBox por unidade do pé, antes do tipo de corpo e da estatura) */
export const FOOT_S = 1.22;
/** câmera um pouco de cima (graus): mostra o comprimento do pé em escorço */
export const FOOT_PITCH = 10;
/** comprimento real do pé do corpo médio (unidades do viewBox) */
export const FOOT_LENGTH = FOOT_LEN * FOOT_SV * FOOT_S;

/** quanto o tornozelo fica acima da sola (na bola do pé) pra uma escala de pé `s`: a bola do pé pousa na sola */
export function ankleAboveSole(s: number): number {
  const ph = (FOOT_PITCH * Math.PI) / 180;
  return s * (FOOT_HA * FOOT_SH * Math.cos(ph) + (FOOT_VB - FOOT_VA) * FOOT_SV * Math.sin(ph));
}

function tab(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    }
  }
  return ys[ys.length - 1];
}

export interface FootFrame {
  /** projeta um ponto do pé unitário (u, v, h) no espaço do grupo da canela */
  P: (u: number, v: number, h: number) => Pt;
  /** escala do pé (unidades do viewBox por unidade do pé) */
  s: number;
  /** giro pra fora em graus */
  yaw: number;
  side: Side;
  /** meia-largura da sola em v (lado de fora / de dentro) e altura do cabedal em v (pé unitário) */
  outer: (v: number) => number;
  inner: (v: number) => number;
  top: (v: number) => number;
}

/** escala do pé desta pessoa (tipo de corpo × estatura; sentado um pouco maior: o pé vem pra frente, pra perto da câmera) */
export function footScale(an: Pick<Anatomy, 'spec' | 'k' | 'seated'>): number {
  return an.spec.foot * FOOT_S * an.k * (an.seated ? 1.08 : 1);
}

/** giro do pé pra fora (graus): apoio quase de frente, perna livre ~20°, sentado apontando pra gente */
export function footYaw(an: Anatomy, side: Side): number {
  if (an.seated) return 6;
  const w = an.rest.weight;
  if (w == null) return 13;
  return w === side ? 9 : 20;
}

/** referencial do pé (grupo shinX): tornozelo da anatomia, escala do tipo de corpo, giro e calcanhar erguido */
export function footFrame(an: Anatomy, side: Side): FootFrame {
  const a = side === 'L' ? an.joints.ankleL : an.joints.ankleR;
  const sg = side === 'L' ? -1 : 1;
  const s = footScale(an);
  const yaw = footYaw(an, side);
  const th = (yaw * Math.PI) / 180;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const ph = (FOOT_PITCH * Math.PI) / 180;
  const cph = Math.cos(ph) * FOOT_SH;
  const sph = Math.sin(ph);
  // perna livre: o calcanhar sobe (o pé gira na bola); o tornozelo da anatomia já subiu o mesmo tanto
  const free = !an.seated && an.rest.weight != null && an.rest.weight !== side;
  const tb = free ? 0.6 / ((FOOT_VB - FOOT_VA) * s * cph) : 0;
  const lift = (v: number) => Math.max(0, FOOT_VB - v) * tb;
  const H0 = FOOT_HA + lift(FOOT_VA);
  const uk = 1.04;
  const P = (u: number, v: number, h: number): Pt => {
    const dv = (v - FOOT_VA) * FOOT_SV;
    const depth = dv * ct - u * uk * st;
    return [a[0] + sg * s * (u * uk * ct + dv * st), a[1] + s * ((H0 - h - lift(v)) * cph + depth * sph)];
  };
  return {
    P,
    s,
    yaw,
    side,
    outer: (v) => tab(FOOT_V, FOOT_OUT, v),
    inner: (v) => tab(FOOT_V, FOOT_IN, v),
    top: (v) => tab(FOOT_V, FOOT_TOP, v),
  };
}

/** casco convexo (cadeia monótona) */
function hull2(pts: Pt[]): Pt[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** tira vértices muito próximos (a spline suave fica sem "dente") */
function sparse(pts: Pt[], min: number): Pt[] {
  const out: Pt[] = [];
  for (const q of pts) if (!out.length || Math.hypot(q[0] - out[out.length - 1][0], q[1] - out[out.length - 1][1]) >= min) out.push(q);
  if (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < min) out.pop();
  return out;
}

/**
 * silhueta projetada de um volume do pé (casco convexo dos anéis da sola e do cabedal). `ease` engorda (calçado),
 * `toe` alonga o bico (bota, sapato social), `topH` = altura do cabedal (pé unitário; padrão: a do tênis),
 * `v0`/`v1` recortam o volume ao longo do pé (biqueira = v0 7,2) e `h0`/`h1` na altura (entressola = h1 1,1).
 */
export function footHull(fr: FootFrame, o: { ease?: number; toe?: number; topH?: number; v0?: number; v1?: number; h0?: number; h1?: number; wk?: number } = {}): Pt[] {
  const e = (o.ease ?? 0) / fr.s;
  const toe = (o.toe ?? 0) / fr.s;
  const v0 = o.v0 ?? 0;
  const v1 = o.v1 ?? FOOT_LEN;
  const wk = o.wk ?? 1;
  const pts: Pt[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const vv = v0 + ((v1 - v0) * i) / N;
    // o bico alonga só da bola pra frente
    const vs = vv <= 6.2 ? vv : 6.2 + (vv - 6.2) * (1 + toe / (FOOT_LEN - 6.2));
    const wo = (fr.outer(vv) + e) * wk;
    const wi = (fr.inner(vv) + e) * wk;
    const top = Math.min(o.h1 ?? 99, (o.topH != null ? Math.min(o.topH, fr.top(vv) + 1.2) : fr.top(vv)) + e * 0.35);
    const bot = Math.max(0, o.h0 ?? 0) - (o.h0 ? 0 : e * 0.15);
    const rings: [number, number][] = [
      [bot, 1],
      [Math.min(top, bot + 1.0), 1.04],
      [bot + (top - bot) * 0.55, 0.98],
      [top, 0.55],
    ];
    for (const [h, k] of rings) {
      pts.push(fr.P(wo * k, vs, h), fr.P(-wi * k, vs, h));
    }
  }
  return sparse(hull2(pts), 0.45 * fr.s);
}

/** caixa do pé (grupo shinX): o calçado ocupa x..x+w, y..y+h; cx = centro */
export function footBox(an: Anatomy, side: Side): { x: number; y: number; w: number; h: number; cx: number } {
  const h = footHull(footFrame(an, side), { ease: 0.8 });
  const xs = h.map((p) => p[0]);
  const ys = h.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: x1 - x0, h: Math.max(...ys) - y0, cx: (x0 + x1) / 2 };
}

/**
 * pé descalço/base do calçado (grupo shinX): silhueta do volume 3D do pé na câmera do avatar (de frente, um pouco de
 * cima, girado pra fora conforme a perna). `ease` engorda (calçado); `toe` alonga o bico (bota, sapato social);
 * `top` = y da boca do calçado (padrão: a altura do tênis, logo acima do tornozelo).
 */
export function footPts(an: Anatomy, side: Side, o: { ease?: number; toe?: number; top?: number } = {}): SP[] {
  const fr = footFrame(an, side);
  let topH: number | undefined;
  if (o.top != null) {
    const a = side === 'L' ? an.joints.ankleL : an.joints.ankleR;
    topH = FOOT_HA + (a[1] - o.top) / fr.s;
  }
  return footHull(fr, { ease: o.ease, toe: o.toe, topH });
}

export function footPath(an: Anatomy, side: Side, o: { ease?: number; toe?: number; top?: number } = {}): string {
  return smoothPath(footPts(an, side, o), true);
}

export interface HandShapes {
  /** dorso + dedos (silhueta) — na mão aberta, palma + dedos */
  hand: string;
  /** polegar */
  thumb: string;
  /** vincos entre os dedos (mão aberta: dobras das falanges) */
  grooves: string[];
  /** brilho dos nós dos dedos (mão aberta: almofadas das pontas dos dedos) */
  knuckle: string;
  /** unhas visíveis (pontas) (mão aberta: linhas da palma) */
  nails: string;
  /** sombra entre o polegar e o indicador */
  web: string;
  palm: Pt;
  tip: Pt;
}

/**
 * Mão (grupo foreX), em três-quartos de costas: palma com volume, dedos em grupos (indicador · médio+anelar ·
 * mindinho) com separação nas pontas e leve curvatura pra dentro, linha dos nós e polegar saindo da lateral da palma
 * com articulação. O pulso tem exatamente a largura da ponta do antebraço (sem degrau).
 * `open` = mão aberta de 5 dedos com a palma pra fora (aceno, oi) — pras animações que trocam a mão.
 */
export function handShapes(an: Anatomy, side: Side, o: { open?: boolean } = {}): HandShapes {
  const j = an.joints;
  const w = side === 'L' ? j.wristL : j.wristR;
  const e = side === 'L' ? j.elbowL : j.elbowR;
  const s = an.spec.hand;
  let ux = w[0] - e[0];
  let uy = w[1] - e[1];
  const L = Math.hypot(ux, uy) || 1;
  ux /= L;
  uy /= L;
  // repouso muda a mão: na cintura ela desce pela LATERAL do quadril (dedos pra baixo e um pouco pra frente, em escorço,
  // polegar escondido atrás); no bolso os dedos pendem na frente do bolso; no passante e no colo dobra no pulso
  const restArm = side === 'L' ? an.rest.armL : an.rest.armR;
  let fa = 1; // escorço ao longo da mão (1 = de lado; < 1 = vindo pra frente/pra trás)
  let fo = 1; // escorço na largura (mão vista mais de quina)
  if (!o.open) {
    if (restArm === 'hip') {
      const n = Math.hypot(0.12, 1);
      ux = (side === 'L' ? 0.12 : -0.12) / n;
      uy = 1 / n;
      fa = 0.72;
      fo = 0.88;
    } else if (restArm === 'pocket' || restArm === 'soft' || restArm === 'lap') {
      // sentado: a mão dobra no pulso e pousa em cima da coxa (dedos descendo pro joelho)
      const k = restArm === 'pocket' ? 0.6 : restArm === 'lap' ? 0.4 : 0.75;
      const nx = ux * (1 - k);
      const ny = uy * (1 - k) + k;
      const n = Math.hypot(nx, ny) || 1;
      ux = nx / n;
      uy = ny / n;
      if (restArm === 'pocket') fa = 0.86;
    }
  }
  // lado de fora da mão (longe do corpo): esquerda da tela no braço L
  const sg = side === 'L' ? -1 : 1;
  // base local: a = ao longo do antebraço (pra baixo), o = pra fora do corpo (lado do mindinho)
  let hx = -uy;
  let hy = ux;
  if (Math.sign(hx || 1) !== sg) {
    hx = -hx;
    hy = -hy;
  }
  const ww = an.spec.wrist / s;
  const P = (along: number, out: number, sm?: number): SP => {
    const al = along * fa;
    // (o pulso mantém a largura do antebraço: o escorço da largura entra aos poucos depois dele)
    const ou = out * (along <= 0.5 ? 1 : along >= 2 ? fo : 1 + (fo - 1) * ((along - 0.5) / 1.5));
    const x = w[0] + (ux * al + hx * ou) * s;
    const y = w[1] + (uy * al + hy * ou) * s;
    return sm == null ? [x, y] : [x, y, sm];
  };
  const pt = (p: SP): Pt => [p[0], p[1]];
  if (o.open) {
    // mão aberta com a PALMA pra câmera (aceno, oi, comemoração): polegar do lado de fora (posição anatômica: com o
    // braço erguido ele aponta pra cabeça), dedos levemente abertos em leque, mindinho mais curto, almofadas das
    // pontas, linhas da palma e dobras das falanges
    const Q = (a: number, out: number, sm?: number) => P(a, -out, sm);
    const fingers: [number, number, number][] = [
      // [ângulo (rad, + = pro lado do mindinho), comprimento, meia-largura]
      [0.36, 3.9, 0.5],
      [0.12, 5.0, 0.56],
      [-0.1, 5.4, 0.58],
      [-0.32, 5.0, 0.57],
    ];
    const base = 4.2;
    const outline: SP[] = [Q(-0.6, ww), Q(1.3, ww + 0.4), Q(3.4, 2.15)];
    let creasesD = '';
    let pads = '';
    for (const [ang, len, hw] of fingers) {
      const bx = base;
      const by = Math.sin(ang) * 2.5;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const tx = bx + ca * len;
      const ty = by + sa * len;
      const nx = -sa;
      const ny = ca;
      outline.push(Q(bx + nx * hw * 0.9, by + ny * hw * 0.9 + 0.1, 0.6), Q(tx + nx * hw * 0.92, ty + ny * hw * 0.92), Q(tx + ca * 0.55, ty + sa * 0.55), Q(tx - nx * hw * 0.92, ty - ny * hw * 0.92), Q(bx - nx * hw * 0.9, by - ny * hw * 0.9 - 0.1, 0.6));
      for (const k of [0.42, 0.72]) {
        const cx0 = bx + ca * len * k;
        const cy0 = by + sa * len * k;
        creasesD += taperPath([Q(cx0 + nx * hw * 0.7, cy0 + ny * hw * 0.7), Q(cx0 + ca * 0.08, cy0 + sa * 0.08), Q(cx0 - nx * hw * 0.7, cy0 - ny * hw * 0.7)], [0, 0.16 * s, 0]);
      }
      pads += smoothPath([Q(tx - ca * 0.15 + nx * hw * 0.55, ty - sa * 0.15 + ny * hw * 0.55), Q(tx + ca * 0.32, ty + sa * 0.32), Q(tx - ca * 0.15 - nx * hw * 0.55, ty - sa * 0.15 - ny * hw * 0.55), Q(tx - ca * 0.9, ty - sa * 0.9)]);
    }
    outline.push(Q(3.0, -2.05), Q(1.0, -ww - 0.35), Q(-0.6, -ww));
    const thumb: SP[] = [Q(0.8, -1.3), Q(1.7, -2.5), Q(2.9, -3.8), Q(3.85, -4.35), Q(4.2, -3.75), Q(3.4, -2.55), Q(2.6, -1.3)];
    // linhas da palma: "do coração" atravessando embaixo dos dedos e "da vida" contornando a base do polegar
    const palmLines = taperPath([Q(3.5, 2.0), Q(3.2, 0.6), Q(3.4, -0.9)], [0, 0.22 * s, 0]) + taperPath([Q(3.2, -1.4), Q(1.9, -1.0), Q(0.6, -0.4)], [0, 0.22 * s, 0]);
    return {
      hand: smoothPath(outline, true),
      thumb: smoothPath(thumb, true),
      grooves: [creasesD],
      knuckle: pads,
      nails: palmLines,
      web: smoothPath([Q(1.0, -1.1), Q(2.4, -2.1), Q(2.9, -1.3), Q(1.8, -0.6)], true),
      palm: pt(Q(2.4, -0.2)),
      tip: pt(Q(9.4, 0)),
    };
  }
  // ---- mão relaxada (três-quartos de costas)
  // lado de fora (mindinho) descendo, pontas (mindinho → indicador), lado de dentro (indicador) subindo até o pulso.
  // O pulso tem a largura exata da ponta do antebraço (ww) e a palma alarga aos poucos: sem degrau nem "punho de luva".
  const hand: SP[] = [
    P(-0.4, ww),
    P(1.2, ww + 0.12),
    P(2.6, 1.95),
    P(4.0, 2.05),
    // mindinho
    P(5.6, 1.92),
    P(6.9, 1.62),
    P(7.6, 1.18, 0.8),
    P(7.38, 0.78, 0.3),
    // anelar
    P(8.5, 0.72),
    P(9.3, 0.26, 0.8),
    P(9.1, -0.1, 0.3),
    // médio
    P(9.75, -0.22),
    P(10.1, -0.7, 0.8),
    P(9.78, -1.15, 0.3),
    // indicador
    P(9.55, -1.32),
    P(9.2, -1.85, 0.8),
    P(8.4, -2.12),
    P(6.5, -2.28),
    P(5.0, -2.24),
    P(3.4, -2.05),
    P(2.0, -1.78),
    P(0.8, -ww - 0.04),
    P(-0.4, -ww),
  ];
  // polegar: sai da lateral de dentro da palma, articulação no meio, ponta pra baixo/dentro na frente do indicador
  const thumb: SP[] = [P(1.2, -1.15), P(2.2, -2.25), P(3.6, -2.82), P(5.0, -2.92), P(5.95, -2.68), P(6.2, -2.28, 0.8), P(5.85, -1.95), P(4.6, -1.95), P(3.4, -1.82), P(2.2, -1.2)];
  const grooves = [
    // mindinho | anelar
    taperPath([P(4.9, 1.2), P(6.3, 1.02), P(7.38, 0.8)], [0, 0.24 * s, 0.1 * s], { n: 6 }),
    // anelar | médio
    taperPath([P(5.2, 0.18), P(7.4, 0.02), P(9.1, -0.08)], [0, 0.24 * s, 0.08 * s], { n: 6 }),
    // médio | indicador
    taperPath([P(5.1, -0.98), P(7.6, -1.12), P(9.72, -1.16)], [0, 0.26 * s, 0.08 * s], { n: 6 }),
  ];
  // nós dos dedos: um brilho curto em cada dedo (linha inclinada: o do indicador mais baixo)
  const knuckle = [
    [4.15, 1.45],
    [4.4, 0.42],
    [4.6, -0.6],
    [4.75, -1.62],
  ]
    .map(([a, b]) => smoothPath([P(a - 0.32, b), P(a, b + 0.36), P(a + 0.32, b), P(a, b - 0.36)]))
    .join('');
  const nails = smoothPath([P(9.0, -1.72), P(9.4, -1.48), P(9.2, -1.25), P(8.75, -1.48)]) + smoothPath([P(9.6, -0.88), P(9.95, -0.66), P(9.75, -0.42), P(9.35, -0.62)]);
  // sombra entre polegar e indicador (o vão) e as pontas dobradas pra dentro
  const web = smoothPath([P(1.8, -1.35), P(3.4, -1.95), P(5.4, -2.2), P(4.0, -1.55)], true);
  return { hand: smoothPath(hand, true), thumb: smoothPath(thumb, true), grooves, knuckle, nails, web, palm: pt(P(3.4, 0)), tip: pt(P(9.4, -0.4)) };
}

/** disco da junta (cotovelo/joelho): no grupo de CIMA, por baixo da peça, na cor do que aparece na dobra */
export function jointPath(an: Anatomy, which: 'elbowL' | 'elbowR' | 'kneeL' | 'kneeR', r?: number): string {
  const j = an.joints;
  const p = which === 'elbowL' ? j.elbowL : which === 'elbowR' ? j.elbowR : which === 'kneeL' ? j.kneeL : j.kneeR;
  const rr = r ?? (which.startsWith('elbow') ? an.spec.elbow : an.spec.knee);
  return ellipse(p[0], p[1], rr, rr);
}

// ---------------------------------------------------------------------------------------------------------------
// Cabeça
// ---------------------------------------------------------------------------------------------------------------

/** âncoras do rosto e da cabeça (grupo 'head') */
export interface HeadAnchors {
  /** escala da cabeça (medidas de olho, nariz e boca multiplicam por isto) */
  s: number;
  /** centro dos olhos */
  eyeL: Pt;
  eyeR: Pt;
  /** meia-largura do olho (já com o tipo de olho e a variação da pessoa) */
  eyeW: number;
  /** escala dos traços do olho (abertura, íris, vinco): cabeça × olho adulto × tipo de olho × variação */
  eyeS: number;
  /** altura das sobrancelhas (no meio delas) e o centro de cada uma */
  browY: number;
  browL: Pt;
  browR: Pt;
  /** ponte do nariz (entre os olhos) e ponta do nariz */
  noseBridge: Pt;
  nose: Pt;
  /** meia-largura das asas do nariz */
  noseW: number;
  /** centro da boca e meia-largura */
  mouth: Pt;
  mouthW: number;
  /** espessura dos lábios (cima/baixo) */
  lipUp: number;
  lipLo: number;
  /** centro das orelhas e raio aproximado */
  earL: Pt;
  earR: Pt;
  earR0: number;
  /** topo da cabeça (sem cabelo) */
  top: Pt;
  /** linha do cabelo na testa (y no centro) */
  hairline: number;
  /** centro da testa */
  forehead: Pt;
  /** nuca: onde o cabelo de trás nasce, atrás do pescoço */
  nape: Pt;
  /** queixo */
  chin: Pt;
  /** bochechas (blush, pintura) e o alto das maçãs (luz do zigomático) */
  cheekL: Pt;
  cheekR: Pt;
  cheekboneL: Pt;
  cheekboneR: Pt;
  /** têmporas e ângulos da mandíbula */
  templeL: Pt;
  templeR: Pt;
  jawL: Pt;
  jawR: Pt;
  /** meias-larguras úteis */
  craniumW: number;
  cheekW: number;
  /** contorno do rosto + crânio (pra recortes: sombra do cabelo na testa, brilho, barba) */
  headPath: string;
  /** só o crânio (calota acima da linha das orelhas), pra cabelo raspado/touca */
  skullPath: string;
}

/**
 * idade: o rosto NÃO alarga (nada de "retângulo inchado"). A maçã afina um pouco (vão sob o malar), o ângulo da mandíbula
 * amacia e desce de leve; a papada é uma sombra macia ABAIXO da linha da mandíbula (desenhada no pescoço, parts/body.ts).
 */
function agedFace(an: Anatomy): FaceSpec {
  const f = an.face;
  const a = an.feat.age;
  if (!a) return f;
  return { ...f, jawY: f.jawY + 0.2 * a, jawSharp: f.jawSharp * (1 - 0.15 * a), cheek: f.cheek - 0.2 * a, temple: f.temple - 0.1 * a };
}

/** pontos do contorno da cabeça (rosto + crânio), horário a partir do topo — spline única, tangente contínua */
export function headPts(an: Anatomy, ease = 0): SP[] {
  const { cx, cy, s } = an.head;
  const f = agedFace(an);
  const T = cy + CROWN_DY * s;
  const X = (d: number) => cx + d * s;
  const Yh = (d: number) => cy + d * s;
  const js = f.jawSharp;
  const mid = (a: number, b: number, t: number) => a + (b - a) * t;
  const half: SP[] = [
    [X(f.cranium * 0.56), T + 1.05 * s],
    [X(f.cranium * 0.9), T + 3.7 * s],
    [X(f.cranium), Yh(-4.4)],
    [X(mid(f.temple, f.cranium, 0.25)), Yh(-1.6)],
    [X(f.cheek), Yh(f.cheekY)],
    [X(mid(f.cheek, f.jaw, 0.42 - js * 0.12)), Yh(mid(f.cheekY, f.jawY, 0.55))],
    [X(f.jaw), Yh(f.jawY), 1 - js * 0.45],
    [X(mid(f.jaw, f.chinW, 0.55 + js * 0.1)), Yh(mid(f.jawY, f.chinY, 0.6 + js * 0.06))],
    [X(f.chinW), Yh(f.chinY - (f.flatChin ? 0.22 : 0.5)), f.flatChin ? 0.7 : 1],
  ];
  const pts: SP[] = [[cx, T], ...half, [cx, Yh(f.chinY)], ...mirrorPts(half, cx)];
  return ease ? offsetPts(pts, ease) : pts;
}

/** medidas do rosto já na escala da cabeça (meias-larguras e alturas relativas ao centro da cabeça) + topo do crânio */
export function faceDims(an: Anatomy): FaceSpec & { crownY: number; s: number } {
  const f = agedFace(an);
  const s = an.head.s;
  return {
    ...f,
    cranium: f.cranium * s,
    temple: f.temple * s,
    cheek: f.cheek * s,
    cheekY: f.cheekY * s,
    jaw: f.jaw * s,
    jawY: f.jawY * s,
    chinW: f.chinW * s,
    chinY: f.chinY * s,
    crownY: an.head.cy + CROWN_DY * s,
    s,
  };
}

/** contorno da cabeça (rosto + crânio) no grupo 'head'; `ease` = folga (touca, capuz justo) */
export function headPath(an: Anatomy, ease = 0): string {
  return smoothPath(headPts(an, ease), true);
}

/**
 * calota do cabelo/chapéu: contorno do crânio afastado `lift` (volume) até a linha `bottomY` (padrão: altura das
 * orelhas), fechada por uma curva de franja que desce `fringe` no meio. Base pra cabelos curtos e toucas.
 */
export function capPath(an: Anatomy, o: { lift?: number; bottomY?: number; fringe?: number; sideDrop?: number } = {}): string {
  const { cx, cy, s } = an.head;
  const f = { cranium: an.face.cranium * s, temple: an.face.temple * s };
  const lift = o.lift ?? 1;
  const T = cy + CROWN_DY * s - lift;
  const by = o.bottomY ?? cy - 0.5;
  const W = f.cranium + lift;
  const fr = o.fringe ?? 0;
  const sd = o.sideDrop ?? 0;
  const pts: SP[] = [
    [cx, T],
    [cx + W * 0.62, T + 1.25 + lift * 0.1],
    [cx + W * 0.95, T + 4.6],
    [cx + W + 0.05, cy - 4.3 * s],
    [cx + Math.max(f.temple, f.cranium) + lift * 0.6, by + sd, 0],
    [cx + f.temple * 0.62, by - 2.6 + fr * 0.5],
    [cx, by - 3.0 + fr],
    [cx - f.temple * 0.62, by - 2.6 + fr * 0.5],
    [cx - Math.max(f.temple, f.cranium) - lift * 0.6, by + sd, 0],
    [cx - W - 0.05, cy - 4.3 * s],
    [cx - W * 0.95, T + 4.6],
    [cx - W * 0.62, T + 1.25 + lift * 0.1],
  ];
  return smoothPath(pts, true);
}

export function headAnchors(an: Anatomy): HeadAnchors {
  const { cx, cy, s } = an.head;
  const f = agedFace(an);
  const ft = an.feat;
  const X = (d: number) => cx + d * s;
  const Yh = (d: number) => cy + d * s;
  const ep = EYE_PLACE[ft.eyes] ?? EYE_PLACE.almond;
  const np = NOSE_PLACE[ft.nose] ?? NOSE_PLACE.soft;
  const lp = LIP_PLACE[ft.nose] ?? LIP_PLACE.soft;
  const jit = ft.jit;
  // olhos: altura fixa a partir do crânio; espaçamento pela largura das maçãs, tipo de olho e variação da pessoa
  // olhos na metade da cabeça (adulto): topo do crânio → olho = olho → queixo, com o ajuste do formato e do tipo
  const eyeY = (CROWN_DY + f.chinY) / 2 + 0.05 + f.eyeDy + ep.dy;
  // tamanho do olho varia ±10% por pessoa (além do formato)
  const eyeK = EYE_SCALE * ep.size * (1 + jit.size * 0.1);
  const eyeDx = 4.05 + (f.cheek - 8.5) * 0.32 + ep.dx * 0.9 + jit.eye * 0.22;
  const eyeW = 2.3 * eyeK;
  const browY = eyeY - (BROW_GAP[ft.brows] ?? 2.4) - jit.brow * 0.18;
  // terço de baixo: nariz e boca proporcionais à distância olho → queixo (nariz → queixo maior que olho → nariz)
  const low = f.chinY - eyeY;
  // terço do meio de adulto (nariz mais longo: +0,4) e filtro labial visível (+0,25)
  // (a idade alonga o nariz só um pouco e nunca soma no aquilino: nariz comprido + idade = "bruxa")
  const noseY = eyeY + low * 0.4 + np.len + 0.6 + jit.nose * 0.2 + ft.age * (np.len > 0.5 ? 0 : 0.15);
  const mouthY = noseY + (f.chinY - noseY) * 0.37 - lp.up * 0.15 + 0.25;
  // largura da boca e espessura dos lábios são traços da PESSOA (não só do tipo de nariz): ±10% na largura, ±22% nos lábios
  const mouthW = (3.3 + lp.w + f.mouthW + jit.mouth * 0.42 - ft.age * 0.1) * s;
  const lipK = 1 + jit.lip * 0.22;
  const lipLoK = 1 + jit.lipLo * 0.2;
  // orelha encostada na cabeça (de frente quase não sai da silhueta): só a hélice aparece além da maçã
  const earX = f.cheek - 0.15;
  const earY = (browY + noseY + 1.0) / 2;
  const asym = jit.asym * 0.12 * s;
  return {
    s,
    eyeL: [X(-eyeDx), Yh(eyeY) + asym],
    eyeR: [X(eyeDx), Yh(eyeY) - asym],
    eyeW: eyeW * s,
    eyeS: eyeK * s,
    browY: Yh(browY),
    browL: [X(-eyeDx - 0.2), Yh(browY)],
    browR: [X(eyeDx + 0.2), Yh(browY)],
    noseBridge: [cx, Yh(eyeY + 0.3)],
    nose: [cx, Yh(noseY)],
    noseW: np.alar * s,
    mouth: [cx, Yh(mouthY)],
    mouthW,
    lipUp: lp.up * s * lipK * (1 - ft.age * 0.28),
    lipLo: lp.lo * s * lipLoK * (1 - ft.age * 0.2),
    earL: [X(-earX), Yh(earY)],
    earR: [X(earX), Yh(earY)],
    earR0: 2.2 * s * (1 + ft.age * 0.06),
    top: [cx, Yh(CROWN_DY)],
    hairline: Yh(-7.6),
    forehead: [cx, Yh(-5.2)],
    nape: [cx, Yh(8)],
    chin: [cx, Yh(f.chinY)],
    cheekL: [X(-f.cheek + 2.7), Yh(eyeY + 3.2)],
    cheekR: [X(f.cheek - 2.7), Yh(eyeY + 3.2)],
    cheekboneL: [X(-f.cheek + 2.0), Yh(eyeY + 2.1)],
    cheekboneR: [X(f.cheek - 2.0), Yh(eyeY + 2.1)],
    templeL: [X(-f.temple), Yh(-1.9)],
    templeR: [X(f.temple), Yh(-1.9)],
    jawL: [X(-f.jaw), Yh(f.jawY)],
    jawR: [X(f.jaw), Yh(f.jawY)],
    craniumW: f.cranium * s,
    cheekW: f.cheek * s,
    headPath: headPath(an),
    skullPath: capPath(an, { lift: 0, bottomY: cy + 0.5 * s, fringe: 0 }),
  };
}

/** orelha (grupo 'head'): hélice (contorno externo), concha (sombra interna), anti-hélice e lóbulo */
export function earShapes(an: Anatomy, side: Side): { ear: string; inner: string; rim: string; lobe: string } {
  const ha = headAnchors(an);
  const c = side === 'L' ? ha.earL : ha.earR;
  const sg = side === 'L' ? -1 : 1;
  const k = ha.s * 0.9 * (1 + an.feat.age * 0.07);
  const X = (d: number) => c[0] + sg * d * k;
  const Y = (d: number) => c[1] + d * k;
  const ear: SP[] = [
    [X(-1.25), Y(-3.0)],
    [X(0.15), Y(-3.35)],
    [X(1.2), Y(-2.5)],
    [X(1.4), Y(-0.6)],
    [X(1.0), Y(1.4)],
    [X(0.55), Y(2.9)],
    [X(-0.25), Y(3.4)],
    [X(-0.95), Y(3.0)],
    [X(-1.35), Y(1.6)],
  ];
  const inner: SP[] = [
    [X(-0.45), Y(-2.0)],
    [X(0.5), Y(-2.1)],
    [X(0.75), Y(-0.7)],
    [X(0.3), Y(1.1)],
    [X(-0.35), Y(1.35)],
    [X(-0.7), Y(-0.2)],
  ];
  const rim = taperPath(
    [
      [X(-0.6), Y(-2.6)],
      [X(0.65), Y(-2.55)],
      [X(0.95), Y(-0.8)],
      [X(0.5), Y(1.05)],
    ],
    [0, 0.42 * k, 0.36 * k, 0],
    { n: 7 },
  );
  const lobe = smoothPath([
    [X(-0.3), Y(1.9)],
    [X(0.45), Y(2.15)],
    [X(0.2), Y(3.1)],
    [X(-0.45), Y(3.05)],
  ]);
  return { ear: smoothPath(ear, true), inner: smoothPath(inner, true), rim, lobe };
}

/**
 * silhueta neutra do corpo (manequim, sem detalhe): lista de paths no espaço do avatar em repouso, pra pintar com uma
 * cor só — placeholder do mapa enquanto o avatar carrega, prova de tipos de corpo. Ordem de desenho já resolvida.
 */
export function silhouettePaths(an: Anatomy): string[] {
  const out: string[] = [];
  for (const s of ['L', 'R'] as const) out.push(thighPath(an, s), shinPath(an, s), footPath(an, s));
  out.push(torsoPath(an));
  // pescoço reto que só abre no trapézio perto da gola (mesmo desenho do corpo: nada de cilindro)
  const nk = an.w.neck;
  const cyS = an.collarY - 2.6;
  const cw = an.collarW;
  const top = an.head.cy + 4.2 * an.head.s;
  out.push(smoothPath([[an.cx - nk + 0.2, top, 0], [an.cx - nk * 0.97, cyS - 4.6], [an.cx - nk - 0.15, cyS - 2.6], [an.cx - nk - 1.0, cyS - 0.95], [an.cx - cw, cyS + 0.6, 0.5], [an.cx, an.collarY + 1], [an.cx + cw, cyS + 0.6, 0.5], [an.cx + nk + 1.0, cyS - 0.95], [an.cx + nk + 0.15, cyS - 2.6], [an.cx + nk * 0.97, cyS - 4.6], [an.cx + nk - 0.2, top, 0]], true));
  for (const s of ['L', 'R'] as const) out.push(upperArmPath(an, s), forearmPath(an, s), handShapes(an, s).hand);
  out.push(headPath(an));
  return out;
}

/**
 * quanto o cabelo (ou o chapéu) sobe acima do topo do crânio, em unidades da cabeça (multiplique pela escala): o
 * recorte de busto usa pra não cortar o black power e não deixar espaço vazio em cima do cabelo curto
 */
export const HAIR_LIFT: Record<string, number> = {
  bald: 0.3, buzz: 0.6, short: 1.9, side: 1.6, quiff: 4.5, long: 1.9, bob: 1.6, wavy: 2.2, ponytail: 1.8, bun: 9.0, braids: 1.6, curly: 3.8, afro: 6.2, mohawk: 10, dreads: 2.2,
  receding: 1.2, thinning: 0.8, classic: 2.0, pixie: 1.9, updo: 4.4, low_bun: 1.2, curtain: 1.8, twists: 3.2, cornrows: 0.7, space_buns: 5.0, undercut: 3.0, long_curly: 4.2, afro_puff: 8.5, pompadour: 6.0, mullet: 2.0, side_shave: 2.0, braid_crown: 2.2,
};

/** HAIR_LIFT do cabelo com este chapéu (a crista do moicano achata embaixo de coroa/tiara/chapéu de festa) */
export function hairLiftOf(hair: string | null | undefined, hat: string | null | undefined, fallback = 2): number {
  if (!hair) return fallback;
  if (hair === 'mohawk' && hatFlattensCrest(hat)) return 1.6;
  return HAIR_LIFT[hair] ?? 2;
}

/**
 * recorte de busto (cabeça + ombros, quadrado) desta pessoa, com o cabelo dela: o topo fica 1 acima do cabelo e os olhos
 * a ~42% da altura (miniatura de 56 px bem enquadrada em qualquer estatura e cabelo). Sem `cfg`, supõe cabelo curto.
 * Pedido ao dono do CruzeiAvatar/palco: usar este no modo 'bust' em vez do recorte fixo AVATAR_BUST_VIEWBOX.
 */
export function bustViewBox(an: Anatomy, cfg?: Partial<Pick<AvatarConfig, 'hair' | 'hat'>>): { x: number; y: number; w: number; h: number } {
  const f = faceDims(an);
  const hairLift = hairLiftOf(cfg?.hair, cfg?.hat, 1.9);
  // chapéu alto (cartola, bruxa, festa, coroa): no máximo ~3 de reserva acima do cabelo — a ponta é cortada pelo
  // círculo em vez de o rosto encolher 15–20% na miniatura de 56 px
  const lift = Math.min(hatLiftOf(cfg?.hat, hairLift), hairLift + 3.0);
  const top = Math.max(0, f.crownY - lift * an.head.s - 1);
  const eyeY = headAnchors(an).eyeL[1];
  // olhos a 42% da altura; tamanho limitado (cabelo muito alto não encolhe demais o rosto; nem fica colado no ombro)
  const h = Math.max(36, Math.min(50, (eyeY - top) / 0.42));
  const y = Math.min(top, eyeY - h * 0.42);
  return { x: an.cx - h / 2, y, w: h, h };
}

/** sombra elíptica no chão (grupo 'shadow') */
export function groundShadowPath(an: Anatomy): string {
  return ellipse(an.cx, an.foot.groundY, an.w.hip + 11, 3.4);
}
