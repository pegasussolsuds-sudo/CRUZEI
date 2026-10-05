import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { AccountDeletionService } from './account-deletion.service';
import { AccountPrivacyController, DeletionCancelController } from './account-privacy.controller';
import { AccountPurgeService } from './account-purge.service';
import { DataExportService } from './data-export.service';
import { LocationHistoryService } from './location-history.service';
import { PrivacyTask } from './privacy.task';

// Conta e privacidade (LGPD art. 18/19, Marco Civil art. 7º X): excluir conta com prazo de arrependimento, limpeza
// definitiva ("conta limpa") e retenção, cópia dos dados e apagar histórico de localização.
// AuthModule: tokens da conta restaurada (AuthService.openSession). ChatGateway vem do RealtimeModule global e o
// DeletionStateService do AccountModule global.
@Module({
  imports: [AuthModule],
  controllers: [AccountPrivacyController, DeletionCancelController],
  providers: [
    AccountDeletionService,
    AccountPurgeService,
    DataExportService,
    LocationHistoryService,
    PrivacyTask,
  ],
  exports: [AccountPurgeService],
})
export class AccountPrivacyModule {}
