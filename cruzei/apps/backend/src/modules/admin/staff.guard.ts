import type { AdminPermission } from '@cruzei/shared-types';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

import { can, isStaff } from './permissions';

const PERMISSION_KEY = 'metch:admin-permission';

/** permissão exigida pela rota (a da rota vence a do controller) */
export const RequirePermission = (permission: AdminPermission) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Painel: só admin/moderador; a rota pode exigir uma permissão (moderador nunca passa em rota só-admin).
 * O papel vem do estado da conta (AccountStateService via JwtStrategy): trocar o papel no painel invalida o cache e
 * vale na próxima requisição. 403 com código pro painel mostrar a mensagem certa.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!isStaff(user?.role)) {
      throw new ForbiddenException({
        error: 'staff_only',
        message: 'Só a equipe do Metch (admin ou moderação) acessa o painel',
      });
    }
    const permission = this.reflector.getAllAndOverride<AdminPermission | undefined>(
      PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (permission && !can(user!.role, permission)) {
      throw new ForbiddenException({
        error: 'admin_only',
        message: 'Só um admin pode fazer isso',
        permission,
      });
    }
    return true;
  }
}
