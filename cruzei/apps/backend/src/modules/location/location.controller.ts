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
   * Filtro: "Mostrar" (Mulheres/Homens/Todos) recíproco + faixa de idade (settings.ageMin/ageMax, só o meu lado; quem
   * esconde a idade entra pelo bloco de 5 anos e a idade não sai) + regras de sempre. Ordem do servidor (o app
   * não reordena): boost → mesma orientação (só de quem exibe) → faixa → rotação justa.
   * deck=1 (deck de curtidas, DeckResponse): sem quem eu passei há menos de DISCOVERY_PASS_DAYS e sem quem eu já
   * curti; super curtidas pendentes pra mim no topo (superLikedMe, de qualquer distância: fora do raio sem faixa nem
   * posição) e superLikesPending; invisible vem null. Sem deck=1 (mapa e lista), passar não esconde ninguém.
   * Resposta: faixas de proximidade e posições visuais anonimizadas — nunca coordenada real, distância ou horário.
   */
  @Get('nearby')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  nearby(
    @CurrentUser() user: AuthenticatedUser,
    @Query('radius_meters') radius?: string,
    @Query('deck') deck?: string,
  ) {
    const r = Number(radius);
    const radiusM = Number.isFinite(r) && radius ? r : undefined;
    return deck === '1' || deck === 'true'
      ? this.svc.discoverDeck(user.id, radiusM)
      : this.svc.discover(user.id, radiusM);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getMe(user.id);
  }
}
