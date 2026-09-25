import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Request } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuid } from 'uuid';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UPLOAD_DIR, UPLOAD_MAX_BYTES } from './uploads.constants';
import { makeThumbnail, probeImage } from './thumbnails';

interface UploadedImage {
  filename: string;
  mimetype: string;
  size: number;
}

const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']);

@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  @Post('photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
          cb(null, `${uuid()}${ext}`);
        },
      }),
      limits: { fileSize: UPLOAD_MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED.has(file.mimetype)) {
          cb(new BadRequestException('Formato não suportado (jpeg, png, webp, heic)'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFile() file: UploadedImage | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Arquivo "file" obrigatório');
    const base = `${req.protocol}://${req.get('host')}`;
    const filePath = path.join(UPLOAD_DIR, file.filename);
    // extensão e mimetype vêm do cliente: confere pelo conteúdo (um .html com Content-Type image/jpeg não entra)
    if ((await probeImage(filePath)) === null) {
      fs.rmSync(filePath, { force: true });
      throw new BadRequestException('O arquivo não é uma imagem válida');
    }
    const url = `${base}/uploads/${file.filename}`;
    // thumbnail 256x256 pra bolha de identidade do mapa e listas; sem ele (HEIC, sharp ausente) usa a própria foto
    const thumb = await makeThumbnail(filePath);
    const thumbnailUrl = thumb ? `${base}/uploads/${thumb}` : url;
    return { url, thumbnailUrl, size: file.size, mimeType: file.mimetype };
  }
}
