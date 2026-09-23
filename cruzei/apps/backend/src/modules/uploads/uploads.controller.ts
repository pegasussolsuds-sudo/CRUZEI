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
  upload(@UploadedFile() file: UploadedImage | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Arquivo "file" obrigatório');
    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/uploads/${file.filename}`;
    return { url, thumbnailUrl: url, size: file.size, mimeType: file.mimetype };
  }
}
