import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { AdminPlacesService } from './admin-places.service';
import { CreatePoiDto, PatchPoiDto, RejectCandidateDto, ResolveReportsDto } from './dto';
import { RequirePermission, StaffGuard } from './staff.guard';

// Lugares no painel: sugestões da galera, denúncias e POIs (admin e moderador)
@UseGuards(JwtAuthGuard, StaffGuard)
@RequirePermission('places')
@Controller('admin/places')
export class AdminPlacesController {
  constructor(private readonly svc: AdminPlacesService) {}

  @Get('candidates')
  candidates(
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.candidates({ status, cursor, limit });
  }

  @Post('candidates/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() me: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.approve(me, id);
  }

  @Post('candidates/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectCandidateDto,
  ) {
    return this.svc.reject(me, id, dto.reason);
  }

  @Get('reports')
  reports() {
    return this.svc.reports();
  }

  @Post('reports/:poiId/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() me: AuthenticatedUser,
    @Param('poiId') poiId: string,
    @Body() dto: ResolveReportsDto,
  ) {
    return this.svc.resolveReports(me, poiId, dto);
  }

  /** ?q= nome/endereço/bairro ou id; ?hidden=1 só ocultos, 0 só visíveis */
  @Get('pois')
  pois(
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('hidden') hidden?: string,
  ) {
    return this.svc.pois({ q, cursor, limit, hidden });
  }

  @Post('pois')
  create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreatePoiDto) {
    return this.svc.createPoi(me, dto);
  }

  @Patch('pois/:id')
  update(@CurrentUser() me: AuthenticatedUser, @Param('id') id: string, @Body() dto: PatchPoiDto) {
    return this.svc.updatePoi(me, id, dto);
  }

  @Post('pois/:id/hide')
  @HttpCode(200)
  hide(@CurrentUser() me: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.hide(me, id);
  }

  @Post('pois/:id/unhide')
  @HttpCode(200)
  unhide(@CurrentUser() me: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.unhide(me, id);
  }
}
