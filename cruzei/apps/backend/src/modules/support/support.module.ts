import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';

import { AdminSupportController } from './admin-support.controller';
import { SupportController } from './support.controller';
import { SupportGateway } from './support.gateway';
import { SupportService } from './support.service';

// Suporte ao vivo: app (/v1/support/*), equipe (/v1/admin/support/*) e o "digitando" no socket
@Module({
  imports: [NotificationsModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, SupportGateway],
  exports: [SupportService],
})
export class SupportModule {}
