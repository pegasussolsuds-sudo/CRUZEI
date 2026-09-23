import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { MessagesService } from './messages.service';

class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(500) content?: string;
  @IsString() clientId!: string;
}

class SendMediaDto {
  @IsString() type!: 'photo_temp' | 'audio' | 'gif';
  @IsString() mediaUrl!: string;
  @IsString() clientId!: string;
}

class ReadDto {
  @IsArray() messageIds!: string[];
}

@UseGuards(JwtAuthGuard)
@Controller('matches/:matchId/messages')
export class MessagesController {
  constructor(private readonly svc: MessagesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Query('limit') limit = '50',
    @Query('before') before?: string,
  ) {
    return this.svc.list(matchId, user.id, Number(limit), before ? new Date(before) : undefined);
  }

  @Post()
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.svc.send(matchId, user.id, dto.content ?? '', dto.clientId);
  }

  @Post('media')
  sendMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: SendMediaDto,
  ) {
    return this.svc.sendMedia(matchId, user.id, dto.type, dto.mediaUrl, dto.clientId);
  }

  @Post('read')
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId') matchId: string,
    @Body() dto: ReadDto,
  ) {
    return this.svc.markRead(matchId, user.id, dto.messageIds);
  }
}
