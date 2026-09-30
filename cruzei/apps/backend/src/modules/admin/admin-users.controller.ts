import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { requestMeta } from '../auth/phone-release.service';

import { AdminUsersService } from './admin-users.service';
import { GrantPremiumDto, ReleasePhoneDto, SetRoleDto } from './dto';
import { RequirePermission, StaffGuard } from './staff.guard';

// Usuários no painel. Moderar (advertir/suspender/banir) continua em POST /admin/users/:id/action (ModerationModule).
@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  /** ?q= nome/telefone/id · status · tier · role · reports=pending (só com denúncia esperando decisão) */
  @Get()
  @RequirePermission('users.read')
  list(
    @CurrentUser() me: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('tier') tier?: string,
    @Query('role') role?: string,
    @Query('reports') reports?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(me, { q, status, tier, role, reports, cursor, limit });
  }

  /** AdminUserDetail (+ os campos de ModerationUserDetail no nível de cima, pra tela de moderação do celular) */
  @Get(':id')
  @RequirePermission('users.read')
  detail(@CurrentUser() me: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(me, id);
  }

  @Post(':id/premium')
  @HttpCode(200)
  @RequirePermission('users.premium')
  premium(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantPremiumDto,
  ) {
    return this.svc.setPremium(me, id, dto);
  }

  @Post(':id/role')
  @HttpCode(200)
  @RequirePermission('users.role')
  role(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRoleDto,
  ) {
    return this.svc.setRole(me, id, dto.role);
  }

  /** número reciclado, caso de suporte: tira o telefone da conta (só admin — mesma permissão dos papéis) */
  @Post(':id/release-phone')
  @HttpCode(200)
  @RequirePermission('users.role')
  releasePhone(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleasePhoneDto,
    @Req() req: Request,
  ) {
    return this.svc.releasePhone(me, id, dto, requestMeta(req));
  }
}
