import { Module } from '@nestjs/common';
import { PoisController } from './pois.controller';
import { PoisService } from './pois.service';
import { PlaceDiscoveryService } from './place-discovery.service';
import { LocationModule } from '../location/location.module';
import { PlacesModule } from '../places/places.module';
import { CrowdDiscoveryTask } from '../../tasks/crowd-discovery.task';

@Module({
  imports: [LocationModule, PlacesModule],
  controllers: [PoisController],
  providers: [PoisService, PlaceDiscoveryService, CrowdDiscoveryTask],
  exports: [PoisService, PlaceDiscoveryService],
})
export class PoisModule {}
