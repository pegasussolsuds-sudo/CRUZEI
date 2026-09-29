import { Module } from '@nestjs/common';

import { LocationModule } from '../location/location.module';
import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PoisModule } from '../pois/pois.module';
import { UsersModule } from '../users/users.module';

import { AdminCampaignsController } from './admin-campaigns.controller';
import { AdminEventsController } from './admin-events.controller';
import { AdminPanelController } from './admin-panel.controller';
import { AdminPlacesController } from './admin-places.controller';
import { AdminPlacesService } from './admin-places.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminTask } from './admin.task';
import { AuditService } from './audit.service';
import { CampaignsService } from './campaigns.service';
import { EventsService } from './events.service';
import { StaffGuard } from './staff.guard';
import { StatsService } from './stats.service';

// Painel admin web (/v1/admin/*): usuários, Premium manual, papéis, lugares, eventos, campanhas, painel e auditoria.
// A fila/decisões de moderação continuam no ModerationModule (mesmo prefixo /admin); o suporte fica no SupportModule.
@Module({
  imports: [ModerationModule, PoisModule, LocationModule, UsersModule, NotificationsModule],
  controllers: [
    AdminPanelController,
    AdminUsersController,
    AdminPlacesController,
    AdminEventsController,
    AdminCampaignsController,
  ],
  providers: [
    StaffGuard,
    AuditService,
    StatsService,
    AdminUsersService,
    AdminPlacesService,
    CampaignsService,
    EventsService,
    AdminTask,
  ],
  exports: [AuditService, StaffGuard],
})
export class AdminModule {}
