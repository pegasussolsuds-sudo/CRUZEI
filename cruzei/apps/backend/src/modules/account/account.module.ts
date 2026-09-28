import { Global, Module } from '@nestjs/common';
import { AccountStateService } from './account-state.service';
import { AccessLogService } from './access-log.service';

// Global: o estado da conta é conferido pelo JwtStrategy (AuthModule) e pelo handshake do socket (RealtimeModule)
@Global()
@Module({
  providers: [AccountStateService, AccessLogService],
  exports: [AccountStateService, AccessLogService],
})
export class AccountModule {}
