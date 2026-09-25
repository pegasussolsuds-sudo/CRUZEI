import { BadRequestException, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { POICategory } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PoisService, VIBE_FILTERS, type VibeFilter } from './pois.service';

const POI_CATEGORIES = new Set<string>(Object.values(POICategory));

/** "bar,cafe" → enum válido; valor desconhecido vira 400 (antes estourava no Prisma como 500) */
function parseCategories(raw?: string): POICategory[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(',').map((c) => c.trim()).filter(Boolean);
  const bad = list.filter((c) => !POI_CATEGORIES.has(c));
  if (bad.length > 0) throw new BadRequestException(`categoria inválida: ${bad.join(', ')}`);
  return list.length > 0 ? (list as POICategory[]) : undefined;
}

@UseGuards(JwtAuthGuard)
@Controller('pois')
export class PoisController {
  constructor(private readonly svc: PoisService) {}

  @Get('nearby')
  nearby(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius_meters') radius = '2000',
    @Query('category') category?: string,
  ) {
    return this.svc.nearby(Number(lat), Number(lng), Number(radius), parseCategories(category));
  }

  /**
   * "Onde tá a vibe": lugares ranqueados por gente agora, tendência e eventos, em volta de um centro
   * (centro do mapa ou o próprio usuário). Só contagens públicas com piso de anonimato — ver PoisService.vibe.
   * Rotas literais ficam ANTES de ':id' (o Express casa na ordem).
   */
  @Get('vibe')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  vibe(
    @CurrentUser() user: AuthenticatedUser,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius_meters') radius = '8000',
    @Query('q') q?: string,
    @Query('filter') filter = 'all',
    @Query('category') category?: string,
    @Query('limit') limit = '40',
  ) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
      throw new BadRequestException('lat/lng inválidos');
    }
    const f = (VIBE_FILTERS as readonly string[]).includes(filter) ? (filter as VibeFilter) : 'all';
    const lim = Math.min(60, Math.max(1, Number(limit) || 40));
    return this.svc.vibe({
      me: user.id,
      lat: la,
      lng: ln,
      radiusM: Number(radius) || 8000,
      q: q?.slice(0, 60),
      filter: f,
      categories: parseCategories(category),
      limit: lim,
    });
  }

  @Get('hotspots')
  hotspots(@Query('city') city: string) {
    return this.svc.hotspotsInCity(city);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.svc.get(Number(id));
  }

  /** quem está no lugar: só quem pode ser descoberto por mim e só se eu estiver perto do lugar (ver PoisService) */
  @Get(':id/people')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  people(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getPeople(user.id, Number(id));
  }

  @Post(':id/checkin')
  @HttpCode(201)
  checkin(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.checkin(user.id, Number(id));
  }
}
