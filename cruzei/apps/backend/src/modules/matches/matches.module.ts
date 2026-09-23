import { Module } from '@nestjs/common';
import { MatchesController, LikesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { MatchContextService } from './match-context.service';
import { MatchesCleanupTask } from '../../tasks/matches-cleanup.task';

@Module({
  controllers: [MatchesController, LikesController],
  providers: [MatchesService, MatchContextService, MatchesCleanupTask],
  exports: [MatchesService],
})
export class MatchesModule {}
