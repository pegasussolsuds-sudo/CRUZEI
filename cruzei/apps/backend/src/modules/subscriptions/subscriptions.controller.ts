import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { SubscriptionsService } from './subscriptions.service';

class SubscribeDto {
  @IsString() planId!: string;
  @IsEnum(['ios', 'android', 'web']) platform!: 'ios' | 'android' | 'web';
  @IsOptional() @IsString() receipt?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('premium')
export class SubscriptionsController {
  constructor(private readonly svc: SubscriptionsService) {}

  /** autenticado: quem já usou o teste grátis (conta ou número) recebe os planos sem trialDays */
  @Get('plans')
  plans(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listPlans(user.id);
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getStatus(user.id);
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubscribeDto) {
    return this.svc.subscribe(user.id, dto.planId, dto.platform, dto.receipt ?? '');
  }

  @Post('cancel')
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.cancel(user.id);
  }
}
