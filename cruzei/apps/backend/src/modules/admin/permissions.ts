import type { AdminPermission, StaffRole } from '@cruzei/shared-types';

// Permissões do painel por papel (o servidor confere SEMPRE; o painel só esconde botões). Testadas em permissions.spec.ts.

export const ALL_PERMISSIONS: readonly AdminPermission[] = [
  'dashboard',
  'users.read',
  'users.moderate',
  'users.premium',
  'users.role',
  'places',
  'events',
  'events.push',
  'campaigns',
  'support',
  'audit',
  // página Métricas (funil do cadastro, retenção, ativos): só admin
  'metrics',
];

/**
 * moderador: painel, usuários (ver + moderar contas 'user' — a regra do alvo fica no ModerationService.act),
 * lugares, eventos (sem aviso por push) e suporte. Premium, papéis, campanhas, aviso de evento e auditoria: só admin.
 */
const MODERATOR: readonly AdminPermission[] = [
  'dashboard',
  'users.read',
  'users.moderate',
  'places',
  'events',
  'support',
];

export function isStaff(role: unknown): role is StaffRole {
  return role === 'admin' || role === 'moderator';
}

export function permissionsFor(role: unknown): AdminPermission[] {
  if (role === 'admin') return [...ALL_PERMISSIONS];
  if (role === 'moderator') return [...MODERATOR];
  return [];
}

export function can(role: unknown, permission: AdminPermission): boolean {
  return permissionsFor(role).includes(permission);
}
