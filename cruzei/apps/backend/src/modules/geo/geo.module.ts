import { Module } from '@nestjs/common';
import { RedisModule } from '../../redis/redis.module';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

@Module({
  imports: [RedisModule],
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
