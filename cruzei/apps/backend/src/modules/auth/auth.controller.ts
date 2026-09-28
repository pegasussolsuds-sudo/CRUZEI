import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AccessLogService } from '../account/access-log.service';

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
  @IsOptional() @IsEnum(['heterosexual', 'homosexual', 'bisexual', 'pansexual', 'other']) orientation?: string;
  @IsOptional() @IsEnum(['relationship', 'casual', 'friendship', 'network', 'unspecified']) lookingFor?: string;
  /** aceite dos Termos de Uso e da Política de privacidade: a versão que o app mostrou */
  @IsString() @MaxLength(20) termsVersion!: string;
}
class RefreshDto {
  @IsString() refreshToken!: string;
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
    const r = await this.auth.login(dto.phone, dto.code);
    if (r.user.id) this.access.record(r.user.id, 'login', req);
    return r;
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
