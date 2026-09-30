import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { BoostsService } from './boosts.service';

class PurchaseDto {
  @IsInt() @Min(1) @Max(24) durationHours!: number;
  /** app antigo ainda manda a posição: aceita e IGNORA (o boost usa a presença de sempre, nada é gravado) */
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsEnum(['ios', 'android']) platform!: 'ios' | 'android';
  // recibo da loja: sem validação de loja, só o 'dev' fora de produção (common/store-receipt.ts)
  @IsString() receipt!: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class BoostsController {
  constructor(private readonly svc: BoostsService) {}

  @Post('boosts')
  purchase(@CurrentUser() user: AuthenticatedUser, @Body() dto: PurchaseDto) {
    return this.svc.purchase(user.id, dto.durationHours, dto.platform, dto.receipt);
  }

  @Get('boosts/active')
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getActive(user.id);
  }
}
