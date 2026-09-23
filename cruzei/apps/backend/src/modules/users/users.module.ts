import { Module } from '@nestjs/common';
import { InterestsController, UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, InterestsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
