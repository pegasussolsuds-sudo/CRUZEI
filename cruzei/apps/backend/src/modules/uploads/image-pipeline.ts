// Reprocessamento de toda foto enviada: tipo pelo CONTEÚDO (nome e mimetype do cliente não valem nada), gira pelo EXIF,
// tira TODO metadado (EXIF, GPS, XMP, IPTC, ICC), reencoda em JPEG com teto de lado e de bytes e gera o thumb 256.
// Falha FECHADA: sem sharp, nada é publicado (o original cru nunca vai ao ar).
import { loadSharp as defaultLoadSharp, THUMB_SIZE, type SharpFactory } from './thumbnails';
import {
  PHOTO_FALLBACK_QUALITY,
  PHOTO_FALLBACK_SIDE,
  PHOTO_FLATTEN_BACKGROUND,
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_INPUT_PIXELS,
  PHOTO_MAX_OUTPUT_BYTES,
  PHOTO_MAX_SIDE,
} from './uploads.constants';

export type PhotoRejectCode = 'photo_invalid' | 'photo_unsupported' | 'photo_too_big';

/** foto recusada pelo conteúdo (400/413) */
export class PhotoRejected extends Error {
  constructor(
    readonly code: PhotoRejectCode,
    message: string,
  ) {
    super(message);
    this.name = 'PhotoRejected';
  }
}

/** servidor sem sharp (503): nunca publica o original cru */
export class PhotoProcessingUnavailable extends Error {
  readonly code = 'photo_processing_unavailable';
  constructor() {
    super('processamento de fotos indisponível');
    this.name = 'PhotoProcessingUnavailable';
  }
}

/** fila de processamento cheia (503) */
export class PhotoBusy extends Error {
  readonly code = 'photo_busy';
  constructor() {
    super('processamento de fotos ocupado');
    this.name = 'PhotoBusy';
  }
}

export interface ProcessedPhoto {
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  bytes: number;
  /** formato detectado na entrada (jpeg, png, webp, gif, heif) */
  inputFormat: string;
}

export interface PipelineOptions {
  maxInputPixels?: number;
  maxSide?: number;
  fallbackSide?: number;
  quality?: number;
  fallbackQuality?: number;
  maxOutputBytes?: number;
  loadSharp?: () => SharpFactory | null;
}

/** aceitos pelo conteúdo; o resto (svg, pdf, tiff, raw…) é photo_invalid */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif']);

/** semáforo por processo: decode de 40 MP pesa ~160 MB; mais que 2 ao mesmo tempo estoura memória com vários workers */
class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(
    private readonly max: number,
    private readonly maxQueue: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxQueue) throw new PhotoBusy();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const gate = new Semaphore(2, 8);

function rejectFromSharpError(err: unknown): PhotoRejected {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  if (msg.includes('pixel limit'))
    return new PhotoRejected('photo_too_big', 'imagem com pixels demais');
  // "unsupported image format" = nem é imagem (HTML, texto, lixo); o resto de "unsupported" é foto de verdade em
  // variante que não abrimos (HEIC, JPEG aritmético…)
  if (msg.includes('unsupported image format'))
    return new PhotoRejected('photo_invalid', 'arquivo não é uma imagem');
  if (msg.includes('heif') || msg.includes('hevc') || msg.includes('unsupported')) {
    return new PhotoRejected('photo_unsupported', 'formato de imagem não suportado');
  }
  return new PhotoRejected('photo_invalid', 'arquivo não é uma imagem válida');
}

/** reprocessa a foto; lança PhotoRejected, PhotoProcessingUnavailable ou PhotoBusy */
export function processPhoto(input: Buffer, opts: PipelineOptions = {}): Promise<ProcessedPhoto> {
  const sharp = (opts.loadSharp ?? defaultLoadSharp)();
  if (!sharp) return Promise.reject(new PhotoProcessingUnavailable());
  return gate.run(() => runPipeline(sharp, input, opts));
}

async function runPipeline(
  sharp: SharpFactory,
  input: Buffer,
  opts: PipelineOptions,
): Promise<ProcessedPhoto> {
  const maxPixels = opts.maxInputPixels ?? PHOTO_MAX_INPUT_PIXELS;
  const maxBytes = opts.maxOutputBytes ?? PHOTO_MAX_OUTPUT_BYTES;
  // pages: 1 → GIF/WebP animado vira só o 1º quadro
  const inputOpts = { limitInputPixels: maxPixels, failOn: 'error' as const, pages: 1 };

  if (!input?.length) throw new PhotoRejected('photo_invalid', 'arquivo vazio');
  let meta: { format?: string; width?: number; height?: number; compression?: string };
  try {
    meta = await sharp(input, inputOpts).metadata();
  } catch (err) {
    throw rejectFromSharpError(err);
  }
  const format = (meta.format ?? '').toLowerCase();
  if (!ACCEPTED_FORMATS.has(format) || !meta.width || !meta.height) {
    throw new PhotoRejected('photo_invalid', `formato não aceito (${format || 'desconhecido'})`);
  }
  // HEIC (HEVC): o sharp pré-compilado não decodifica
  if (format === 'heif' && meta.compression === 'hevc') {
    throw new PhotoRejected('photo_unsupported', 'HEIC não suportado');
  }
  if (meta.width * meta.height > maxPixels)
    throw new PhotoRejected('photo_too_big', 'imagem com pixels demais');

  // NUNCA withMetadata/keepMetadata/keepExif/keepIccProfile: o padrão do sharp descarta tudo e converte pra sRGB
  const encode = (side: number, quality: number) =>
    sharp(input, inputOpts)
      .autoOrient()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: PHOTO_FLATTEN_BACKGROUND })
      .toColourspace('srgb')
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

  const side = opts.maxSide ?? PHOTO_MAX_SIDE;
  const attempts: [number, number][] = [
    [side, opts.quality ?? PHOTO_JPEG_QUALITY],
    [side, opts.fallbackQuality ?? PHOTO_FALLBACK_QUALITY],
    [
      Math.min(side, opts.fallbackSide ?? PHOTO_FALLBACK_SIDE),
      opts.fallbackQuality ?? PHOTO_FALLBACK_QUALITY,
    ],
  ];
  let out: { data: Buffer; info: { width: number; height: number; size: number } } | null = null;
  for (const [s, q] of attempts) {
    try {
      out = await encode(s, q);
    } catch (err) {
      throw rejectFromSharpError(err);
    }
    if (out.data.length <= maxBytes) break;
    out = null;
  }
  if (!out)
    throw new PhotoRejected('photo_too_big', 'foto continua grande demais depois de comprimir');

  let thumb: Buffer;
  try {
    thumb = await sharp(out.data)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    throw rejectFromSharpError(err);
  }

  return {
    main: out.data,
    thumb,
    width: out.info.width,
    height: out.info.height,
    bytes: out.data.length,
    inputFormat: format,
  };
}
