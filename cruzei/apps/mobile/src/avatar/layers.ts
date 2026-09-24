// Monta as camadas vetoriais do avatar Cruzei a partir de uma AvatarConfig.
// Uma única fonte de verdade de geometria: o app desenha com react-native-svg e o mapa (WebView)
// recebe as mesmas camadas e desenha com canvas/Path2D — o avatar é idêntico nos dois lugares.
//
// Sistema de coordenadas: viewBox 0 0 100 140 (corpo inteiro, pés em y≈134).
// Cabeça: centro (50,33) r=21. Ombros y≈56. Mãos y≈101. Pernas 92→126. Sapatos até 134.

import type { AvatarConfig } from '@cruzei/shared-types';
import { avatarColorHex } from '@cruzei/shared-utils';
import { arc, capAbove, capBelow, circle, ellipse, line, luminance, poly, quad, rgba, rrect, rrect4, shade } from './geometry';

/** Grupo do esqueleto a que a camada pertence (a animação gira/move o grupo em volta do pivô do rig). */
export type AvatarGroup = 'shadow' | 'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR';

/** Pivôs do rig no viewBox 0 0 100 140: [x, y] de cada articulação. */
export interface AvatarRig {
  /** quadris: o tronco (e tudo acima) gira/escala a partir daqui */
  body: [number, number];
  /** base do pescoço */
  head: [number, number];
  armL: [number, number];
  armR: [number, number];
  legL: [number, number];
  legR: [number, number];
}

/** Camada desenhável (chaves curtas: vai serializada pro WebView do mapa). */
export interface AvatarLayer {
  /** path SVG */
  d: string;
  /** grupo do esqueleto */
  g?: AvatarGroup;
  /** fill (hex/rgba) */
  f?: string;
  /** stroke */
  s?: string;
  /** stroke width */
  w?: number;
  /** opacity 0..1 */
  o?: number;
  /** fill-rule evenodd */
  r?: 'evenodd';
  /** linecap */
  c?: 'round' | 'butt';
}

export const AVATAR_VIEWBOX = { x: 0, y: 0, w: 100, h: 140 } as const;
/** recorte "busto" (cabeça + ombros), 1:1 */
export const AVATAR_BUST_VIEWBOX = { x: 18, y: 6, w: 64, h: 64 } as const;

const HEAD = { cx: 50, cy: 33, r: 21 } as const;
const BODY_WIDTH: Record<string, number> = { slim: 38, regular: 44, broad: 50 };

/** Pivôs do rig pra uma config (dependem só da largura do corpo). */
export function buildAvatarRig(cfg: AvatarConfig): AvatarRig {
  const w = BODY_WIDTH[cfg.body] ?? BODY_WIDTH.regular;
  const x0 = 50 - w / 2;
  const x1 = 50 + w / 2;
  const legW = w / 2 - 6;
  return {
    body: [50, 96],
    head: [50, 50],
    armL: [x0 - 5.5, 60],
    armR: [x1 + 5.5, 60],
    legL: [x0 + 3 + legW / 2, 92],
    legR: [50 + 3 + legW / 2, 92],
  };
}
const DARK = '#1F1B2E';
const WHITE = '#F7F7FA';
const GOLD = '#FFD700';
const LIME = '#7FFF00';
const MAGENTA = '#FF1493';

export interface BuildOptions {
  /** desenha a sombra elíptica no chão (mapa) */
  groundShadow?: boolean;
}

export function buildAvatarLayers(cfg: AvatarConfig, opts: BuildOptions = {}): AvatarLayer[] {
  const L: AvatarLayer[] = [];
  const skin = avatarColorHex('skin', cfg.skin);
  const skinShade = shade(skin, -0.14);
  const hair = avatarColorHex('hairColor', cfg.hairColor);
  const hairShade = shade(hair, -0.18);
  const top = avatarColorHex('topColor', cfg.topColor);
  const bottom = avatarColorHex('bottomColor', cfg.bottomColor);
  const shoes = avatarColorHex('shoesColor', cfg.shoesColor);
  const hat = avatarColorHex('hatColor', cfg.hatColor);
  const w = BODY_WIDTH[cfg.body] ?? BODY_WIDTH.regular;
  const x0 = 50 - w / 2; // borda esquerda do tronco
  const x1 = 50 + w / 2;
  const axL = x0 - 5.5; // centro do braço esquerdo
  const axR = x1 + 5.5;
  const legW = w / 2 - 6;
  const legLx = x0 + 3; // x da perna esquerda
  const legRx = 50 + 3;
  const footL = legLx + legW / 2;
  const footR = legRx + legW / 2;
  const isDress = cfg.top === 'dress';
  const longSleeve = ['hoodie', 'shirt', 'sweater', 'jacket', 'neon_jacket'].includes(cfg.top);
  const sleeveless = ['tank', 'dress'].includes(cfg.top);
  let cur: AvatarGroup = 'body';
  const push = (d: string, f?: string, extra?: Partial<AvatarLayer>) => L.push({ d, f, g: cur, ...extra });
  const stroke = (d: string, s: string, w2: number, extra?: Partial<AvatarLayer>) => L.push({ d, s, w: w2, c: 'round', g: cur, ...extra });

  // ---------- sombra no chão ----------
  cur = 'shadow';
  if (opts.groundShadow) push(ellipse(50, 135, 26, 5), 'rgba(0,0,0,0.28)');

  // ---------- cabelo: parte de trás ----------
  cur = 'head';
  const hairBack = HAIR_BACK[cfg.hair];
  if (hairBack) hairBack(L, hair, hairShade);

  // ---------- capuz (atrás da cabeça) ----------
  cur = 'body';
  if (cfg.top === 'hoodie') push(rrect4(25, 22, 50, 44, [25, 25, 10, 10]), shade(top, -0.1));

  // ---------- mochila (corpo, atrás do tronco) ----------
  if (cfg.bag === 'backpack') push(rrect4(x0 - 6, 60, w + 12, 44, [9, 9, 9, 9]), '#3A3A48');

  // ---------- pernas / parte de baixo ----------
  const bottomKind = isDress ? 'dress' : cfg.bottom;
  if (bottomKind === 'shorts' || bottomKind === 'skirt' || bottomKind === 'dress') {
    // pele das pernas aparece abaixo
    cur = 'legL'; push(rrect4(legLx + 1.5, 104, legW - 3, 24, [2, 2, 4, 4]), skin);
    cur = 'legR'; push(rrect4(legRx + 1.5, 104, legW - 3, 24, [2, 2, 4, 4]), skin);
  }
  if (bottomKind === 'jeans' || bottomKind === 'pants' || bottomKind === 'joggers' || bottomKind === 'cargo') {
    cur = 'legL'; push(rrect4(legLx, 92, legW, 34, [2, 2, 4, 4]), bottom);
    cur = 'legR'; push(rrect4(legRx, 92, legW, 34, [2, 2, 4, 4]), bottom);
    if (bottomKind === 'jeans') {
      cur = 'legL'; stroke(line(legLx + legW - 2, 96, legLx + legW - 2, 124), shade(bottom, 0.25), 0.8, { o: 0.7 });
      cur = 'legR'; stroke(line(legRx + 2, 96, legRx + 2, 124), shade(bottom, 0.25), 0.8, { o: 0.7 });
    }
    if (bottomKind === 'joggers') {
      cur = 'legL'; push(rrect(legLx, 120, legW, 6, 2), shade(bottom, -0.22));
      cur = 'legR'; push(rrect(legRx, 120, legW, 6, 2), shade(bottom, -0.22));
    }
    if (bottomKind === 'cargo') {
      cur = 'legL'; push(rrect(legLx + 1, 104, legW - 2, 8, 1.5), shade(bottom, -0.18));
      cur = 'legR'; push(rrect(legRx + 1, 104, legW - 2, 8, 1.5), shade(bottom, -0.18));
    }
  } else if (bottomKind === 'leggings') {
    cur = 'legL'; push(rrect4(legLx + 1, 92, legW - 2, 34, [2, 2, 3, 3]), bottom);
    cur = 'legR'; push(rrect4(legRx + 1, 92, legW - 2, 34, [2, 2, 3, 3]), bottom);
  } else if (bottomKind === 'shorts') {
    cur = 'legL'; push(rrect4(legLx, 92, legW, 20, [2, 2, 3, 3]), bottom);
    cur = 'legR'; push(rrect4(legRx, 92, legW, 20, [2, 2, 3, 3]), bottom);
  } else if (bottomKind === 'skirt') {
    cur = 'body'; push(poly([[x0 + 2, 92], [x1 - 2, 92], [x1 + 6, 114], [x0 - 6, 114]]), bottom);
  }

  // ---------- sapatos ----------
  const shoeAt = (fx: number) => {
    const sole = luminance(shoes) > 0.8 ? shade(shoes, -0.12) : WHITE;
    switch (cfg.shoes) {
      case 'hightops':
        push(rrect4(fx - 8, 116, 16, 17, [4, 4, 5, 5]), shoes);
        push(rrect(fx - 8, 130, 16, 4, 2), sole);
        stroke(line(fx - 3, 120, fx + 3, 120), shade(shoes, 0.5), 1, { o: 0.8 });
        stroke(line(fx - 3, 124, fx + 3, 124), shade(shoes, 0.5), 1, { o: 0.8 });
        break;
      case 'boots':
        push(rrect4(fx - 8, 113, 16, 20, [3, 3, 4, 4]), shoes);
        push(rrect(fx - 8, 130, 16, 4, 2), shade(shoes, -0.35));
        break;
      case 'sandals':
        push(rrect(fx - 6, 122, 12, 9, 3), skin);
        push(rrect(fx - 8, 129, 16, 5, 2.5), shoes);
        stroke(line(fx - 6, 126, fx + 6, 126), shoes, 1.6);
        break;
      case 'runners':
        push(rrect4(fx - 8, 122, 16, 11, [4, 4, 5, 5]), shoes);
        push(rrect(fx - 8, 130, 16, 4, 2), LIME);
        push(rrect(fx - 4, 125, 8, 2, 1), shade(shoes, -0.3));
        break;
      default: // sneakers
        push(rrect4(fx - 8, 122, 16, 11, [4, 4, 5, 5]), shoes);
        push(rrect(fx - 8, 130, 16, 4, 2), sole);
        push(rrect(fx - 4, 125, 8, 2, 1), shade(shoes, luminance(shoes) > 0.6 ? -0.3 : 0.35));
    }
  };
  cur = 'legL';
  shoeAt(footL);
  cur = 'legR';
  shoeAt(footR);

  // ---------- tronco / parte de cima ----------
  cur = 'body';
  const torso = (yTop: number, yBot: number, inset = 0) => rrect4(x0 + inset, yTop, w - inset * 2, yBot - yTop, [14, 14, 8, 8]);
  const shortSleeve = (ax: number) => {
    push(rrect4(ax - 5.5, 58, 11, 22, [6, 6, 3, 3]), top);
    push(rrect4(ax - 5, 76, 10, 24, [2, 2, 5, 5]), skin);
  };
  const longSleeveArm = (ax: number, color = top) => push(rrect4(ax - 5.5, 58, 11, 42, [6, 6, 5, 5]), color);
  const bareArm = (ax: number) => push(rrect4(ax - 5, 58, 10, 42, [5, 5, 5, 5]), skin);

  switch (cfg.top) {
    case 'tank':
      push(torso(60, 96, 4), top);
      push(rrect(x0 + 6, 54, 5, 10, 2), top);
      push(rrect(x1 - 11, 54, 5, 10, 2), top);
      break;
    case 'crop':
      push(rrect(x0 + 3, 80, w - 6, 14, 2), skin); // barriga
      push(rrect4(x0, 56, w, 28, [14, 14, 4, 4]), top);
      break;
    case 'dress':
      push(torso(58, 92, 2), top);
      push(rrect(x0 + 6, 54, 5, 8, 2), top);
      push(rrect(x1 - 11, 54, 5, 8, 2), top);
      push(poly([[x0 + 1, 88], [x1 - 1, 88], [x1 + 10, 122], [x0 - 10, 122]]), top);
      push(rrect(x0 + 1, 86, w - 2, 4, 2), shade(top, -0.15)); // cintura
      break;
    case 'jacket':
    case 'neon_jacket': {
      const inner = cfg.top === 'neon_jacket' ? '#101018' : luminance(top) > 0.7 ? '#2A2A36' : WHITE;
      push(torso(56, 96, 0), inner);
      push(poly([[x0, 58], [48, 58], [43.5, 72], [43.5, 96], [x0, 96]]), top);
      push(poly([[x1, 58], [52, 58], [56.5, 72], [56.5, 96], [x1, 96]]), top);
      // lapelas
      push(poly([[x0 + 4, 56], [48, 56], [43.5, 70]]), shade(top, -0.22));
      push(poly([[x1 - 4, 56], [52, 56], [56.5, 70]]), shade(top, -0.22));
      if (cfg.top === 'neon_jacket') {
        stroke(line(43.5, 72, 43.5, 96), LIME, 1.4);
        stroke(line(56.5, 72, 56.5, 96), LIME, 1.4);
        stroke(line(x0 + 1, 94, x1 - 1, 94), LIME, 1.2, { o: 0.8 });
      }
      break;
    }
    case 'jersey':
      push(torso(56, 96, 0), top);
      push(rrect(x0 + 2, 60, 4, 34, 1.5), WHITE);
      push(rrect(x1 - 6, 60, 4, 34, 1.5), WHITE);
      push(poly([[44, 56], [50, 63], [56, 56]]), WHITE);
      break;
    default:
      push(torso(56, 96, 0), top);
  }
  // sombra leve na base do tronco (profundidade)
  if (!isDress && cfg.top !== 'crop') push(rrect4(x0, 88, w, 8, [0, 0, 8, 8]), 'rgba(0,0,0,0.10)');

  // detalhes por peça
  if (cfg.top === 'polo' || cfg.top === 'shirt') {
    const collar = luminance(top) > 0.75 ? shade(top, -0.18) : cfg.top === 'shirt' ? WHITE : shade(top, -0.25);
    push(poly([[42, 56], [50, 65], [58, 56], [55, 54], [50, 59], [45, 54]]), collar);
    if (cfg.top === 'shirt') {
      push(circle(50, 70, 1.3), shade(top, -0.4));
      push(circle(50, 78, 1.3), shade(top, -0.4));
      push(circle(50, 86, 1.3), shade(top, -0.4));
    } else {
      stroke(line(50, 60, 50, 70), shade(top, -0.3), 1);
    }
  }
  if (cfg.top === 'hoodie') {
    push(rrect(x0 + 6, 82, w - 12, 10, 3), shade(top, -0.16));
    stroke(line(46.5, 58, 45, 72), WHITE, 1.2, { o: 0.85 });
    stroke(line(53.5, 58, 55, 72), WHITE, 1.2, { o: 0.85 });
  }
  if (cfg.top === 'sweater') {
    push(rrect(x0, 92, w, 4, 1.5), shade(top, -0.2));
    stroke(quad(44, 57, 50, 62, 56, 57), shade(top, -0.25), 1.4);
  }
  if (cfg.top === 'tee') stroke(quad(45, 56, 50, 60, 55, 56), shade(top, -0.2), 1.2, { o: 0.9 });

  // ---------- braços ----------
  if (sleeveless) {
    cur = 'armL'; bareArm(axL);
    cur = 'armR'; bareArm(axR);
  } else if (longSleeve) {
    cur = 'armL'; longSleeveArm(axL);
    cur = 'armR'; longSleeveArm(axR);
    if (cfg.top === 'sweater') {
      cur = 'armL'; push(rrect(axL - 5.5, 94, 11, 5, 2), shade(top, -0.2));
      cur = 'armR'; push(rrect(axR - 5.5, 94, 11, 5, 2), shade(top, -0.2));
    }
  } else {
    cur = 'armL'; shortSleeve(axL);
    cur = 'armR'; shortSleeve(axR);
  }
  // mãos
  cur = 'armL'; push(circle(axL, 101, 5.5), skin);
  cur = 'armR'; push(circle(axR, 101, 5.5), skin);

  // ---------- pulso ----------
  cur = 'armL';
  switch (cfg.wrist) {
    case 'watch':
      push(rrect(axL - 5.5, 92, 11, 6, 2), '#22222E');
      push(circle(axL, 95, 2.2), '#E8E8F0');
      break;
    case 'bracelet':
      push(rrect(axL - 5.5, 94, 11, 3.2, 1.6), GOLD);
      break;
    case 'smartwatch':
      push(rrect(axL - 5.5, 91, 11, 8, 3), '#111118');
      push(rrect(axL - 3.5, 93, 7, 4, 1), LIME);
      break;
    default:
      break;
  }

  // ---------- bolsa (frente) ----------
  cur = 'body';
  if (cfg.bag === 'backpack') {
    push(rrect(x0 + 3, 56, 6, 36, 3), '#2B2B36');
    push(rrect(x1 - 9, 56, 6, 36, 3), '#2B2B36');
  } else if (cfg.bag === 'crossbody') {
    push(poly([[x0 + 3, 57], [x0 + 10, 57], [x1 - 1, 94], [x1 - 8, 94]]), '#5A4632');
    push(rrect(x1 - 9, 88, 15, 12, 3), '#6E5640');
    push(rrect(x1 - 9, 88, 15, 4, 2), '#5A4632');
  }

  // ---------- colar / corrente / cachecol (sobre o tronco, sob a cabeça) ----------
  if (cfg.accessory === 'necklace') {
    stroke(quad(42, 55, 50, 65, 58, 55), GOLD, 1.3);
    push(circle(50, 64, 2), GOLD);
  } else if (cfg.accessory === 'chain') {
    stroke(quad(41, 55, 50, 67, 59, 55), GOLD, 2.6);
    stroke(quad(41, 55, 50, 67, 59, 55), shade(GOLD, -0.35), 0.8, { o: 0.6 });
  } else if (cfg.accessory === 'scarf') {
    push(rrect(37, 50, 26, 11, 5.5), '#C0392B');
    push(rrect(52, 57, 8, 18, 3), '#C0392B');
    stroke(line(53.5, 62, 58.5, 62), '#A93226', 1.2);
    stroke(line(53.5, 68, 58.5, 68), '#A93226', 1.2);
  }

  // ---------- pescoço + cabeça ----------
  cur = 'body';
  push(rrect(45, 48, 10, 12, 3), skin);
  push(ellipse(50, 52, 6.5, 2.4), 'rgba(0,0,0,0.16)');
  cur = 'head';
  push(circle(HEAD.cx, HEAD.cy, HEAD.r), skin);
  // orelhas
  push(circle(29.5, 35, 4), skin);
  push(circle(70.5, 35, 4), skin);
  push(circle(29.5, 35, 2), skinShade, { o: 0.6 });
  push(circle(70.5, 35, 2), skinShade, { o: 0.6 });

  // ---------- barba (antes do rosto: olhos/boca ficam por cima) ----------
  cur = 'head';
  switch (cfg.facialHair) {
    case 'stubble':
      push(capBelow(50, 33, 21, 39), hair, { o: 0.28 });
      break;
    case 'beard':
      push(capBelow(50, 33, 21.6, 38), hair);
      push(capBelow(50, 33, 21.6, 38), hairShade, { o: 0.25 });
      break;
    case 'goatee':
      push(rrect(45, 44, 10, 8.5, 4.5), hair);
      break;
    case 'mustache':
      push(poly([[42.5, 41], [50, 38.5], [57.5, 41], [50, 43]]), hair);
      break;
    default:
      break;
  }

  // ---------- rosto ----------
  face(L, cfg.face, hairShade, skin);

  // ---------- cabelo: frente ----------
  const hairFront = HAIR_FRONT[cfg.hair];
  if (hairFront) hairFront(L, hair, hairShade);

  // ---------- flor no cabelo ----------
  if (cfg.accessory === 'flower') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      push(circle(66 + Math.cos(a) * 3.2, 19 + Math.sin(a) * 3.2, 2.2), '#FF5AA7');
    }
    push(circle(66, 19, 2), GOLD);
  }

  // ---------- óculos ----------
  switch (cfg.glasses) {
    case 'round':
      stroke(circle(42, 35, 6.2), DARK, 1.6);
      stroke(circle(58, 35, 6.2), DARK, 1.6);
      stroke(line(48.2, 35, 51.8, 35), DARK, 1.4);
      stroke(line(35.8, 34, 30, 32.5), DARK, 1.4);
      stroke(line(64.2, 34, 70, 32.5), DARK, 1.4);
      break;
    case 'square':
      stroke(rrect(35.5, 30, 13, 10, 2.5), DARK, 1.6);
      stroke(rrect(51.5, 30, 13, 10, 2.5), DARK, 1.6);
      stroke(line(48.5, 34, 51.5, 34), DARK, 1.4);
      stroke(line(35.5, 33, 30, 32), DARK, 1.4);
      stroke(line(64.5, 33, 70, 32), DARK, 1.4);
      break;
    case 'sun':
      push(rrect(34.5, 29.5, 14, 11.5, 4.5), '#15131F');
      push(rrect(51.5, 29.5, 14, 11.5, 4.5), '#15131F');
      stroke(line(48.5, 33, 51.5, 33), '#15131F', 2);
      stroke(line(34.5, 32, 30, 31.5), '#15131F', 1.6);
      stroke(line(65.5, 32, 70, 31.5), '#15131F', 1.6);
      push(rrect(37, 31.5, 4, 2, 1), WHITE, { o: 0.35 });
      push(rrect(54, 31.5, 4, 2, 1), WHITE, { o: 0.35 });
      break;
    case 'aviator':
      push(`M34.5,30 Q34.5,42 41.5,41.5 Q48.5,41 48.5,30 Z`, '#2E2440', { o: 0.92 });
      push(`M51.5,30 Q51.5,41 58.5,41.5 Q65.5,42 65.5,30 Z`, '#2E2440', { o: 0.92 });
      stroke(`M34.5,30 Q34.5,42 41.5,41.5 Q48.5,41 48.5,30 Z`, GOLD, 1.2);
      stroke(`M51.5,30 Q51.5,41 58.5,41.5 Q65.5,42 65.5,30 Z`, GOLD, 1.2);
      stroke(line(48.5, 31, 51.5, 31), GOLD, 1.4);
      stroke(line(34.5, 31, 30, 31), GOLD, 1.2);
      stroke(line(65.5, 31, 70, 31), GOLD, 1.2);
      break;
    case 'visor':
      push(rrect(30.5, 28, 39, 11.5, 5.5), rgba(LIME, 0.55));
      stroke(rrect(30.5, 28, 39, 11.5, 5.5), LIME, 1.4);
      push(rrect(33, 30, 10, 2.5, 1.2), WHITE, { o: 0.55 });
      break;
    default:
      break;
  }

  // ---------- chapéu ----------
  switch (cfg.hat) {
    case 'cap':
      push(capAbove(50, 33, 23.5, 24), hat);
      push(rrect(29, 21.5, 42, 5.5, 2.75), shade(hat, -0.25));
      push(circle(50, 10.5, 1.6), shade(hat, -0.3));
      break;
    case 'cap_back':
      push(capAbove(50, 33, 23.5, 24), hat);
      push(rrect(39, 8, 28, 5, 2.5), shade(hat, -0.25));
      push(rrect(45, 22, 10, 3, 1.5), skin);
      break;
    case 'beanie':
      push(capAbove(50, 33, 24, 21), hat);
      push(rrect(26.5, 21, 47, 8, 3.5), shade(hat, -0.15));
      push(rrect(26.5, 21, 47, 8, 3.5), 'rgba(0,0,0,0.06)');
      break;
    case 'bucket':
      push(capAbove(50, 33, 23, 22), hat);
      push(ellipse(50, 24, 30, 5), shade(hat, -0.22));
      push(rrect(28, 18, 44, 4, 2), shade(hat, -0.1));
      break;
    case 'headband':
      push(rrect(28, 17.5, 44, 6, 3), hat);
      break;
    case 'straw':
      push(capAbove(50, 33, 24.5, 19), '#E8CB86');
      push(ellipse(50, 22.5, 36, 6), '#D9B96E');
      push(rrect(27, 17.5, 46, 4, 2), '#2A2A36');
      break;
    case 'crown':
      push(poly([[34, 21], [34, 9], [42, 16], [50, 5], [58, 16], [66, 9], [66, 21]]), GOLD);
      push(circle(42, 13, 1.6), MAGENTA);
      push(circle(50, 10, 1.9), LIME);
      push(circle(58, 13, 1.6), MAGENTA);
      break;
    default:
      break;
  }

  // ---------- brincos / fone (por cima de tudo) ----------
  if (cfg.accessory === 'earrings') {
    push(circle(29.5, 39.5, 1.7), GOLD);
    push(circle(70.5, 39.5, 1.7), GOLD);
  } else if (cfg.accessory === 'headphones') {
    stroke(arc(29, 32, 71, 32, 22, 1, 0), '#1B1B25', 3.2);
    push(rrect(25, 28, 8, 13, 3.5), '#1B1B25');
    push(rrect(67, 28, 8, 13, 3.5), '#1B1B25');
    push(circle(29, 34.5, 1.4), LIME);
    push(circle(71, 34.5, 1.4), LIME);
  }

  return L;
}

// ---------------- rosto ----------------

function face(L: AvatarLayer[], kind: string, brow: string, skin: string): void {
  const push = (d: string, f?: string, extra?: Partial<AvatarLayer>) => L.push({ d, f, g: 'head', ...extra });
  const stroke = (d: string, s: string, w: number, extra?: Partial<AvatarLayer>) => L.push({ d, s, w, c: 'round', g: 'head', ...extra });
  const eye = (cx: number) => {
    push(ellipse(cx, 35, 2.6, 3.2), DARK);
    push(circle(cx + 0.9, 33.8, 0.9), WHITE);
  };
  const happyEye = (cx: number) => stroke(quad(cx - 3, 35.5, cx, 32, cx + 3, 35.5), DARK, 1.8);
  // sobrancelhas
  if (kind === 'cool') {
    stroke(line(38, 28.5, 46, 28), brow, 1.7);
    stroke(line(54, 27, 62, 28.5), brow, 1.7);
  } else if (kind === 'calm') {
    stroke(line(38, 28.5, 46, 28.5), brow, 1.6);
    stroke(line(54, 28.5, 62, 28.5), brow, 1.6);
  } else {
    stroke(quad(38, 28.8, 42, 26.8, 46, 28.2), brow, 1.6);
    stroke(quad(54, 28.2, 58, 26.8, 62, 28.8), brow, 1.6);
  }
  // olhos
  switch (kind) {
    case 'wink':
      eye(42);
      stroke(quad(55, 35.5, 58, 33, 61, 35.5), DARK, 1.8);
      break;
    case 'laugh':
      happyEye(42);
      happyEye(58);
      break;
    default:
      eye(42);
      eye(58);
  }
  // bochechas
  if (kind === 'blush' || kind === 'laugh') {
    push(ellipse(37.5, 41, 3.4, 1.8), '#FF7A9E', { o: kind === 'blush' ? 0.55 : 0.35 });
    push(ellipse(62.5, 41, 3.4, 1.8), '#FF7A9E', { o: kind === 'blush' ? 0.55 : 0.35 });
  }
  // boca
  switch (kind) {
    case 'grin':
      push(`M43.5,43 Q50,51 56.5,43 Z`, WHITE);
      stroke(`M43.5,43 Q50,51 56.5,43 Z`, DARK, 1.4);
      break;
    case 'laugh':
      push(ellipse(50, 45.5, 5.2, 3.6), '#3B1F2E');
      push(ellipse(50, 47.2, 3.2, 1.6), '#F06C8C');
      break;
    case 'calm':
      stroke(line(46.5, 45, 53.5, 45), DARK, 1.6);
      break;
    case 'cool':
      stroke(quad(45, 44.5, 51, 47.5, 56, 44), DARK, 1.7);
      break;
    case 'blush':
      stroke(quad(46, 44.5, 50, 47, 54, 44.5), DARK, 1.6);
      break;
    default: // smile / wink
      stroke(quad(44.5, 44, 50, 49, 55.5, 44), DARK, 1.8);
  }
  void skin;
}

// ---------------- cabelo ----------------

type HairFn = (L: AvatarLayer[], color: string, dark: string) => void;

const push = (L: AvatarLayer[], d: string, f: string, extra?: Partial<AvatarLayer>) => L.push({ d, f, g: 'head', ...extra });

/** calota padrão (linha do cabelo em y=22) */
const cap = (yCut = 22, r = 21.8) => capAbove(50, 33, r, yCut);

const HAIR_FRONT: Record<string, HairFn> = {
  buzz: (L, c) => push(L, cap(23, 21.6) + capAbove(50, 33, 17, 25), c, { r: 'evenodd', o: 0.9 }),
  short: (L, c, d) => {
    push(L, cap(22), c);
    push(L, rrect(28.5, 21, 4.5, 16, 2), c); // costeletas
    push(L, rrect(67, 21, 4.5, 16, 2), c);
    push(L, poly([[32, 22], [68, 22], [66, 24.5], [34, 24.5]]), d, { o: 0.35 });
  },
  side: (L, c, d) => {
    push(L, `M31.8,22 A21.8,21.8 0 0 1 68.2,22 L60,25.5 L42,20 L31.8,24 Z`, c);
    push(L, rrect(28.5, 21, 4.5, 15, 2), c);
    push(L, rrect(67, 21, 4.5, 15, 2), c);
    push(L, poly([[42, 20], [60, 25.5], [62, 27], [40, 21.5]]), d, { o: 0.35 });
  },
  quiff: (L, c, d) => {
    push(L, cap(22), c);
    push(L, ellipse(53, 12.5, 12, 7.5), c);
    push(L, ellipse(44, 14, 7, 5), c);
    push(L, rrect(28.5, 21, 4.5, 15, 2), c);
    push(L, rrect(67, 21, 4.5, 15, 2), c);
    push(L, ellipse(56, 14.5, 6, 2.5), d, { o: 0.3 });
  },
  curly: (L, c) => {
    push(L, cap(21), c);
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + (i / 7) * Math.PI;
      push(L, circle(50 + Math.cos(a) * 20.5, 33 + Math.sin(a) * 20.5 + 1, 6.2), c);
    }
    push(L, rrect(28, 22, 5.5, 14, 2.5), c);
    push(L, rrect(66.5, 22, 5.5, 14, 2.5), c);
  },
  afro: (L, c) => push(L, cap(20, 22), c),
  bob: (L, c, d) => {
    push(L, cap(21), c);
    push(L, poly([[32, 21], [68, 21], [67, 24], [33, 24]]), d, { o: 0.3 });
  },
  long: (L, c, d) => {
    push(L, `M31.8,22 A21.8,21.8 0 0 1 68.2,22 L64,19 Q50,24 36,19 Z`, c);
    push(L, poly([[36, 19], [50, 24], [64, 19], [64, 21], [50, 26], [36, 21]]), d, { o: 0.3 });
  },
  wavy: (L, c) => push(L, `M31.8,22 A21.8,21.8 0 0 1 68.2,22 L62,19.5 Q56,25 50,20 Q44,25 38,19.5 Z`, c),
  ponytail: (L, c, d) => {
    push(L, cap(21), c);
    push(L, poly([[33, 21], [67, 21], [66, 23.5], [34, 23.5]]), d, { o: 0.3 });
  },
  bun: (L, c, d) => {
    push(L, cap(21), c);
    push(L, circle(50, 11, 8.5), c);
    push(L, circle(50, 11, 8.5), d, { o: 0.2 });
    push(L, poly([[33, 21], [67, 21], [66, 23.5], [34, 23.5]]), d, { o: 0.3 });
  },
  braids: (L, c, d) => {
    push(L, cap(21), c);
    push(L, poly([[33, 21], [67, 21], [66, 23.5], [34, 23.5]]), d, { o: 0.3 });
  },
  mohawk: (L, c, d) => {
    push(L, cap(24, 21.6) + capAbove(50, 33, 17.5, 26), '#2B2B36', { r: 'evenodd', o: 0.85 });
    push(L, poly([[44, 22], [45, 8], [50, 2], [55, 8], [56, 22]]), c);
    push(L, poly([[49, 22], [50, 6], [55, 8], [56, 22]]), d, { o: 0.3 });
  },
  dreads: (L, c, d) => {
    push(L, cap(20.5), c);
    for (let i = 0; i < 7; i++) push(L, rrect(30 + i * 6, 14, 4, 12, 2), d, { o: 0.35 });
  },
};

const HAIR_BACK: Record<string, HairFn> = {
  afro: (L, c, d) => {
    push(L, circle(50, 31, 29), c);
    push(L, circle(50, 31, 29), d, { o: 0.12 });
  },
  bob: (L, c) => push(L, rrect4(27, 18, 46, 42, [23, 23, 10, 10]), c),
  long: (L, c) => push(L, rrect4(27, 18, 46, 62, [23, 23, 12, 12]), c),
  wavy: (L, c) => {
    push(L, rrect4(26, 18, 48, 54, [24, 24, 16, 16]), c);
    for (let i = 0; i < 5; i++) push(L, circle(31 + i * 9.5, 70, 6), c);
  },
  ponytail: (L, c, d) => {
    push(L, rrect4(60, 22, 13, 46, [6, 6, 6, 6]), c);
    push(L, circle(66.5, 24, 7.5), c);
    push(L, rrect4(63, 40, 7, 26, [3, 3, 3, 3]), d, { o: 0.25 });
  },
  braids: (L, c, d) => {
    push(L, rrect4(27, 18, 46, 26, [23, 23, 6, 6]), c);
    push(L, rrect4(29, 38, 8, 40, [3, 3, 4, 4]), c);
    push(L, rrect4(63, 38, 8, 40, [3, 3, 4, 4]), c);
    for (let i = 0; i < 4; i++) {
      push(L, ellipse(33, 44 + i * 9, 3.6, 2.2), d, { o: 0.35 });
      push(L, ellipse(67, 44 + i * 9, 3.6, 2.2), d, { o: 0.35 });
    }
  },
  dreads: (L, c) => {
    push(L, rrect4(27, 18, 46, 30, [23, 23, 8, 8]), c);
    for (let i = 0; i < 6; i++) push(L, rrect4(28 + i * 8, 40, 5, 22 + (i % 2) * 6, [2, 2, 2.5, 2.5]), c);
  },
  curly: (L, c) => {
    for (let i = 0; i < 6; i++) push(L, circle(31 + i * 7.6, 44, 5.5), c);
  },
};
