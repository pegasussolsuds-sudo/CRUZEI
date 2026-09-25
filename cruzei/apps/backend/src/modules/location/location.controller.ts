import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { LocationService } from './location.service';

class UpdateLocationDto {
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsOptional() @IsNumber() accuracyMeters?: number;
  @IsOptional() @IsNumber() poiId?: number;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('location')
export class LocationController {
  constructor(private readonly svc: LocationService) {}

  /** minha posição (a única coordenada precisa que entra); o serviço ignora envios mais frequentes que 20 s */
  @Post('update')
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateLocationDto) {
    return this.svc.update(user.id, dto);
  }

  /**
   * Descoberta por proximidade. O centro é SEMPRE a minha posição no servidor — lat/lng/me_lat/me_lng enviados pelo
   * cliente são ignorados (o app ainda os manda pros lugares, que são públicos). O raio é limitado a 350 m.
   * Resposta: faixas de proximidade e posições visuais anonimizadas — nunca coordenada real, distância ou horário.
   */
  @Get('nearby')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  nearby(@CurrentUser() user: AuthenticatedUser, @Query('radius_meters') radius?: string) {
    const r = Number(radius);
    return this.svc.discover(user.id, Number.isFinite(r) && radius ? r : undefined);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getMe(user.id);
  }
}
