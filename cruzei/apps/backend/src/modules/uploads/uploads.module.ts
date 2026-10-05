import { Global, Logger, Module } from '@nestjs/common';

import { MediaGcService } from './media-gc.service';
import { MediaGcTask } from './media-gc.task';
import {
  OBJECT_STORAGE,
  sharedObjectStorage,
  storageConfigFromEnv,
} from './storage/object-storage';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

// Global: o storage e o GC são usados por users (apagar foto), moderação (ler a foto) e pela limpeza da conta
@Global()
@Module({
  controllers: [UploadsController],
  providers: [
    {
      provide: OBJECT_STORAGE,
      // valida STORAGE_* no boot: config inválida (s3 sem chave, produção sem base https) não sobe
      useFactory: () => {
        const cfg = storageConfigFromEnv();
        const log = new Logger('Storage');
        cfg.warnings.forEach((w) => log.warn(w));
        log.log(`fotos: driver ${cfg.driver}, base ${cfg.publicBaseUrl}, GC ${cfg.gc}`);
        return sharedObjectStorage();
      },
    },
    MediaGcService,
    MediaGcTask,
    UploadsService,
  ],
  exports: [OBJECT_STORAGE, MediaGcService, UploadsService],
})
export class UploadsModule {}
