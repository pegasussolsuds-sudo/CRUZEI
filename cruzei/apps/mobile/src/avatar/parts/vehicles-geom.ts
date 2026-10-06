// Geometria dos veículos que o corpo e o desenho dividem: subida do piloto, onde as mãos pegam (volante/guidão), pernas
// de cada montaria, onde o pet passageiro senta e o balanço. Sem desenho e sem worklet: roda no JS (resolveScene) e na
// montagem das camadas (parts/vehicles-*.ts). Dono: veículos.
//
// Espaço: unidades do viewBox 0 0 100 140, no espaço do grupo 'mount' (= avatar parado: o 'mount' só se mexe no
// balanço/tremidinha). O piloto fica em `T(0, lift) ∘ mount` (rig.ts): pra um ponto do veículo cair na mão, a cena
// desconta `lift` (e a descida de quem está sentado).
//
// Tudo sai da anatomia (âncoras do corpo), nunca de coordenadas fixas do boneco antigo.

import { bodyAnchors, type Anatomy } from '../anatomy';
import type { Pt } from '../types';

/** ids conhecidos (o resto cai em null = sem geometria própria) */
export type VehicleId =
  | 'bike'
  | 'kick'
  | 'skate'
  | 'wheelchair'
  | 'wheelchair_sport'
  | 'moto'
  | 'lambreta'
  | 'car'
  | 'classic'
  | 'jeep'
  | 'hoverboard'
  | 'carpet'
  | 'cloud'
  | 'sport'
  | 'ufo';

export interface VehicleRigSpec {
  /** subida do piloto (negativo = sobe); o veículo fica embaixo dos pés */
  lift: number;
  /** pernas [coxa L, canela L, coxa R, canela R] (graus, relativos ao repouso; positivo = horário na tela) */
  legs: readonly [number, number, number, number];
  /** braços SOMADOS quando as mãos ficam livres (equilíbrio): [braço L, antebraço L, braço R, antebraço R] */
  armsAdd: readonly [number, number, number, number] | null;
  /** amplitude do balanço (unidades); 0 = sem balanço próprio além do da montaria */
  bob: number;
}

/**
 * pernas e subida por veículo (o lado direito já vem espelhado na tabela). A subida é pequena de propósito: o veículo
 * de ficar em pé tem deque fino e o piloto não pode sair pelo topo do viewBox com cabelo alto ou chapéu.
 */
export const VEHICLE_RIG: Record<VehicleId, VehicleRigSpec> = {
  // carros: pernas escondidas na carroceria
  car: { lift: 0, legs: [0, 0, 0, 0], armsAdd: null, bob: 0 },
  classic: { lift: 0, legs: [0, 0, 0, 0], armsAdd: null, bob: 0 },
  jeep: { lift: 0, legs: [0, 0, 0, 0], armsAdd: null, bob: 0 },
  sport: { lift: 0, legs: [0, 0, 0, 0], armsAdd: null, bob: 0 },
  // duas rodas paradas: montado no banco com os dois pés no chão, joelhos abertos em volta do tanque (moto), pernas
  // em A por cima do quadro (bike) e atrás do escudo (lambreta). De frente, um pé no pedal de cima viraria perna de sapo.
  moto: { lift: 0, legs: [12, -10, -12, 10], armsAdd: null, bob: 0 },
  bike: { lift: 0, legs: [6.5, -5, -6.5, 5], armsAdd: null, bob: 0 },
  lambreta: { lift: 0, legs: [8, -7, -8, 7], armsAdd: null, bob: 0 },
  // em pé no deque / na prancha
  kick: { lift: -3.5, legs: [0.5, -0.5, -0.5, 0.5], armsAdd: null, bob: 0 },
  skate: { lift: -3.5, legs: [7, -6, -7, 6], armsAdd: [7, -10, -7, 10], bob: 0 },
  hoverboard: { lift: -4, legs: [5, -4, -5, 4], armsAdd: [6, -12, -6, 12], bob: 0.5 },
  // sentado (a anatomia desenha as pernas sentadas; as mãos ficam no colo)
  wheelchair: { lift: 0, legs: [0, 0, 0, 0], armsAdd: null, bob: 0 },
  wheelchair_sport: { lift: 0, legs: [0, 0, 0, 0], armsAdd: null, bob: 0 },
  // flutuando
  carpet: { lift: -4, legs: [3, -2.5, -3, 2.5], armsAdd: [4, -6, -4, 6], bob: 1.1 },
  cloud: { lift: -4, legs: [2, -1.5, -2, 1.5], armsAdd: [3, -5, -3, 5], bob: 1.1 },
  ufo: { lift: -4.5, legs: [2, -2, -2, 2], armsAdd: [3, -6, -3, 6], bob: 0.9 },
};

export function vehicleRig(id: string | null | undefined): VehicleRigSpec | null {
  return id && (VEHICLE_RIG as Record<string, VehicleRigSpec>)[id] ? (VEHICLE_RIG as Record<string, VehicleRigSpec>)[id] : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Carros (vista de frente): carroceria da cintura pra baixo, volante na frente do peito
// ---------------------------------------------------------------------------------------------------------------

export interface CarGeom {
  /** topo do para-brisa (moldura) */
  top: number;
  /** base do para-brisa / painel (o painel cobre o tronco daqui pra baixo) */
  dash: number;
  /** borda da frente do capô (começa a frente: faróis, grade) */
  nose: number;
  /** meia-largura da carroceria na altura dos para-lamas */
  half: number;
  /** centro e raio do volante */
  wheel: Pt;
  wheelR: number;
  /** palmas no aro do volante [L, R] */
  grips: [Pt, Pt];
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** altura do painel por carro (o esportivo é baixo, o jipe é alto) */
const CAR_DASH: Record<string, number> = { car: 79, classic: 78, jeep: 77, sport: 81 };
const CAR_TOP: Record<string, number> = { car: 62, classic: 61, jeep: 57, sport: 66 };

export function carGeom(an: Anatomy, id: string): CarGeom {
  const cx = an.cx;
  const dash = CAR_DASH[id] ?? 84;
  const top = CAR_TOP[id] ?? 66;
  // volante na frente da barriga da pessoa (acompanha a altura do tronco), mas sempre com o aro acima da tampa do
  // painel: no tronco curto (plus, curvilíneo) a barriga fica baixa e as mãos iam parar em cima do painel
  const wy = clamp(an.waistY + 8.5, dash - 9, dash - 5.2);
  const wheelR = 8.8;
  // mãos em "9 e 15" (um tico acima): no aro dos lados, bem separadas (nada de mãos juntas no miolo)
  const a = (74 * Math.PI) / 180;
  const gx = Math.sin(a) * wheelR;
  const gy = -Math.cos(a) * wheelR * 0.78;
  return {
    top,
    dash,
    nose: dash + 13,
    half: 44,
    wheel: [cx, wy],
    wheelR,
    grips: [
      [cx - gx, wy + gy],
      [cx + gx, wy + gy],
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Duas rodas e patinete (vista de frente, roda da frente levemente esterçada pra ler como roda)
// ---------------------------------------------------------------------------------------------------------------

export interface BarsGeom {
  /** palmas nas manoplas [L, R] */
  grips: [Pt, Pt];
  /** y do guidão (tubo) */
  barY: number;
  /** centro da roda da frente e raios (elipse) */
  wheel: Pt;
  wheelR: number;
}

/**
 * guidão de cada veículo PRA ESTA PESSOA: as manoplas ficam um pouco acima e pra fora de onde a mão dela cai com o braço
 * solto (bodyAnchors.palm com o repouso 'hang' de quem está montado) — o cotovelo dobra só o natural e nunca vira mão na
 * cintura. A roda da frente da moto e da bike ocupa o espaço entre o guidão e o chão (o veículo é do tamanho da pessoa).
 */
const BARS: Record<string, { up: number; out: number }> = {
  moto: { up: 4.4, out: 2.8 },
  lambreta: { up: 3.6, out: 1.4 },
  kick: { up: 2.4, out: 0.8 },
  bike: { up: 3.2, out: 1.6 },
};

export function barsGeom(an: Anatomy, id: string): BarsGeom {
  const cx = an.cx;
  const k = BARS[id] ?? BARS.bike;
  const ba = bodyAnchors(an);
  const lift = vehicleRig(id)?.lift ?? 0;
  const y = (ba.palmL[1] + ba.palmR[1]) / 2 + lift - k.up;
  const hx = Math.max(cx - ba.palmL[0], ba.palmR[0] - cx) + k.out;
  const grips: [Pt, Pt] = [
    [cx - hx, y],
    [cx + hx, y],
  ];
  const barY = y - 0.4;
  switch (id) {
    case 'moto': {
      const R = clamp((134 - barY - 15.5) / 2, 17.5, 22);
      return { grips, barY, wheel: [cx, 134 - R], wheelR: R };
    }
    case 'lambreta':
      return { grips, barY, wheel: [cx, 125.6], wheelR: 8.4 };
    case 'kick':
      return { grips, barY, wheel: [cx, 127.4], wheelR: 6.6 };
    default: {
      const R = clamp((134 - barY - 7.5) / 2, 20, 24);
      return { grips, barY, wheel: [cx, 134 - R], wheelR: R };
    }
  }
}

/** palmas-alvo do veículo (volante/guidão) no espaço do veículo, ou null (mãos livres) */
export function gripTargets(an: Anatomy, id: string): [Pt, Pt] | null {
  switch (id) {
    case 'car':
    case 'classic':
    case 'jeep':
    case 'sport':
      return carGeom(an, id).grips;
    case 'moto':
    case 'lambreta':
    case 'kick':
    case 'bike':
      return barsGeom(an, id).grips;
    default:
      return null;
  }
}
