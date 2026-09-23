import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsUrl } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SafetyService } from './safety.service';

class VerifyDto {
  @IsUrl() selfieUrl!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('verify')
export class SafetyController {
  constructor(private readonly svc: SafetyService) {}

  @Post('selfie')
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyDto) {
    return this.svc.submitVerification(user.id, dto.selfieUrl);
  }
}
