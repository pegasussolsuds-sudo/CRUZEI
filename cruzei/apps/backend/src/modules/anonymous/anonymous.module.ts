import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';

import { AnonymousController } from './anonymous.controller';
import { AnonymousService } from './anonymous.service';

// UsersModule: enable/disable passam pelo UsersService.setVisibility (uma regra só pro prazo do invisível grátis)
@Module({
  imports: [UsersModule],
  controllers: [AnonymousController],
  providers: [AnonymousService],
  exports: [AnonymousService],
})
export class AnonymousModule {}
