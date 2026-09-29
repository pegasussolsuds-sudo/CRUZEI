import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { AccountStateService } from '../../account/account-state.service';
import { isRefreshPayload, JwtPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    cfg: ConfigService,
    private readonly accounts: AccountStateService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('jwt.secret')!,
    });
  }

  // token válido não basta: conta banida/suspensa/excluída perde o acesso na hora (403 com o motivo)
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // refresh (mesmo segredo, 30 dias) não serve de Bearer: só renova no /auth/refresh
    if (isRefreshPayload(payload)) throw new UnauthorizedException('Token inválido');
    const st = await this.accounts.assertActive(payload.sub);
    return { id: payload.sub, phone: payload.phone, role: st.role };
  }
}
