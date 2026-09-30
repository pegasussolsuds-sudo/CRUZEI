import { distanceMeters, offsetLatLng } from '@cruzei/shared-utils';

import {
  GPS_GUARD,
  applyMode,
  autoReportText,
  decide,
  judgeMove,
  nextWindow,
  parseGuardMode,
  strikeLimit,
  windowOk,
  type Fix,
  type GuardConfig,
  type GuardDecision,
  type GuardState,
} from './anti-spoof';

// limites fixos (não dependem do .env de quem roda)
const cfg: GuardConfig = {
  ...GPS_GUARD,
  MAX_GROUND_KMH: 250,
  MAX_AIR_KMH: 1_000,
  AIR_AFTER_S: 1_800,
  NOISE_FLOOR_M: 300,
  SHORT_DT_S: 60,
  MIN_JUMP_M: 1_500,
  WINDOW_S: 300,
  ACC_TOLERANCE_CAP_M: 200,
  ACC_IGNORE_M: 500,
  ACC_DEFAULT_M: 100,
  CONFIRM_S: 45,
  STRIKES_TELEPORT: 5,
  STRIKES_MOCK: 3,
};

const HOME = { lat: -18.923, lng: -48.27 }; // Uberlândia
const T0 = Date.UTC(2026, 9, 3, 20, 0, 0);
/** posição a `north` m ao norte de HOME, `s` segundos depois de T0 */
const at = (north: number, s: number, acc = 10): Fix => {
  const p = offsetLatLng(HOME.lat, HOME.lng, north, 0);
  return { lat: p.lat, lng: p.lng, t: T0 + s * 1000, acc };
};
const state = (s: Partial<GuardState> = {}): GuardState => ({
  anchor: null,
  win: null,
  pending: null,
  flag: null,
  ...s,
});
/** o que o GpsGuard + LocationService gravam depois de cada decisão (sem Redis): aceite anda âncora e janela */
const apply = (s: GuardState, fix: Fix, d: GuardDecision): GuardState => {
  if (d.action === 'accept')
    return { anchor: fix, win: nextWindow(s, fix, d.reason, cfg), pending: null, flag: null };
  if (d.action === 'hold') return { ...s, pending: d.pending ?? s.pending, flag: d.reason };
  return s;
};

describe('judgeMove (velocidade entre posições aceitas)', () => {
  it('andar e dirigir passam', () => {
    expect(judgeMove(at(0, 0), at(100, 60), cfg).ok).toBe(true); // 6 km/h
    expect(judgeMove(at(0, 0), at(2_000, 60), cfg).ok).toBe(true); // 120 km/h
    expect(judgeMove(at(0, 0), at(30_000, 900), cfg).ok).toBe(true); // 120 km/h por 15 min
  });

  it('5 km em 20 s é salto impossível', () => {
    const j = judgeMove(at(0, 0), at(5_000, 20), cfg);
    expect(j.ok).toBe(false);
    expect(j.kmh).toBeGreaterThan(250);
  });

  it('avião: 400 km em 1 h passa; 400 km em 20 min não', () => {
    expect(judgeMove(at(0, 0), at(400_000, 3_600), cfg).ok).toBe(true);
    expect(judgeMove(at(0, 0), at(400_000, 1_200), cfg).ok).toBe(false);
  });

  it('ruído de GPS / wi-fi: abaixo do piso passa em qualquer intervalo; salto médio com tempo de sobra também', () => {
    expect(judgeMove(at(0, 0), at(290, 1), cfg).ok).toBe(true); // 270 m efetivos < piso de 300 m
    expect(judgeMove(at(0, 0), at(1_400, 90), cfg).ok).toBe(true); // < 1,5 km com 90 s: no máximo ~56 km/h
  });

  it('intervalo curto: salto abaixo de MIN_JUMP_M também precisa de velocidade plausível (GPS falso deslizando)', () => {
    // 1,2 km em 10 s (~425 km/h): antes passava como "ruído" por ser < 1,5 km
    const j = judgeMove(at(0, 0), at(1_200, 10), cfg);
    expect(j.ok).toBe(false);
    expect(j.kmh).toBeGreaterThan(400);
    // a mesma distância em 30 s é carro na avenida (~140 km/h)
    expect(judgeMove(at(0, 0), at(1_200, 30), cfg).ok).toBe(true);
    // 1,48 km em 20 s (~266 km/h) com GPS bom: salto, mesmo abaixo de 1,5 km
    expect(judgeMove(at(0, 0), at(1_500, 20), cfg).ok).toBe(false);
  });

  it('a precisão desconta, mas com teto de 200 m: accuracy alta não compra salto', () => {
    // 1,5 km em 20 s com ±150 m: efetivo 1,34 km (~241 km/h) → passa; com GPS bom não passava (acima)
    expect(judgeMove(at(0, 0, 10), at(1_500, 20, 150), cfg).ok).toBe(true);
    // accuracy=100000 desconta só 200 m: 1,7 km em 20 s continua salto (com o teto antigo de 1 km passava)
    const j = judgeMove(at(0, 0, 10), at(1_700, 20, 100_000), cfg);
    expect(j.ok).toBe(false);
    expect(j.effM).toBeCloseTo(1_500, -1);
  });
});

describe('janela (velocidade acumulada)', () => {
  it('nextWindow: recomeça na 1ª posição e na viagem confirmada; senão só anda depois de WINDOW_S, pra âncora anterior', () => {
    const a = at(0, 0);
    const b = at(500, 100);
    const fix = at(900, 200);
    expect(nextWindow(state(), fix, 'first', cfg)).toBe(fix);
    expect(nextWindow(state({ anchor: b, win: a }), fix, 'confirmed', cfg)).toBe(fix);
    // sem janela ainda (estado antigo): começa na âncora
    expect(nextWindow(state({ anchor: b }), fix, 'ok', cfg)).toBe(b);
    // janela com 200 s: fica
    expect(nextWindow(state({ anchor: b, win: a }), fix, 'ok', cfg)).toBe(a);
    // janela passou de 300 s: anda pra âncora anterior — nunca pro fix que acabou de chegar
    const late = at(1_000, 301);
    expect(nextWindow(state({ anchor: b, win: a }), late, 'ok', cfg)).toBe(b);
  });

  it('windowOk: sem janela, ou janela = âncora, não muda nada', () => {
    const far = at(5_000, 20);
    expect(windowOk(state({ anchor: at(0, 0) }), far, cfg)).toBe(true);
    expect(windowOk(state({ anchor: at(0, 0), win: at(0, 0) }), far, cfg)).toBe(true);
    expect(
      windowOk(state({ anchor: at(1_580, 20, 100), win: at(0, 0, 100) }), at(3_160, 40, 100), cfg),
    ).toBe(false);
  });

  it('GPS falso deslizando em passinhos "plausíveis" (tolerância a cada passo): a âncora não anda e os saltos contam', () => {
    // 1,58 km a cada 20 s com ±100 m: cada passo sozinho dá ~248 km/h (passa), mas somado dá > 250 km/h
    let s = state({ anchor: at(0, 0, 100) });
    let strikes = 0;
    const actions: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const fix = at(i * 1_580, i * 20, 100);
      expect(judgeMove(at((i - 1) * 1_580, (i - 1) * 20, 100), fix, cfg).ok).toBe(true);
      const d = decide(s, fix, false, cfg);
      actions.push(d.action);
      if (d.action === 'hold' && d.strike) strikes++;
      s = apply(s, fix, d);
    }
    // só o 1º passo entra; depois disso a âncora fica parada perto do começo
    expect(actions[0]).toBe('accept');
    expect(actions.slice(1).every((a) => a === 'hold')).toBe(true);
    expect(distanceMeters(HOME.lat, HOME.lng, s.anchor!.lat, s.anchor!.lng)).toBeLessThan(1_600);
    expect(strikes).toBeGreaterThanOrEqual(strikeLimit('teleport', cfg));
  });

  it('carro de verdade (120 km/h por 10 min) e GPS parado com ruído passam sempre', () => {
    let s = state({ anchor: at(0, 0) });
    for (let i = 1; i <= 30; i++) {
      const fix = at(i * 667, i * 20);
      const d = decide(s, fix, false, cfg);
      expect(d.action).toBe('accept');
      s = apply(s, fix, d);
      // a janela fica sempre atrás e com no máximo WINDOW_S + um passo
      expect(s.win!.t).toBeLessThan(fix.t);
      expect(fix.t - s.win!.t).toBeLessThanOrEqual((cfg.WINDOW_S + 20) * 1000);
    }
    let still = state({ anchor: at(0, 0) });
    const noise = [250, -200, 280, 0, -260, 150, 290, -280];
    noise.forEach((n, i) => {
      const fix = at(n, (i + 1) * 20, 30);
      const d = decide(still, fix, false, cfg);
      expect(d.action).toBe('accept');
      still = apply(still, fix, d);
    });
  });
});

describe('decide (modo on)', () => {
  it('sem âncora: aceita como primeira posição', () => {
    expect(decide(state(), at(0, 0), false, cfg)).toEqual({ action: 'accept', reason: 'first' });
  });

  it('movimento possível: aceita', () => {
    expect(decide(state({ anchor: at(0, 0) }), at(300, 30), false, cfg)).toEqual({
      action: 'accept',
      reason: 'ok',
    });
  });

  it('só localização aproximada (Android "aproximada", ±2 km): a 1ª vira presença e, parada, segue valendo', () => {
    expect(decide(state(), at(0, 0, 2_000), false, cfg)).toEqual({
      action: 'accept',
      reason: 'first',
    });
    // o Android arredonda a aproximada pra uma grade: o mesmo ponto de novo é aceito (mantém a presença viva)
    expect(decide(state({ anchor: at(0, 0, 2_000) }), at(0, 30, 2_000), false, cfg)).toEqual({
      action: 'accept',
      reason: 'ok',
    });
    // mas precisão ruim não compra salto: 3 km em 30 s continua ignorado (sem strike)
    expect(decide(state({ anchor: at(0, 0, 2_000) }), at(3_000, 30, 2_000), false, cfg)).toEqual({
      action: 'ignore',
      reason: 'inaccurate',
    });
  });

  it('precisão inútil: ignora (não move a presença nem conta episódio)', () => {
    expect(decide(state({ anchor: at(0, 0) }), at(50_000, 20, 20_000), false, cfg)).toEqual({
      action: 'ignore',
      reason: 'inaccurate',
    });
  });

  it('fix honesto e impreciso (antena, ±3 km) longe da âncora: ignora, sem segurar nem contar strike', () => {
    const ignore = { action: 'ignore', reason: 'inaccurate' };
    expect(decide(state({ anchor: at(0, 0) }), at(4_000, 30, 3_000), false, cfg)).toEqual(ignore);
    // precisão inválida perto da âncora: julgada com a tolerância do teto (parado = segue valendo)
    expect(decide(state({ anchor: at(0, 0) }), at(100, 30, Number.NaN), false, cfg)).toEqual({
      action: 'accept',
      reason: 'ok',
    });
    // no teto ainda é julgada
    expect(
      decide(state({ anchor: at(0, 0) }), at(300, 30, cfg.ACC_IGNORE_M), false, cfg).action,
    ).toBe('accept');
    // simulada continua sendo simulada, com qualquer precisão
    expect(decide(state({ anchor: at(0, 0) }), at(0, 30, 3_000), true, cfg).action).toBe('hold');
  });

  it('posição simulada: segura sem pendente; um episódio por aviso', () => {
    const d = decide(state({ anchor: at(0, 0) }), at(0, 30), true, cfg);
    expect(d).toEqual({ action: 'hold', reason: 'mock', pending: null, strike: 'mock' });
    // já avisado: não conta de novo a cada envio
    expect(decide(state({ anchor: at(0, 0), flag: 'mock' }), at(0, 60), true, cfg)).toEqual({
      action: 'hold',
      reason: 'mock',
      pending: null,
      strike: null,
    });
    // mesmo sem âncora (primeira posição) simulada não entra
    expect(decide(state(), at(0, 0), true, cfg).action).toBe('hold');
  });

  it('salto: segura com pendente e conta episódio; confirma depois de CONFIRM_S no lugar novo', () => {
    const anchor = at(0, 0);
    const jump = at(5_000, 20);
    const d1 = decide(state({ anchor }), jump, false, cfg);
    expect(d1).toEqual({ action: 'hold', reason: 'teleport', pending: jump, strike: 'teleport' });
    // 20 s depois, no mesmo lugar novo: ainda esperando (sem episódio novo, mantém o pendente)
    expect(
      decide(state({ anchor, pending: jump, flag: 'teleport' }), at(5_050, 40), false, cfg),
    ).toEqual({
      action: 'hold',
      reason: 'teleport',
      pending: null,
      strike: null,
    });
    // 50 s depois do salto, ainda lá: era viagem de verdade (ou o GPS voltou)
    expect(
      decide(state({ anchor, pending: jump, flag: 'teleport' }), at(5_020, 70), false, cfg),
    ).toEqual({ action: 'accept', reason: 'confirmed' });
  });

  it('pulo de GPS e volta: a posição de antes é aceita na hora', () => {
    const anchor = at(0, 0);
    const jump = at(8_000, 20);
    expect(
      decide(state({ anchor, pending: jump, flag: 'teleport' }), at(50, 40), false, cfg),
    ).toEqual({ action: 'accept', reason: 'ok' });
  });

  it('pulando de bairro em bairro a cada 20 s: nunca é aceito e cada salto conta', () => {
    let s = state({ anchor: at(0, 0) });
    let strikes = 0;
    for (let i = 1; i <= 6; i++) {
      const fix = at(i * 4_000 * (i % 2 ? 1 : -1), i * 20);
      const d = decide(s, fix, false, cfg);
      expect(d.action).toBe('hold');
      if (d.action === 'hold') {
        if (d.strike) strikes++;
        s = { anchor: s.anchor, win: s.win, pending: d.pending ?? s.pending, flag: 'teleport' };
      }
    }
    expect(strikes).toBe(6);
    expect(strikes).toBeGreaterThanOrEqual(strikeLimit('teleport', cfg));
  });
});

describe('applyMode (off / shadow / on)', () => {
  const hold = decide(state({ anchor: at(0, 0) }), at(5_000, 20), false, cfg);

  it('on: vale a decisão', () => {
    expect(applyMode('on', hold)).toEqual({ effective: hold, shadow: null });
  });

  it('shadow: aceita tudo e devolve o que faria (pra contar)', () => {
    expect(applyMode('shadow', hold)).toEqual({
      effective: { action: 'accept', reason: 'ok' },
      shadow: 'teleport',
    });
    expect(applyMode('shadow', { action: 'ignore', reason: 'inaccurate' }).effective.action).toBe(
      'accept',
    );
  });

  it('off: aceita tudo sem contar', () => {
    expect(applyMode('off', hold)).toEqual({
      effective: { action: 'accept', reason: 'ok' },
      shadow: null,
    });
  });

  it('aceite passa igual em qualquer modo', () => {
    const ok = decide(state({ anchor: at(0, 0) }), at(100, 30), false, cfg);
    expect(applyMode('shadow', ok)).toEqual({ effective: ok, shadow: null });
  });
});

describe('config e textos', () => {
  it('GPS_GUARD: off | shadow | on; vazio ou inválido = on (decisão do dono)', () => {
    expect(parseGuardMode('off')).toBe('off');
    expect(parseGuardMode(' Shadow ')).toBe('shadow');
    expect(parseGuardMode('on')).toBe('on');
    expect(parseGuardMode(undefined)).toBe('on');
    expect(parseGuardMode('talvez')).toBe('on');
  });

  it('denúncia automática sem coordenada', () => {
    const t = autoReportText('teleport', 5) + autoReportText('mock', 3);
    expect(t).not.toMatch(/-?\d+\.\d{3,}/);
    expect(t).toContain('Automático');
  });
});
