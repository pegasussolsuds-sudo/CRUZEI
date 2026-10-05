import { Inject, Injectable, Logger } from '@nestjs/common';

import { newPhotoKeys, photoUrl } from '../../common/photo-url';
import { PrismaService } from '../../database/prisma.service';

import { processPhoto } from './image-pipeline';
import { MediaGcService } from './media-gc.service';
import { OBJECT_STORAGE, type ObjectStorage } from './storage/object-storage';
import { UPLOAD_ORPHAN_TTL_H } from './uploads.constants';

/** storage fora do ar (disco cheio, R2 caído): 503 com a mesma mensagem do "fora do ar" */
export class PhotoStorageUnavailable extends Error {
  readonly code = 'photo_processing_unavailable';
  constructor() {
    super('storage de fotos indisponível');
    this.name = 'PhotoStorageUnavailable';
  }
}

export interface UploadPhotoResult {
  key: string;
  url: string;
  thumbnailKey: string;
  thumbnailUrl: string;
  size: number;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

@Injectable()
export class UploadsService {
  private readonly log = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly gc: MediaGcService,
  ) {}

  /**
   * Reprocessa (sem metadado), registra o objeto em media_objects ANTES de gravar (arquivo nunca fica sem dono na
   * fila: sem anexar em 24 h, o GC apaga) e grava original + miniatura no storage.
   * Lança PhotoRejected / PhotoProcessingUnavailable / PhotoBusy / PhotoStorageUnavailable (o controller traduz).
   */
  async uploadPhoto(userId: string, input: Buffer): Promise<UploadPhotoResult> {
    const out = await processPhoto(input);
    const { key, thumbKey } = newPhotoKeys();
    // delete_after = created_at + TTL exato: é a marca de "upload fresco" que o POST /me/photos confere
    await this.prisma.$executeRaw`
      INSERT INTO media_objects (key, owner_id, kind, thumb_key, bytes, width, height, created_at, delete_after)
      VALUES (${key}, ${userId}::uuid, 'photo', ${thumbKey}, ${out.bytes}, ${out.width}, ${out.height},
              now(), now() + make_interval(hours => ${UPLOAD_ORPHAN_TTL_H}::int))`;
    try {
      await Promise.all([
        this.storage.put(key, out.main, 'image/jpeg'),
        this.storage.put(thumbKey, out.thumb, 'image/jpeg'),
      ]);
    } catch (err) {
      // o que chegou a ser gravado sai pelo GC agora (a linha já existe)
      await this.prisma
        .$executeRaw`UPDATE media_objects SET delete_after = now() WHERE key = ${key}`.catch(
        () => 0,
      );
      this.gc.kick([key]);
      // a mensagem do driver traz método, status e chave (nunca segredo)
      this.log.warn(`upload de foto não gravou no storage: ${(err as Error).message}`);
      throw new PhotoStorageUnavailable();
    }
    return {
      key,
      url: photoUrl(key)!,
      thumbnailKey: thumbKey,
      thumbnailUrl: photoUrl(thumbKey)!,
      size: out.bytes,
      mimeType: 'image/jpeg',
      width: out.width,
      height: out.height,
    };
  }
}
