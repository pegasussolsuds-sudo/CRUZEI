import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsInt, IsLatitude, IsLongitude, IsString, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BoostsService } from './boosts.service';

class PurchaseDto {
  @IsInt() @Min(1) @Max(24) durationHours!: number;
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsEnum(['ios', 'android']) platform!: 'ios' | 'android';
  @IsString() receipt!: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class BoostsController {
  constructor(private readonly svc: BoostsService) {}

  @Post('boosts')
  purchase(@CurrentUser() user: AuthenticatedUser, @Body() dto: PurchaseDto) {
    return this.svc.purchase(
      user.id,
      dto.durationHours,
      dto.latitude,
      dto.longitude,
      dto.platform,
    );
  }

  @Get('boosts/active')
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getActive(user.id);
  }
}
