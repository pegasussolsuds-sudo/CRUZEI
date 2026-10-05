import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { PhotoBusy, PhotoProcessingUnavailable, PhotoRejected } from './image-pipeline';
import { UPLOAD_MAX_BYTES } from './uploads.constants';
import { PhotoStorageUnavailable, UploadsService } from './uploads.service';

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** mensagens pro app (pt-BR informal) */
export const PHOTO_ERROR_MESSAGES = {
  photo_invalid: 'Esse arquivo não é uma foto que a gente aceita. Manda um JPG ou PNG.',
  photo_unsupported: 'Não deu pra abrir esse formato de foto. Tenta mandar em JPG ou PNG.',
  photo_too_big: 'Essa foto é grande demais. Tenta outra?',
  photo_processing_unavailable:
    'O envio de fotos tá fora do ar agora. Tenta de novo daqui a pouco.',
  photo_busy: 'Muita foto chegando ao mesmo tempo. Tenta de novo em alguns segundos.',
} as const;

/** erro do pipeline → HTTP no formato {error, message} */
export function photoHttpError(err: unknown): HttpException | null {
  if (err instanceof PhotoRejected) {
    const body = { error: err.code, message: PHOTO_ERROR_MESSAGES[err.code] };
    return err.code === 'photo_too_big'
      ? new PayloadTooLargeException(body)
      : new BadRequestException(body);
  }
  if (
    err instanceof PhotoProcessingUnavailable ||
    err instanceof PhotoBusy ||
    err instanceof PhotoStorageUnavailable
  ) {
    return new ServiceUnavailableException({
      error: err.code,
      message: PHOTO_ERROR_MESSAGES[err.code],
    });
  }
  return null;
}

/** arquivo acima de 10 MB (o multer barra antes do handler): 413 com o mesmo formato */
@Catch(PayloadTooLargeException)
class PhotoTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(HttpStatus.PAYLOAD_TOO_LARGE).json({
      error: 'photo_too_big',
      message: PHOTO_ERROR_MESSAGES.photo_too_big,
      status: HttpStatus.PAYLOAD_TOO_LARGE,
    });
  }
}

@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Foto nova: fica em memória (sem disco), é reprocessada pelo conteúdo (nome e tipo do cliente não valem) e gravada
   * como p/<uuid>.jpg. Anexar ao perfil é outro passo (POST /me/photos com a key), que confere a posse.
   */
  @Post('photo')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseFilters(PhotoTooLargeFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_MAX_BYTES, files: 1, fields: 5 },
      // filtro barato: o tipo de verdade sai do conteúdo no pipeline
      fileFilter: (_req, file, cb) => {
        const t = (file.mimetype ?? '').toLowerCase();
        if (t.startsWith('image/') || t === 'application/octet-stream') return cb(null, true);
        cb(
          new BadRequestException({
            error: 'photo_invalid',
            message: PHOTO_ERROR_MESSAGES.photo_invalid,
          }),
          false,
        );
      },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({
        error: 'photo_invalid',
        message: 'Faltou a foto (campo "file").',
      });
    }
    try {
      return await this.uploads.uploadPhoto(user.id, file.buffer);
    } catch (err) {
      throw photoHttpError(err) ?? err;
    }
  }
}
