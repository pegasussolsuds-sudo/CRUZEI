import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { GeoLabelResponse, GeoSearchResponse } from '@cruzei/shared-types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GeoService } from './geo.service';

/** query repetida (?q=a&q=b) chega como array: só string conta */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function latLng(latRaw: unknown, lngRaw: unknown): { lat: number; lng: number } | null {
  const lat = str(latRaw) || undefined;
  const lng = str(lngRaw) || undefined;
  if ((lat == null) !== (lng == null)) throw new BadRequestException('lat e lng precisam vir juntos');
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) throw new BadRequestException('lat/lng inválidos');
  return { lat: la, lng: ln };
}

@Controller('geo')
@UseGuards(JwtAuthGuard)
export class GeoController {
  constructor(private readonly svc: GeoService) {}

  /** "Cidade · Bairro" de um ponto (cabeçalho do mapa): polígonos do OSM no nosso banco, cache por geohash-6 */
  @Get('label')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  label(@Query('lat') latRaw?: unknown, @Query('lng') lngRaw?: unknown): Promise<GeoLabelResponse> {
    const p = latLng(latRaw, lngRaw);
    if (!p) throw new BadRequestException('lat e lng são obrigatórios');
    return this.svc.label(p.lat, p.lng);
  }

  /** "Ir até lá": ruas, bairros, distritos e cidades pelo nome, em volta do centro do mapa */
  @Get('search')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  search(
    @Query('q') qRaw?: unknown,
    @Query('lat') latRaw?: unknown,
    @Query('lng') lngRaw?: unknown,
    @Query('limit') limitRaw?: unknown,
  ): Promise<GeoSearchResponse> {
    const q = (str(qRaw) ?? '').trim();
    if (q.length < 2) throw new BadRequestException('q precisa de ao menos 2 caracteres');
    if (q.length > 80) throw new BadRequestException('q muito longo (máx 80)');
    const center = latLng(latRaw, lngRaw);
    const lim = Math.min(10, Math.max(1, Math.floor(Number(str(limitRaw))) || 6));
    return this.svc.search(q, center, lim);
  }
}
