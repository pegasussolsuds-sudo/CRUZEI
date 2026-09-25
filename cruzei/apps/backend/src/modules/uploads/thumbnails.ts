// Thumbnails das fotos (brief FOTO AVATAR §16): o mapa nunca baixa a foto grande — a bolha de identidade
// usa um quadrado de 256 px (cover, recorte "attention" pra manter o rosto, EXIF rotacionado, JPEG 82).
// `sharp` é opcional em runtime: sem ele (ou com HEIC sem libheif) o upload segue e o thumbnail vira a própria foto.
import { Logger } from '@nestjs/common';
import * as path from 'node:path';

export const THUMB_SIZE = 256;
export const THUMB_SUFFIX = '-t';

type SharpFactory = (input: string) => {
  rotate: () => SharpPipeline;
  metadata: () => Promise<{ format?: string; width?: number; height?: number }>;
};
interface SharpPipeline {
  resize: (w: number, h: number, opts: { fit: 'cover'; position: string }) => SharpPipeline;
  flatten: (opts: { background: string }) => SharpPipeline;
  jpeg: (opts: { quality: number; mozjpeg?: boolean }) => SharpPipeline;
  toFile: (out: string) => Promise<unknown>;
}

const IMAGE_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp', 'heif', 'heic', 'avif']);

/**
 * Confere pelo CONTEÚDO que o arquivo é uma imagem (extensão e mimetype vêm do cliente). Devolve o formato
 * detectado, ou null quando não é imagem; undefined quando não dá pra saber (sem sharp) — aí o upload segue.
 */
export async function probeImage(filePath: string): Promise<string | null | undefined> {
  const sharp = loadSharp();
  if (!sharp) return undefined;
  try {
    const meta = await sharp(filePath).metadata();
    const fmt = (meta.format ?? '').toLowerCase();
    return IMAGE_FORMATS.has(fmt) && (meta.width ?? 0) > 0 ? fmt : null;
  } catch {
    return null;
  }
}

const logger = new Logger('Thumbnails');
let sharpFactory: SharpFactory | null | undefined;

function loadSharp(): SharpFactory | null {
  if (sharpFactory !== undefined) return sharpFactory;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sharpFactory = require('sharp') as SharpFactory;
  } catch (err) {
    sharpFactory = null;
    logger.warn(`sharp indisponível — fotos sem thumbnail (${(err as Error).message})`);
  }
  return sharpFactory;
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
 * (sem sharp, formato não suportado, arquivo corrompido) — nunca lança: o upload não pode quebrar por causa disso.
 */
export async function makeThumbnail(filePath: string): Promise<string | null> {
  const sharp = loadSharp();
  if (!sharp) return null;
  const thumbName = thumbNameFor(path.basename(filePath));
  try {
    await sharp(filePath)
      .rotate()
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
