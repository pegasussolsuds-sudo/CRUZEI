// Geometria do tour: recorte em volta do alvo, cartão onde couber (360 dp do Galaxy S23 e 432 dp do Moto) e os
// alvos calculados a partir da raiz do mapa.
import { CARD_GAP, clampHole, holeFor, listRect, mePoint, meRect, peopleRect, placeCard, tabsRect, type Hole } from './geometry';
import { TOUR_STEPS, resolveTourSteps, tourStep, type TourTargetId } from './steps';

const CARD_H = 210;
const S23 = { w: 360, h: 780, insets: { top: 24, bottom: 0 } };
const MOTO = { w: 432, h: 960, insets: { top: 28, bottom: 42 } };

function card(screen: { w: number; h: number; insets: { top: number; bottom: number } }, hole: Hole | null) {
  const cardW = Math.min(screen.w - 32, 420);
  const cardLeft = (screen.w - cardW) / 2;
  const p = placeCard({ hole, screenH: screen.h, cardLeft, cardW, cardH: CARD_H, insets: screen.insets });
  return { ...p, cardW, cardLeft };
}

describe('holeFor', () => {
  it('círculo cobre o maior lado + folga, centrado no alvo', () => {
    expect(holeFor({ x: 100, y: 50, width: 44, height: 44 }, 'circle', 8)).toEqual({ x: 92, y: 42, width: 60, height: 60, r: 30 });
  });

  it('pílula: raio = metade da altura', () => {
    const h = holeFor({ x: 16, y: 40, width: 328, height: 48 }, 'pill', 6);
    expect(h).toEqual({ x: 10, y: 34, width: 340, height: 60, r: 30 });
  });

  it('retângulo usa o raio pedido (sem passar da metade)', () => {
    expect(holeFor({ x: 0, y: 0, width: 100, height: 20 }, 'rect', 0, 22).r).toBe(10);
    expect(holeFor({ x: 0, y: 0, width: 100, height: 80 }, 'rect', 0, 22).r).toBe(22);
  });
});

describe('clampHole', () => {
  it('lista e abas encostadas na borda ficam dentro da tela', () => {
    const h = clampHole({ x: -4, y: 700, width: 400, height: 120, r: 22 }, 360, 780);
    expect(h.x).toBe(2);
    expect(h.x + h.width).toBe(358);
    expect(h.y + h.height).toBe(778);
    expect(h.r).toBeLessThanOrEqual(h.height / 2);
  });
});

describe('placeCard', () => {
  it('sem recorte (boas-vindas): no meio, sem setinha', () => {
    const p = card(S23, null);
    expect(p.caret).toBeNull();
    expect(p.top).toBe(Math.round((780 - CARD_H) / 2));
  });

  it('alvo no header (busca, visível, localizar): cartão embaixo, setinha pra cima apontando pro alvo', () => {
    const fab = holeFor({ x: 300, y: 84, width: 44, height: 44 }, 'circle', 8);
    const p = card(S23, fab);
    expect(p.caret).toBe('up');
    expect(p.top).toBe(Math.round(fab.y + fab.height + CARD_GAP));
    // a setinha fica embaixo do botão (limitada à borda do cartão)
    expect(p.caretX).toBeGreaterThan(p.cardW / 2);
    expect(p.caretX).toBeLessThanOrEqual(p.cardW - 28);
  });

  it('abas embaixo: cartão em cima, setinha pra baixo, sem sair da tela', () => {
    const tabs = clampHole(holeFor({ x: 76, y: 719, width: 136, height: 48 }, 'rect', 0, 18), S23.w, S23.h);
    const p = card(S23, tabs);
    expect(p.caret).toBe('down');
    expect(p.top + CARD_H + CARD_GAP).toBeLessThanOrEqual(tabs.y + 1);
    expect(p.top).toBeGreaterThanOrEqual(S23.insets.top);
  });

  it('recorte enorme: por cima, longe do centro do recorte, sem setinha', () => {
    const huge: Hole = { x: 10, y: 60, width: 340, height: 660, r: 20 };
    const p = card(S23, huge);
    expect(p.caret).toBeNull();
    expect(p.top).toBeGreaterThanOrEqual(S23.insets.top);
    expect(p.top + CARD_H).toBeLessThanOrEqual(S23.h - S23.insets.bottom);
  });

  it.each([
    ['Galaxy S23 (360 dp)', S23],
    ['Moto g54 (432 dp)', MOTO],
  ])('roda de gente em volta de mim cabe com o cartão: %s', (_name, screen) => {
    const tabBar = 64 + screen.insets.bottom;
    const frame = { x: 0, y: 0, width: screen.w, height: screen.h - tabBar };
    const hole = holeFor(peopleRect(frame, 132, 190), 'circle', 0);
    const p = card(screen, hole);
    expect(p.caret).not.toBeNull();
    expect(p.cardW).toBeLessThanOrEqual(screen.w - 32);
    // o cartão não cobre o recorte
    if (p.caret === 'up') expect(p.top).toBeGreaterThanOrEqual(hole.y + hole.height);
    else expect(p.top + CARD_H).toBeLessThanOrEqual(hole.y);
  });
});

describe('alvos calculados do mapa', () => {
  const frame = { x: 0, y: 0, width: 360, height: 716 };

  it('o boneco fica no meio da área útil (header em cima, lista embaixo)', () => {
    expect(mePoint(frame, 130, 190)).toEqual({ x: 180, y: 130 + (716 - 130 - 190) / 2 });
  });

  it('o círculo do boneco sobe um pouco (âncora no pé)', () => {
    const p = mePoint(frame, 130, 190);
    const r = meRect(frame, 130, 190);
    expect(r.x + r.width / 2).toBe(p.x);
    expect(r.y + r.height / 2).toBeLessThan(p.y);
  });

  it('a roda de gente cabe na largura e na área útil', () => {
    const r = peopleRect(frame, 130, 190);
    expect(r.width).toBe(r.height);
    expect(r.width).toBeLessThanOrEqual(360 * 0.84);
    expect(r.width).toBeLessThanOrEqual(716 - 130 - 190);
  });

  it('lista recolhida: faixa de baixo (nunca mais que metade da tela)', () => {
    expect(listRect(frame, 190)).toEqual({ x: 6, y: 716 - 190, width: 348, height: 190 });
    expect(listRect(frame, 600).height).toBe(358);
  });

  it('abas Curtidas e Mensagens na barra logo abaixo do mapa', () => {
    const r = tabsRect(frame, 64 + 48, 48, ['Map', 'Likes', 'Inbox', 'Paywall', 'Profile'], ['Likes', 'Inbox']);
    expect(r).not.toBeNull();
    expect(r?.x).toBeCloseTo(72 + 4);
    expect(r?.width).toBeCloseTo(144 - 8);
    expect(r?.y).toBe(716 + 3);
    expect(r?.height).toBe(64 - 8);
  });

  it('aba que não existe: sem passo das abas', () => {
    expect(tabsRect(frame, 64, 0, ['Map', 'Profile'], ['Likes', 'Inbox'])).toBeNull();
    expect(tabsRect(frame, 0, 0, ['Map', 'Likes', 'Inbox'], ['Likes', 'Inbox'])).toBeNull();
  });
});

describe('passos', () => {
  it('boas-vindas primeiro e todos os alvos pedidos (você, gente, busca, visível, localizar, lista, abas)', () => {
    expect(resolveTourSteps(() => true)).toEqual(['welcome', 'me', 'people', 'vibe', 'visibility', 'locate', 'list', 'tabs']);
  });

  it('sem localização: sem "você no mapa" nem a roda de gente', () => {
    const noMe = (t: TourTargetId) => t !== 'me' && t !== 'people';
    expect(resolveTourSteps(noMe)).toEqual(['welcome', 'vibe', 'visibility', 'locate', 'list', 'tabs']);
  });

  it('textos curtos (cabem no cartão de 360 dp) e só o "você no mapa" mexe na câmera', () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeLessThanOrEqual(32);
      expect(s.body.length).toBeLessThanOrEqual(120);
    }
    expect(TOUR_STEPS.filter((s) => s.focusMe).map((s) => s.id)).toEqual(['me']);
    expect(tourStep('tabs').target).toBe('tabs');
  });
});
