import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { LocationService } from './location.service';

class UpdateLocationDto {
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100_000) accuracyMeters?: number;
  @IsOptional() @IsNumber() poiId?: number;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  /** Android: posição de app de GPS falso (o GPS_GUARD esconde e não atualiza a posição pública) */
  @IsOptional() @IsBoolean() mocked?: boolean;
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
   * cliente são ignorados (o app ainda os manda pros lugares, que são públicos). O raio é limitado a 350 m; quem tem
   * Boost ativo aparece até 5 km (faixa 'boost'). Mapa, lista e deck de curtidas usam esta mesma resposta.
   * Filtro: "Mostrar" (Mulheres/Homens/Todos) recíproco + regras de sempre. Ordem do servidor (o app não reordena):
   * boost → mesma orientação (só de quem exibe) → faixa → rotação justa (lugar lotado não mostra sempre os mesmos).
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
