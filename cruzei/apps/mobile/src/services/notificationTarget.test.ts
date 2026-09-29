import type { NotificationTarget } from '@cruzei/shared-types';
import {
  noticeTextOf,
  parseTarget,
  poiIdOf,
  pushDataOf,
  routeForNotification,
  routeForPush,
  routeForTarget,
  shouldShowNotice,
  type TargetRoute,
} from './notificationTarget';

describe('routeForTarget: a tabela do toque', () => {
  const cases: [string, NotificationTarget, TargetRoute][] = [
    ['mapa', { kind: 'map' }, { screen: 'Map' }],
    ['evento com lugar → mapa focando o POI', { kind: 'event', eventId: 'ev1', poiId: '42' }, { screen: 'Map', focusPoiId: 42 }],
    ['evento sem lugar → só o mapa', { kind: 'event', eventId: 'ev1', poiId: null }, { screen: 'Map' }],
    ['evento com poiId estranho → só o mapa', { kind: 'event', eventId: 'ev1', poiId: 'abc' }, { screen: 'Map' }],
    ['lugar → mapa focando', { kind: 'place', poiId: '7' }, { screen: 'Map', focusPoiId: 7 }],
    ['Premium → Paywall', { kind: 'premium' }, { screen: 'Paywall' }],
    ['suporte → chat do suporte', { kind: 'support' }, { screen: 'SupportChat' }],
    ['conversa → Chat', { kind: 'conversation', conversationId: 'c1' }, { screen: 'Chat', conversationId: 'c1' }],
    ['curtidas → aba Curtidas', { kind: 'likes' }, { screen: 'Likes' }],
  ];
  it.each(cases)('%s', (_label, target, route) => {
    expect(routeForTarget(target)).toEqual(route);
  });

  it('sem alvo → null', () => {
    expect(routeForTarget(null)).toBeNull();
    expect(routeForTarget(undefined)).toBeNull();
  });
});

describe('parseTarget: só destinos conhecidos, nunca URL livre', () => {
  it('aceita o JSON em texto do FCM', () => {
    expect(parseTarget('{"kind":"place","poiId":"99"}')).toEqual({ kind: 'place', poiId: '99' });
  });
  it('aceita objeto e poiId numérico (vira texto, como no contrato)', () => {
    expect(parseTarget({ kind: 'event', eventId: 'e', poiId: 12 })).toEqual({ kind: 'event', eventId: 'e', poiId: '12' });
  });
  it.each([
    ['kind desconhecido', { kind: 'url', href: 'https://x.y' }],
    ['evento sem eventId', { kind: 'event', poiId: '1' }],
    ['lugar sem poiId', { kind: 'place' }],
    ['conversa sem id', { kind: 'conversation', conversationId: '' }],
    ['JSON quebrado', '{kind:'],
    ['lista', [{ kind: 'map' }]],
    ['null', null],
    ['número', 3],
  ])('%s → null', (_label, raw) => {
    expect(parseTarget(raw)).toBeNull();
  });
  it('campos a mais não passam pro alvo', () => {
    expect(parseTarget({ kind: 'premium', url: 'https://evil' })).toEqual({ kind: 'premium' });
  });
});

describe('poiIdOf', () => {
  it.each([
    ['42', 42],
    [' 42 ', 42],
    [42, 42],
    ['0', null],
    ['-3', null],
    ['4.5', null],
    ['12abc', null],
    ['1234567890123456', null],
    [1.5, null],
    [null, null],
  ])('%p → %p', (raw, expected) => {
    expect(poiIdOf(raw)).toBe(expected);
  });
});

describe('pushDataOf: dados do push pelos caminhos do Android', () => {
  it('content.data (app aberto ou toque tratado pela lib)', () => {
    const n = { request: { content: { data: { notificationId: 'n1', type: 'event', target: '{"kind":"map"}' } } } };
    expect(pushDataOf(n)).toEqual({ notificationId: 'n1', type: 'event', target: '{"kind":"map"}' });
  });
  it('só em trigger.remoteMessage.data (notificação mostrada pelo FCM com o app fechado)', () => {
    const n = {
      request: {
        content: { data: {} },
        trigger: { type: 'push', remoteMessage: { data: { notificationId: 'n2', type: 'support_reply' } } },
      },
    };
    expect(pushDataOf(n)).toEqual({ notificationId: 'n2', type: 'support_reply' });
  });
  it('alvo como objeto vira JSON (o contrato manda texto)', () => {
    const n = { request: { content: { data: { notificationId: 'n3', type: 'x', target: { kind: 'likes' } } } } };
    expect(pushDataOf(n)?.target).toBe('{"kind":"likes"}');
  });
  it("campanha só de push: notificationId '' ainda é push nosso", () => {
    const n = { request: { content: { data: { notificationId: '', type: 'campaign' } } } };
    expect(pushDataOf(n)).toEqual({ notificationId: '', type: 'campaign' });
  });
  it('sem dados nossos → null', () => {
    expect(pushDataOf({ request: { content: { data: { foo: 'bar' } } } })).toBeNull();
    expect(pushDataOf(null)).toBeNull();
    expect(pushDataOf({})).toBeNull();
  });
});

describe('routeForPush: toque sem alvo', () => {
  it('alvo válido manda', () => {
    expect(routeForPush({ notificationId: 'n', type: 'campaign', target: '{"kind":"premium"}' })).toEqual({ screen: 'Paywall' });
  });
  it('resposta do suporte sem alvo → chat do suporte', () => {
    expect(routeForPush({ notificationId: 'n', type: 'support_reply' })).toEqual({ screen: 'SupportChat' });
  });
  it('sem alvo (ou alvo inválido) → central de avisos, onde o aviso está', () => {
    expect(routeForPush({ notificationId: 'n', type: 'campaign' })).toEqual({ screen: 'Notifications' });
    expect(routeForPush({ notificationId: 'n', type: 'campaign', target: '{"kind":"nope"}' })).toEqual({ screen: 'Notifications' });
  });
  it("campanha só de push (sem item na central) e sem alvo → mapa", () => {
    expect(routeForPush({ notificationId: '', type: 'campaign' })).toEqual({ screen: 'Map' });
    expect(routeForPush(null)).toEqual({ screen: 'Map' });
  });
  it('campanha só de push com alvo → o alvo', () => {
    expect(routeForPush({ notificationId: '', type: 'campaign', target: '{"kind":"likes"}' })).toEqual({ screen: 'Likes' });
  });
});

describe('routeForNotification: linha da central', () => {
  it('sem alvo nem tipo que abre algo → null (só marca lida)', () => {
    expect(routeForNotification({ type: 'campaign', target: null })).toBeNull();
  });
  it('resposta do suporte sem alvo → suporte', () => {
    expect(routeForNotification({ type: 'support_reply', target: null })).toEqual({ screen: 'SupportChat' });
  });
});

describe('aviso rápido no app', () => {
  it('texto com o emoji do tipo', () => {
    expect(noticeTextOf({ type: 'event', title: 'Show no Parque' })).toBe('⚡ Show no Parque');
    expect(noticeTextOf({ type: 'desconhecido', title: 'Oi' })).toBe('🔔 Oi');
    // título que já vem com emoji não ganha outro ("⚡ ⚡ Festa" era o bug)
    expect(noticeTextOf({ type: 'event', title: '⚡ Festa perto de você' })).toBe('⚡ Festa perto de você');
    expect(noticeTextOf({ type: 'campaign', title: '🎉 Novidade' })).toBe('🎉 Novidade');
    expect(noticeTextOf({ type: 'event', title: 'Às 20h no parque' })).toBe('⚡ Às 20h no parque');
  });
  it.each([
    ['na central de avisos não aparece', { type: 'event', target: null }, 'Notifications', false],
    ['resposta do suporte com o chat do suporte aberto não aparece', { type: 'support_reply', target: null }, 'SupportChat', false],
    ['alvo suporte com o chat aberto não aparece', { type: 'campaign', target: { kind: 'support' } as NotificationTarget }, 'SupportChat', false],
    ['evento com o chat do suporte aberto aparece', { type: 'event', target: null }, 'SupportChat', true],
    ['advertência da moderação nunca (o App já abre o alerta)', { type: 'moderation_warning', target: null }, 'Map', false],
    ['no mapa aparece', { type: 'campaign', target: null }, 'Map', true],
    ['navegação ainda sem rota aparece', { type: 'campaign', target: null }, undefined, true],
  ])('%s', (_label, n, route, expected) => {
    expect(shouldShowNotice(n as { type: string; target: NotificationTarget | null }, route)).toBe(expected);
  });
});
