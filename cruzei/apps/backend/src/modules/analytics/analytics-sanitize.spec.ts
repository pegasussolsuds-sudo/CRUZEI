import { ANALYTICS_LIMITS } from '@cruzei/shared-types';

import {
  allowedEvents,
  FIRST_STEP,
  gateUnstarted,
  isFirstStep,
  isValidInstallId,
  resolveAt,
  sanitizeBatch,
  sanitizeEvent,
  sanitizeProps,
  spDay,
  type CleanEvent,
} from './analytics-sanitize';

const NOW = new Date('2026-09-30T15:00:00.000Z'); // 12:00 em São Paulo

describe('saneamento dos eventos de métricas', () => {
  it('installId: aleatório do app (uuid), nada de lixo nem longo demais', () => {
    expect(isValidInstallId('3f2b8c1e-9a7d-4e1b-8c55-0a1b2c3d4e5f')).toBe(true);
    expect(isValidInstallId('abc')).toBe(false);
    expect(isValidInstallId('x'.repeat(ANALYTICS_LIMITS.installIdMax + 1))).toBe(false);
    expect(isValidInstallId("1' OR 1=1 --")).toBe(false);
    expect(isValidInstallId(123)).toBe(false);
  });

  it('props: só as chaves da lista (posição nunca), valores simples, texto cortado', () => {
    expect(
      sanitizeProps({
        platform: 'android',
        appVersion: '1.2.3',
        durationMs: 1200,
        skipped: true,
        lat: -18.9,
        lng: -48.2,
        latitude: -18.9,
        stepIndex: Number.NaN,
        osVersion: { nested: 1 },
      }),
    ).toEqual({ platform: 'android', appVersion: '1.2.3', durationMs: 1200, skipped: true });
    expect(sanitizeProps({ lat: 1, lng: 2 })).toBeNull();
    expect(sanitizeProps(['platform'])).toBeNull();
    expect(sanitizeProps('platform=android')).toBeNull();
    expect(sanitizeProps({ appVersion: 'v'.repeat(500) })?.appVersion).toHaveLength(64);
    expect(sanitizeProps({ skipped: null })).toEqual({ skipped: null });
  });

  it('hora: ausente/inválida/futura = agora; velha demais = descarta', () => {
    expect(resolveAt(undefined, NOW)).toBe(NOW);
    expect(resolveAt('ontem', NOW)).toBe(NOW);
    expect(resolveAt('2026-10-01T00:00:00Z', NOW)).toBe(NOW);
    expect(resolveAt('2026-09-30T14:00:00Z', NOW)?.toISOString()).toBe('2026-09-30T14:00:00.000Z');
    const old = new Date(NOW.getTime() - (ANALYTICS_LIMITS.maxAgeHours + 1) * 3_600_000);
    expect(resolveAt(old.toISOString(), NOW)).toBeNull();
  });

  it('evento: lista fechada, etapa conhecida, signup_done do app não entra', () => {
    expect(sanitizeEvent({ name: 'onboarding_step_view', step: 'phone' }, NOW)).toMatchObject({
      name: 'onboarding_step_view',
      step: 'phone',
      props: null,
    });
    expect(sanitizeEvent({ name: 'onboarding_step_done', step: 'nao_existe' }, NOW)).toBeNull();
    expect(sanitizeEvent({ name: 'onboarding_step_done' }, NOW)).toBeNull();
    expect(sanitizeEvent({ name: 'screen_view', step: 'phone' }, NOW)).toBeNull();
    expect(sanitizeEvent({ name: 'signup_done' }, NOW)).toBeNull();
    expect(sanitizeEvent(null, NOW)).toBeNull();
    expect(sanitizeEvent('app_open', NOW)).toBeNull();
    // app_open não guarda etapa; tour guarda um id curto (ou nada)
    expect(sanitizeEvent({ name: 'app_open', step: 'phone' }, NOW)?.step).toBeNull();
    expect(sanitizeEvent({ name: 'map_tour_skipped', step: 'vibe_search' }, NOW)?.step).toBe(
      'vibe_search',
    );
    expect(sanitizeEvent({ name: 'map_tour_done', step: 'DROP TABLE' }, NOW)?.step).toBeNull();
  });

  it('lote: descarta o ruim sem derrubar o resto, app_open 1x por dia de São Paulo, corta no máximo', () => {
    const out = sanitizeBatch(
      [
        { name: 'app_open', at: '2026-09-30T04:00:00Z' }, // 01:00 SP do dia 30
        { name: 'app_open', at: '2026-09-30T14:00:00Z' }, // mesmo dia SP: sai
        { name: 'app_open', at: '2026-09-30T02:00:00Z' }, // 23:00 SP do dia 29: fica
        { name: 'bogus' },
        { name: 'onboarding_step_view', step: 'welcome' },
      ],
      NOW,
    );
    expect(out.map((e) => [e.name, e.name === 'app_open' ? spDay(e.at) : e.step])).toEqual([
      ['app_open', '2026-09-30'],
      ['app_open', '2026-09-29'],
      ['onboarding_step_view', 'welcome'],
    ]);
    const many = Array.from({ length: ANALYTICS_LIMITS.batchMax + 10 }, () => ({
      name: 'onboarding_step_view',
      step: 'phone',
    }));
    expect(sanitizeBatch(many, NOW)).toHaveLength(ANALYTICS_LIMITS.batchMax);
  });

  describe('quem pode gravar o quê (installId é livre)', () => {
    const ev = (name: string, step?: string) => sanitizeEvent({ name, step }, NOW) as CleanEvent;
    const names = (es: CleanEvent[]) => es.map((e) => (e.step ? `${e.name}:${e.step}` : e.name));
    const lote = [
      ev('app_open'),
      ev('onboarding_step_view', 'phone'),
      ev('onboarding_step_done', 'phone'),
      ev('map_tour_done', 'vibe_search'),
      ev('map_tour_skipped'),
    ];

    it('1º passo = boas-vindas (vista ou concluída); outra etapa não abre a instalação', () => {
      expect(FIRST_STEP).toBe('welcome');
      expect(isFirstStep(ev('onboarding_step_view', 'welcome'))).toBe(true);
      expect(isFirstStep(ev('onboarding_step_done', 'welcome'))).toBe(true);
      expect(isFirstStep(ev('onboarding_step_view', 'phone'))).toBe(false);
      expect(isFirstStep(ev('app_open'))).toBe(false);
    });

    it('sem conta: só onboarding_* e app_open (tour do mapa é de quem tem conta)', () => {
      expect(names(allowedEvents(lote, false))).toEqual([
        'app_open',
        'onboarding_step_view:phone',
        'onboarding_step_done:phone',
      ]);
      expect(allowedEvents(lote, true)).toEqual(lote);
    });

    it('instalação sem o 1º passo: lote ignorado, menos o app_open de quem tem conta', () => {
      expect(gateUnstarted(lote, false)).toEqual([]);
      expect(names(gateUnstarted(lote, true))).toEqual(['app_open']);
      expect(gateUnstarted([ev('onboarding_step_view', 'avatar')], true)).toEqual([]);
    });

    it('lote que traz o 1º passo abre a instalação e entra inteiro', () => {
      const abre = [
        ev('app_open'),
        ev('onboarding_step_view', 'welcome'),
        ev('onboarding_step_view', 'phone'),
      ];
      expect(gateUnstarted(abre, false)).toEqual(abre);
      expect(gateUnstarted(abre, true)).toEqual(abre);
      // o 1º passo sozinho também abre
      expect(gateUnstarted([ev('onboarding_step_done', 'welcome')], false)).toHaveLength(1);
    });
  });
});
