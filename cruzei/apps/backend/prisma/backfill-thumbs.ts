// Backfill de thumbnails (brief FOTO AVATAR §16): gera o 256x256 de cada foto local que ainda não tem
// e grava thumbnail_url. Opcionalmente troca o host das URLs (dev: o IP da LAN muda; o túnel USB usa 127.0.0.1).
//
// Uso: pnpm exec ts-node prisma/backfill-thumbs.ts [--rehost http://127.0.0.1:3000]
import { PrismaClient } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UPLOAD_DIR } from '../src/modules/uploads/uploads.constants';
import { isThumbUrl, makeThumbnail, thumbNameFor } from '../src/modules/uploads/thumbnails';

const prisma = new PrismaClient();

/** troca o host SÓ de fotos servidas pelo próprio backend (/uploads/…); R2/CDN e URLs externas ficam como estão */
function rehost(url: string, base: string): string {
  try {
    const u = new URL(url);
    if (!u.pathname.startsWith('/uploads/')) return url;
    const b = new URL(base);
    u.protocol = b.protocol;
    u.host = b.host;
    return u.toString();
  } catch {
    return url;
  }
}

/** caminho local de uma URL /uploads/... (null pra fotos fora do backend, ex.: R2, ou URL mal formada) */
function localPathOf(url: string): string | null {
  const m = /\/uploads\/(.+)$/.exec(url);
  if (!m) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  const p = path.resolve(UPLOAD_DIR, rel);
  if (!p.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return null; // nunca sai da pasta de uploads
  return fs.existsSync(p) ? p : null;
}

async function main() {
  const args = process.argv.slice(2);
  const rehostIdx = args.indexOf('--rehost');
  const base = rehostIdx >= 0 ? args[rehostIdx + 1] : null;

  const photos = await prisma.photo.findMany({ select: { id: true, url: true, thumbnailUrl: true } });
  let thumbs = 0;
  let rehosted = 0;
  let skipped = 0;
  for (const p of photos) {
    let url = p.url;
    let thumbnailUrl = p.thumbnailUrl;
    if (base) {
      url = rehost(url, base);
      if (thumbnailUrl) thumbnailUrl = rehost(thumbnailUrl, base);
    }
    if (!isThumbUrl(thumbnailUrl)) {
      const local = localPathOf(url);
      if (local) {
        const thumbName = thumbNameFor(path.basename(local));
        const exists = fs.existsSync(path.join(path.dirname(local), thumbName));
        const made = exists ? thumbName : await makeThumbnail(local);
        if (made) {
          thumbnailUrl = url.replace(/[^/]+$/, made);
          thumbs += 1;
        }
      } else {
        skipped += 1;
      }
    }
    if (url !== p.url || thumbnailUrl !== p.thumbnailUrl) {
      await prisma.photo.update({ where: { id: p.id }, data: { url, thumbnailUrl } });
      if (url !== p.url) rehosted += 1;
    }
  }
  // perfis em cache carregam as URLs antigas
  console.log(`✅ ${photos.length} fotos — ${thumbs} thumbnails, ${rehosted} URLs re-hospedadas, ${skipped} sem arquivo local`);
  if (rehosted || thumbs) console.log('ℹ️  limpe o cache de perfis no Redis (profile:*) ou espere expirar (1h)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
