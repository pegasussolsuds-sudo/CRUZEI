import { describe, expect, it } from 'vitest';
import type { AdminMe } from '@cruzei/shared-types';
import { confirmCountFromError, hasErrors, openRate, pushSuccessRate, validateComposer } from './campaign';
import { canChangeRole, canModerateAccount, firstAllowedPath, hasPermission, visibleNav } from './permissions';
import { isOpenReport, REPORT_STATUS_LABEL, subscriptionState } from './labels';
import { buildQuery, messageFromBody, refreshOutcome } from './query';
import { fillDays, periodDelta, sumPoints } from './stats';

const admin: AdminMe = {
  id: 'adm',
  name: 'Ana',
  role: 'admin',
  permissions: ['dashboard', 'users.read', 'users.moderate', 'users.premium', 'users.role', 'places', 'events', 'events.push', 'campaigns', 'support', 'audit'],
};
const mod: AdminMe = { id: 'mod', name: 'Beto', role: 'moderator', permissions: ['dashboard', 'users.read', 'users.moderate', 'places', 'events', 'support'] };

describe('permissões', () => {
  it('menu filtrado pelo papel', () => {
    expect(visibleNav(mod.permissions).map((i) => i.key)).toEqual(['dashboard', 'users', 'moderation', 'places', 'events', 'support']);
    expect(visibleNav(admin.permissions)).toHaveLength(8);
    expect(firstAllowedPath(['support'])).toBe('/suporte');
    expect(firstAllowedPath([])).toBeNull();
    expect(hasPermission(mod, 'audit')).toBe(false);
    expect(hasPermission(null, 'dashboard')).toBe(false);
  });

  it('moderação só mexe em conta comum; ninguém modera a própria', () => {
    expect(canModerateAccount(mod, { id: 'x', role: 'user' })).toBe(true);
    expect(canModerateAccount(mod, { id: 'x', role: 'moderator' })).toBe(false);
    expect(canModerateAccount(admin, { id: 'x', role: 'moderator' })).toBe(true);
    expect(canModerateAccount(admin, { id: 'adm', role: 'admin' })).toBe(false);
  });

  it('papel: só admin e nunca o próprio', () => {
    expect(canChangeRole(admin, 'x')).toBe(true);
    expect(canChangeRole(admin, 'adm')).toBe(false);
    expect(canChangeRole(mod, 'x')).toBe(false);
  });
});

describe('query string e erros da API', () => {
  it('pula vazios (o backend recusa campo sobrando)', () => {
    expect(buildQuery({ q: '  ana ', status: '', tier: undefined, cursor: null, limit: 30 })).toBe('?q=ana&limit=30');
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
  });

  it('mensagem do Metch (pt-BR) passa; a do framework, em inglês, vira a padrão do painel', () => {
    expect(messageFromBody({ message: 'Só a moderação acessa' })).toBe('Só a moderação acessa');
    expect(messageFromBody({ message: 'Você não pode moderar a própria conta', error: 'Bad Request' })).toBe('Você não pode moderar a própria conta');
    // class-validator (lista) e pipes do Nest: inglês
    expect(messageFromBody({ message: ['limit must be a number', 'property x should not exist'], error: 'Bad Request' })).toBeNull();
    expect(messageFromBody({ message: 'Validation failed (uuid is expected)', error: 'Bad Request' })).toBeNull();
    expect(messageFromBody({ message: 'Cannot GET /v1/admin/nada' })).toBeNull();
    expect(messageFromBody({ message: 'Unauthorized' })).toBeNull();
    expect(messageFromBody({ message: 'Forbidden resource' })).toBeNull();
    expect(messageFromBody({ message: '' })).toBeNull();
    expect(messageFromBody(null)).toBeNull();
  });

  it('renovar a sessão: só 401/403 encerram; sem rede, 5xx e 429 mantêm', () => {
    expect(refreshOutcome(200)).toBe('ok');
    expect(refreshOutcome(201)).toBe('ok');
    expect(refreshOutcome(401)).toBe('denied');
    expect(refreshOutcome(403)).toBe('denied');
    expect(refreshOutcome('network')).toBe('unavailable');
    expect(refreshOutcome(500)).toBe('unavailable');
    expect(refreshOutcome(502)).toBe('unavailable');
    expect(refreshOutcome(503)).toBe('unavailable');
    expect(refreshOutcome(429)).toBe('unavailable');
  });
});

describe('séries do painel', () => {
  it('completa dias sem registro', () => {
    const filled = fillDays(
      [
        { day: '2026-09-27', n: 3 },
        { day: '2026-09-29', n: 5 },
      ],
      4,
    );
    expect(filled).toEqual([
      { day: '2026-09-26', n: 0 },
      { day: '2026-09-27', n: 3 },
      { day: '2026-09-28', n: 0 },
      { day: '2026-09-29', n: 5 },
    ]);
    expect(fillDays([], 30)).toEqual([]);
  });

  it('atravessa virada de mês', () => {
    expect(fillDays([{ day: '2026-10-01', n: 1 }], 2).map((p) => p.day)).toEqual(['2026-09-30', '2026-10-01']);
  });

  it('variação da semana', () => {
    const pts = Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 10).padStart(2, '0')}`, n: i < 7 ? 2 : 4 }));
    expect(sumPoints(pts)).toBe(42);
    expect(periodDelta(pts, 7)).toEqual({ current: 28, previous: 14, ratio: 1 });
    expect(periodDelta(pts.slice(7), 7).ratio).toBeNull();
  });

  it('base pequena não vira porcentagem absurda (+3.500%)', () => {
    const pts = Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 10).padStart(2, '0')}`, n: i === 0 ? 1 : i >= 7 ? 5 : 0 }));
    expect(periodDelta(pts, 7)).toEqual({ current: 35, previous: 1, ratio: null });
  });
});

describe('campanhas', () => {
  const stats = { targetCount: 100, notified: 80, pushSent: 60, pushFailed: 20, opened: 20 };
  it('taxas', () => {
    expect(openRate(stats)).toBe(0.25);
    expect(pushSuccessRate(stats)).toBe(0.75);
    expect(openRate({ ...stats, notified: 0 })).toBeNull();
    expect(pushSuccessRate({ ...stats, pushSent: 0, pushFailed: 0 })).toBeNull();
  });

  it('compositor', () => {
    const ok = { title: 'Sexta tem festa', body: 'Bora pro Sabiá', audience: { kind: 'premium' as const }, channels: { push: true, inbox: false }, target: null };
    expect(hasErrors(validateComposer(ok))).toBe(false);
    const bad = validateComposer({ ...ok, title: 'x', body: '', channels: { push: false, inbox: false }, target: { kind: 'place', poiId: '' } });
    expect(Object.keys(bad).sort()).toEqual(['body', 'channels', 'target', 'title']);
  });
});

it('409 confirm_required traz o número que o servidor quer', () => {
  expect(confirmCountFromError(409, { error: 'confirm_required', message: 'x', targetCount: 1834, status: 409 })).toBe(1834);
  expect(confirmCountFromError(409, { error: 'thread_conflict', message: 'x' })).toBeNull();
  expect(confirmCountFromError(400, { error: 'confirm_required', targetCount: 1 })).toBeNull();
  expect(confirmCountFromError(409, null)).toBeNull();
});

describe('ficha do usuário', () => {
  const NOW = Date.parse('2026-09-29T15:00:00Z');
  it('situação de cada assinatura do histórico', () => {
    expect(subscriptionState({ cancelledAt: null, expiresAt: '2026-10-29T15:00:00Z' }, NOW)).toEqual({ state: 'active', label: 'ativa' });
    expect(subscriptionState({ cancelledAt: null, expiresAt: '2026-09-01T15:00:00Z' }, NOW)).toEqual({ state: 'expired', label: 'vencida' });
    expect(subscriptionState({ cancelledAt: null, expiresAt: '2099-12-31T23:59:59.000Z' }, NOW).state).toBe('active');
    const c = subscriptionState({ cancelledAt: '2026-09-10T12:00:00Z', expiresAt: '2026-10-29T15:00:00Z' }, NOW);
    expect(c.state).toBe('cancelled');
    expect(c.label).toMatch(/^cancelada em 10 set 2026$/);
  });

  it('situação da denúncia', () => {
    expect(REPORT_STATUS_LABEL.dismissed).toBe('Dispensada');
    expect(isOpenReport('pending')).toBe(true);
    expect(isOpenReport('reviewing')).toBe(true);
    expect(isOpenReport('resolved')).toBe(false);
    expect(isOpenReport('dismissed')).toBe(false);
  });
});

describe('rótulos da auditoria e do histórico', () => {
  it('ações do painel e da moderação em português; desconhecida fica crua', async () => {
    const { auditActionLabel, moderationActionLabel } = await import('./labels');
    expect(auditActionLabel('admin.user.premium_grant')).toBe('Premium dado');
    expect(auditActionLabel('moderation.suspend:3')).toBe('Suspensão por 3 dias');
    expect(auditActionLabel('moderation.suspend:1')).toBe('Suspensão por 1 dia');
    expect(auditActionLabel('moderation.suspend:revisao')).toBe('Suspensão até revisão');
    expect(auditActionLabel('moderation.ban')).toBe('Banimento');
    expect(auditActionLabel('algo.novo')).toBe('algo.novo');
    expect(moderationActionLabel('auto_hold')).toBe('Segurada pra revisão (automático)');
  });
});
