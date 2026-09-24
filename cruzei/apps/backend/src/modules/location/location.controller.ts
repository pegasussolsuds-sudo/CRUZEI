import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { LocationService, NEARBY_RADIUS_MAX_M, NEARBY_RADIUS_MIN_M } from './location.service';

class UpdateLocationDto {
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsOptional() @IsNumber() accuracyMeters?: number;
  @IsOptional() @IsNumber() poiId?: number;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
}

// lat/lng de query string → números finitos e dentro da faixa; null se inválidos
function parseLatLng(lat?: string, lng?: string): { lat: number; lng: number } | null {
  if (!lat || !lng) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

@UseGuards(JwtAuthGuard)
@Controller('location')
export class LocationController {
  constructor(private readonly svc: LocationService) {}

  @Post('update')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateLocationDto) {
    return this.svc.update(user.id, dto);
  }

  // lat/lng = centro da busca; me_lat/me_lng (opcionais) = posição de quem consulta, base do distanceM.
  // radius_meters é clampado em [300, 5000] — raio pequeno demais viraria um oráculo de posição.
  @Get('nearby')
  nearby(
    @CurrentUser() user: AuthenticatedUser,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius_meters') radius?: string,
    @Query('me_lat') meLat?: string,
    @Query('me_lng') meLng?: string,
  ) {
    const center = parseLatLng(lat, lng);
    if (!center) throw new BadRequestException('lat/lng inválidos');

    let me = center;
    if (meLat !== undefined || meLng !== undefined) {
      const parsed = parseLatLng(meLat, meLng);
      if (!parsed) throw new BadRequestException('me_lat/me_lng inválidos');
      me = parsed;
    }

    const r = Number(radius);
    const radiusM = Number.isFinite(r) && radius ? Math.min(NEARBY_RADIUS_MAX_M, Math.max(NEARBY_RADIUS_MIN_M, r)) : NEARBY_RADIUS_MAX_M;

    return this.svc.getNearby({
      centerLat: center.lat,
      centerLng: center.lng,
      meLat: me.lat,
      meLng: me.lng,
      radiusM,
      requesterId: user.id,
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getMe(user.id);
  }
}
