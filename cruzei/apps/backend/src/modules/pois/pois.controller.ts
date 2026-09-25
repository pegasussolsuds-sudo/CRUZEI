import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PoisService } from './pois.service';

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
    return this.svc.nearby(
      Number(lat),
      Number(lng),
      Number(radius),
      category?.split(','),
    );
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

  @Get('hotspots')
  hotspots(@Query('city') city: string) {
    return this.svc.hotspotsInCity(city);
  }
}
