import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
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

  @Get('plans')
  plans() {
    return this.svc.listPlans();
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
