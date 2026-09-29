import type { AdminPermission } from '@cruzei/shared-types';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { maskPhone } from '../../common/phone-mask';

import { ALL_PERMISSIONS, can, isStaff, permissionsFor } from './permissions';
import { RequirePermission, StaffGuard } from './staff.guard';

// Permissões do painel por papel + o guard (moderador nunca passa em rota só-admin) + a máscara de telefone.

const ADMIN_ONLY: AdminPermission[] = [
  'users.premium',
  'users.role',
  'campaigns',
  'events.push',
  'audit',
];

describe('permissões por papel', () => {
  it('admin tem tudo', () => {
    expect(permissionsFor('admin').sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(ALL_PERMISSIONS).toHaveLength(11);
  });

  it('moderador: painel, usuários (ver + moderar), lugares, eventos e suporte — nada só-admin', () => {
    expect(permissionsFor('moderator').sort()).toEqual(
      ['dashboard', 'events', 'places', 'support', 'users.moderate', 'users.read'].sort(),
    );
    for (const p of ADMIN_ONLY) expect(can('moderator', p)).toBe(false);
  });

  it('pessoa comum e papel desconhecido: nada', () => {
    expect(permissionsFor('user')).toEqual([]);
    expect(permissionsFor(undefined)).toEqual([]);
    expect(permissionsFor('root')).toEqual([]);
    expect(isStaff('user')).toBe(false);
    expect(isStaff('moderator')).toBe(true);
    expect(isStaff('admin')).toBe(true);
  });

  it('a lista devolvida é cópia (o chamador não mexe na regra)', () => {
    const p = permissionsFor('moderator');
    p.push('audit');
    expect(can('moderator', 'audit')).toBe(false);
  });
});

describe('StaffGuard', () => {
  class Routes {
    @RequirePermission('campaigns') campaigns() {}
    open() {}
  }
  @RequirePermission('places')
  class PlacesRoutes {
    list() {}
    @RequirePermission('events.push') announce() {}
  }

  const guard = new StaffGuard(new Reflector());
  const ctx = (role: string | undefined, cls: new () => object, method: string): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { id: 'x', role } : undefined }) }),
      getHandler: () => (cls.prototype as Record<string, unknown>)[method],
      getClass: () => cls,
    }) as unknown as ExecutionContext;
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
      return 'ok';
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      return ((e as ForbiddenException).getResponse() as { error: string }).error;
    }
  };

  it('pessoa comum (ou sem login) → 403 staff_only em qualquer rota do painel', () => {
    expect(codeOf(() => guard.canActivate(ctx('user', Routes, 'open')))).toBe('staff_only');
    expect(codeOf(() => guard.canActivate(ctx(undefined, Routes, 'open')))).toBe('staff_only');
  });

  it('moderador em rota só-admin → 403 admin_only; em rota da equipe passa', () => {
    expect(codeOf(() => guard.canActivate(ctx('moderator', Routes, 'campaigns')))).toBe(
      'admin_only',
    );
    expect(codeOf(() => guard.canActivate(ctx('moderator', Routes, 'open')))).toBe('ok');
    expect(codeOf(() => guard.canActivate(ctx('moderator', PlacesRoutes, 'list')))).toBe('ok');
    // a permissão da rota vence a do controller
    expect(codeOf(() => guard.canActivate(ctx('moderator', PlacesRoutes, 'announce')))).toBe(
      'admin_only',
    );
  });

  it('admin passa em tudo', () => {
    expect(codeOf(() => guard.canActivate(ctx('admin', Routes, 'campaigns')))).toBe('ok');
    expect(codeOf(() => guard.canActivate(ctx('admin', PlacesRoutes, 'announce')))).toBe('ok');
  });
});

describe('máscara de telefone (o que o moderador vê)', () => {
  it('mostra DDI, DDD, o 1º dígito e os 4 últimos', () => {
    expect(maskPhone('+5534991234567')).toBe('+55 34 9••••-4567');
    expect(maskPhone('+55 (11) 3498-3721')).toBe('+55 11 3••••-3721');
  });

  it('nunca devolve o número inteiro, nem pra número curto', () => {
    expect(maskPhone('+1234')).toBe('••••');
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('')).toBeNull();
    const masked = maskPhone('+5534991234567')!;
    expect(masked.replace(/\D/g, '')).not.toContain('99123');
  });
});
