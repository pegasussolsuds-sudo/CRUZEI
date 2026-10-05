import { Global, Module } from '@nestjs/common';

import { AccessLogService } from './access-log.service';
import { AccountStateService } from './account-state.service';
import { DeletionStateService } from './deletion-state.service';

// Global: o estado da conta é conferido pelo JwtStrategy (AuthModule) e pelo handshake do socket (RealtimeModule).
// DeletionStateService: login de conta com exclusão pendente (409 + desafio) e o cancelamento, sem ciclo com o Realtime
@Global()
@Module({
  providers: [AccountStateService, AccessLogService, DeletionStateService],
  exports: [AccountStateService, AccessLogService, DeletionStateService],
})
export class AccountModule {}
