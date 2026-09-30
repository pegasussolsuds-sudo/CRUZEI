import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { NotificationsService } from './notifications.service';

class SettingsValuesDto {
  @IsOptional() @IsBoolean() campaigns?: boolean;
  @IsOptional() @IsBoolean() events?: boolean;
  // push social (só push): mensagem nova, curtida, match e o texto da mensagem no aviso
  @IsOptional() @IsBoolean() messages?: boolean;
  @IsOptional() @IsBoolean() likes?: boolean;
  @IsOptional() @IsBoolean() matches?: boolean;
  @IsOptional() @IsBoolean() messagePreview?: boolean;
}

class SettingsDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SettingsValuesDto)
  settings?: SettingsValuesDto;
}

class DeviceDto {
  // token FCM (~160 caracteres); só caracteres de token, nada de espaço/controle
  @IsString() @MinLength(20) @MaxLength(500) @Matches(/^[\w:.\-_]+$/) token!: string;
  @IsIn(['android', 'ios']) platform!: 'android' | 'ios';
  @IsOptional() @IsString() @MaxLength(20) appVersion?: string;
}

class RemoveDeviceDto {
  @IsString() @MaxLength(500) token!: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  /** central de avisos (AppNotification[]) */
  @Get('notifications')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
    @Query('unread_only') unreadOnly = 'false',
  ) {
    return this.svc.list(user.id, Number(limit), Number(offset), unreadOnly === 'true');
  }

  /** NotificationUnreadCount (badge) — rota literal antes de notifications/:id */
  @Get('notifications/unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.unreadCount(user.id);
  }

  @Get('notifications/settings')
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.settings(user.id);
  }

  /**
   * { settings: Partial<NotificationSettings> } → NotificationSettings. campaigns/events desligado = fora do público
   * das campanhas; messages/likes/matches desligado = sem aquele push social; messagePreview = texto no aviso.
   */
  @Patch('notifications/settings')
  settings(@CurrentUser() user: AuthenticatedUser, @Body() dto: SettingsDto) {
    return this.svc.updateSettings(user.id, dto.settings ?? {});
  }

  /** tocar num aviso (push ou central): lida + aberta */
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

  /** RegisterDevicePayload: token de push deste aparelho (FCM) */
  @Post('me/devices')
  @HttpCode(200)
  registerDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: DeviceDto) {
    return this.svc.registerDevice(user.id, dto);
  }

  @Delete('me/devices')
  @HttpCode(204)
  removeDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RemoveDeviceDto) {
    return this.svc.removeDevice(user.id, dto.token);
  }
}
