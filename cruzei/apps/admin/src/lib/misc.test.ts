import { describe, expect, it } from 'vitest';
import type { AdminMe } from '@cruzei/shared-types';
import { confirmCountFromError, hasErrors, openRate, pushSuccessRate, validateComposer } from './campaign';
import { canChangeRole, canModerateAccount, firstAllowedPath, hasPermission, visibleNav } from './permissions';
import { buildQuery, messageFromBody } from './query';
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

  it('mensagem do Nest: texto ou lista', () => {
    expect(messageFromBody({ message: 'Só a moderação acessa' })).toBe('Só a moderação acessa');
    expect(messageFromBody({ message: ['title muito longo', 'body vazio'] })).toBe('title muito longo · body vazio');
    expect(messageFromBody({ message: '' })).toBeNull();
    expect(messageFromBody(null)).toBeNull();
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
    const pts = Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 10).padStart(2, '0')}`, n: i < 7 ? 1 : 2 }));
    expect(sumPoints(pts)).toBe(21);
    expect(periodDelta(pts, 7)).toEqual({ current: 14, previous: 7, ratio: 1 });
    expect(periodDelta(pts.slice(7), 7).ratio).toBeNull();
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
