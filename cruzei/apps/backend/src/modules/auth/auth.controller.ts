import { ORIENTATIONS, SHOW_ME } from '@cruzei/shared-types';
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type { Request } from 'express';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AccessLogService } from '../account/access-log.service';

import { AuthService } from './auth.service';
import { requestMeta } from './phone-release.service';

class RequestCodeDto {
  @IsString() phone!: string;
}
class LoginDto {
  @IsString() phone!: string;
  @IsString() code!: string;
}
class RegisterDto {
  @IsString() phone!: string;
  @IsString() name!: string;
  @IsDateString() birthDate!: string;
  @IsEnum(['female', 'male', 'non_binary', 'other']) gender!: string;
  /** opcional (null/ausente = não informar) */
  @IsOptional() @IsEnum([...ORIENTATIONS]) orientation?: string | null;
  @IsOptional()
  @IsEnum(['relationship', 'casual', 'friendship', 'network', 'unspecified'])
  lookingFor?: string;
  /** aceite dos Termos de Uso e da Política de privacidade: a versão que o app mostrou */
  @IsString() @MaxLength(20) termsVersion!: string;
  /** exibir a orientação no perfil (exige orientação) */
  @IsOptional() @IsBoolean() showOrientation?: boolean;
  /** ver primeiro quem tem a mesma orientação (exige orientação) */
  @IsOptional() @IsBoolean() sameOrientationFirst?: boolean;
  @IsOptional() @IsEnum([...SHOW_ME]) showMe?: string;
  /** o app novo sempre manda; ausente (app antigo) = invisível com a janela grátis de 24 h, como antes */
  @IsOptional() @IsIn(['visible', 'anonymous']) visibilityMode?: 'visible' | 'anonymous';
}
class RefreshDto {
  @IsString() refreshToken!: string;
}
class ClaimConfirmDto {
  @IsUUID() challengeId!: string;
  /** 'AAAA-MM-DD' */
  @Matches(/^\d{4}-\d{2}-\d{2}$/) birthDate!: string;
}
class ClaimReleaseDto {
  @IsUUID() challengeId!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessLogService,
  ) {}

  // Estrito — anti-bruteforce de SMS
  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @Post('request-code')
  requestCode(@Body() dto: RequestCodeDto) {
    return this.auth.requestCode(dto.phone);
  }

  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const r = await this.auth.login(dto.phone, dto.code, requestMeta(req));
    // só sessão aberta conta como acesso: conta parada (claim) NÃO grava, senão "acorda" sem confirmar
    if (r.user.id && r.token) this.access.record(r.user.id, 'login', req);
    return r;
  }

  /** "Essa conta é sua?" → data de nascimento. Acertou: sessão (e access_log 'login'); errou: 401 claim_mismatch */
  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @Post('claim/confirm')
  @HttpCode(200)
  async claimConfirm(@Body() dto: ClaimConfirmDto, @Req() req: Request) {
    const r = await this.auth.confirmClaim(dto.challengeId, dto.birthDate, requestMeta(req));
    if (r.user.id && r.token) this.access.record(r.user.id, 'login', req);
    return r;
  }

  /** "Não é minha": o número sai da conta antiga e a pessoa segue pro cadastro */
  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @Post('claim/release')
  @HttpCode(200)
  claimRelease(@Body() dto: ClaimReleaseDto, @Req() req: Request) {
    return this.auth.releaseClaim(dto.challengeId, requestMeta(req));
  }

  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const r = await this.auth.register({
      phone: dto.phone,
      name: dto.name,
      birthDate: new Date(dto.birthDate),
      gender: dto.gender,
      orientation: dto.orientation,
      lookingFor: dto.lookingFor,
      termsVersion: dto.termsVersion,
      showOrientation: dto.showOrientation,
      sameOrientationFirst: dto.sameOrientationFirst,
      showMe: dto.showMe,
      visibilityMode: dto.visibilityMode,
    });
    this.access.record(r.user.id, 'register', req);
    return r;
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const r = await this.auth.refresh(dto.refreshToken);
    this.access.record(r.user.id, 'refresh', req);
    return r;
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.id);
  }
}
