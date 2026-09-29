import { Module } from '@nestjs/common';
import { BuildingTilesService } from './building-tiles.service';
import { TilesController } from './tiles.controller';

// Tiles vetoriais servidos pelo backend (hoje: prédios extras). Prisma e Redis vêm dos módulos globais.
@Module({
  controllers: [TilesController],
  providers: [BuildingTilesService],
  exports: [BuildingTilesService],
})
export class TilesModule {}
