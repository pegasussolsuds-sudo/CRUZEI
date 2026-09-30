// Geometria do tour (pura, testada): recorte em volta do alvo, onde fica o cartão e os alvos que não são uma View
// (o boneco no mapa, a roda de gente em volta, a lista recolhida e as abas).
import type { TourShape } from './steps';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** recorte: retângulo arredondado (círculo = quadrado com r = metade) */
export interface Hole extends Rect {
  r: number;
}

/** margem mínima do recorte até a borda da tela */
const EDGE = 2;

/** recorte em volta do alvo: folga + forma */
export function holeFor(rect: Rect, shape: TourShape, pad: number, radius = 16): Hole {
  if (shape === 'circle') {
    const d = Math.max(rect.width, rect.height) + pad * 2;
    return { x: rect.x + rect.width / 2 - d / 2, y: rect.y + rect.height / 2 - d / 2, width: d, height: d, r: d / 2 };
  }
  const width = rect.width + pad * 2;
  const height = rect.height + pad * 2;
  const r = shape === 'pill' ? height / 2 : radius;
  return { x: rect.x - pad, y: rect.y - pad, width, height, r: Math.min(r, width / 2, height / 2) };
}

/** recorte dentro da tela (a lista e as abas encostam na borda) */
export function clampHole(h: Hole, screenW: number, screenH: number): Hole {
  const x = Math.max(EDGE, h.x);
  const y = Math.max(EDGE, h.y);
  const width = Math.max(0, Math.min(h.x + h.width, screenW - EDGE) - x);
  const height = Math.max(0, Math.min(h.y + h.height, screenH - EDGE) - y);
  return { x, y, width, height, r: Math.min(h.r, width / 2, height / 2) };
}

export interface Insets {
  top: number;
  bottom: number;
}

export interface CardPlacement {
  top: number;
  /** a setinha aponta pro recorte: 'up' (cartão embaixo), 'down' (cartão em cima), null (sem recorte / por cima) */
  caret: 'up' | 'down' | null;
  /** x da setinha dentro do cartão */
  caretX: number;
}

/** folga entre o recorte e o cartão */
export const CARD_GAP = 16;
/** margem do cartão até as bordas seguras */
const CARD_MARGIN = 12;
const CARET_MIN = 28;

/**
 * Cartão embaixo ou em cima do recorte (onde couber, preferindo o lado com mais espaço). Sem recorte: no meio.
 * Recorte grande demais: por cima dele, no lado oposto ao centro do recorte.
 */
export function placeCard(p: {
  hole: Hole | null;
  screenH: number;
  cardLeft: number;
  cardW: number;
  cardH: number;
  insets: Insets;
}): CardPlacement {
  const { hole, screenH, cardLeft, cardW, cardH, insets } = p;
  const minTop = insets.top + CARD_MARGIN;
  const maxTop = screenH - insets.bottom - CARD_MARGIN - cardH;
  if (!hole || hole.width < 1 || hole.height < 1) {
    return { top: Math.max(minTop, Math.min(maxTop, Math.round((screenH - cardH) / 2))), caret: null, caretX: cardW / 2 };
  }
  const caretX = Math.max(CARET_MIN, Math.min(cardW - CARET_MIN, hole.x + hole.width / 2 - cardLeft));
  const below = hole.y + hole.height + CARD_GAP;
  const above = hole.y - CARD_GAP - cardH;
  const fitsBelow = below <= maxTop;
  const fitsAbove = above >= minTop;
  const spaceBelow = screenH - (hole.y + hole.height);
  const spaceAbove = hole.y;
  const preferBelow = spaceBelow >= spaceAbove;
  if (fitsBelow && (preferBelow || !fitsAbove)) return { top: Math.round(below), caret: 'up', caretX };
  if (fitsAbove) return { top: Math.round(above), caret: 'down', caretX };
  // não cabe de nenhum lado: por cima, longe do centro do recorte
  const holeMid = hole.y + hole.height / 2;
  return { top: Math.round(holeMid < screenH / 2 ? Math.max(minTop, maxTop) : minTop), caret: null, caretX };
}

// ---- alvos calculados a partir da raiz do mapa ----

/**
 * Onde o boneco fica depois de a câmera centralizar em mim: o MapLibre põe o centro no meio da área útil (tela menos o
 * padding do header em cima e da lista embaixo). `frame` = raiz do MapScreen na janela.
 */
export function mePoint(frame: Rect, headerH: number, listH: number): { x: number; y: number } {
  const usable = Math.max(0, frame.height - headerH - listH);
  return { x: frame.x + frame.width / 2, y: frame.y + headerH + usable / 2 };
}

/** o boneco sai do ponto pra cima (âncora no pé): o círculo sobe um pouco */
const FIGURE_LIFT = 26;
const ME_DIAMETER = 108;

export function meRect(frame: Rect, headerH: number, listH: number): Rect {
  const p = mePoint(frame, headerH, listH);
  return { x: p.x - ME_DIAMETER / 2, y: p.y - FIGURE_LIFT - ME_DIAMETER / 2, width: ME_DIAMETER, height: ME_DIAMETER };
}

/** roda de gente em volta de mim: cabe na área útil do mapa, no máximo 340 px de diâmetro */
export function peopleRect(frame: Rect, headerH: number, listH: number): Rect {
  const p = mePoint(frame, headerH, listH);
  const usable = Math.max(0, frame.height - headerH - listH);
  const d = Math.max(ME_DIAMETER, Math.min(frame.width * 0.84, usable - 16, 340));
  return { x: p.x - d / 2, y: p.y - d / 2, width: d, height: d };
}

/** lista recolhida: faixa de baixo do mapa */
export function listRect(frame: Rect, listH: number): Rect {
  const h = Math.min(listH, frame.height * 0.5);
  return { x: frame.x + 6, y: frame.y + frame.height - h, width: frame.width - 12, height: h };
}

/**
 * Abas pedidas (ex.: Curtidas e Mensagens) na barra de baixo, logo abaixo da raiz do mapa: abas de largura igual, a
 * parte de toque é a barra sem o inset do sistema. null se alguma aba não existir.
 */
export function tabsRect(frame: Rect, tabBarH: number, insetBottom: number, routes: readonly string[], wanted: readonly string[]): Rect | null {
  if (routes.length === 0 || tabBarH <= 0) return null;
  const idx = wanted.map((w) => routes.indexOf(w));
  if (idx.some((i) => i < 0)) return null;
  const first = Math.min(...idx);
  const last = Math.max(...idx);
  const tabW = frame.width / routes.length;
  const barH = Math.max(40, tabBarH - insetBottom);
  return { x: frame.x + tabW * first + 4, y: frame.y + frame.height + 3, width: tabW * (last - first + 1) - 8, height: barH - 8 };
}
