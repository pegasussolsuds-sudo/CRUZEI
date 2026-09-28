import { Module } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationWritesFlusher } from './location-writes';

@Module({
  controllers: [LocationController],
  providers: [LocationService, LocationWritesFlusher],
  exports: [LocationService],
})
export class LocationModule {}
