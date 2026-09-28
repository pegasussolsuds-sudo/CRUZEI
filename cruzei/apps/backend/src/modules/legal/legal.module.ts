import { Module } from '@nestjs/common';
import { LegalDocsController, LegalPagesController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  controllers: [LegalDocsController, LegalPagesController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
