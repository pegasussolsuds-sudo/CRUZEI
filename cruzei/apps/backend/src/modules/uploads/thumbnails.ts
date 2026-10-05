// Utilitários do sharp compartilhados: carregamento opcional (loadSharp), JPEG pra análise automática e o thumbnail
// em disco que o seed-dev usa. O upload de verdade passa pelo image-pipeline.ts, que FALHA FECHADO sem sharp.
import * as path from 'node:path';

import { Logger } from '@nestjs/common';
import type SharpNs from 'sharp';

export const THUMB_SIZE = 256;
export const THUMB_SUFFIX = '-t';

export type SharpFactory = typeof SharpNs;

const logger = new Logger('Thumbnails');
let sharpFactory: SharpFactory | null | undefined;

/** sharp do processo, ou null quando o binário nativo não carrega (node_modules copiado de outro SO, por exemplo) */
export function loadSharp(): SharpFactory | null {
  if (sharpFactory !== undefined) return sharpFactory;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sharpFactory = require('sharp') as SharpFactory;
  } catch (err) {
    sharpFactory = null;
    logger.error(`sharp indisponível — upload de fotos desligado (${(err as Error).message})`);
  }
  return sharpFactory;
}

/**
 * JPEG de até `maxSide` px (EXIF girado e descartado) pra mandar à análise automática de fotos: a Rekognition aceita
 * só JPEG/PNG de até 5 MB. null sem sharp ou com arquivo ilegível.
 */
export async function jpegForAnalysis(
  input: string | Buffer,
  maxSide = 1600,
): Promise<Buffer | null> {
  const sharp = loadSharp();
  if (!sharp) return null;
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
      .autoOrient()
      .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch (err) {
    logger.warn(`foto ilegível pra análise: ${(err as Error).message}`);
    return null;
  }
}

/** Nome do arquivo de thumbnail de uma foto (`abc.jpg` → `abc-t.jpg`). */
export function thumbNameFor(filename: string): string {
  const ext = path.extname(filename);
  return `${path.basename(filename, ext)}${THUMB_SUFFIX}.jpg`;
}

/** true quando a URL já aponta pra um thumbnail gerado aqui. */
export function isThumbUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.endsWith(`${THUMB_SUFFIX}.jpg`);
}

/**
 * Gera o thumbnail ao lado da foto e devolve o nome do arquivo gerado, ou null quando não deu
 * (sem sharp, formato não suportado, arquivo corrompido) — nunca lança. Usado pelo seed-dev (fotos fakes/).
 */
export async function makeThumbnail(filePath: string): Promise<string | null> {
  const sharp = loadSharp();
  if (!sharp) return null;
  const thumbName = thumbNameFor(path.basename(filePath));
  try {
    await sharp(filePath)
      .autoOrient()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'attention' })
      .flatten({ background: '#12122A' }) // PNG/WebP com transparência: fundo escuro do app em vez de preto
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(path.dirname(filePath), thumbName));
    return thumbName;
  } catch (err) {
    logger.warn(`thumbnail falhou pra ${path.basename(filePath)}: ${(err as Error).message}`);
    return null;
  }
}
