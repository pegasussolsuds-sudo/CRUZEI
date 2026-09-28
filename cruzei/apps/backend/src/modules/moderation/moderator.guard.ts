import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/** só moderador/admin (o papel vem do estado da conta, conferido a cada requisição pelo JwtStrategy) */
@Injectable()
export class ModeratorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (user?.role === 'moderator' || user?.role === 'admin') return true;
    throw new ForbiddenException('Só a moderação acessa');
  }
}
