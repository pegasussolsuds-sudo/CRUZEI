import type { ModerationDecision } from '@cruzei/shared-types';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { ModerationService } from './moderation.service';
import { ModeratorGuard } from './moderator.guard';

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
  act(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionDto,
  ) {
    return this.svc.act(me, id, dto);
  }

  @Post('photos/:id')
  photo(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PhotoDecisionDto,
  ) {
    return this.svc.photoDecision(me.id, id, dto.decision, dto.reason);
  }

  /**
   * Foto retida por denúncia (held/): só por aqui, com o Bearer de moderador/admin. Nada de cache (nem do navegador),
   * nosniff e CSP sandbox (o arquivo legado pode não ser imagem de verdade).
   */
  @Get('photos/:id/file')
  async photoFile(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.svc.retainedPhotoFile(me.id, id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(f.body, {
      type: f.contentType,
      disposition: 'inline',
      length: f.body.length,
    });
  }
}
