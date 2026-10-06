// Cena do avatar: o que a config pede de veículo/pet/objeto e como o corpo se ajeita por causa disso.
// Dono: veículos (pose-base de montaria e regras de cena).
//
// resolveScene(cfg) roda no JS (lê o catálogo e a anatomia) e devolve um objeto simples — vai junto no rig
// (rig.scene) pra thread de UI, pro mapa e pro SVG estático.
// applyScene(pose, scene, t) roda em qualquer lugar ('worklet'): soma a pose-base da cena em cima da pose da animação
// (pernas na montaria, sentado, mãos no volante/guidão/colo, balanço do flutuante). Só mexe nos braços quando a
// animação não usa os braços (EmoteDef.usesArms); com veículo, as pernas sempre seguem o veículo.
//
// Regras (contrato):
//   carro (cover)          pernas escondidas, mãos no volante, objeto e bandeirinha somem; pet ao lado/no colo vira passageiro
//   moto/bike (straddle)   pernas montadas, mãos no guidão, objeto e bandeirinha somem; pet no colo vai pro lado
//   patinete (stand, kick) mãos no guidão
//   skate/hoverboard       mãos livres (sobe na prancha; braços levemente abertos, de equilíbrio)
//   cadeira (seat)         sentado, pernas encurtadas, mãos no colo (anatomia 'lap'); pet no colo fica no colo
//   tapete/nuvem/disco     balanço suave; pet ao lado sobe no veículo
//   sem veículo + colo     mãos 'cradle' (um antebraço por baixo do bicho, a outra mão nas costas dele — sem cruzar em
//                          X); objeto e bandeirinha somem. Animação que usa os braços: o bicho desce pro chão ao lado
//                          enquanto ela dura (petDrop) e volta pro colo no fim
//
// Mãos no volante/guidão: a cena calcula, PRA CADA PESSOA, o giro do braço e do antebraço (dois ossos, a partir do
// braço solto da anatomia) que leva a palma até a manopla/aro definidos em parts/vehicles-geom.ts — assim a mão cai no
// lugar em qualquer tipo de corpo e o desenho do veículo usa os mesmos pontos. Sem anatomia (cena antiga, testes), cai
// na tabela HAND_POSES.
//
// Pet ao lado em veículo de ficar em pé (skate, patinete, hoverboard): o piloto sobe `lift`, e o pet (grupo 'pet', raiz
// = piloto) subiria junto; a cena devolve o pet pro chão (pose.pet.dy = −lift). No carro e nos flutuantes o pets.ts já
// põe o bicho no banco / em cima do veículo.

import type { AvatarConfig, AvatarMountKind, AvatarPetPose } from '@cruzei/shared-types';
import { petPosesOf, vehicleMountOf } from '@cruzei/shared-utils';

import { SEAT_DROP, bodyAnchors, buildAnatomy, petAnchor, seatDropFor, type Anatomy } from './anatomy';
import { gripTargets, vehicleRig } from './parts/vehicles-geom';
import { clonePose, type Pose } from './pose';
import type { AvatarHands, AvatarSceneInfo, Pt } from './types';

/**
 * Cena resolvida. Os campos além de AvatarSceneInfo são opcionais (cena antiga/serializada continua valendo) e são
 * números simples (vão pra thread de UI dentro do rig).
 */
export interface AvatarScene extends AvatarSceneInfo {
  /** id do veículo (null sem) */
  vehicle?: string | null;
  /** pose-base dos braços com as mãos no volante/guidão/colo, relativa ao repouso: [braço L, antebraço L, braço R, antebraço R] */
  arms?: readonly number[] | null;
  /** braços SOMADOS quando as mãos ficam livres (equilíbrio): mesma ordem */
  armsAdd?: readonly number[] | null;
  /** pernas na montaria (absolutas): [coxa L, canela L, coxa R, canela R] */
  legs?: readonly number[] | null;
  /** amplitude do balanço (unidades) do veículo flutuante */
  bob?: number;
  /** sentado: quanto o tronco desce PRA ESTA PESSOA (anatomy.seatDropFor; perna longa senta mais fundo) */
  seatDrop?: number;
  /** pet no colo, de pé no chão: deslocamento [dx, dy] do colo até o chão ao lado (animação que usa os braços solta o bicho) */
  petDrop?: readonly number[] | null;
}

/**
 * braços do colo (relativos ao repouso): o esquerdo vem por baixo do bicho, antebraço quase na horizontal (apoio); o
 * direito sobe com a mão pousada nas costas dele. Sem cruzar os antebraços em X (lia "braços cruzados").
 */
export const CRADLE_ARMS: readonly [number, number, number, number] = [-10, -56, 0, 80];

const NONE = 'none';

/** cena vazia (pé no chão, mãos livres) */
export const EMPTY_SCENE: AvatarScene = {
  mount: null,
  petPose: null,
  petAttach: 'root',
  showHeld: true,
  showLeftHandFlag: true,
  hands: 'free',
  hideLegs: false,
  seated: false,
  lift: 0,
};

/** reserva enquanto o catálogo publicado não tem vehicleMountOf/petPosesOf (mesma tabela do F1) */
const MOUNT_FALLBACK: Record<string, AvatarMountKind> = {
  bike: 'straddle',
  moto: 'straddle',
  lambreta: 'straddle',
  kick: 'stand',
  skate: 'stand',
  hoverboard: 'stand',
  wheelchair: 'seat',
  wheelchair_sport: 'seat',
  car: 'cover',
  classic: 'cover',
  jeep: 'cover',
  sport: 'cover',
  carpet: 'hover',
  cloud: 'hover',
  ufo: 'hover',
};

function mountOf(id: string | undefined): AvatarMountKind | null {
  if (!id || id === NONE) return null;
  const fn = vehicleMountOf as unknown;
  if (typeof fn === 'function') {
    const m = (fn as (x: string) => AvatarMountKind | null)(id);
    if (m) return m;
  }
  return MOUNT_FALLBACK[id] ?? null;
}

function posesOf(petId: string): AvatarPetPose[] {
  const fn = petPosesOf as unknown;
  if (typeof fn === 'function') return (fn as (x: string) => AvatarPetPose[])(petId);
  return ['side', 'arms', 'shoulder', 'float'];
}

/** veículos em pé que têm guidão (o resto dos 'stand' deixa as mãos livres) */
const STAND_WITH_BARS = new Set(['kick']);

/** deslocamento vertical do corpo por tipo de montaria (negativo = sobe); cada veículo pode ter o seu (vehicles-geom) */
export const MOUNT_LIFT: Record<AvatarMountKind, number> = { cover: 0, straddle: 0, stand: -4, seat: 0, hover: -6 };

// ---------------------------------------------------------------------------------------------------------------
// Dois ossos: giro do braço e do antebraço que leva a palma até um alvo
// ---------------------------------------------------------------------------------------------------------------

const DEG = 180 / Math.PI;
const angOf = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]) * DEG;
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * IK de dois ossos com comprimentos fixos (ombro S → cotovelo E0 → palma P0, em repouso) até o alvo T. `out` = lado
 * pra onde o cotovelo abre (−1 esquerda da tela, +1 direita). Devolve [giro do braço, giro do antebraço] (graus,
 * horário na tela, o do antebraço relativo ao braço) — a mesma convenção da Pose.
 */
export function twoBoneAngles(S: Pt, E0: Pt, P0: Pt, T: Pt, out: number): [number, number] {
  const l1 = Math.hypot(E0[0] - S[0], E0[1] - S[1]);
  const l2 = Math.hypot(P0[0] - E0[0], P0[1] - E0[1]);
  const dx = T[0] - S[0];
  const dy = T[1] - S[1];
  const d0 = Math.hypot(dx, dy) || 1e-6;
  const d = Math.max(Math.abs(l1 - l2) + 0.05, Math.min((l1 + l2) * 0.999, d0));
  const ux = dx / d0;
  const uy = dy / d0;
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let nx = -uy;
  let ny = ux;
  // cotovelo pro lado de fora; alvo quase na horizontal: cotovelo pra baixo
  if (Math.abs(nx) < 0.15 ? ny < 0 : Math.sign(nx) !== Math.sign(out)) {
    nx = -nx;
    ny = -ny;
  }
  const E: Pt = [S[0] + ux * x + nx * h, S[1] + uy * x + ny * h];
  const R: Pt = [S[0] + ux * d, S[1] + uy * d];
  const a = wrapDeg(angOf(S, E) - angOf(S, E0));
  const f = wrapDeg(angOf(E, R) - angOf(E0, P0) - a);
  return [a, f];
}

/** braços que levam as palmas às manoplas (espaço do veículo), descontando a subida e a descida do tronco */
function gripArms(an: Anatomy, grips: [Pt, Pt], lift: number, seatDrop: number): number[] {
  const ba = bodyAnchors(an);
  const j = an.joints;
  const dy = lift + seatDrop;
  const L = twoBoneAngles(j.shoulderL, j.elbowL, ba.palmL, [grips[0][0], grips[0][1] - dy], -1);
  const R = twoBoneAngles(j.shoulderR, j.elbowR, ba.palmR, [grips[1][0], grips[1][1] - dy], 1);
  return [L[0], L[1], R[0], R[1]];
}

/** cena da config (roda no JS: lê o catálogo). `noVehicle` ignora o veículo (busto). */
export function resolveScene(cfg: Pick<AvatarConfig, 'vehicle' | 'pet' | 'petPose'> & Partial<AvatarConfig>, opts: { noVehicle?: boolean } = {}): AvatarScene {
  const vehicle = opts.noVehicle ? NONE : (cfg.vehicle ?? NONE);
  const mount = mountOf(vehicle);
  const petId = cfg.pet ?? NONE;
  let petPose: AvatarPetPose | null = null;
  if (petId && petId !== NONE) {
    const allowed = posesOf(petId);
    const want = cfg.petPose as AvatarPetPose | undefined;
    petPose = want && allowed.includes(want) ? want : (allowed[0] ?? 'side');
  }
  const s: AvatarScene = { ...EMPTY_SCENE, mount, petPose };
  switch (mount) {
    case 'cover':
      s.hideLegs = true;
      s.hands = 'wheel';
      s.showHeld = false;
      s.showLeftHandFlag = false;
      if (petPose === 'arms') s.petPose = 'side'; // passageiro
      break;
    case 'straddle':
      s.hands = 'bars';
      s.showHeld = false;
      s.showLeftHandFlag = false;
      if (petPose === 'arms') s.petPose = 'side';
      break;
    case 'stand':
      if (STAND_WITH_BARS.has(vehicle)) {
        s.hands = 'bars';
        s.showHeld = false;
        s.showLeftHandFlag = false;
      }
      break;
    case 'seat':
      s.seated = true;
      s.seatDrop = seatDropFor(cfg);
      break;
    case 'hover':
      break;
    default:
      break;
  }
  // sem veículo (ou sentado) com o pet no colo: braços aninhando, mãos ocupadas
  if (s.petPose === 'arms' && (mount === null || mount === 'seat' || mount === 'hover' || (mount === 'stand' && s.hands === 'free'))) {
    s.hands = 'cradle';
    s.showHeld = false;
    s.showLeftHandFlag = false;
    s.arms = [...CRADLE_ARMS];
    if (mount === null) {
      // do colo (pets.ts: o bicho se ajeita sobre o antebraço de apoio, perto da cintura) pro chão ao lado do pé direito
      const an = buildAnatomy({ body: 'regular', ...cfg } as Parameters<typeof buildAnatomy>[0], s);
      const from = petAnchor(an, 'arms');
      const to = petAnchor(an, 'side');
      s.petDrop = [to[0] - from[0] - 2, to[1] - (from[1] + 6)];
    }
  }
  s.petAttach = s.petPose === 'arms' || s.petPose === 'shoulder' ? 'body' : 'root';
  if (!mount) return s;

  // pose-base própria do veículo (subida, pernas, equilíbrio, balanço) e mãos no volante/guidão desta pessoa
  const vr = vehicleRig(vehicle);
  s.vehicle = vehicle;
  s.lift = vr ? vr.lift : MOUNT_LIFT[mount];
  if (vr) {
    if (mount !== 'seat') s.legs = [vr.legs[0], vr.legs[1], vr.legs[2], vr.legs[3]];
    if (vr.armsAdd && s.hands === 'free') s.armsAdd = [vr.armsAdd[0], vr.armsAdd[1], vr.armsAdd[2], vr.armsAdd[3]];
    if (vr.bob) s.bob = vr.bob;
  }
  if (s.hands === 'wheel' || s.hands === 'bars') {
    const an = buildAnatomy({ body: 'regular', ...cfg } as Parameters<typeof buildAnatomy>[0], s);
    const grips = gripTargets(an, vehicle);
    if (grips) s.arms = gripArms(an, grips, s.lift, s.seated ? (s.seatDrop ?? SEAT_DROP) : 0);
  }
  return s;
}

/** pet no colo de quem está de pé no chão: a animação de braço solta o bicho (petDrop) e a mão fica livre pro objeto dela */
export function propFreesHands(cfg: Partial<Pick<AvatarConfig, 'petPose' | 'pet' | 'vehicle'>>): boolean {
  return cfg.petPose === 'arms' && !!cfg.pet && cfg.pet !== NONE && (!cfg.vehicle || cfg.vehicle === NONE);
}

/**
 * config da montagem do objeto de uma animação (só as camadas 'held'/'prop' dela entram no palco/mapa): com o pet no
 * colo, monta sem o pet (senão a cena esconderia o objeto — no palco o bicho já está no chão enquanto a animação dura)
 */
export function propConfig<T extends Partial<AvatarConfig>>(cfg: T, prop: string): T {
  return { ...cfg, held: prop, ...(propFreesHands(cfg) ? { pet: NONE } : {}) };
}

/** braços por tipo de mão: [armL, foreL] (o lado direito é o espelho) — reserva quando a cena não traz `arms` */
export const HAND_POSES: Record<AvatarHands, readonly [number, number]> = {
  free: [0, 0],
  wheel: [-14, -52],
  bars: [-6, -24],
  cradle: [CRADLE_ARMS[0], CRADLE_ARMS[1]],
  rest: [-6, -34],
};

/** pernas por montaria: [coxa esquerda, canela esquerda] (direita = espelho) — reserva quando a cena não traz `legs` */
export const LEG_POSES: Record<AvatarMountKind, readonly [number, number]> = {
  cover: [0, 0],
  straddle: [19, -23],
  stand: [5, -4],
  seat: [0, 0],
  hover: [0, 0],
};

export interface ApplySceneOpts {
  /** a animação mexe nos braços: a cena não sobrescreve os braços */
  usesArms?: boolean;
}

/**
 * soma a pose-base da cena em cima de `pose` (devolve uma pose nova). `t` em segundos (balanço do flutuante).
 * Sem veículo e mãos livres, devolve a própria pose (mesmo objeto).
 */
export function applyScene(pose: Pose, scene: AvatarScene | null | undefined, t: number, opts?: ApplySceneOpts): Pose {
  'worklet';
  if (!scene) return pose;
  const usesArms = !!(opts && opts.usesArms);
  const hasHands = scene.hands !== 'free' && !usesArms;
  const drop = usesArms && scene.hands === 'cradle' && !!scene.petDrop && scene.petDrop.length === 2;
  if (!scene.mount && !hasHands && !scene.seated && !drop) return pose;
  const p = clonePose(pose);
  if (scene.mount) {
    // com veículo as pernas seguem o veículo (a caminhada do mapa não balança a perna de quem está montado)
    const lg = scene.legs;
    if (lg && lg.length === 4) {
      p.legL.r = lg[0];
      p.shinL = { r: lg[1] };
      p.legR.r = lg[2];
      p.shinR = { r: lg[3] };
    } else {
      const lp = LEG_POSES[scene.mount];
      p.legL.r = lp[0];
      p.legR.r = -lp[0];
      p.shinL = { r: lp[1] };
      p.shinR = { r: -lp[1] };
    }
    p.shadow.s = 1;
    const amp = scene.bob != null ? scene.bob : scene.mount === 'hover' ? 1.6 : 0;
    if (amp > 0) {
      // flutuando: sobe e desce devagar e inclina um tiquinho (a sombra no chão encolhe quando sobe)
      const bob = Math.sin((t * Math.PI * 2) / 2.4);
      p.mount = { dy: (p.mount ? p.mount.dy : 0) + amp * bob, r: (p.mount ? p.mount.r : 0) + amp * 0.75 * Math.sin((t * Math.PI * 2) / 3.1) };
      p.shadow.s = 1 - 0.035 * amp * bob;
    } else if (scene.mount === 'cover' || scene.mount === 'straddle') {
      // motor ligado: tremidinha bem leve
      p.mount = { dy: (p.mount ? p.mount.dy : 0) + 0.25 * Math.sin(t * 40), r: p.mount ? p.mount.r : 0 };
    }
    // pet ao lado de quem subiu na prancha/patinete: volta pro chão (o grupo do pet herda a subida do piloto)
    if (scene.mount === 'stand' && scene.petPose === 'side' && scene.lift) {
      const q = p.pet ? p.pet : { dx: 0, dy: 0, r: 0, s: 1 };
      p.pet = { dx: q.dx, dy: q.dy - scene.lift, r: q.r, s: q.s };
    }
  }
  if (scene.seated) p.body.dy += scene.seatDrop != null ? scene.seatDrop : SEAT_DROP;
  if (hasHands) {
    const am = scene.arms;
    if (am && am.length === 4) {
      p.armL.r = am[0];
      p.foreL = { r: am[1] };
      p.armR.r = am[2];
      p.foreR = { r: am[3] };
    } else {
      const hp = HAND_POSES[scene.hands];
      p.armL.r = hp[0];
      p.armR.r = -hp[0];
      p.foreL = { r: hp[1] };
      p.foreR = { r: -hp[1] };
    }
  } else if (drop && scene.petDrop) {
    // a animação precisa dos braços: o bicho desce do colo e espera no chão ao lado (o palco e o mapa misturam com o
    // peso da animação, então ele desce e volta suave)
    const q = p.pet ? p.pet : { dx: 0, dy: 0, r: 0, s: 1 };
    p.pet = { dx: q.dx + scene.petDrop[0], dy: q.dy + scene.petDrop[1], r: q.r, s: q.s };
  } else if (!usesArms && scene.armsAdd && scene.armsAdd.length === 4) {
    const aa = scene.armsAdd;
    p.armL.r += aa[0];
    p.foreL = { r: (p.foreL ? p.foreL.r : 0) + aa[1] };
    p.armR.r += aa[2];
    p.foreR = { r: (p.foreR ? p.foreR.r : 0) + aa[3] };
  }
  return p;
}
