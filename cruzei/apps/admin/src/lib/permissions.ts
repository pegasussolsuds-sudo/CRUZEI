// O que cada pessoa da equipe vê. O servidor confere tudo de novo: aqui é só pra não mostrar botão que vai dar 403.
import type { AdminMe, AdminPermission, UserRole } from '@cruzei/shared-types';

export type NavKey = 'dashboard' | 'users' | 'moderation' | 'places' | 'events' | 'campaigns' | 'support' | 'audit';

export interface NavItem {
  key: NavKey;
  label: string;
  path: string;
  permission: AdminPermission;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', label: 'Painel', path: '/', permission: 'dashboard' },
  { key: 'users', label: 'Usuários', path: '/usuarios', permission: 'users.read' },
  { key: 'moderation', label: 'Moderação', path: '/moderacao', permission: 'users.moderate' },
  { key: 'places', label: 'Lugares', path: '/lugares', permission: 'places' },
  { key: 'events', label: 'Eventos', path: '/eventos', permission: 'events' },
  { key: 'campaigns', label: 'Notificações', path: '/notificacoes', permission: 'campaigns' },
  { key: 'support', label: 'Suporte', path: '/suporte', permission: 'support' },
  { key: 'audit', label: 'Auditoria', path: '/auditoria', permission: 'audit' },
];

export function hasPermission(me: Pick<AdminMe, 'permissions'> | null | undefined, perm: AdminPermission): boolean {
  return !!me && me.permissions.includes(perm);
}

export function visibleNav(perms: readonly AdminPermission[]): NavItem[] {
  return NAV_ITEMS.filter((i) => perms.includes(i.permission));
}

/** pra onde mandar depois do login quando o painel (/) não é liberado */
export function firstAllowedPath(perms: readonly AdminPermission[]): string | null {
  return visibleNav(perms)[0]?.path ?? null;
}

/**
 * Pode moderar (avisar/suspender/banir/reativar) essa conta?
 * Moderação só mexe em contas 'user'; admin mexe em todas, menos na própria.
 */
export function canModerateAccount(me: AdminMe | null | undefined, target: { id: string; role: UserRole }): boolean {
  if (!me || !hasPermission(me, 'users.moderate')) return false;
  if (me.id === target.id) return false;
  if (me.role === 'admin') return true;
  return target.role === 'user';
}

/** papel: só admin, e nunca o próprio (o servidor ainda garante que sobra 1 admin) */
export function canChangeRole(me: AdminMe | null | undefined, targetId: string): boolean {
  return !!me && hasPermission(me, 'users.role') && me.id !== targetId;
}
