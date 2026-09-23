import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

class SettingsDto {
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('notifications')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
    @Query('unread_only') unreadOnly = 'false',
  ) {
    return this.svc.list(user.id, Number(limit), Number(offset), unreadOnly === 'true');
  }

  @HttpCode(204)
  @Post('notifications/:id/read')
  readOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.markRead(user.id, id);
  }

  @HttpCode(204)
  @Post('notifications/read-all')
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.markAllRead(user.id);
  }

  @Patch('notifications/settings')
  settings(@Body() _dto: SettingsDto) {
    // Settings armazenados em UserSettings (JSON) — TODO
    return { ok: true };
  }
}
