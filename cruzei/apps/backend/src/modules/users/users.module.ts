import { Module } from '@nestjs/common';
import { InterestsController, UsersController } from './users.controller';
import { PublicUsersController } from './public-users.controller';
import { UsersService } from './users.service';
import { LocationModule } from '../location/location.module';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  // LocationModule: o cartão público (/users/:id) usa o mesmo blur de posição do /nearby
  // ModerationModule: foto nova nasce "em análise" e vai pra análise automática
  imports: [LocationModule, ModerationModule],
  controllers: [UsersController, InterestsController, PublicUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
