import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

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
}
class RefreshDto {
  @IsString() refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Estrito — anti-bruteforce de SMS
  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @Post('request-code')
  requestCode(@Body() dto: RequestCodeDto) {
    return this.auth.requestCode(dto.phone);
  }

  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.phone, dto.code);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register({
      phone: dto.phone,
      name: dto.name,
      birthDate: new Date(dto.birthDate),
      gender: dto.gender,
      orientation: dto.orientation,
      lookingFor: dto.lookingFor,
    });
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.id);
  }
}
