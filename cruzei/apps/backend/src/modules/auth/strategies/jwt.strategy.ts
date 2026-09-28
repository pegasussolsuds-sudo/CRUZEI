import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../auth.service';
import { AccountStateService } from '../../account/account-state.service';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

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
    const st = await this.accounts.assertActive(payload.sub);
    return { id: payload.sub, phone: payload.phone, role: st.role };
  }
}
