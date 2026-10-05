import * as path from 'node:path';

// Fotos: o original é reprocessado no servidor (image-pipeline.ts) e gravado no storage (driver local em UPLOAD_DIR,
// servido em /uploads; ou s3 = R2/S3). O banco guarda a CHAVE e o servidor monta a URL (common/photo-url.ts).
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');
/** entrada do multipart (em memória) */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** bomba de descompressão: acima disso nem decodifica (413) */
export const PHOTO_MAX_INPUT_PIXELS = 40_000_000;
/** lado maior da foto publicada */
export const PHOTO_MAX_SIDE = 1600;
/** 2ª tentativa quando o arquivo passa do teto */
export const PHOTO_FALLBACK_SIDE = 1280;
export const PHOTO_JPEG_QUALITY = 82;
export const PHOTO_FALLBACK_QUALITY = 72;
/** teto do JPEG publicado */
export const PHOTO_MAX_OUTPUT_BYTES = 800 * 1024;
/** fundo de PNG/WebP com transparência (fundo escuro do app) */
export const PHOTO_FLATTEN_BACKGROUND = '#12122A';

/** upload solto vira lixo depois disso (o GC apaga) */
export const UPLOAD_ORPHAN_TTL_H = 24;
/** janela pra anexar em POST /me/photos: 1 h de folga contra corrida com o GC */
export const UPLOAD_ATTACH_WINDOW_H = 23;
