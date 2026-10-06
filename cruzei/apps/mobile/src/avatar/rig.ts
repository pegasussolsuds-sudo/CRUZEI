// Matemática do esqueleto: matriz afim de cada grupo a partir do rig e da pose.
// UMA fonte pros três renderizadores (SVG estático, palco Skia na thread de UI e raster do mapa) e pra folha de contato.
//
// Mat = [a, b, c, d, e, f] na ordem do SVG `matrix(a b c d e f)`:
//   x' = a·x + c·y + e
//   y' = b·x + d·y + f
// A matriz leva um ponto do espaço do grupo (unidades do viewBox) pro espaço do avatar (viewBox 0 0 100 140).
// O enquadramento (posição, escala, espelho) fica com cada renderizador.
//
// Hierarquia (igual ao antigo avatar-anim.ts, mais os grupos novos):
//   shadow  = escala horizontal em volta de (50,135)
//   mount   = raiz: T(0,dy) e giro em volta de rig.mount
//   rider   = T(0, scene.lift) ∘ (com veículo ? mount : I)       ← o piloto vai junto do veículo
//   body    = rider ∘ T(pivô + (dx,dy)) R(r) S(sx,sy) T(-pivô)
//   head    = body ∘ T(pivô + (0,dy)) R(r) T(-pivô)
//   armX    = body ∘ giro no ombro;   foreX = armX ∘ giro no cotovelo
//   legX    = rider ∘ giro no quadril ∘ escorço sy no eixo da perna; shinX = legX ∘ giro no joelho
//   pet     = (petAttach 'body' ? body : rider) ∘ T(pivô + (dx,dy)) R(r) S(s) T(-pivô)
// Sem veículo e sem lift, rider = identidade e o resultado bate com o desenho antigo.

import type { Pose } from './pose';
import type { AvatarGroup, AvatarRig } from './types';

export type Mat = [number, number, number, number, number, number];

const DEG = Math.PI / 180;

// ATENÇÃO (worklets): o plugin transforma cada função 'worklet' numa fábrica que captura as funções que ela chama NO
// MOMENTO EM QUE É DEFINIDA. Defina sempre a função chamada ANTES de quem chama (senão vira "is not a function").

export function mIdentity(): Mat {
  'worklet';
  return [1, 0, 0, 1, 0, 0];
}

/** A·B (aplica B primeiro, depois A) */
export function mMul(A: Mat, B: Mat): Mat {
  'worklet';
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

/** M ∘ T(x,y) */
function tr(M: Mat, x: number, y: number): Mat {
  'worklet';
  return [M[0], M[1], M[2], M[3], M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}
/** M ∘ R(deg) */
function rot(M: Mat, deg: number): Mat {
  'worklet';
  if (deg === 0) return M;
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [M[0] * c + M[2] * s, M[1] * c + M[3] * s, -M[0] * s + M[2] * c, -M[1] * s + M[3] * c, M[4], M[5]];
}
/** M ∘ S(sx,sy) */
function sc(M: Mat, sx: number, sy: number): Mat {
  'worklet';
  return [M[0] * sx, M[1] * sx, M[2] * sy, M[3] * sy, M[4], M[5]];
}
/** M ∘ giro em volta de p */
function pivot(M: Mat, p: readonly [number, number], deg: number): Mat {
  'worklet';
  if (deg === 0) return M;
  return tr(rot(tr(M, p[0], p[1]), deg), -p[0], -p[1]);
}
/** perna: giro no quadril e escorço vertical no eixo dela (sy ausente/1 = só o giro) */
function legOf(M: Mat, p: readonly [number, number], leg: { r: number; sy?: number }): Mat {
  'worklet';
  const sy = leg.sy;
  if (sy === undefined || sy === 1) return pivot(M, p, leg.r);
  return tr(sc(rot(tr(M, p[0], p[1]), leg.r), 1, sy), -p[0], -p[1]);
}

function mountOf(M: Mat, rig: AvatarRig, pose: Pose): Mat {
  'worklet';
  const m = pose.mount;
  if (!m) return M;
  return tr(rot(tr(M, rig.mount[0], rig.mount[1] + m.dy), m.r), -rig.mount[0], -rig.mount[1]);
}
function riderOf(rig: AvatarRig, pose: Pose): Mat {
  'worklet';
  const sc0 = rig.scene;
  let M = mIdentity();
  if (!sc0) return M;
  if (sc0.lift) M = tr(M, 0, sc0.lift);
  if (sc0.mount && pose.mount) M = mountOf(M, rig, pose);
  return M;
}
function bodyOf(rig: AvatarRig, pose: Pose): Mat {
  'worklet';
  const b = pose.body;
  let M = riderOf(rig, pose);
  M = tr(M, rig.body[0] + (b.dx ?? 0), rig.body[1] + b.dy);
  M = rot(M, b.r);
  M = sc(M, b.sx, b.sy);
  return tr(M, -rig.body[0], -rig.body[1]);
}

/** matriz do grupo `g` (espaço do grupo → espaço do avatar) */
export function groupMatrix(g: AvatarGroup, rig: AvatarRig, pose: Pose): Mat {
  'worklet';
  switch (g) {
    case 'shadow': {
      let M = tr(mIdentity(), 50, 135);
      M = sc(M, pose.shadow.s, 1);
      return tr(M, -50, -135);
    }
    case 'body':
      return bodyOf(rig, pose);
    case 'head': {
      let M = bodyOf(rig, pose);
      M = tr(M, rig.head[0], rig.head[1] + pose.head.dy);
      M = rot(M, pose.head.r);
      return tr(M, -rig.head[0], -rig.head[1]);
    }
    case 'armL':
      return pivot(bodyOf(rig, pose), rig.armL, pose.armL.r);
    case 'armR':
      return pivot(bodyOf(rig, pose), rig.armR, pose.armR.r);
    case 'foreL':
      return pivot(pivot(bodyOf(rig, pose), rig.armL, pose.armL.r), rig.foreL, pose.foreL ? pose.foreL.r : 0);
    case 'foreR':
      return pivot(pivot(bodyOf(rig, pose), rig.armR, pose.armR.r), rig.foreR, pose.foreR ? pose.foreR.r : 0);
    case 'legL':
      return legOf(riderOf(rig, pose), rig.legL, pose.legL);
    case 'legR':
      return legOf(riderOf(rig, pose), rig.legR, pose.legR);
    case 'shinL':
      return pivot(legOf(riderOf(rig, pose), rig.legL, pose.legL), rig.shinL, pose.shinL ? pose.shinL.r : 0);
    case 'shinR':
      return pivot(legOf(riderOf(rig, pose), rig.legR, pose.legR), rig.shinR, pose.shinR ? pose.shinR.r : 0);
    case 'mount':
      return mountOf(mIdentity(), rig, pose);
    case 'pet': {
      const base = rig.petAttach === 'body' ? bodyOf(rig, pose) : riderOf(rig, pose);
      const p = pose.pet;
      if (!p) return base;
      let M = tr(base, rig.pet[0] + p.dx, rig.pet[1] + p.dy);
      M = rot(M, p.r);
      M = sc(M, p.s, p.s);
      return tr(M, -rig.pet[0], -rig.pet[1]);
    }
    default:
      return mIdentity();
  }
}

/** aplica a matriz a um ponto */
export function mApply(M: Mat, x: number, y: number): [number, number] {
  'worklet';
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

/** true quando a matriz é a identidade (o renderizador pode pular o grupo de transformação) */
export function mIsIdentity(M: Mat, eps = 1e-9): boolean {
  'worklet';
  return Math.abs(M[0] - 1) < eps && Math.abs(M[1]) < eps && Math.abs(M[2]) < eps && Math.abs(M[3] - 1) < eps && Math.abs(M[4]) < eps && Math.abs(M[5]) < eps;
}

/** Mat → matriz 3x3 do Skia (linha a linha: scaleX, skewX, transX, skewY, scaleY, transY, 0, 0, 1) */
export function mToSkia(M: Mat): number[] {
  'worklet';
  return [M[0], M[2], M[4], M[1], M[3], M[5], 0, 0, 1];
}

/** Mat → atributo `transform` do SVG */
export function mToSvg(M: Mat): string {
  const r = (n: number) => String(Math.round(n * 10000) / 10000);
  return `matrix(${r(M[0])} ${r(M[1])} ${r(M[2])} ${r(M[3])} ${r(M[4])} ${r(M[5])})`;
}
