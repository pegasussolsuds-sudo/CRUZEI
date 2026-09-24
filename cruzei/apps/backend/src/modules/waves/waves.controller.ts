import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { WavesService } from './waves.service';

class WaveDto {
  @IsUUID() userId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('waves')
export class WavesController {
  constructor(private readonly svc: WavesService) {}

  // Acenar pra alguém do mapa. Sempre 200: { ok, duplicate } (duplicate=true se já acenou nas últimas 24h)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @HttpCode(200)
  @Post()
  wave(@CurrentUser() user: AuthenticatedUser, @Body() dto: WaveDto) {
    return this.svc.wave(user.id, dto.userId);
  }
}
