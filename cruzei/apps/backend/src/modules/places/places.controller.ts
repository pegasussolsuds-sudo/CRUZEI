import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { PlaceCategoryKey, PlaceSearchResponse } from '@cruzei/shared-types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlacesService } from './places.service';
import { CHIP_TO_MAPBOX } from './places.ranking';

const ALLOWED_CATEGORIES: ReadonlySet<string> = new Set(Object.keys(CHIP_TO_MAPBOX));

/** query repetida (?q=a&q=b) chega como array: só string conta */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

@Controller('places')
@UseGuards(JwtAuthGuard)
export class PlacesController {
  constructor(private readonly svc: PlacesService) {}

  /**
   * Bares, baladas, restaurantes e outros lugares reais da cidade (Mapbox Search Box, chamado daqui do servidor).
   * O backend é a única porta: guarda o token, limita a frequência, cacheia por região e manda pro Mapbox só a
   * posição arredondada (~1 km). Proximidade = centro do mapa ou minha posição.
   */
  @Get('search')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async search(
    @Query('q') qRaw?: unknown,
    @Query('category') categoryRaw?: unknown,
    @Query('lat') latRaw?: unknown,
    @Query('lng') lngRaw?: unknown,
    @Query('proximity') proximityRaw?: unknown,
    @Query('limit') limitRaw?: unknown,
  ): Promise<PlaceSearchResponse> {
    const category = str(categoryRaw) || undefined;
    const lat = str(latRaw) || undefined;
    const lng = str(lngRaw) || undefined;
    const typed = (str(qRaw) ?? '').trim();
    // chip sozinho (🍻 Bares sem texto) lista os lugares daquela categoria mais perto
    if (typed.length < 2 && !category) throw new BadRequestException('q precisa de ao menos 2 caracteres (ou escolha uma categoria)');
    if (typed.length > 80) throw new BadRequestException('q muito longo (máx 80)');
    const text = typed.length >= 2 ? typed : '';

    let catKey: PlaceCategoryKey | null = null;
    if (category) {
      if (!ALLOWED_CATEGORIES.has(category)) {
        throw new BadRequestException('categoria inválida');
      }
      catKey = category as PlaceCategoryKey;
    }

    if ((lat == null) !== (lng == null)) throw new BadRequestException('lat e lng precisam vir juntos');
    let center: { lat: number; lng: number } | null = null;
    if (lat != null && lng != null) {
      const la = Number(lat);
      const ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
        throw new BadRequestException('lat/lng inválidos');
      }
      center = { lat: la, lng: ln };
    }

    const lim = Math.min(15, Math.max(1, Math.floor(Number(str(limitRaw))) || 8));

    return this.svc.search({
      q: text,
      category: catKey,
      center,
      proximityMode: str(proximityRaw) === 'me' ? 'me' : 'map',
      limit: lim,
    });
  }
}

