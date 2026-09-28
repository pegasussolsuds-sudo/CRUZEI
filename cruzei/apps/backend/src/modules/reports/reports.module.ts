import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { BlocksModule } from '../blocks/blocks.module';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [BlocksModule, ModerationModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
