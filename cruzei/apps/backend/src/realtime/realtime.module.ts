import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { ChatGateway } from './chat.gateway';

@Global()
@Module({
  imports: [AuthModule],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class RealtimeModule {}
