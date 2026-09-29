import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { AnnounceDto, CreateEventDto, PatchEventDto } from './dto';
import { EventsService } from './events.service';
import { RequirePermission, StaffGuard } from './staff.guard';

// Eventos: admin e moderador criam/publicam/cancelam; aviso por push só admin ('events.push')
@UseGuards(JwtAuthGuard, StaffGuard)
@RequirePermission('events')
@Controller('admin/events')
export class AdminEventsController {
  constructor(private readonly svc: EventsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('when') when?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list({ status, when, cursor, limit });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateEventDto) {
    return this.svc.create(me, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchEventDto,
  ) {
    return this.svc.update(me, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentUser() me: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.publish(me, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() me: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(me, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() me: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(me, id);
  }

  @Post(':id/announce')
  @RequirePermission('events.push')
  announce(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnnounceDto,
  ) {
    return this.svc.announce(me, id, dto);
  }
}
