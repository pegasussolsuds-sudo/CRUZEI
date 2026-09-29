import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { CampaignsService } from './campaigns.service';
import { CampaignPreviewDto, CreateCampaignDto } from './dto';
import { RequirePermission, StaffGuard } from './staff.guard';

// Campanhas de push/central de avisos: só admin
@UseGuards(JwtAuthGuard, StaffGuard)
@RequirePermission('campaigns')
@Controller('admin/campaigns')
export class AdminCampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Get()
  list(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.svc.list({ cursor, limit });
  }

  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: CampaignPreviewDto) {
    return this.svc.preview(dto.audience, dto.eventId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  /** envia já ou agenda; público 'all' ou > 1000 exige confirmCount igual ao total (409 confirm_required) */
  @Post()
  create(@CurrentUser() me: AuthenticatedUser, @Body() dto: CreateCampaignDto) {
    return this.svc.create(me, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() me: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(me, id);
  }
}
