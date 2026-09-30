import { Module } from '@nestjs/common';

import { BlocksModule } from '../blocks/blocks.module';
import { ModerationModule } from '../moderation/moderation.module';
import { SupportModule } from '../support/support.module';

import { EmergencyController } from './emergency.controller';
import { EmergencyService } from './emergency.service';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';

// Segurança: selfie de verificação e botão de emergência (o filtro de abuso é função pura: text-guard.ts / auto-report.ts)
@Module({
  imports: [BlocksModule, SupportModule, ModerationModule],
  controllers: [SafetyController, EmergencyController],
  providers: [SafetyService, EmergencyService],
})
export class SafetyModule {}
