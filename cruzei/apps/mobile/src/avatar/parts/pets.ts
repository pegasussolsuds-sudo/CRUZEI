// Pets (slot `pet`, posição efetiva em ctx.scene.petPose). Dono: pets.
//
// Posições e etapas:
//   'side'     7  petGround   — no chão ao lado (no carro: passageiro; no tapete/nuvem/disco: em cima do veículo)
//   'arms'    14  petCradle   — no colo, por cima do tronco e por baixo dos antebraços (mãos 'cradle' aninham)
//   'shoulder' 25 petShoulder — no ombro direito da tela, por cima do cabelo e do chapéu
//   'float'   26  petFloat    — flutuando perto da cabeça, com brilho
//
// Contrato:
//   - TODAS as camadas no grupo 'pet' e com k:'pet' (o orquestrador já põe os dois antes de chamar);
//   - pivô: rig.pet = petAnchor(an, petPose) (anatomy.ts); 'body' (colo/ombro) acompanha o tronco, 'root' fica no
//     chão/no ar (com veículo, vai junto do veículo);
//   - cada bicho é desenhado UMA vez (pets-sitter.ts, pets-critters.ts, pets-birds.ts, pets-fantasy.ts) e aqui só
//     ganha posição, escala e espelho por pose. No colo, o bicho se ajeita onde os antebraços da cena 'cradle'
//     realmente cruzam (rig + pose da cena), então acompanha qualquer ajuste em scene.HAND_POSES;
//   - busto: só 'shoulder' e 'float' aparecem (o 'float' chega perto da cabeça pra caber no recorte).

import type { AvatarPetPose } from '@cruzei/shared-types';

import { bodyAnchors, bustViewBox, petAnchor } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { zero } from '../pose';
import { mApply, groupMatrix } from '../rig';
import { applyScene } from '../scene';
import { isLite, lodCtx } from '../shading';
import type { AvatarRig } from '../types';

import { drawBird } from './pets-birds';
import { drawCritter } from './pets-critters';
import { drawFantasy } from './pets-fantasy';
import { glow, groundShadow, makePen, sparkles, type Pen } from './pets-kit';
import { drawSitter, sitterHeight, type SitterSpec } from './pets-sitter';

export type PetPoseDraw = 'side' | 'arms' | 'shoulder' | 'float';

/** caixa do desenho no espaço local (escala 1): x0..x1, topo (y negativo) e centro visual */
export interface PetBox {
  x0: number;
  x1: number;
  top: number;
  /** y do centro visual (pra flutuar e ombro) */
  cy: number;
}

export interface PetDef {
  /** desenha no espaço local (origem no ponto de apoio) */
  draw: (pen: Pen, pose: PetPoseDraw) => void;
  /** caixa na escala 1 */
  box: PetBox;
  /** escala por pose (relativa ao tamanho "real" no chão) */
  scale?: Partial<Record<PetPoseDraw, number>>;
  /** sombra de chão (meia-largura) */
  shadowW: number;
  /** brilho ao flutuar */
  glowColor?: string;
  /** bicho de verdade voando (aves): sem halo mágico nem cintilas */
  noGlow?: boolean;
  /** altura dos olhos acima dos pés (fração da altura da caixa): no colo, os olhos ficam acima dos antebraços */
  eye?: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Raças que usam o quadrúpede sentado
// ---------------------------------------------------------------------------------------------------------------

const SIT = (spec: SitterSpec, extra: Partial<PetDef> = {}): PetDef => {
  const tail = spec.tail === 'wrap' ? 9 : spec.tail === 'curl' ? 12 : 13.5;
  const top = -sitterHeight(spec);
  return {
    draw: (pen, pose) => drawSitter(pen, spec, pose),
    box: { x0: -7.4 * spec.k, x1: tail * spec.k, top, cy: top * 0.5 },
    shadowW: 9 * spec.k,
    // centro da cabeça do sentado (pets-sitter: hcy = −15·legs − 3,4·head)
    eye: ((15 * spec.legs + 3.4 * spec.head) * spec.k) / -top,
    ...extra,
  };
};

export const PET_DEFS: Record<string, PetDef> = {
  dog_caramel: SIT(
    { k: 1.42, head: 0.98, muzzle: 0.85, bulk: 1.0, legs: 1.05, ear: 'semi', earSize: 1.05, tail: 'curl', fur: 'short', coat: '#C8873F', belly: '#F0D3A2', nose: '#2A1A14', iris: '#6B3E1E', pupil: 'round', marks: [], tongue: true, collar: '#2E7DD7' },
  ),
  dog_black: SIT(
    { k: 1.22, head: 1.0, muzzle: 0.8, bulk: 0.98, legs: 1.0, ear: 'flop', earSize: 0.95, tail: 'curl', fur: 'sleek', coat: '#2B2624', belly: '#3E3532', nose: '#120C0B', iris: '#7A4A26', pupil: 'round', marks: ['blaze'], tongue: true, collar: '#E0475B' },
  ),
  pug: SIT(
    { k: 1.0, head: 1.22, muzzle: 0.22, bulk: 1.22, legs: 0.82, ear: 'button', earSize: 1.0, tail: 'curl', fur: 'short', coat: '#D9B98A', belly: '#E8CFA6', nose: '#1A1210', iris: '#3A2214', pupil: 'round', marks: ['mask'], markColor: '#2A2220', tongue: true, eyeK: 1.25 },
  ),
  poodle: SIT(
    { k: 1.12, head: 1.0, muzzle: 0.75, bulk: 0.92, legs: 1.15, ear: 'flop', earSize: 1.0, tail: 'pom', fur: 'curly', coat: '#F3E9DC', belly: '#F3E9DC', nose: '#2A1C18', iris: '#3A2416', pupil: 'round', marks: [], collar: '#FF5FA2' },
  ),
  husky: SIT(
    { k: 1.55, head: 0.95, muzzle: 0.8, bulk: 1.05, legs: 1.05, ear: 'prick', earSize: 1.0, tail: 'brush', fur: 'fluffy', coat: '#6F7682', belly: '#F4F2EE', nose: '#1A1A1E', iris: '#7EC4F2', pupil: 'round', marks: ['husky'], tongue: true },
  ),
  cat_orange: SIT(
    { k: 1.0, head: 1.0, muzzle: 0, bulk: 0.95, legs: 1.0, ear: 'prick', earSize: 0.95, tail: 'wrap', fur: 'short', coat: '#E08A3C', belly: '#F6D7AE', nose: '#E58A8A', iris: '#C9B23A', pupil: 'slit', marks: ['tabby'], markColor: '#A9541C' },
    { scale: { shoulder: 0.72 } },
  ),
  cat_black: SIT(
    { k: 1.0, head: 1.0, muzzle: 0, bulk: 0.92, legs: 1.0, ear: 'prick', earSize: 1.0, tail: 'wrap', fur: 'sleek', coat: '#242029', belly: '#2E2934', nose: '#3A3036', iris: '#C6D23A', pupil: 'slit', marks: [] },
    { scale: { shoulder: 0.72 } },
  ),
  cat_tuxedo: SIT(
    { k: 1.0, head: 1.0, muzzle: 0, bulk: 0.95, legs: 1.0, ear: 'prick', earSize: 0.95, tail: 'wrap', fur: 'short', coat: '#25222A', belly: '#F4F2F0', nose: '#E79A9A', iris: '#8BC34A', pupil: 'slit', marks: ['tux'], markColor: '#25222A' },
    { scale: { shoulder: 0.72 } },
  ),
  cat_siamese: SIT(
    { k: 1.0, head: 0.96, muzzle: 0, bulk: 0.9, legs: 1.05, ear: 'prick', earSize: 1.12, tail: 'wrap', fur: 'sleek', coat: '#EEE0C8', belly: '#F6EDDD', nose: '#5A3A30', iris: '#5FA8E8', pupil: 'slit', marks: ['points'], markColor: '#4A3228' },
    { scale: { shoulder: 0.72 } },
  ),
  fox_spirit: SIT(
    { k: 1.18, head: 0.95, muzzle: 0.7, bulk: 0.9, legs: 1.05, ear: 'tall', earSize: 1.0, tail: 'spirit', fur: 'fluffy', coat: '#F2F4FF', belly: '#FFFFFF', nose: '#5B6BD8', iris: '#7DE8FF', pupil: 'slit', marks: ['spirit'], markColor: '#9FB4FF', aura: '#8FE3FF', eyeK: 1.05 },
    { glowColor: '#8FE3FF', scale: { float: 0.82 } },
  ),
};

// bichos com desenho próprio
for (const id of ['dachshund', 'bunny', 'hamster', 'turtle', 'capybara', 'sloth', 'axolotl'] as const) {
  PET_DEFS[id] = drawCritter(id);
}
for (const id of ['arara', 'parrot', 'phoenix'] as const) {
  PET_DEFS[id] = drawBird(id);
}
for (const id of ['dragon', 'unicorn', 'robot_dog', 'ghost'] as const) {
  PET_DEFS[id] = drawFantasy(id);
}
// altura dos olhos dos desenhos próprios (y do olho ÷ topo da caixa, medidos nos desenhos)
const EYE: Record<string, number> = { dachshund: 0.87, bunny: 0.55, hamster: 0.61, turtle: 0.48, sloth: 0.8, axolotl: 0.38, unicorn: 0.71 };
for (const [id, eye] of Object.entries(EYE)) PET_DEFS[id] = { ...PET_DEFS[id], eye };

/** definição do pet (null = sem pet ou id desconhecido) */
export function petDef(id: string | null | undefined): PetDef | null {
  if (!id || id === 'none') return null;
  return Object.prototype.hasOwnProperty.call(PET_DEFS, id) ? PET_DEFS[id] : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Onde os antebraços da cena 'cradle' cruzam (no espaço do tronco)
// ---------------------------------------------------------------------------------------------------------------

/** pontos das mãos na pose da cena (espaço do tronco: sem o deslocamento do corpo inteiro) */
export function cradleHands(ctx: LayerCtx): { L: [number, number]; R: [number, number]; elbowL: [number, number]; elbowR: [number, number] } {
  const { an, scene } = ctx;
  const ba = bodyAnchors(an);
  const rig = { body: [an.cx, 70], head: [an.cx, 30], armL: an.joints.shoulderL, armR: an.joints.shoulderR, foreL: an.joints.elbowL, foreR: an.joints.elbowR, legL: an.joints.hipL, legR: an.joints.hipR, shinL: an.joints.kneeL, shinR: an.joints.kneeR, mount: [an.cx, 118], pet: [an.cx, 70], petAttach: 'body' } as AvatarRig;
  const p = applyScene(zero(), { ...scene, mount: null, seated: false, lift: 0 }, 0);
  const mL = groupMatrix('foreL', rig, p);
  const mR = groupMatrix('foreR', rig, p);
  const aL = groupMatrix('armL', rig, p);
  const aR = groupMatrix('armR', rig, p);
  return {
    L: mApply(mL, ba.palmL[0], ba.palmL[1]),
    R: mApply(mR, ba.palmR[0], ba.palmR[1]),
    elbowL: mApply(aL, an.joints.elbowL[0], an.joints.elbowL[1]),
    elbowR: mApply(aR, an.joints.elbowR[0], an.joints.elbowR[1]),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Posicionamento por pose
// ---------------------------------------------------------------------------------------------------------------

/** tamanho mínimo (maior lado da caixa, unidades) do bicho flutuando no corpo inteiro pequeno */
const LITE_FLOAT_MIN = 20;

/** quanto os olhos do bicho no colo ficam acima da mão de cima (a que pousa no peito/costas dele, não na cara) */
const CRADLE_EYE_CLEAR = 6.5;

interface Place {
  x: number;
  y: number;
  s: number;
  flip: boolean;
}

function placeFor(ctx: LayerCtx, def: PetDef, pose: PetPoseDraw): Place {
  const { an, scene } = ctx;
  const anchor = petAnchor(an, pose as AvatarPetPose);
  const sc = def.scale?.[pose] ?? 1;
  const b = def.box;
  switch (pose) {
    case 'arms': {
      // aninhado no peito: o antebraço esquerdo apoia por baixo e a mão direita pousa por cima; a "cintura" do bicho
      // (42% da altura) fica entre as mãos, mas os olhos sempre acima da mão de cima (o bicho sobe); o topo nunca passa
      // da gola (o pescoço é desenhado depois e cobriria a cabeça do bicho): se não couber, o bicho encolhe
      const h = cradleHands(ctx);
      const crossY = (h.L[1] + h.R[1]) / 2 + 1.2;
      const upper = Math.min(h.L[1], h.R[1]);
      const crossX = (h.L[0] + h.R[0]) / 2;
      const H = -b.top;
      const eye = def.eye ?? 0.72;
      const ceiling = an.collarY + 0.6;
      const footAt = (s: number): number => Math.min(crossY + H * s * 0.42, upper + H * s * eye - CRADLE_EYE_CLEAR);
      let s = sc;
      for (let i = 0; i < 20 && footAt(s) - H * s < ceiling; i++) s *= 0.96;
      return { x: crossX + 1.0, y: footAt(s), s, flip: false };
    }
    case 'shoulder': {
      const ba = bodyAnchors(an);
      return { x: ba.shoulderPerch[0] + 0.6, y: ba.shoulderPerch[1] + 0.8, s: sc, flip: false };
    }
    case 'float': {
      // o halo (glow em drawPet) passa da caixa do bicho: cabe inteiro no viewBox
      const right = def.noGlow ? b.x1 : Math.max(b.x1, (b.x0 + b.x1) / 2 + (b.x1 - b.x0) * 0.62);
      if (ctx.opts.mode === 'bust') {
        // no busto: ao lado do rosto, dentro do recorte (bustViewBox); se não couber entre o rosto e a borda, encolhe
        const vb = bustViewBox(an, ctx.cfg);
        const edge = vb.x + vb.w - 0.5;
        const faceR = an.cx + 8;
        let s = sc * 0.8;
        let x = Math.min(an.cx + 17, edge - right * s);
        if (x + b.x0 * s < faceR) {
          s = Math.min(s, (edge - faceR) / (right - b.x0));
          x = faceR - b.x0 * s;
        }
        return { x, y: an.head.cy + 4 - b.cy * s, s, flip: false };
      }
      // corpo inteiro pequeno (mapa, miniatura): bicho miúdo (fantasminha) cresce até LITE_FLOAT_MIN unidades, senão vira
      // uma bolinha de ~6 px longe da cabeça; a borda de dentro dele chega mais perto do rosto
      const big = Math.max(-b.top, b.x1 - b.x0);
      const s = isLite(ctx) ? Math.max(sc, LITE_FLOAT_MIN / big) : sc;
      return { x: Math.min(anchor[0], 99.5 - right * s), y: anchor[1] - b.cy * s, s, flip: false };
    }
    default: {
      // no chão ao lado do pé direito; no carro (passageiro) sobe pro banco; no tapete/nuvem/disco, em cima dele
      let x = anchor[0];
      let y = anchor[1];
      if (scene.mount === 'cover') {
        x = an.cx + an.w.shoulder + 6;
        y = an.hj - 2;
      } else if (scene.mount === 'hover') {
        x = an.cx + an.w.hip + 12;
        y = an.foot.soleY + 0.5;
      }
      // cabe no viewBox
      x = Math.min(x, 99 - b.x1 * sc);
      return { x, y, s: sc, flip: false };
    }
  }
}

function drawPet(ctx: LayerCtx, pose: PetPoseDraw): void {
  ctx = lodCtx(ctx);
  const def = petDef(ctx.cfg.pet);
  if (!def) return;
  const pl = placeFor(ctx, def, pose);
  const pen = makePen(ctx, pl.x, pl.y, pl.s, 0, pl.flip);
  if (pose === 'side' && ctx.scene.mount !== 'cover') groundShadow(pen, (def.box.x0 + def.box.x1) / 2 + 1, 0.2, def.shadowW, 1.5, 0.38);
  if (pose === 'float') {
    const c = def.glowColor ?? '#FFE9A8';
    if (!def.noGlow) glow(pen, (def.box.x0 + def.box.x1) / 2, def.box.cy, (def.box.x1 - def.box.x0) * 0.62, -def.box.top * 0.58, c, 0.28);
    // sombra suave embaixo (no ar) e cintilas
    pen.fill(pen.ell((def.box.x0 + def.box.x1) / 2, 4.5, def.shadowW * 0.6, 1.0), def.noGlow ? '#05030A' : c, { o: 0.25, b: 1.2 });
  }
  def.draw(pen, pose);
  if (pose === 'float' && !pen.lite && !def.noGlow) {
    const w = def.box.x1 - def.box.x0;
    sparkles(pen, [[def.box.x0 - 1, def.box.top * 0.7, 1.1], [def.box.x1 + 0.5, def.box.top * 0.35, 0.8], [def.box.x0 + w * 0.3, 3.2, 0.7]], '#FFFFFF', 0.85);
  }
}

/** 7. pet no chão ao lado (petPose 'side') */
export function petGround(ctx: LayerCtx): void {
  drawPet(ctx, 'side');
}

/** 14. pet no colo (petPose 'arms') */
export function petCradle(ctx: LayerCtx): void {
  if (ctx.opts.mode === 'bust') return;
  drawPet(ctx, 'arms');
}

/** 25. pet no ombro (petPose 'shoulder') */
export function petShoulder(ctx: LayerCtx): void {
  drawPet(ctx, 'shoulder');
}

/** 26. pet flutuando (petPose 'float') */
export function petFloat(ctx: LayerCtx): void {
  drawPet(ctx, 'float');
}
