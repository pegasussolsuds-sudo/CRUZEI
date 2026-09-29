import { Module } from '@nestjs/common';
import { InterestsController, UsersController } from './users.controller';
import { PublicUsersController } from './public-users.controller';
import { UserSafetyController } from './user-safety.controller';
import { UsersService } from './users.service';
import { LocationModule } from '../location/location.module';
import { ModerationModule } from '../moderation/moderation.module';
import { BlocksModule } from '../blocks/blocks.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  // LocationModule: o cartão público (/users/:id) usa o mesmo blur de posição do /nearby
  // ModerationModule: foto nova nasce "em análise" e vai pra análise automática
  // BlocksModule/ReportsModule: POST /users/:id/block e /users/:id/report só encaminham pros serviços deles
  imports: [LocationModule, ModerationModule, BlocksModule, ReportsModule],
  controllers: [UsersController, InterestsController, PublicUsersController, UserSafetyController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
