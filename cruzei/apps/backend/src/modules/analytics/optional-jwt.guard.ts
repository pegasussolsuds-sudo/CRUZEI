import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { bearerOf } from '../../common/guards/user-throttler.guard';

/**
 * Login OPCIONAL (POST /analytics/events): sem Bearer passa anônimo (req.user vazio, vale o installId). Com Bearer,
 * é o JwtAuthGuard de sempre — token vencido dá 401 (o app renova e reenvia) e conta suspensa/banida dá 403. Assim um
 * evento de quem está logado nunca vira anônimo por engano.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    if (!bearerOf(req)) return true;
    return super.canActivate(ctx);
  }
}
