import { EMERGENCY_THROTTLED_ERROR, type EmergencyRequest } from '@cruzei/shared-types';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsUUID } from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ThrottleMessage } from '../../common/guards/user-throttler.guard';

import { EMERGENCY_THROTTLE } from './emergency-limits';
import { emergencyThrottledText } from './emergency-texts';
import { EmergencyService } from './emergency.service';

class EmergencyDto implements EmergencyRequest {
  /** a pessoa envolvida (chat/cartão); ausente = emergência sem pessoa (Ajuda e segurança) */
  @IsOptional() @IsUUID() targetUserId?: string;
  /** a conversa (quando veio do chat) */
  @IsOptional() @IsUUID() conversationId?: string;
}

// Botão "🆘 Emergência": pausa o perfil, bloqueia, denuncia e chama o suporte URGENTE (EmergencyResult)
@UseGuards(JwtAuthGuard)
@Controller('safety')
export class EmergencyController {
  constructor(private readonly svc: EmergencyService) {}

  // 3 por hora e 10 por dia por conta; o 429 diz que a equipe já foi avisada e lembra do 190
  @Throttle(EMERGENCY_THROTTLE)
  @ThrottleMessage({ error: EMERGENCY_THROTTLED_ERROR, message: emergencyThrottledText() })
  @Post('emergency')
  @HttpCode(200)
  emergency(@CurrentUser() me: AuthenticatedUser, @Body() dto: EmergencyDto) {
    return this.svc.trigger(me.id, dto);
  }
}
