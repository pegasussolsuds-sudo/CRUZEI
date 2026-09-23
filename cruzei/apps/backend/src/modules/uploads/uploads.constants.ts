import * as path from 'node:path';

// Em dev as fotos ficam em disco local e são servidas em /uploads/*.
// Em prod trocar por Cloudflare R2 (signed URL) — ver 07-arquitetura-tecnica.md.
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
