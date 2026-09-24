import { Module } from '@nestjs/common';
import { InterestsController, UsersController } from './users.controller';
import { PublicUsersController } from './public-users.controller';
import { UsersService } from './users.service';
import { LocationModule } from '../location/location.module';

@Module({
  // LocationModule: o cartão público (/users/:id) usa o mesmo blur de posição do /nearby
  imports: [LocationModule],
  controllers: [UsersController, InterestsController, PublicUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
