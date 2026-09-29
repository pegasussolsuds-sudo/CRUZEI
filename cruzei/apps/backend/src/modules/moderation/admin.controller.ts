import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { ModerationDecision } from '@cruzei/shared-types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ModeratorGuard } from './moderator.guard';
import { ModerationService } from './moderation.service';

class ActionDto {
  @IsIn(['dismiss', 'warn', 'suspend', 'ban', 'reinstate']) action!: ModerationDecision;
  @IsOptional() @IsInt() @Min(1) @Max(365) days?: number;
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

class PhotoDecisionDto {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @IsOptional() @IsString() @MaxLength(100) reason?: string;
}

// Fila e decisões da moderação (tela "Moderação" no app, visível só pra moderador/admin)
@UseGuards(JwtAuthGuard, ModeratorGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: ModerationService) {}

  @Get('queue')
  queue() {
    return this.svc.queue();
  }

  // GET /admin/users/:id mudou pro painel (AdminUsersController): devolve esta ficha + o resto, no mesmo formato

  @Post('users/:id/action')
  act(@CurrentUser() me: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActionDto) {
    return this.svc.act(me, id, dto);
  }

  @Post('photos/:id')
  photo(@CurrentUser() me: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PhotoDecisionDto) {
    return this.svc.photoDecision(me.id, id, dto.decision, dto.reason);
  }
}
