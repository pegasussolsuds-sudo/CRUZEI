// Rosto: estrutura (arco da sobrancelha, órbita, maçã do rosto, filtro, queixo), nariz esculpido por planos de sombra,
// marcas do tempo e detalhes (sardas, pinta, vitiligo, glitter, estrelinha) e a EXPRESSÃO (sobrancelhas, olhos, boca,
// bochecha subindo e rubor, etiquetadas k:'face' pro palco trocar durante as animações).
// Dono: diretor de arte.
//
// ASSINATURA DO ROSTO METCH (ver STYLE.md):
//   - olho: linha dos cílios como forma afilada que engrossa no terço de fora e termina num "flick" curto (nada de
//     cílios espetados); íris grande com anel escuro, luz que entra por baixo, reflexo grande em cima-esquerda e um
//     pequeno embaixo-direita; a pálpebra de cima projeta sombra no branco e cobre parte da íris (a íris NÃO sobe com a
//     abertura: pálpebra a meio = olhar tranquilo/cool);
//   - nariz: plano lateral da ponte em sombra do lado direito, luz na ponte e na ponta, asas como formas, sombra embaixo
//     da ponta e sombra projetada no lábio de cima — nunca contorno;
//   - boca: lábio de cima mais escuro com arco do cupido, linha de junção mais escura no meio, lábio de baixo com luz e
//     sombra embaixo; no sorriso a bochecha sobe e empurra a pálpebra de baixo;
//   - estrutura: sombras recortadas de borda macia (não aerógrafo), rubor só quando a expressão/maquiagem pede.
//
// Etapas do orquestrador (layers.ts):  17 faceBase (estrutura + nariz + marcas + detalhes)  ·  19 expression (k:'face')
// Contrato da expressão: TODA camada de expressão sai com k:'face' (o orquestrador já liga a etiqueta antes de chamar);
// o palco monta a mesma config com outro `face` e troca só essas camadas. Batom, delineado e make glam acompanham a
// expressão (o olho fechado leva o delineado junto), por isso moram aqui.

import { faceDims, headAnchors, smoothPath, taperPath, type HeadAnchors, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { ellipse } from '../geometry';
import { blob, heartPath, isLite, lodCtx, lum, mix, saturate, speckle, starPath, type SkinTones } from '../shading';
import type { AvatarLayer, Pt } from '../types';

import { tonesOf } from './body';

// ---------------------------------------------------------------------------------------------------------------
// especificações (formatos)
// ---------------------------------------------------------------------------------------------------------------

/** olho (cabeça unitária): abertura de cima/baixo, inclinação, pico, queda, vinco, dobra, linha dos cílios, íris */
interface EyeSpec {
  up: number;
  lo: number;
  /** canto de fora: negativo = sobe */
  tilt: number;
  /** onde fica o ponto mais alto da pálpebra de cima (u: -1 canto de fora … +1 canto de dentro) */
  peak: number;
  /** ponto mais baixo da pálpebra de baixo */
  loPeak: number;
  /** quanto o canto de fora da pálpebra de cima cai (olho caído) 0..1 */
  droop: number;
  /** altura do vinco acima da pálpebra (0 = sem vinco: monolid/encoberta) */
  crease: number;
  /** dobra de pele por cima da pálpebra (pálpebra encoberta) */
  hood: number;
  /** espessura da linha dos cílios no canto de fora */
  lid: number;
  iris: number;
  /** quanto a pálpebra de cima cobre a íris em repouso (0..1) */
  cover: number;
}

const EYES: Record<string, EyeSpec> = {
  almond: { up: 1.22, lo: 0.7, tilt: -0.28, peak: 0.12, loPeak: -0.15, droop: 0, crease: 0.82, hood: 0, lid: 0.3, iris: 1.0, cover: 0.24 },
  round: { up: 1.62, lo: 1.14, tilt: 0.02, peak: 0.02, loPeak: 0, droop: 0, crease: 1.08, hood: 0, lid: 0.27, iris: 1.06, cover: 0.06 },
  upturned: { up: 1.12, lo: 0.6, tilt: -0.8, peak: 0.28, loPeak: -0.4, droop: 0, crease: 0.74, hood: 0, lid: 0.31, iris: 0.98, cover: 0.26 },
  downturned: { up: 1.26, lo: 0.8, tilt: 0.62, peak: 0.42, loPeak: 0.22, droop: 0.5, crease: 0.86, hood: 0, lid: 0.28, iris: 1.02, cover: 0.3 },
  monolid: { up: 0.86, lo: 0.6, tilt: -0.38, peak: -0.05, loPeak: -0.1, droop: 0, crease: 0, hood: 0, lid: 0.36, iris: 0.96, cover: 0.36 },
  hooded: { up: 1.02, lo: 0.74, tilt: 0.18, peak: 0.15, loPeak: 0, droop: 0.22, crease: 0, hood: 1, lid: 0.29, iris: 1.0, cover: 0.36 },
};

/** sobrancelha: espessura no começo/meio/ponta, arco, posição do arco, queda da ponta, fios, comprimento */
interface BrowSpec {
  head: number;
  mid: number;
  tail: number;
  arch: number;
  archAt: number;
  drop: number;
  hairs: number;
  len: number;
}

const BROWS: Record<string, BrowSpec> = {
  soft: { head: 0.78, mid: 0.7, tail: 0.2, arch: 0.55, archAt: 0.62, drop: 0.32, hairs: 0, len: 1 },
  thick: { head: 1.05, mid: 1.0, tail: 0.34, arch: 0.4, archAt: 0.6, drop: 0.3, hairs: 0, len: 1.04 },
  thin: { head: 0.42, mid: 0.4, tail: 0.1, arch: 0.75, archAt: 0.62, drop: 0.42, hairs: 0, len: 0.97 },
  arched: { head: 0.66, mid: 0.64, tail: 0.16, arch: 0.92, archAt: 0.66, drop: 0.55, hairs: 0, len: 1 },
  straight: { head: 0.86, mid: 0.8, tail: 0.3, arch: 0.05, archAt: 0.5, drop: 0.06, hairs: 0, len: 1.03 },
  bushy: { head: 1.32, mid: 1.16, tail: 0.46, arch: 0.42, archAt: 0.58, drop: 0.34, hairs: 9, len: 1.07 },
};

/** nariz: raio da ponta, ponte (largura do plano), narinas, empinado, giba, ponte longa */
interface NoseSpec {
  tip: number;
  bridge: number;
  nostril: number;
  up: number;
  hump: number;
  /** quão definida é a ponte (sombra lateral) */
  def: number;
}

const NOSES: Record<string, NoseSpec> = {
  soft: { tip: 1.0, bridge: 0.9, nostril: 0.5, up: 0, hump: 0, def: 0.85 },
  button: { tip: 1.0, bridge: 0.7, nostril: 0.85, up: 0.45, hump: 0, def: 0.6 },
  straight: { tip: 0.78, bridge: 0.95, nostril: 0.4, up: 0, hump: 0, def: 1.15 },
  wide: { tip: 1.25, bridge: 1.2, nostril: 0.7, up: 0.08, hump: 0, def: 0.9 },
  aquiline: { tip: 0.85, bridge: 1.0, nostril: 0.36, up: -0.3, hump: 1, def: 1.2 },
  small: { tip: 0.72, bridge: 0.58, nostril: 0.42, up: 0.2, hump: 0, def: 0.6 },
};

// ---------------------------------------------------------------------------------------------------------------
// expressões
// ---------------------------------------------------------------------------------------------------------------

type EyeState =
  | { k: 'open'; ou: number; ol: number; gx: number; gy: number; sq: number; flat?: number; iris?: 'star' | 'heart' }
  | { k: 'happy' }
  | { k: 'closed' };

interface BrowState {
  /** sobe a sobrancelha inteira */
  raise: number;
  /** sobe só o começo (preocupado/doce) — negativo franze */
  inner: number;
  /** sobe/desce só a ponta */
  outer: number;
  /** aumenta o arco */
  arch: number;
}

type MouthKind = 'closed' | 'open' | 'pucker' | 'o';

interface MouthState {
  k: MouthKind;
  /** quanto cada canto sobe (L/R da tela) */
  cl: number;
  cr: number;
  /** largura extra */
  w: number;
  /** abertura (open/o) */
  h?: number;
  teeth?: boolean;
  /** dentes de baixo aparecendo (risada) */
  lowTeeth?: boolean;
  tongue?: boolean;
  /** linhas do sorriso (bigode chinês) */
  lines?: number;
  dimple?: 'L' | 'R';
  /** desloca a boca pro lado (sorriso de canto) */
  dx?: number;
}

interface Expr {
  eyeL: EyeState;
  eyeR: EyeState;
  browL: BrowState;
  browR: BrowState;
  mouth: MouthState;
  /** rubor (0 = nada) */
  blush: number;
  /** bochecha subindo (sorriso): sombra embaixo do olho e luz na maçã */
  cheek: number;
  /** só uma bochecha sobe (sorriso de canto): lado da tela */
  cheekSide?: 'L' | 'R';
}

const B = (raise = 0, inner = 0, outer = 0, arch = 0): BrowState => ({ raise, inner, outer, arch });
const O = (ou: number, ol: number, sq = 0, gx = 0, gy = 0, iris?: 'star' | 'heart', flat?: number): EyeState => ({ k: 'open', ou, ol, gx, gy, sq, iris, flat });

// Cada expressão muda pelo menos TRÊS sinais — sobrancelha (altura, ângulo, assimetria), pálpebra de baixo (o sorriso de
// verdade sobe a pálpebra de baixo e estreita o olho) e boca — pra se distinguir no busto de 56 px e na pele escura.
// (unidades da cabeça; no 'lite' a sobrancelha e os cantos da boca são ampliados: ampLite)
const EXPR: Record<string, Expr> = {
  // sorriso: cantos sobem, a bochecha sobe e aperta a pálpebra de baixo, sobrancelhas sobem de leve
  smile: { eyeL: O(0.92, 0.9, 0.62), eyeR: O(0.92, 0.9, 0.62), browL: B(0.3, 0.2, 0, 0.1), browR: B(0.3, 0.2, 0, 0.1), mouth: { k: 'closed', cl: 1.05, cr: 1.05, w: 0.45 }, blush: 0, cheek: 0.6 },
  grin: { eyeL: O(0.84, 0.85, 0.9), eyeR: O(0.84, 0.85, 0.9), browL: B(0.5, 0.25, 0.05), browR: B(0.5, 0.25, 0.05), mouth: { k: 'open', cl: 0.9, cr: 0.9, w: 0.5, h: 1.6, teeth: true, lines: 1 }, blush: 0, cheek: 0.9 },
  // calmo: olhar ABERTO e reto (a bochecha não sobe), sobrancelhas relaxadas mais baixas e retas, boca reta e fechada
  calm: { eyeL: O(1.0, 1.02, 0), eyeR: O(1.0, 1.02, 0), browL: B(-0.3, -0.05, -0.1, -0.35), browR: B(-0.3, -0.05, -0.1, -0.35), mouth: { k: 'closed', cl: 0.02, cr: 0.02, w: -0.35 }, blush: 0, cheek: 0 },
  wink: { eyeL: O(0.98, 0.9, 0.5), eyeR: { k: 'happy' }, browL: B(0.45, 0.05, 0.15, 0.15), browR: B(-0.4, -0.15, -0.25), mouth: { k: 'closed', cl: 0.45, cr: 1.2, w: 0.3, dimple: 'R', dx: 0.3 }, blush: 0, cheek: 0.6 },
  laugh: { eyeL: { k: 'happy' }, eyeR: { k: 'happy' }, browL: B(0.6, 0.35), browR: B(0.6, 0.35), mouth: { k: 'open', cl: 1.2, cr: 1.2, w: 0.85, h: 3.1, teeth: true, lowTeeth: true, tongue: true, lines: 1.25 }, blush: 0.35, cheek: 1 },
  // descolado: pálpebras de cima a ~40% e RETAS, olhar de lado; uma sobrancelha ~1 unidade mais baixa (a outra sobe de
  // leve); boca de lado, sem sorriso aberto
  cool: { eyeL: O(0.46, 0.95, 0.15, 0.4, 0.05, undefined, 1), eyeR: O(0.42, 0.95, 0.25, 0.4, 0.05, undefined, 1), browL: B(0.35, 0, 0.4, 0.1), browR: B(-1.1, -0.35, -0.35, -0.25), mouth: { k: 'closed', cl: -0.15, cr: 0.5, w: -0.1, dx: 0.5 }, blush: 0, cheek: 0.05 },
  // tímido: começo das sobrancelhas sobe (doce), olhar baixo e de lado, pálpebras um pouco baixas, boca pequena, rubor
  blush: { eyeL: O(0.76, 0.95, 0.35, -0.45, 0.5), eyeR: O(0.76, 0.95, 0.35, -0.45, 0.5), browL: B(0.15, 0.9, -0.3), browR: B(0.15, 0.9, -0.3), mouth: { k: 'closed', cl: 0.6, cr: 0.6, w: -0.65 }, blush: 0.95, cheek: 0.45 },
  kiss: { eyeL: { k: 'closed' }, eyeR: { k: 'closed' }, browL: B(0.25, 0.3), browR: B(0.25, 0.3), mouth: { k: 'pucker', cl: 0, cr: 0, w: 0 }, blush: 0.45, cheek: 0 },
  // sereno: olhos fechados relaxados, começo das sobrancelhas erguido (doce) e sorriso suave com a bochecha subindo
  serene: { eyeL: { k: 'closed' }, eyeR: { k: 'closed' }, browL: B(0.3, 0.65, -0.1), browR: B(0.3, 0.65, -0.1), mouth: { k: 'closed', cl: 0.6, cr: 0.6, w: 0.05 }, blush: 0, cheek: 0.35 },
  // sorriso de canto: o canto direito sobe ~1,3 a mais, com covinha e a bochecha do MESMO lado subindo e apertando o
  // olho; a sobrancelha do outro lado sobe (ar de quem sabe de algo)
  smirk: { eyeL: O(1.0, 1.0, 0, 0.12), eyeR: O(0.8, 0.85, 1.0, 0.12), browL: B(0.9, 0.05, 0.35, 0.35), browR: B(-0.35, -0.15), mouth: { k: 'closed', cl: -0.25, cr: 1.45, w: 0.1, dimple: 'R', dx: 0.5 }, blush: 0, cheek: 0.1, cheekSide: 'R' },
  surprised: { eyeL: O(1.38, 1.22), eyeR: O(1.38, 1.22), browL: B(1.45, 0.25, 0.1, 0.3), browR: B(1.45, 0.25, 0.1, 0.3), mouth: { k: 'o', cl: 0, cr: 0, w: -1.0, h: 2.0 }, blush: 0, cheek: 0 },
  // olhos de estrela e apaixonado: a íris vira a forma (maior que a íris normal), sobrancelhas erguidas, boca aberta
  starry: { eyeL: O(1.15, 0.95, 0.4, 0, 0, 'star'), eyeR: O(1.15, 0.95, 0.4, 0, 0, 'star'), browL: B(0.7, 0.25), browR: B(0.7, 0.25), mouth: { k: 'open', cl: 1.0, cr: 1.0, w: 0.6, h: 2.2, teeth: true, tongue: true, lines: 1 }, blush: 0.3, cheek: 0.7 },
  hearts: { eyeL: O(1.08, 0.95, 0.4, 0, 0, 'heart'), eyeR: O(1.08, 0.95, 0.4, 0, 0, 'heart'), browL: B(0.5, 0.55), browR: B(0.5, 0.55), mouth: { k: 'open', cl: 0.95, cr: 0.95, w: 0.45, h: 1.7, teeth: true, lines: 0.8 }, blush: 0.6, cheek: 0.6 },
};

/** miniatura/mapa: a sobrancelha e os cantos da boca andam ~1,5× (senão a diferença some em 56 px) */
function ampLite(ex: Expr, k: number): Expr {
  if (k === 1) return ex;
  const b = (s: BrowState): BrowState => ({ raise: s.raise * k, inner: s.inner * k, outer: s.outer * k, arch: s.arch });
  const m = ex.mouth;
  return { ...ex, browL: b(ex.browL), browR: b(ex.browR), mouth: { ...m, cl: m.cl * (m.cl > 0 ? 1 + (k - 1) * 0.5 : 1), cr: m.cr * (m.cr > 0 ? 1 + (k - 1) * 0.5 : 1) } };
}

// ---------------------------------------------------------------------------------------------------------------
// cores
// ---------------------------------------------------------------------------------------------------------------

function browColor(hair: string, skin: string): string {
  const L = lum(hair);
  const [r, g, b] = [parseInt(hair.slice(1, 3), 16), parseInt(hair.slice(3, 5), 16), parseInt(hair.slice(5, 7), 16)];
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  let c: string;
  // tinta de fantasia (azul, rosa…): sobrancelha natural escurecida; claro demais: escurece pra ler no rosto
  if (sat > 110 && !(r > g && g > b)) c = mix(hair, '#2A1C18', 0.62);
  else if (L > 0.5) c = mix(hair, '#4A3A30', 0.45);
  else if (L > 0.25) c = mix(hair, '#2A1A14', 0.32);
  else c = mix(hair, '#140C0A', 0.15);
  // pele muito escura com sobrancelha escura: um pouco mais fria/escura pra separar do tom
  if (lum(skin) < 0.08) c = mix(c, '#050304', 0.25);
  return c;
}

const LASH = '#1F1416';
const TEETH = '#EEE7DC';
const MOUTH_IN = '#3A1216';

// ---------------------------------------------------------------------------------------------------------------
// olho
// ---------------------------------------------------------------------------------------------------------------

interface EyeGeo {
  /** x do eixo do olho em u (-1 canto de fora … +1 canto de dentro) */
  X: (u: number) => number;
  base: (u: number) => number;
  yO: number;
  yI: number;
  upper: SP[];
  lower: SP[];
  sclera: string;
  c: Pt;
  w: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** geometria do olho: `ou`/`ol` = abertura de cima/baixo; `sq` = bochecha empurrando a pálpebra de baixo; `flat` = pálpebra de cima reta (olhar a meio) */
function eyeGeo(c: Pt, side: 'L' | 'R', sp: EyeSpec, w: number, ou: number, ol: number, sq = 0, flat = 0): EyeGeo {
  const sg = side === 'L' ? 1 : -1; // u=+1 (dentro) fica pro lado do nariz
  const X = (u: number) => c[0] + sg * u * w;
  const yO = c[1] + sp.tilt;
  const yI = c[1] + 0.12;
  const up = sp.up * ou;
  const lo = sp.lo * ol * (1 - sq * 0.45);
  const base = (u: number) => lerp(yO, yI, (u + 1) / 2);
  const pk = (k: number) => up * lerp(k, 0.92, flat);
  const upper: SP[] = [
    [X(-1), yO, 0],
    [X(-0.64), base(-0.64) - pk(0.76 - sp.droop * 0.32)],
    [X(sp.peak), base(sp.peak) - up],
    [X(0.6), base(0.6) - pk(0.7)],
    [X(1), yI, 0],
  ];
  const lower: SP[] = [
    [X(1), yI, 0],
    [X(0.58), base(0.58) + lo * 0.62],
    [X(sp.loPeak - sq * 0.2), base(sp.loPeak) + lo],
    [X(-0.62), base(-0.62) + lo * (0.74 - sq * 0.2)],
    [X(-1), yO, 0],
  ];
  const sclera = smoothPath([...upper, ...lower.slice(1, -1)], true);
  return { X, base, yO, yI, upper, lower, sclera, c, w };
}

interface Makeup {
  lip: string | null;
  gloss: boolean;
  liner: boolean;
  shadow: string | null;
  lash: number;
}

function makeupOf(ctx: LayerCtx): Makeup {
  switch (ctx.cfg.faceDetail) {
    case 'lipstick':
      return { lip: '#B0193F', gloss: false, liner: false, shadow: null, lash: 1 };
    case 'liner':
      return { lip: null, gloss: false, liner: true, shadow: null, lash: 1.12 };
    case 'glam':
      return { lip: '#9E2449', gloss: true, liner: true, shadow: '#8E4A6A', lash: 1.3 };
    default:
      return { lip: null, gloss: false, liner: false, shadow: null, lash: 1 };
  }
}

/** junta as camadas iguais dos dois olhos num path só (mesmo visual, metade das camadas) */
interface EyeAcc {
  add(slot: string, d: string, f: string, extra?: Partial<AvatarLayer>): void;
  flush(ctx: LayerCtx): void;
}

/** ordem de desenho das camadas do olho (aberto, rindo e fechado) */
const EYE_SLOTS = ['lidSkin', 'lidMk', 'sclera', 'car', 'iris0_L', 'iris0_R', 'iris_L', 'iris_R', 'fib', 'pupil', 'lidSh', 'hl', 'crease', 'creaseHi', 'hoodSh', 'hood_L', 'hood_R', 'mono', 'lash', 'lowRim', 'lowLine', 'sq', 'hLash', 'hLid', 'hSq', 'cLash', 'cLight', 'cCrease', 'cMk'];

function eyeAcc(): EyeAcc {
  const m = new Map<string, { d: string; f: string; extra: Partial<AvatarLayer>; cp: string }>();
  return {
    add(slot, d, f, extra = {}) {
      const e = m.get(slot);
      if (e) {
        e.d += d;
        if (extra.cp) e.cp += extra.cp;
      } else m.set(slot, { d, f, extra, cp: extra.cp ?? '' });
    },
    flush(ctx) {
      for (const k of EYE_SLOTS) {
        const e = m.get(k);
        if (e) ctx.push(e.d, e.f, { ...e.extra, ...(e.cp ? { cp: e.cp } : {}) });
      }
    },
  };
}

/** olho aberto: pálpebra, branco, íris, pupila, sombra da pálpebra, reflexos, cílios, pálpebra de baixo, vinco */
function openEye(ctx: LayerCtx, acc: EyeAcc, ha: HeadAnchors, side: 'L' | 'R', sp: EyeSpec, st: Extract<EyeState, { k: 'open' }>, t: SkinTones, mk: Makeup, age: number): void {
  const lite = isLite(ctx);
  const c = side === 'L' ? ha.eyeL : ha.eyeR;
  // idade: pálpebra de cima um pouco mais caída
  const droop = Math.min(1, sp.droop + age * 0.25);
  const spA: EyeSpec = { ...sp, droop };
  const ou = st.ou * (1 - age * 0.06);
  const g = eyeGeo(c, side, spA, ha.eyeW, ou, st.ol, st.sq, st.flat ?? 0);
  const up = sp.up * ou;
  // pele da pálpebra de cima (entre os cílios e o vinco) um pouco mais escura e quente: o olho "afunda" na órbita
  acc.add('lidSkin', taperPath(g.upper.map((p) => [p[0], p[1] - 0.55] as SP), [0.3, 1.4, 1.6, 1.25, 0.3]), mix(t.shade, t.blush, 0.15), { o: 0.4, b: 0.35 });
  if (mk.shadow) {
    const lid = taperPath([g.upper[1], [g.X(0), g.yO - up - 0.8], g.upper[3]].map((p) => [p[0], p[1] - 0.3] as SP), [0.3, 1.9, 0.3]);
    acc.add('lidMk', lid, mk.shadow, { o: 0.6, b: 0.45 });
  }
  // branco do olho (sombreado em cima pela pálpebra, mais claro embaixo)
  // pele bem escura no 'lite' (mapa, miniatura): esclera ~10% mais clara pro olho não sumir
  // (pele escura: +~10% também no completo, senão o olho se funde ao tom no busto)
  const scl = t.dark ? (lite ? ['#A49894', '#E4DCD6', '#F4EEEA'] : ['#9C8E8A', '#DDD4CE', '#EFE8E3']) : ['#B0A29E', '#E2D9D4', '#F3EEEB'];
  acc.add('sclera', g.sclera, scl[1], {
    gf: { t: 'l', x1: c[0], y1: c[1] - up, x2: c[0], y2: c[1] + sp.lo, s: [[0, scl[0]], [0.45, scl[1]], [1, scl[2]]] },
  });
  // canto de dentro rosado (carúncula)
  if (!lite) acc.add('car', ellipse(g.X(0.9), g.yI + 0.02, 0.3 * (ha.eyeW / 2.2), 0.24), '#D98C8A', { o: 0.55 });
  // íris e pupila: posição fixa (não sobe com a abertura) — a pálpebra cobre o alto dela
  const ir = sp.iris;
  const ix = c[0] + st.gx * ha.eyeW * 0.42;
  const iy = c[1] + (sp.cover - 0.2) * ir * 0.9 - sp.up * 0.08 + st.gy * 0.45;
  const eye = ctx.col.eye;
  if (st.iris === 'star' || st.iris === 'heart') {
    const fill = st.iris === 'star' ? '#FFC93C' : '#FF3D8B';
    acc.add(`iris0_${side}`, ellipse(ix, iy, ir * 1.04, ir * 1.04), st.iris === 'star' ? '#2A1A40' : '#5A0A2A', { cp: g.sclera });
    acc.add(`iris_${side}`, st.iris === 'star' ? starPath(ix, iy + 0.05, ir * 1.15, 5, 0.48) : heartPath(ix, iy + 0.05, ir * 1.0), fill, {
      cp: g.sclera,
      gf: { t: 'r', cx: ix - 0.3, cy: iy - 0.3, r: ir * 1.3, s: [[0, '#FFFFFF'], [0.35, fill], [1, mix(fill, '#000000', 0.25)]] },
    });
  } else {
    const ring = mix(eye, '#0A0608', lite ? 0.75 : 0.62);
    const dark = lum(eye) < 0.04;
    acc.add(`iris_${side}`, ellipse(ix, iy, ir, ir), eye, {
      cp: g.sclera,
      gf: { t: 'r', cx: ix, cy: iy + ir * 0.35, r: ir * 1.05, fx: ix - ir * 0.1, fy: iy + ir * 0.55, s: [[0, mix(eye, '#FFF4E0', dark ? 0.32 : 0.42)], [0.5, eye], [0.84, mix(eye, '#000000', 0.32)], [1, ring]] },
    });
    // fibras da íris (raios curtos, bem sutis) e pupila
    if (!lite) acc.add('fib', ellipse(ix, iy, ir * 0.72, ir * 0.72), mix(eye, '#FFFFFF', 0.2), { cp: g.sclera, o: 0.12, b: 0.2 });
    acc.add('pupil', ellipse(ix, iy, ir * 0.42, ir * 0.42), '#0B0709', { cp: g.sclera });
  }
  // sombra da pálpebra de cima sobre o olho (inclui o alto da íris)
  acc.add('lidSh', taperPath(g.upper.map((p) => [p[0], p[1] + 0.15] as SP), [0, 0.9, 1.0, 0.8, 0]), '#2A141C', { o: 0.32, b: 0.35, cp: g.sclera });
  // reflexos: grande em cima-esquerda, pequeno embaixo-direita (assinatura)
  const hr = 0.25 * ir;
  acc.add('hl', ellipse(ix - ir * 0.36, iy - ir * 0.36, hr, hr * 0.92) + (lite ? '' : ellipse(ix + ir * 0.42, iy + ir * 0.36, hr * 0.42, hr * 0.42)), '#FFFFFF', { o: 0.95, cp: g.sclera });
  // vinco da pálpebra (acima da linha dos cílios): forma afilada, sobe com a abertura
  if (sp.crease > 0) {
    const cr = sp.crease * (0.7 + st.ou * 0.3) * (1 - age * 0.25);
    const crease: SP[] = [
      [g.X(0.74), g.yI - up * 0.78 - cr * 0.5],
      [g.X(0.08), lerp(g.yO, g.yI, 0.55) - up - cr],
      [g.X(-0.6), g.yO - up * 0.68 - cr * 0.85],
      [g.X(-1.04), g.yO - cr * 0.3 + droop * 0.35],
    ];
    acc.add('crease', taperPath(crease, [0, 0.3, 0.26, 0]), t.line, { o: 0.48 });
    // luz no osso da sobrancelha logo acima do vinco
    if (!lite) acc.add('creaseHi', taperPath(crease.map((p) => [p[0], p[1] - 0.6] as SP), [0, 0.5, 0.4, 0]), t.lighter, { o: 0.22, b: 0.25 });
  }
  // dobra da pálpebra encoberta: pele por cima, cobrindo o vinco e parte da pálpebra (mais do lado de fora)
  if (sp.hood > 0) {
    const hood: SP[] = [
      [g.X(0.62), g.yI - up * 0.95 - 0.3],
      [g.X(-0.15), lerp(g.yO, g.yI, 0.42) - up - 0.2],
      [g.X(-0.85), g.yO - up * 0.55],
      [g.X(-1.15), g.yO + 0.05],
      [g.X(-0.95), g.yO - up * 0.85 - 1.05],
      [g.X(0.05), lerp(g.yO, g.yI, 0.5) - up - 1.2],
      [g.X(0.75), g.yI - up - 1.0],
    ];
    acc.add('hoodSh', taperPath([hood[0], hood[1], hood[2], hood[3]], [0, 0.6, 0.5, 0]), t.deep, { o: 0.5, b: 0.25 });
    acc.add(`hood_${side}`, smoothPath(hood, true), t.base, { gf: { t: 'l', x1: c[0], y1: g.yO - up - 1.2, x2: c[0], y2: g.yO - up * 0.6, s: [[0, mix(t.base, t.shade, 0.2)], [1, t.light]] } });
  }
  // monolid: plano liso da pálpebra pega luz (sem vinco)
  if (sp.crease === 0 && sp.hood === 0 && !lite) {
    acc.add('mono', taperPath(g.upper.map((p) => [p[0], p[1] - 1.0] as SP), [0, 1.2, 1.3, 0.9, 0]), t.lighter, { o: 0.22, b: 0.45 });
  }
  // linha dos cílios de cima: fina dentro, grossa no terço de fora, termina num flick curto (sem cílios espetados)
  const lwMin = lite ? (t.dark ? 0.72 : 0.62) : 0;
  const lw = Math.max(lwMin, sp.lid * mk.lash);
  const tilt = sp.tilt;
  const flick: SP = [g.X(-1.04), g.yO - 0.06 - (tilt < 0 ? 0.05 : 0) + droop * 0.2];
  const lashSpine: SP[] = [g.upper[4], g.upper[3], g.upper[2], g.upper[1], g.upper[0], flick];
  let lash = taperPath(lashSpine, [Math.max(lwMin * 0.4, 0.07), Math.max(lwMin * 0.6, 0.15), lw * 0.68, lw, lw * 0.85, 0], { n: 12 });
  if (mk.liner) {
    const wing: SP[] = [g.upper[2], g.upper[1], g.upper[0], [g.X(-1.55), g.yO - 0.85]];
    lash += taperPath(wing, [0.15, 0.45, 0.45, 0]);
  }
  acc.add('lash', lash, LASH);
  // pálpebra de baixo: borda clara (espessura da pálpebra) + linha dos cílios de baixo leve (some no canto de dentro)
  if (!lite) acc.add('lowRim', taperPath(g.lower.map((p) => [p[0], p[1] + 0.24] as SP), [0.05, 0.3, 0.36, 0.26, 0.05]), t.lighter, { o: 0.45 });
  acc.add('lowLine', taperPath(g.lower, [0.02, 0.1, 0.2, 0.2, 0.08]), t.line, { o: lite ? 0.75 : 0.62 });
  // bochecha empurrando (sorriso): vinco suave embaixo do olho
  if (st.sq > 0.2) acc.add('sq', taperPath([[g.X(-0.8), g.yO + sp.lo * 0.95 + 0.45], [g.X(0), c[1] + sp.lo * 1.05 + 0.45], [g.X(0.6), g.yI + sp.lo * 0.85 + 0.3]], [0, 0.45 * st.sq, 0]), t.form, { o: 0.3, b: 0.2 });
}

/** olho fechado: 'happy' = arco pra cima (rindo, bochecha empurrando); 'closed' = pálpebra fechada relaxada */
function closedEye(ctx: LayerCtx, acc: EyeAcc, ha: HeadAnchors, side: 'L' | 'R', sp: EyeSpec, kind: 'happy' | 'closed', t: SkinTones, mk: Makeup): void {
  const lite = isLite(ctx);
  const c = side === 'L' ? ha.eyeL : ha.eyeR;
  const g = eyeGeo(c, side, sp, ha.eyeW, 1, 1);
  const out = side === 'L' ? -1 : 1;
  const lw = Math.max(lite ? 0.66 : 0, 0.5 * ha.s * mk.lash);
  if (kind === 'happy') {
    const sp2: SP[] = [[g.X(-1.08), g.yO + 0.45], [g.X(-0.35), c[1] - sp.up * 0.5], [g.X(0.45), c[1] - sp.up * 0.42], [g.X(1), g.yI + 0.35]];
    let d = taperPath(sp2, [0.14, lw * 1.15, lw, 0.12], { n: 10 });
    d += taperPath([[g.X(-1.04), g.yO + 0.4], [g.X(-1.04) + out * 0.4, g.yO + 0.62], [g.X(-1.04) + out * 0.62, g.yO + 0.52]], [0.2, 0.12, 0]);
    acc.add('hLash', d, LASH);
    // pálpebra de cima sombreada e bochecha empurrando (vinco embaixo + luz na maçã subindo)
    acc.add('hLid', taperPath(sp2.map((p) => [p[0], p[1] - 0.7] as SP), [0, 1.2, 1.1, 0]), t.shade, { o: 0.32, b: 0.35 });
    acc.add('hSq', taperPath([[g.X(-0.8), g.yO + 1.15], [g.X(0), c[1] + 0.95], [g.X(0.65), g.yI + 0.8]], [0, 0.32, 0]), t.line, { o: 0.4 });
    return;
  }
  // fechado relaxado: a pálpebra desce até a linha de baixo; cílios grossos (lê na miniatura), vinco acima
  const sp2: SP[] = [[g.X(-1.06), g.yO + 0.1], [g.X(-0.3), c[1] + sp.lo * 0.5], [g.X(0.5), c[1] + sp.lo * 0.4], [g.X(1), g.yI]];
  let d = taperPath(sp2, [0.14, lw, lw * 0.85, 0.08], { n: 10 });
  if (!lite) {
    for (let i = 0; i < 3; i++) {
      const u = -0.9 + i * 0.32;
      const bx = g.X(u);
      const by = lerp(g.yO + 0.1, g.yI, (u + 1) / 2) + sp.lo * 0.5 * (1 - Math.abs(u + 0.2) * 0.6);
      d += taperPath([[bx, by], [bx + out * 0.14, by + 0.42], [bx + out * 0.3, by + 0.62]], [0.16 * mk.lash, 0.08, 0]);
    }
  }
  if (mk.liner) d += taperPath([[g.X(-0.2), c[1] + sp.lo * 0.46], [g.X(-1.0), g.yO + 0.1], [g.X(-1.45), g.yO - 0.55]], [0.1, 0.32, 0]);
  acc.add('cLash', d, LASH);
  // pálpebra fechada (bulbo coberto): luz em cima, vinco acima
  acc.add('cLight', blob(c[0] - 0.2, c[1] - sp.up * 0.15, ha.eyeW * 0.85, sp.up * 0.55), t.lighter, { o: 0.22, b: 0.45 });
  acc.add('cCrease', taperPath([[g.X(0.72), c[1] - sp.up * 0.6], [g.X(0), c[1] - sp.up * 0.92], [g.X(-0.85), g.yO - sp.up * 0.45]], [0, 0.28, 0]), t.line, { o: 0.42 });
  if (mk.shadow) acc.add('cMk', blob(c[0], c[1] - 0.5, ha.eyeW * 1.05, 0.85), mk.shadow, { o: 0.45, b: 0.45 });
}

// ---------------------------------------------------------------------------------------------------------------
// sobrancelha
// ---------------------------------------------------------------------------------------------------------------

/**
 * sobrancelha. Pele clara: opacidade ~0,75 e começo mais claro e fino (sobrancelha escura e cheia em pele clara dá olhar
 * severo/cético). Idade: afina um pouco e NUNCA franze (o que abaixa o começo ou a sobrancelha inteira perde ~60%: rosto
 * maduro sem cara de bravo).
 */
function brow(ctx: LayerCtx, ha: HeadAnchors, side: 'L' | 'R', sp: BrowSpec, stIn: BrowState, color: string, skin: string, age: number): void {
  const lite = isLite(ctx);
  const sg = side === 'L' ? 1 : -1; // pro lado do nariz
  const e = side === 'L' ? ha.eyeL : ha.eyeR;
  const by = ha.browY;
  const X = (u: number) => e[0] + sg * u; // u>0 = pro nariz
  const k = ha.s;
  const soft = (v: number) => (v < 0 ? v * (1 - 0.6 * age) : v);
  const st: BrowState = age > 0 ? { raise: soft(stIn.raise), inner: soft(stIn.inner), outer: stIn.outer, arch: stIn.arch * (1 - 0.15 * age) } : stIn;
  const L = lum(skin);
  const bo = lite ? 1 : L > 0.45 ? 0.76 : L > 0.3 ? 0.86 : 1;
  const thin = 1 - 0.12 * age;
  const len = 5.1 * sp.len * k;
  const headU = Math.min(2.35 * k, Math.abs(e[0] - ha.noseBridge[0]) - 1.3);
  const tailU = headU - len;
  const arch = (sp.arch + st.arch) * k;
  const r = st.raise * k;
  const peakU = headU - len * sp.archAt;
  const spine: SP[] = [
    [X(headU), by + 0.4 * k - st.inner * k - r * 0.85],
    [X(headU - len * 0.3), by - arch * 0.55 - r - st.inner * k * 0.45],
    [X(peakU), by - arch - r - st.outer * k * 0.3],
    [X(tailU + 0.2), by + sp.drop * k - arch * 0.3 - r * 0.7 - st.outer * k],
  ];
  const wk = (lite ? 1.2 : 1) * thin;
  // pele clara: o começo afina (0,72) e clareia pro tom da pele — fios esparsos no começo, densos no meio
  const hk = bo < 1 ? 0.72 : 0.85;
  const d = taperPath(spine, [sp.head * k * hk * wk, sp.head * k * (bo < 1 ? 0.9 : 1) * wk, sp.mid * k * wk, sp.tail * k * 0.35 * wk], { n: 11, round: true });
  const c0 = bo < 1 ? mix(color, skin, 0.4) : mix(color, '#FFFFFF', 0.14);
  ctx.push(d, color, { o: bo, gf: { t: 'l', x1: X(headU), y1: 0, x2: X(tailU), y2: 0, s: [[0, c0, bo < 1 ? 0.7 : 0.85], [bo < 1 ? 0.32 : 0.25, color], [1, color]] } });
  if (!lite && sp.hairs) {
    // textura de fios ao longo (sobrancelha cheia)
    let hairs = '';
    const n = sp.hairs;
    for (let i = 0; i < n; i++) {
      const u = headU - 0.25 - (i / Math.max(1, n - 1)) * (sp.hairs ? len * 0.62 : 1.1);
      const kk = (headU - u) / len;
      const yy = by - arch * Math.sin(Math.min(1, kk / sp.archAt) * Math.PI * 0.5) - r - st.inner * k * (1 - kk) * 0.6 + (i % 2 ? 0.18 : -0.12);
      const up = i < 3 ? 0.55 : 0.2;
      hairs += taperPath([[X(u), yy + 0.3], [X(u - 0.3), yy - 0.05 * up], [X(u - 0.6), yy - 0.2 - up * 0.2]], [0.17, 0.12, 0]);
    }
    ctx.push(hairs, mix(color, '#000000', 0.2), { o: 0.7 });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// boca
// ---------------------------------------------------------------------------------------------------------------

function mouth(ctx: LayerCtx, ha: HeadAnchors, st: MouthState, t: SkinTones, mk: Makeup): void {
  const lite = isLite(ctx);
  const k = ha.s;
  const mx = ha.mouth[0] + (st.dx ?? 0) * k;
  const my = ha.mouth[1];
  const W = ha.mouthW + st.w * k + (lite ? 0.25 : 0);
  const up = ha.lipUp;
  const lo = ha.lipLo;
  const lipC = mk.lip ?? t.lip;
  const lipUp = mk.lip ? mix(mk.lip, '#000000', 0.2) : mix(t.lip, t.lipDark, 0.32);
  const lipDark = mk.lip ? mix(mk.lip, '#1A0008', 0.55) : t.lipDark;
  const cl = st.cl * k;
  const cr = st.cr * k;
  const CL: Pt = [mx - W, my - cl];
  const CR: Pt = [mx + W, my - cr];
  const bow = Math.min(0.62 * k, W * 0.24);

  if (st.k === 'pucker') {
    const px = mx + 0.15;
    const w = 1.45 * k;
    ctx.push(blob(px + 0.2, my + 1.9, w * 1.05, 0.6), t.deep, { o: 0.32, b: 0.45 });
    const upper = smoothPath([[px - w, my + 0.05, 0.6], [px - w * 0.55, my - up * 1.25], [px - 0.25, my - up * 1.35], [px, my - up * 1.15], [px + 0.25, my - up * 1.35], [px + w * 0.55, my - up * 1.25], [px + w, my + 0.05, 0.6], [px + w * 0.4, my + 0.2], [px - w * 0.4, my + 0.2]]);
    const lower = smoothPath([[px - w, my + 0.05, 0.6], [px - w * 0.4, my + 0.25], [px + w * 0.4, my + 0.25], [px + w, my + 0.05, 0.6], [px + w * 0.7, my + lo * 1.25], [px, my + lo * 1.45], [px - w * 0.7, my + lo * 1.25]]);
    ctx.push(upper, lipUp);
    ctx.push(lower, lipC, { gf: { t: 'l', x1: px, y1: my, x2: px, y2: my + lo * 1.5, s: [[0, mix(lipC, '#000000', 0.12)], [0.5, lipC], [1, mix(lipC, '#000000', 0.15)]] } });
    ctx.push(ellipse(px, my + 0.18, 0.45, 0.24), lipDark, { o: 0.9 });
    ctx.push(blob(px - 0.35, my + lo * 0.78, 0.6, 0.26, -0.2), '#FFFFFF', { o: 0.38 });
    // vincos do biquinho
    ctx.push(taperPath([[px - w * 0.6, my - up * 0.5], [px - w * 0.35, my + 0.1]], [0, 0.14, 0]) + taperPath([[px + w * 0.6, my - up * 0.5], [px + w * 0.35, my + 0.1]], [0, 0.14, 0]), lipDark, { o: 0.38 });
    return;
  }

  if (st.k === 'o') {
    const h = (st.h ?? 1.6) * k;
    const w = Math.max(1.2 * k, W);
    ctx.push(blob(mx + 0.25, my + h + 1.1, w * 0.75, 0.55), t.deep, { o: 0.3, b: 0.45 });
    ctx.push(ellipse(mx, my + 0.4, w + 0.4, h * 0.62 + 0.8), lipC, { gf: { t: 'l', x1: mx, y1: my - h, x2: mx, y2: my + h, s: [[0, lipUp], [0.5, lipC], [1, mix(lipC, '#000000', 0.1)]] } });
    ctx.push(ellipse(mx, my + 0.45, w * 0.78, h * 0.6), MOUTH_IN, { gf: { t: 'r', cx: mx, cy: my + 0.95, r: h, s: [[0, '#6A2028'], [1, MOUTH_IN]] } });
    ctx.push(ellipse(mx, my + 0.45 - h * 0.5, w * 0.6, h * 0.18), TEETH, { o: 0.85, cp: ellipse(mx, my + 0.45, w * 0.78, h * 0.6) });
    ctx.push(blob(mx - 0.35, my + h * 0.62 + 0.6, w * 0.42, 0.22), '#FFFFFF', { o: 0.32 });
    return;
  }

  if (st.k === 'open') {
    const h = (st.h ?? 1.6) * k;
    // abertura: borda de cima quase reta (lábio esticado), de baixo funda
    const opening = smoothPath([
      [CL[0], CL[1], 0],
      [mx - W * 0.5, my - 0.12 - cl * 0.25],
      [mx, my + 0.05],
      [mx + W * 0.5, my - 0.12 - cr * 0.25],
      [CR[0], CR[1], 0],
      [mx + W * 0.62, my + h * 0.72],
      [mx, my + h],
      [mx - W * 0.62, my + h * 0.72],
    ]);
    // sombra embaixo do lábio de baixo
    ctx.push(blob(mx + 0.3, my + h + lo * 0.72 + 0.9, W * 0.5, 0.55), t.deep, { o: 0.32, b: 0.5 });
    // lábio de baixo (faixa abaixo da abertura)
    const lowerLip = smoothPath([
      [CL[0], CL[1], 0],
      [mx - W * 0.62, my + h * 0.72],
      [mx, my + h],
      [mx + W * 0.62, my + h * 0.72],
      [CR[0], CR[1], 0],
      [mx + W * 0.62, my + h * 0.78 + lo * 0.62],
      [mx, my + h + lo * 0.74],
      [mx - W * 0.62, my + h * 0.78 + lo * 0.62],
    ]);
    ctx.push(lowerLip, lipC, { gf: { t: 'l', x1: mx, y1: my + h, x2: mx, y2: my + h + lo, s: [[0, mix(lipC, '#000000', 0.15)], [0.5, lipC], [1, mix(lipC, '#000000', 0.12)]] } });
    ctx.push(opening, MOUTH_IN, { gf: { t: 'l', x1: mx, y1: my, x2: mx, y2: my + h, s: [[0, '#2A0A0E'], [1, '#5A1A22']] } });
    if (st.tongue) ctx.push(blob(mx + 0.2, my + h * 0.95, W * 0.5, h * 0.36), '#D8606E', { cp: opening, gf: { t: 'l', x1: mx, y1: my + h * 0.55, x2: mx, y2: my + h, s: [[0, '#B8404E'], [1, '#E8808A']] } });
    if (st.lowTeeth) {
      const tb = Math.min(h * 0.22, 0.6);
      ctx.push(smoothPath([[mx - W * 0.55, my + h * 0.8], [mx, my + h - tb], [mx + W * 0.55, my + h * 0.8], [mx + W * 0.4, my + h + 0.3], [mx - W * 0.4, my + h + 0.3]]), TEETH, { cp: opening, o: 0.9 });
    }
    if (st.teeth) {
      // fileira de dentes de cima: sombra da gengiva em cima e nas laterais (a boca é curva), divisão sutil no meio
      const th = Math.min(h * 0.48, 1.05 * k);
      const teeth = smoothPath([[CL[0] - 0.3, CL[1] - 0.3], [mx, my - 0.3], [CR[0] + 0.3, CR[1] - 0.3], [mx + W * 0.6, my + th - 0.1], [mx, my + th + 0.12], [mx - W * 0.6, my + th - 0.1]]);
      ctx.push(teeth, TEETH, {
        cp: opening,
        gf: { t: 'l', x1: mx - W, y1: 0, x2: mx + W, y2: 0, s: [[0, '#B8ADA4'], [0.22, TEETH], [0.7, TEETH], [1, '#B8ADA4']] },
      });
      ctx.push(taperPath([[mx - W * 0.7, my + 0.05 - cl * 0.25], [mx, my + 0.28], [mx + W * 0.7, my + 0.05 - cr * 0.25]], [0.1, 0.4, 0.1]), '#7A3A40', { o: 0.35, cp: opening });
      if (!lite) ctx.push(taperPath([[mx + 0.05, my + 0.15], [mx + 0.05, my + th * 0.85]], [0.12, 0.05]), '#A89C94', { o: 0.5, cp: teeth });
    }
    // lábio de cima (fino, esticado) com arco do cupido
    const upperLip = smoothPath([
      [CL[0] - 0.05, CL[1], 0],
      [mx - W * 0.62, my - up * 0.62 - cl * 0.45],
      [mx - bow, my - up * 0.92],
      [mx, my - up * 0.68],
      [mx + bow, my - up * 0.92],
      [mx + W * 0.62, my - up * 0.62 - cr * 0.45],
      [CR[0] + 0.05, CR[1], 0],
      [mx + W * 0.5, my - 0.12 - cr * 0.25],
      [mx, my + 0.05],
      [mx - W * 0.5, my - 0.12 - cl * 0.25],
    ]);
    ctx.push(upperLip, lipUp);
    ctx.push(blob(mx - 0.5, my + h + lo * 0.34, W * 0.32, 0.2, -0.1), '#FFFFFF', { o: mk.gloss ? 0.55 : mk.lip ? 0.32 : 0.2 });
    cornerCreases(ctx, CL, CR, st, t);
    return;
  }

  // fechada: lábio de cima (arco do cupido), de baixo com reflexo, linha entre eles mais escura no meio
  const seam: SP[] = [
    [CL[0], CL[1], 0],
    [mx - W * 0.5, my + 0.12 - cl * 0.34],
    [mx, my + 0.22 - (cl + cr) * 0.05],
    [mx + W * 0.5, my + 0.12 - cr * 0.34],
    [CR[0], CR[1], 0],
  ];
  // sombra embaixo do lábio de baixo (sulco do queixo)
  ctx.push(blob(mx + 0.3, my + lo + 1.25, W * 0.5, 0.55), t.deep, { o: 0.32, b: 0.5 });
  const upper = smoothPath([
    [CL[0], CL[1], 0],
    [mx - W * 0.6, my - up * 0.7 - cl * 0.42],
    [mx - bow, my - up * 1.05],
    [mx, my - up * 0.74],
    [mx + bow, my - up * 1.05],
    [mx + W * 0.6, my - up * 0.7 - cr * 0.42],
    [CR[0], CR[1], 0],
    ...seam.slice(1, -1).reverse(),
  ]);
  const lower = smoothPath([
    ...seam,
    [mx + W * 0.55, my + lo * 0.8 + 0.22 - cr * 0.22],
    [mx, my + lo + 0.25],
    [mx - W * 0.55, my + lo * 0.8 + 0.22 - cl * 0.22],
  ]);
  ctx.push(lower, lipC, { gf: { t: 'l', x1: mx, y1: my, x2: mx, y2: my + lo + 0.3, s: [[0, mix(lipC, '#000000', 0.14)], [0.45, lipC], [1, mix(lipC, '#000000', 0.1)]] } });
  ctx.push(upper, lipUp, { gf: { t: 'l', x1: mx, y1: my - up, x2: mx, y2: my + 0.2, s: [[0, mix(lipUp, '#FFFFFF', 0.06)], [1, mix(lipUp, '#000000', 0.14)]] } });
  // pele escura: contraste interno maior (luz no lábio de baixo, comissuras escuras) pra boca ler no busto e no mapa
  const deep = lum(t.base) < 0.15;
  ctx.push(blob(mx - 0.45, my + lo * 0.5 + 0.2, W * (deep ? 0.32 : 0.26), deep ? 0.22 : 0.18, -0.1), '#FFFFFF', { o: mk.gloss ? 0.55 : mk.lip ? 0.3 : deep ? 0.3 : 0.16, b: mk.gloss ? 0 : 0.12 });
  ctx.push(taperPath(seam, lite ? [0.2, 0.42, 0.48, 0.42, 0.2] : [0.08, 0.3, 0.36, 0.3, 0.08], { n: 9 }), lipDark, { o: 0.92 });
  if (deep) ctx.push(ellipse(CL[0] + 0.15, CL[1] + 0.05, 0.32, 0.24) + ellipse(CR[0] - 0.15, CR[1] + 0.05, 0.32, 0.24), lipDark, { o: 0.55, b: lite ? 0 : 0.12 });
  // contorno de luz do lábio de cima (a borda do vermelhão pega luz)
  if (!lite) ctx.push(taperPath([[mx - W * 0.55, my - up * 0.8 - cl * 0.4], [mx - bow, my - up * 1.18], [mx, my - up * 0.9], [mx + bow, my - up * 1.18]], [0, 0.3, 0.2, 0]), t.lighter, { o: 0.35, b: 0.15 });
  cornerCreases(ctx, CL, CR, st, t);
}

function cornerCreases(ctx: LayerCtx, CL: Pt, CR: Pt, st: MouthState, t: SkinTones): void {
  let d = '';
  if (st.cl > 0.3) d += taperPath([[CL[0] + 0.25, CL[1] + 0.05], [CL[0] - 0.3, CL[1] - 0.2], [CL[0] - 0.45, CL[1] - 0.7]], [0.2, 0.15, 0]);
  if (st.cr > 0.3) d += taperPath([[CR[0] - 0.25, CR[1] + 0.05], [CR[0] + 0.3, CR[1] - 0.2], [CR[0] + 0.45, CR[1] - 0.7]], [0.2, 0.15, 0]);
  if (st.dimple === 'R') d += taperPath([[CR[0] + 1.0, CR[1] - 1.3], [CR[0] + 1.25, CR[1] - 0.45], [CR[0] + 1.0, CR[1] + 0.35]], [0, 0.26, 0]);
  if (st.dimple === 'L') d += taperPath([[CL[0] - 1.0, CL[1] - 1.3], [CL[0] - 1.25, CL[1] - 0.45], [CL[0] - 1.0, CL[1] + 0.35]], [0, 0.26, 0]);
  if (d) ctx.push(d, t.line, { o: 0.48 });
}

// ---------------------------------------------------------------------------------------------------------------
// 17. estrutura do rosto, nariz, marcas e detalhes
// ---------------------------------------------------------------------------------------------------------------

function nose(ctx: LayerCtx, ha: HeadAnchors, t: SkinTones): void {
  const lite = isLite(ctx);
  const sp = NOSES[ctx.cfg.nose] ?? NOSES.soft;
  const k = ha.s;
  const cx = ha.nose[0];
  const ny = ha.nose[1];
  const w = ha.noseW;
  const tip = sp.tip * k;
  const br = sp.bridge * k;
  const top = ha.browY + 0.9;
  const ey = ha.eyeL[1];
  const up = sp.up * k;
  // pele escura: sombras do nariz mais SATURADAS (vermelho-marrom), não mais escuras — senão nariz e boca se fundem
  const nf = lum(t.base) < 0.15 ? saturate(mix(t.base, '#4A1408', 0.34), 0.3) : t.form;
  // plano lateral da ponte em sombra (lado direito: luz vem da esquerda): do canto da sobrancelha até a asa, alargando
  // embaixo — é o que dá o volume do nariz de frente
  ctx.push(
    smoothPath([
      [cx + br * 0.35, top],
      [cx + br * 0.5, ey + 1.0],
      [cx + br * 0.55 + sp.hump * 0.2, ny - 2.4],
      [cx + tip * 0.7, ny - 1.1],
      [cx + w * 0.82, ny - 0.15],
      [cx + w * 1.12, ny - 0.9],
      [cx + br * 1.7, ny - 2.6],
      [cx + br * 1.55, ey + 0.8],
      [cx + br * 1.2, top + 0.2],
    ]),
    nf,
    { o: 0.5 * sp.def, b: 0.4 },
  );
  // lado da luz: só a borda da ponte perto do olho
  if (!lite) ctx.push(taperPath([[cx - br * 0.7, top + 0.5], [cx - br * 0.85, ey + 1.2], [cx - br * 0.75, ny - 2.4]], [0, 0.6, 0]), nf, { o: 0.22, b: 0.4 });
  // luz na ponte (estreita) — no aquilino ela é INTERROMPIDA pelo calombo (luz no alto do calombo, sombra logo abaixo,
  // e a luz volta só na ponta, que cai um pouco): é o que faz o aquilino ler de frente
  if (sp.hump) {
    const hy = (ey + ny) / 2 + 0.2;
    ctx.push(taperPath([[cx - 0.1, ey + 0.2], [cx - 0.16, hy - 1.4], [cx - 0.12, hy - 0.2]], [0, 0.6 * k, 0.2]), t.lighter, { o: lite ? 0.3 : 0.4, b: 0.22 });
    ctx.push(blob(cx - 0.05, hy, 0.62, 0.62), t.lighter, { o: 0.55, b: 0.15 });
    ctx.push(smoothPath([[cx - br * 0.5, hy + 0.5], [cx, hy + 0.95], [cx + br * 0.75, hy + 0.55], [cx + br * 0.3, hy + 1.6], [cx - br * 0.35, hy + 1.45]]), nf, { o: 0.42, b: 0.3 });
    ctx.push(taperPath([[cx - 0.18, hy + 1.8], [cx - 0.22, ny - 1.3]], [0.15, 0.4 * k]), t.lighter, { o: lite ? 0.25 : 0.35, b: 0.2 });
  } else {
    ctx.push(taperPath([[cx - 0.1, ey + 0.2], [cx - 0.18, ny - 2.8], [cx - 0.2, ny - 1.4]], [0, 0.65 * k, 0.35]), t.lighter, { o: lite ? 0.3 : nf !== t.form ? 0.55 : 0.4, b: 0.25 });
  }
  // ponte do nariz arrebitado/pequeno: sombra macia dos dois lados da ponte perto do canto do olho (a ponte existe)
  if (sp.def < 0.7) {
    ctx.push(blob(cx - br * 0.95 - 0.35, ey + 0.6, 0.45, 1.3) + blob(cx + br * 0.95 + 0.35, ey + 0.6, 0.5, 1.4), nf, { o: 0.32, b: 0.4 });
  }
  // bola da ponta: sombra em crescente embaixo e à direita, luz em cima
  ctx.push(
    smoothPath([
      [cx - tip * 0.95, ny - 0.2 - up * 0.3],
      [cx - tip * 0.4, ny + 0.55 - up * 0.3],
      [cx + tip * 0.5, ny + 0.45 - up * 0.3],
      [cx + tip * 1.05, ny - 0.5],
      [cx + tip * 1.1, ny - 1.3],
      [cx + tip * 1.25, ny - 0.1],
      [cx + tip * 0.6, ny + 1.0],
      [cx - tip * 0.6, ny + 1.0],
    ]),
    nf,
    { o: 0.45, b: 0.3 },
  );
  // asas: crescente escuro do lado da sombra (onde a asa encontra a bochecha), clarinho do lado da luz
  const ala = (sg: number, wk: number) =>
    taperPath(
      [
        [cx + sg * w * 0.66, ny - 1.25],
        [cx + sg * w * 1.02, ny - 0.5],
        [cx + sg * w * 0.96, ny + 0.4],
        [cx + sg * w * 0.62, ny + 0.75],
      ],
      [0, wk * k, wk * 0.9 * k, 0],
    );
  ctx.push(ala(1, 0.5), t.line, { o: 0.5 });
  ctx.push(ala(-1, 0.32), t.line, { o: 0.3 });
  if (!lite) ctx.push(blob(cx - w * 0.72, ny - 0.4, w * 0.22, 0.5), t.lighter, { o: 0.3, b: 0.2 });
  // nariz largo: cada asa tem volume próprio — sombra onde ela encontra a bochecha e luz no alto dela
  if (ctx.cfg.nose === 'wide') {
    ctx.push(blob(cx + w * 1.12, ny - 0.1, 0.55, 1.0) + blob(cx - w * 1.12, ny - 0.1, 0.45, 0.9), nf, { o: 0.4, b: 0.3 });
    ctx.push(blob(cx + w * 0.72, ny - 0.75, w * 0.22, 0.4) + blob(cx - w * 0.75, ny - 0.75, w * 0.24, 0.42), t.lighter, { o: 0.32, b: 0.2 });
  }
  // embaixo da ponta: cunha escura (columela) e as narinas como gotas mais escuras dentro dela
  ctx.push(
    smoothPath([
      [cx - w * 0.85, ny + 0.25 - up * 0.3],
      [cx - w * 0.35, ny + 0.7 - up * 0.3],
      [cx, ny + 0.95 - up * 0.25],
      [cx + w * 0.35, ny + 0.7 - up * 0.3],
      [cx + w * 0.85, ny + 0.25 - up * 0.3],
      [cx + w * 0.45, ny + 1.25],
      [cx, ny + 1.45],
      [cx - w * 0.45, ny + 1.25],
    ]),
    t.deep,
    { o: 0.45, b: 0.3 },
  );
  const nh = (0.42 + sp.nostril * 0.25) * k;
  ctx.push(
    taperPath([[cx - w * 0.7, ny + 0.62], [cx - w * 0.45, ny + 0.85], [cx - w * 0.18, ny + 0.78]], [0, nh, 0.1]) + taperPath([[cx + w * 0.7, ny + 0.62], [cx + w * 0.45, ny + 0.85], [cx + w * 0.18, ny + 0.78]], [0, nh, 0.1]),
    t.lipDark,
    { o: Math.min(0.85, 0.5 + sp.nostril * 0.35) },
  );
  // sombra projetada no lábio de cima (embaixo e à direita da ponta)
  ctx.push(blob(cx + 0.6, ny + 2.1, w * 0.75, 0.55, 0.1), nf, { o: 0.25, b: 0.5 });
  // calor e brilho da ponta
  ctx.push(blob(cx, ny - 0.4, tip * 0.95, tip * 0.75), t.blush, { o: t.dark ? 0.1 : 0.14, b: 0.4 });
  ctx.push(blob(cx - 0.32, ny - 0.6 - up * 0.2, tip * 0.42, tip * 0.32), t.fantasy ?? '#FFFFFF', { o: nf !== t.form ? 0.48 : t.dark ? 0.36 : 0.32, b: 0.22 });
}

/** escurecimento NEUTRO da pele (mesmo matiz, sem puxar pro marrom/vermelho): marcas do tempo nunca viram mancha */
function ageShade(t: SkinTones): string {
  return mix(t.base, '#17110F', t.dark ? 0.42 : 0.3);
}

/**
 * marcas do tempo (cfg.lines) como VOLUME, nunca risco: cada vinco é uma sombra curta e macia (desfocada) com uma luz
 * fina do lado de CIMA (a crista da pele que dobra). Só três grupos, que seguem a anatomia:
 *   - sulco nasogeniano: da asa do nariz até um pouco além do canto da boca, com a bochecha iluminada por cima;
 *   - testa: 2 linhas curtas que acompanham o arco das sobrancelhas (só fora do 'lite');
 *   - pés de galinha: na expressão (crowFeet), mais fortes no sorriso.
 * Nada de traço solto na bochecha, ruga entre as sobrancelhas ("bravo") ou linha de marionete ("boca caída"). A bolsa
 * embaixo do olho é só uma sombra larga e macia. Pálpebra mais caída, lábio mais fino e pescoço vêm da anatomia e do
 * corpo.
 */
function lines(ctx: LayerCtx, ha: HeadAnchors, t: SkinTones): void {
  const kind = ctx.cfg.lines;
  if (kind !== 'soft' && kind !== 'marked') return;
  const lite = isLite(ctx);
  const m = kind === 'marked' ? 1 : 0.65;
  const [mx, my] = ha.mouth;
  const W = ha.mouthW;
  const nx = ha.nose[0];
  const ny = ha.nose[1];
  const k = ha.s;
  const ash = ageShade(t);
  let shade = '';
  let crest = '';
  let bag = '';
  for (const sg of [-1, 1]) {
    // sulco nasogeniano: sombra macia e afilada, mais larga no meio; a crista (bochecha) fica por cima e por fora
    const nl: SP[] = [[nx + sg * (ha.noseW + 0.3), ny - 0.6], [nx + sg * (ha.noseW + 1.0), ny + 0.9], [mx + sg * (W + 0.5), my + 0.15], [mx + sg * (W + 0.6), my + 1.1]];
    shade += taperPath(nl, [0, 0.5 * m * k, 0.36 * m * k, 0]);
    crest += taperPath(nl.slice(0, 3).map((p) => [p[0] + sg * 0.55, p[1] - 0.25] as SP), [0, 0.55 * m * k, 0]);
    // bolsa embaixo do olho: sombra larga e macia (sem linha)
    const e = sg < 0 ? ha.eyeL : ha.eyeR;
    bag += blob(e[0] + sg * 0.1, e[1] + ha.eyeW * 0.95, ha.eyeW * 0.85, 0.45 * k);
  }
  // (no 'lite' o desfoque some: o vinco ficaria um risco duro na miniatura — metade da força e sem a bolsa)
  ctx.push(shade, ash, { o: (kind === 'marked' ? 0.42 : 0.3) * (lite ? 0.55 : 1), b: 0.32 });
  if (!lite) ctx.push(bag, ash, { o: 0.14 * m, b: 0.5 });
  if (!lite) {
    // testa: 2 linhas curtas que acompanham o arco da sobrancelha (arco leve pra cima no meio), luz fina em cima de cada
    const by = ha.browY;
    for (let i = 0; i < 2; i++) {
      const y = by - (2.5 + i * 1.25) * k;
      const L = (2.9 - i * 0.6) * k;
      const sp: SP[] = [[nx - L, y + 0.25], [nx - L * 0.3, y - 0.05], [nx + L * 0.35, y - 0.05], [nx + L * 0.95, y + 0.22]];
      shade = taperPath(sp, [0, 0.3 * m * k, 0.3 * m * k, 0]);
      ctx.push(shade, ash, { o: (kind === 'marked' ? 0.3 : 0.2) * (1 - i * 0.2), b: 0.22 });
      crest += taperPath(sp.map((p) => [p[0], p[1] - 0.42] as SP), [0, 0.32 * m * k, 0.3 * m * k, 0]);
    }
    ctx.push(crest, t.lighter, { o: 0.26 * m + 0.06, b: 0.25 });
  }
}

/**
 * pés de galinha (camada da expressão, k:'face'): leque de 2–3 vincos curtos no canto de fora do olho, cada um com luz
 * fina em cima. Linhas marcadas: aparecem sempre (fracos com o rosto parado, fortes no sorriso); suaves: só no sorriso.
 */
function crowFeet(ctx: LayerCtx, ha: HeadAnchors, t: SkinTones, smile: number): void {
  const kind = ctx.cfg.lines;
  if ((kind !== 'soft' && kind !== 'marked') || isLite(ctx)) return;
  const s = kind === 'marked' ? 0.45 + 0.55 * Math.min(1, smile + 0.2) : smile < 0.3 ? 0 : Math.min(1, smile + 0.2) * 0.7;
  if (s <= 0) return;
  const n = kind === 'marked' ? 3 : 2;
  let d = '';
  let hi = '';
  for (const sg of [-1, 1]) {
    const e = sg < 0 ? ha.eyeL : ha.eyeR;
    const ox = e[0] + sg * (ha.eyeW + 0.4);
    for (let i = 0; i < n; i++) {
      const a = (-0.5 + (i / Math.max(1, n - 1)) * 1.0) * 0.9;
      const p0: SP = [ox, e[1] + a * 0.45];
      const p1: SP = [ox + sg * 0.85 * ha.s, e[1] + a * 0.45 + a * 0.7];
      d += taperPath([p0, p1], [0.24 * ha.s, 0]);
      hi += taperPath([[p0[0], p0[1] - 0.28], [p1[0], p1[1] - 0.28]], [0.2 * ha.s, 0]);
    }
  }
  ctx.push(d, ageShade(t), { o: 0.34 * s, b: 0.14 });
  ctx.push(hi, t.lighter, { o: 0.22 * s, b: 0.14 });
}

/** manchas de vitiligo (formas orgânicas determinísticas) */
function vitiligo(ctx: LayerCtx, ha: HeadAnchors, t: SkinTones): void {
  // tom despigmentado natural (rosado-bege), borda NÍTIDA e recortada como contorno de mapa (duas frequências de
  // irregularidade, reentrâncias); desfoque mínimo — borda difusa parece reflexo de luz
  const light = t.dark ? mix(t.base, '#EBC9BA', 0.66) : mix(t.base, '#FBEDE6', 0.5);
  const patch = (cx: number, cy: number, r: number, seed: number, n = 13): string => {
    const pts: SP[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // lóbulos largos e macios (nada de estrela/respingo): baixa frequência forte, alta frequência fraca
      const k = 0.72 + 0.2 * Math.sin(seed * 3.1 + i * 1.3) + 0.08 * Math.sin(seed * 1.7 + i * 3.9);
      pts.push([cx + Math.cos(a) * r * k * 1.2, cy + Math.sin(a) * r * k]);
    }
    return smoothPath(pts, true);
  };
  const e = ha.eyeL;
  const d =
    patch(e[0] - 1.0, e[1] - 0.6, 2.3, 1) +
    patch(e[0] - 2.6, e[1] + 1.6, 0.9, 6, 9) +
    patch(ha.templeL[0] + 1.4, ha.templeL[1] - 2.8, 1.2, 2) +
    patch(ha.chin[0] + 1.5, ha.chin[1] - 1.4, 1.5, 3) +
    patch(ha.chin[0] - 0.6, ha.chin[1] - 0.6, 0.6, 7, 8) +
    patch(ha.cheekR[0] + 1.6, ha.cheekR[1] - 1.0, 0.8, 4, 9);
  ctx.push(d, light, { cp: ha.headPath, o: 0.9, b: 0.12 });
}

function details(ctx: LayerCtx, ha: HeadAnchors, t: SkinTones): void {
  const fd = ctx.cfg.faceDetail;
  switch (fd) {
    case 'freckles': {
      const c = t.dark ? mix(t.base, '#1A0A06', 0.45) : mix(t.base, '#8A4222', 0.5);
      const nx = ha.nose[0];
      speckle(ctx, { x: ha.cheekL[0] - 2.2, y: ha.cheekL[1] - 2.0, w: 3.8, h: 2.4 }, c, { n: 10, r: [0.1, 0.2], seed: 11, o: 0.55 });
      speckle(ctx, { x: ha.cheekR[0] - 1.6, y: ha.cheekR[1] - 2.0, w: 3.8, h: 2.4 }, c, { n: 10, r: [0.1, 0.2], seed: 23, o: 0.55 });
      speckle(ctx, { x: nx - 1.6, y: ha.nose[1] - 2.9, w: 3.2, h: 1.8 }, c, { n: 6, r: [0.08, 0.15], seed: 5, o: 0.5 });
      break;
    }
    case 'mole': {
      const [mx, my] = ha.mouth;
      ctx.push(ellipse(mx + ha.mouthW + 0.95, my - 1.5, 0.32, 0.3), mix(t.base, '#1E0A06', 0.7), { o: 0.95 });
      break;
    }
    case 'vitiligo':
      vitiligo(ctx, ha, t);
      break;
    case 'glitter': {
      const d =
        starPath(ha.cheekL[0] - 0.6, ha.cheekL[1] - 1.4, 0.55, 4, 0.3) +
        starPath(ha.cheekL[0] + 1.0, ha.cheekL[1] - 0.6, 0.35, 4, 0.3) +
        starPath(ha.cheekR[0] + 0.7, ha.cheekR[1] - 1.3, 0.5, 4, 0.3) +
        starPath(ha.eyeR[0] + 2.4, ha.eyeR[1] - 0.6, 0.32, 4, 0.3);
      ctx.push(blob(ha.cheekL[0], ha.cheekL[1] - 1, 2.2, 1.2) + blob(ha.cheekR[0], ha.cheekR[1] - 1, 2.2, 1.2), '#FFE9A8', { o: 0.22, b: 0.7 });
      speckle(ctx, { x: ha.cheekL[0] - 2, y: ha.cheekL[1] - 2.4, w: 4, h: 2.2 }, '#FFF4C2', { n: 9, r: [0.08, 0.16], seed: 3, o: 0.9 });
      speckle(ctx, { x: ha.cheekR[0] - 2, y: ha.cheekR[1] - 2.4, w: 4, h: 2.2 }, '#FFF4C2', { n: 9, r: [0.08, 0.16], seed: 9, o: 0.9 });
      ctx.push(d, '#FFFFFF', { o: 0.95 });
      break;
    }
    case 'star_cheek': {
      const c: Pt = [ha.cheekR[0] + 0.6, ha.cheekR[1] - 0.3];
      ctx.push(starPath(c[0], c[1], 1.25, 5, 0.46), '#FFD700', { gf: { t: 'r', cx: c[0] - 0.3, cy: c[1] - 0.4, r: 1.6, s: [[0, '#FFF6B0'], [0.5, '#FFD700'], [1, '#E0A000']] } });
      ctx.push(starPath(c[0], c[1], 1.25, 5, 0.46), '#FFD700', { o: 0.35, b: 0.6 });
      break;
    }
    default:
      break;
  }
}

/**
 * 17. estrutura do rosto (arco da sobrancelha, órbitas, maçãs com luz e sombra embaixo, têmporas, filtro, queixo),
 * nariz por planos, marcas do tempo (cfg.lines) e detalhes (cfg.faceDetail). Grupo 'head', por cima da cabeça base e
 * por baixo da barba.
 */
export function faceBase(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  ctx.group('head');
  const lite = isLite(ctx);
  const t = tonesOf(ctx);
  const ha = headAnchors(ctx.an);
  const head = ha.headPath;
  const f = faceDims(ctx.an);
  const { cx, cy } = ctx.an.head;
  // órbitas: o olho fica numa cavidade — sombra entre a sobrancelha e o olho, mais funda no canto de dentro
  {
    let sock = '';
    let inner = '';
    for (const [e, sg] of [[ha.eyeL, 1], [ha.eyeR, -1]] as const) {
      sock += blob(e[0] + sg * 0.25, e[1] - 1.15, ha.eyeW * (sg > 0 ? 1.25 : 1.35), sg > 0 ? 1.3 : 1.5, sg * 0.06);
      inner += blob(cx - sg * (Math.abs(e[0] - cx) - ha.eyeW - 0.2), e[1] - 0.5, 0.9, 1.6);
    }
    ctx.push(sock, t.form, { o: 0.5, b: 0.6, cp: head });
    ctx.push(inner, t.deep, { o: 0.38, b: 0.45 });
  }
  // arco da sobrancelha: faixa de luz logo acima da sobrancelha (osso) e testa com luz à esquerda
  if (!lite) {
    ctx.push(blob(ha.browL[0] - 0.2, ha.browY - 1.4, 2.8, 0.75, -0.05) + blob(ha.browR[0] + 0.2, ha.browY - 1.4, 2.4, 0.7, 0.05) + blob(cx - 1.8, ha.forehead[1] - 0.2, 4.0, 2.0, -0.15), t.lighter, { o: 0.19, b: 0.7, cp: head });
  }
  // maçãs do rosto: luz no alto do osso (forma inclinada), sombra macia logo abaixo (bochecha encovada sutil). Pele
  // escura: no lugar do clareamento largo (vira mancha/borrão), um especular PEQUENO e quente que segue o zigomático
  const deep = lum(t.base) < 0.15;
  if (deep) {
    const spec = mix(t.lighter, '#FFD8BE', 0.35);
    ctx.push(blob(ha.cheekboneL[0] - 0.35, ha.cheekboneL[1] - 0.25, 1.45, 0.38, -0.42), spec, { o: 0.22, b: 0.3, cp: head });
    ctx.push(blob(ha.cheekboneR[0] + 0.3, ha.cheekboneR[1] - 0.25, 1.1, 0.3, 0.42), spec, { o: 0.1, b: 0.3, cp: head });
  } else ctx.push(blob(ha.cheekboneL[0] - 0.2, ha.cheekboneL[1], 2.4, 0.85, -0.35), t.lighter, { o: t.dark ? 0.24 : 0.36, b: 0.5, cp: head });
  // (lado da luz bem mais leve e macio: sombra forte dos dois lados vira "entalhe" anguloso na bochecha)
  ctx.push(taperPath([[cx - f.cheek + 0.6, cy + f.cheekY + 1.2], [cx - f.cheek + 2.2, cy + f.cheekY + 3.2], [cx - f.cheek + 3.8, cy + f.cheekY + 4.2]], [0, 1.2, 0]), t.form, { o: 0.18 + ctx.an.feat.age * 0.08, b: 0.6, cp: head });
  ctx.push(taperPath([[cx + f.cheek - 0.6, cy + f.cheekY + 1.2], [cx + f.cheek - 2.2, cy + f.cheekY + 3.2], [cx + f.cheek - 3.8, cy + f.cheekY + 4.2]], [0, 1.4, 0]), t.form, { o: 0.34 + ctx.an.feat.age * 0.06, b: 0.5, cp: head });
  // plano lateral do rosto (a bochecha vira pra trás): faixa macia ao longo da mandíbula, mais forte à direita
  // (lado da luz bem leve; nenhum dos dois chega ao queixo — senão vira contorno de adesivo / quina de "buldogue")
  ctx.push(taperPath([[cx - f.cheek + 0.3, cy + f.cheekY + 0.5], [cx - f.jaw + 0.6, cy + f.jawY - 0.6], [cx - f.jaw * 0.55 - f.chinW * 0.45, cy + f.jawY + 1.2]], [0, 1.2, 0]), t.form, { o: t.dark ? 0.2 : 0.12, b: 0.5, cp: head });
  ctx.push(taperPath([[cx + f.cheek - 0.3, cy + f.cheekY + 0.5], [cx + f.jaw - 0.6, cy + f.jawY - 0.6], [cx + f.jaw * 0.55 + f.chinW * 0.45, cy + f.jawY + 1.4]], [0, 1.8, 0]), t.form, { o: 0.2 + f.jawSharp * 0.14, b: 0.45, cp: head });
  // embaixo do olho: bolsa sutil (luz) e sulco (sombra) — tira a cara de boneca
  if (!lite) {
    let d = '';
    for (const [e, sg] of [[ha.eyeL, 1], [ha.eyeR, -1]] as const) d += taperPath([[e[0] - sg * ha.eyeW * 0.9, e[1] + 1.55], [e[0], e[1] + 2.2], [e[0] + sg * ha.eyeW * 0.85, e[1] + 1.6]], [0, 0.5, 0]);
    ctx.push(d, t.form, { o: 0.18, b: 0.35 });
  }
  // calor natural da pele, alongado sobre a maçã (nada de bolinha de blush); bem leve, mais fraco na pele escura
  ctx.push(blob(ha.cheekL[0] - 0.3, ha.cheekL[1] - 0.4, 2.6, 1.1, -0.25) + blob(ha.cheekR[0] + 0.3, ha.cheekR[1] - 0.4, 2.6, 1.1, 0.25), t.blush, { o: t.dark ? 0.08 : 0.12, b: 1.0 });
  // têmporas
  ctx.push(blob(cx - f.temple + 0.6, cy - 2.6, 1.0, 2.6) + blob(cx + f.temple - 0.6, cy - 2.6, 1.0, 2.6), t.shade, { o: 0.2, b: 0.8, cp: head });
  // filtro (dois sulcos + luz no meio) e queixo (bola de luz + sombra dos lados)
  const [mx, my] = ha.mouth;
  const ny = ha.nose[1];
  if (!lite) {
    ctx.push(taperPath([[mx - 0.55, ny + 1.5], [mx - 0.62, my - ha.lipUp - 0.1]], [0.1, 0.4]) + taperPath([[mx + 0.55, ny + 1.5], [mx + 0.62, my - ha.lipUp - 0.1]], [0.1, 0.45]), deep ? saturate(mix(t.base, '#4A1408', 0.3), 0.3) : t.shade, { o: deep ? 0.42 : 0.3, b: 0.22 });
    ctx.push(blob(mx - 0.1, (ny + my) / 2 + 0.3, 0.4, 0.8), t.lighter, { o: 0.26, b: 0.3 });
  }
  ctx.push(blob(ha.chin[0] - 0.35, ha.chin[1] - 1.6, f.chinW * 0.55 + 0.6, 0.9), t.lighter, { o: deep ? 0.42 : 0.3, b: 0.5 });
  // pele escura: especular quente e pequeno na testa (lado da luz) — modela o crânio sem clarear a pele
  if (deep) ctx.push(blob(cx - 2.4, ha.forehead[1] - 0.6, 2.2, 0.9, -0.2), mix(t.lighter, '#FFE0CC', 0.3), { o: 0.18, b: 0.6, cp: head });
  ctx.push(blob(ha.chin[0] - f.chinW - 0.5, ha.chin[1] - 1.5, 0.7, 1.1) + blob(ha.chin[0] + f.chinW + 0.6, ha.chin[1] - 1.4, 0.8, 1.2), t.form, { o: 0.22, b: 0.45, cp: head });
  ctx.push(blob(mx + 0.2, my + ha.lipLo + 1.05, ha.mouthW * 0.42, 0.42), t.form, { o: 0.22, b: 0.35 });
  // pele escura: luz de borda FRIA e fina do lado da sombra (têmpora → maçã), separa o rosto do fundo e dá volume
  if (deep && !lite) {
    ctx.push(taperPath([[cx + f.temple - 0.25, cy - 4.2], [cx + f.cheek - 0.2, cy + f.cheekY], [cx + f.jaw + 0.1, cy + f.jawY - 2.2]], [0, 0.7, 0]), '#A8BEE8', { o: 0.1, b: 0.35, cp: head });
  }
  // tom de fantasia: brilho iridescente discreto na testa e nas maçãs
  if (t.fantasy) ctx.push(blob(cx - 2.5, cy - 6.5, 3.5, 1.5, -0.2) + blob(ha.cheekboneL[0], ha.cheekboneL[1], 1.6, 0.7), t.fantasy, { o: 0.25, b: 0.8, cp: head });
  nose(ctx, ha, t);
  lines(ctx, ha, t);
  details(ctx, ha, t);
}

// ---------------------------------------------------------------------------------------------------------------
// 19. expressão
// ---------------------------------------------------------------------------------------------------------------

/** 19. expressão (cfg.face): sobrancelhas, olhos (cfg.eyes, cfg.eyeColor), bochecha, rubor e boca — k:'face' */
export function expression(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  ctx.group('head');
  const prevTag = ctx.k;
  ctx.tag('face');
  const lite = isLite(ctx);
  const t = tonesOf(ctx);
  const ha = headAnchors(ctx.an);
  const ex = ampLite(EXPR[ctx.cfg.face] ?? EXPR.smile, lite ? 1.45 : 1);
  const e0 = EYES[ctx.cfg.eyes] ?? EYES.almond;
  const k = ha.s;
  // forma do olho na escala do olho adulto (ha.eyeS); a linha dos cílios na escala da cabeça (não afina demais)
  const es = ha.eyeS;
  const eyeSp: EyeSpec = { ...e0, up: e0.up * es, lo: e0.lo * es, tilt: e0.tilt * es, crease: e0.crease * es, lid: e0.lid * k, iris: e0.iris * es };
  const browSp = BROWS[ctx.cfg.brows] ?? BROWS.soft;
  const mk = makeupOf(ctx);
  const age = ctx.an.feat.age;
  // bochecha subindo (sorriso): luz na maçã sobe e arredonda
  // (pele escura: menor e mais fraca — luz larga vira mancha clara)
  const deepSkin = lum(t.base) < 0.15;
  if (ex.cheek > 0.3 && !lite) {
    for (const [c, sg] of [[ha.cheekL, -1], [ha.cheekR, 1]] as const) ctx.push(blob(c[0] + sg * 0.2, c[1] - 0.9, deepSkin ? 1.3 : 1.9, deepSkin ? 0.6 : 1.0, sg * 0.3), t.lighter, { o: (deepSkin ? 0.1 : 0.16) * ex.cheek, b: 0.6 });
  }
  // sorriso de canto: só a bochecha do lado que sobe (luz na maçã subindo + vinco curto embaixo do olho)
  if (ex.cheekSide) {
    const c = ex.cheekSide === 'L' ? ha.cheekL : ha.cheekR;
    const e = ex.cheekSide === 'L' ? ha.eyeL : ha.eyeR;
    const sg = ex.cheekSide === 'L' ? -1 : 1;
    ctx.push(blob(c[0] + sg * 0.1, c[1] - 1.3, 2.0, 1.1, sg * 0.2), t.lighter, { o: lite ? 0.18 : 0.26, b: 0.6 });
    ctx.push(taperPath([[e[0] - ha.eyeW * 0.7, e[1] + ha.eyeW * 0.95], [e[0] + sg * 0.2, e[1] + ha.eyeW * 1.15], [e[0] + sg * ha.eyeW * 0.9, e[1] + ha.eyeW * 0.7]], [0, 0.4, 0]), t.form, { o: 0.35, b: 0.2 });
  }
  // rubor da expressão (só quando ela pede), intensidade pelo tom de pele
  if (ex.blush > 0) {
    const bo = Math.min(0.62, (t.dark ? 0.18 : 0.24) + ex.blush * (t.dark ? 0.3 : 0.42));
    ctx.push(blob(ha.cheekL[0] - 0.2, ha.cheekL[1] + 0.1, 2.5, 1.3, -0.15) + blob(ha.cheekR[0] + 0.2, ha.cheekR[1] + 0.1, 2.5, 1.3, 0.15), saturate(t.blush, 0.15), { o: bo, b: 0.9 });
  }
  if (ctx.cfg.faceDetail === 'glam') {
    // iluminador nas maçãs
    ctx.push(blob(ha.cheekboneL[0] - 0.4, ha.cheekboneL[1] - 0.2, 1.7, 0.55, -0.3) + blob(ha.cheekboneR[0] + 0.4, ha.cheekboneR[1] - 0.2, 1.7, 0.55, 0.3), '#FFF4E6', { o: 0.38, b: 0.45 });
  }
  // olhos (as camadas iguais dos dois olhos saem juntas num path só)
  const acc = eyeAcc();
  for (const side of ['L', 'R'] as const) {
    const st = side === 'L' ? ex.eyeL : ex.eyeR;
    if (st.k === 'open') openEye(ctx, acc, ha, side, eyeSp, st, t, mk, age);
    else closedEye(ctx, acc, ha, side, eyeSp, st.k, t, mk);
  }
  acc.flush(ctx);
  // sobrancelhas
  let bc = browColor(ctx.col.hair, ctx.col.skin);
  if (lite) bc = mix(bc, '#000000', t.dark ? 0.45 : 0.22);
  // pele bem escura no 'lite': luz fina no arco da sobrancelha separa a sobrancelha do tom da pele
  if (lite && t.dark) ctx.push(blob(ha.browL[0] - 0.2, ha.browY - 1.15, 2.3, 0.5, -0.05) + blob(ha.browR[0] + 0.2, ha.browY - 1.15, 2.3, 0.5, 0.05), t.lighter, { o: 0.35 });
  brow(ctx, ha, 'L', browSp, ex.browL, bc, t.base, age);
  brow(ctx, ha, 'R', browSp, ex.browR, bc, t.base, age);
  // linhas do sorriso aberto (bochecha empurrada)
  if (ex.mouth.lines) {
    const [mx, my] = ha.mouth;
    const W = ha.mouthW + ex.mouth.w * ha.s;
    const nx = ha.nose[0];
    const ny = ha.nose[1];
    const nw = ha.noseW;
    ctx.push(
      taperPath([[nx - nw - 0.5, ny - 0.3], [nx - nw - 1.5, ny + 1.5], [mx - W - 0.9, my + 0.5]], [0, 0.5, 0]) + taperPath([[nx + nw + 0.5, ny - 0.3], [nx + nw + 1.5, ny + 1.5], [mx + W + 0.9, my + 0.5]], [0, 0.55, 0]),
      t.line,
      { o: 0.34 * ex.mouth.lines },
    );
    if (!lite) ctx.push(taperPath([[nx - nw - 1.1, ny], [nx - nw - 2.1, ny + 1.6], [mx - W - 1.5, my + 0.3]], [0, 0.6, 0]), t.lighter, { o: 0.22 * ex.mouth.lines, b: 0.3 });
  }
  crowFeet(ctx, ha, t, ex.eyeL.k === 'happy' || ex.eyeR.k === 'happy' ? 1 : ex.cheek);
  mouth(ctx, ha, ex.mouth, t, mk);
  ctx.tag(prevTag);
}

/** expressões que o rosto sabe desenhar (o resto cai no sorriso) */
export const FACE_EXPRESSIONS = Object.keys(EXPR);
