import { Module } from '@nestjs/common';
import { InterestsController, UsersController } from './users.controller';
import { PublicUsersController } from './public-users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, InterestsController, PublicUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
