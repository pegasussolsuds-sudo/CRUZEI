// Backfill das fotos ANTIGAS (anteriores ao image-pipeline): o arquivo legado <uuid>.<ext> na raiz do storage saiu do
// celular como veio (EXIF/GPS, modelo, data; às vezes PNG com nome .jpg). Pra cada linha de photos que ainda aponta pra
// ele: roda o pipeline (processPhoto), grava p/<uuid>.jpg + miniatura, troca a linha (só se ela não mudou no meio) e
// manda os arquivos antigos pro GC (media_objects) com folga pros caches. Idempotente: trocada, a linha deixa de ser
// legado. Sem Nest: o script (src/database/scripts/photos-reprocess.ts) e os testes injetam banco, storage e pipeline.
import type { Prisma, PrismaClient } from '@prisma/client';

import { isHeldKey, isManagedKey, keyFromPhotoUrl, newPhotoKeys } from '../../common/photo-url';

import { processPhoto, type ProcessedPhoto } from './image-pipeline';
import { isUrgentPhoto } from './photo-retention';
import type { ObjectStorage } from './storage/object-storage';
import { UPLOAD_ORPHAN_TTL_H } from './uploads.constants';

/** padrão da folga: o cache do app/CDN (max-age 1 dia) e o do perfil (1 h) ainda pedem a URL antiga */
export const REPROCESS_GRACE_HOURS = 24;
/** = gatilho photos_release_media: foto 'urgent' guarda o arquivo 180 dias depois de sair */
export const URGENT_RETENTION_DAYS = 180;

export interface LegacyPhotoRow {
  id: string;
  user_id: string;
  url: string;
  thumbnail_url: string | null;
  moderation_labels: unknown;
}

export interface ReprocessPlan {
  /** de onde sai a cópia nova (o original legado) */
  sourceKey: string;
  /** chaves gerenciadas que a linha larga (vão pro GC) */
  oldKeys: string[];
}

// held/ é a cópia privada da foto retida: nunca volta pra uma chave pública
const isLegacyKey = (k: string | null): k is string =>
  !!k && isManagedKey(k) && !k.startsWith('p/') && !isHeldKey(k);

/**
 * Linha legada → plano; null quando não há o que fazer: já reprocessada (p/), fakes/ do seed, URL externa, ou original
 * fora do nosso storage (não dá pra reprocessar a partir dele).
 */
export function legacyPlan(
  row: Pick<LegacyPhotoRow, 'url' | 'thumbnail_url'>,
): ReprocessPlan | null {
  const main = keyFromPhotoUrl(row.url);
  const thumb = keyFromPhotoUrl(row.thumbnail_url);
  if (!isLegacyKey(main) && !isLegacyKey(thumb)) return null;
  if (!main || !isManagedKey(main) || isHeldKey(main)) return null;
  const oldKeys = [...new Set([main, thumb].filter((k): k is string => !!k && isManagedKey(k)))];
  return { sourceKey: main, oldKeys };
}

export interface ReprocessFailure {
  id: string;
  key: string;
  reason: string;
}

export interface ReprocessReport {
  /** linhas legadas encontradas (depois do --limit) */
  legacy: number;
  reprocessed: number;
  /** --dry-run: reprocessou em memória e não gravou nada */
  dry: number;
  /** arquivo legado não existe mais no storage */
  missing: number;
  failed: number;
  /** a linha mudou (apagada/trocada) no meio: a cópia nova foi pro GC */
  changed: number;
  /** chaves novas gravadas (pra conferir a URL) */
  written: string[];
  failures: ReprocessFailure[];
}

type Db = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>;

export interface ReprocessDeps {
  db: Db;
  storage: ObjectStorage;
  process?: (input: Buffer) => Promise<ProcessedPhoto>;
  log?: (msg: string) => void;
}

export interface ReprocessOptions {
  dryRun?: boolean;
  limit?: number;
  graceHours?: number;
}

/**
 * linhas que podem ser legado (o filtro fino é o legacyPlan): tudo que não começa com p/. Fica de fora a foto retida
 * por denúncia: é prova (os bytes ficam como vieram) e vai pra cópia privada held/ pelo MediaGcService, nunca pra p/
 */
export async function findLegacyPhotos(db: Pick<Db, '$queryRaw'>): Promise<LegacyPhotoRow[]> {
  return db.$queryRaw<LegacyPhotoRow[]>`
    SELECT id::text AS id, user_id::text AS user_id, url, thumbnail_url, moderation_labels
      FROM photos
     WHERE (url NOT LIKE 'p/%' OR (thumbnail_url IS NOT NULL AND thumbnail_url NOT LIKE 'p/%'))
       AND (moderation_labels -> 'retainedByReport') IS NULL
     ORDER BY created_at, id`;
}

export async function reprocessLegacyPhotos(
  deps: ReprocessDeps,
  opts: ReprocessOptions = {},
): Promise<ReprocessReport> {
  const { db, storage } = deps;
  const run = deps.process ?? ((b: Buffer) => processPhoto(b));
  const log = deps.log ?? (() => undefined);
  const grace = Math.max(
    0,
    Math.min(24 * 30, Math.round(opts.graceHours ?? REPROCESS_GRACE_HOURS)),
  );
  const report: ReprocessReport = {
    legacy: 0,
    reprocessed: 0,
    dry: 0,
    missing: 0,
    failed: 0,
    changed: 0,
    written: [],
    failures: [],
  };

  let todo = (await findLegacyPhotos(db))
    .map((row) => ({ row, plan: legacyPlan(row) }))
    .filter((x): x is { row: LegacyPhotoRow; plan: ReprocessPlan } => !!x.plan);
  if (opts.limit && opts.limit > 0) todo = todo.slice(0, opts.limit);
  report.legacy = todo.length;

  for (const { row, plan } of todo) {
    const fail = (reason: string) => {
      report.failed++;
      report.failures.push({ id: row.id, key: plan.sourceKey, reason });
      log(`falhou ${row.id} (${plan.sourceKey}): ${reason}`);
    };
    const raw = await storage.get(plan.sourceKey).catch(() => null);
    if (!raw) {
      report.missing++;
      log(`sem arquivo ${row.id}: ${plan.sourceKey} não está no storage (fica como está)`);
      continue;
    }
    let out: ProcessedPhoto;
    try {
      out = await run(raw);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      fail(e.code ?? e.message ?? String(err));
      continue;
    }
    if (opts.dryRun) {
      report.dry++;
      log(
        `reprocessaria ${row.id}: ${plan.sourceKey} (${out.inputFormat}, ${raw.length} B) → JPEG ${out.width}x${out.height} ${out.bytes} B; GC: ${plan.oldKeys.join(', ')}`,
      );
      continue;
    }

    const { key, thumbKey } = newPhotoKeys();
    // como um upload fresco: se o script cair antes de trocar a linha, o GC apaga a cópia órfã em 24 h
    await db.$executeRaw`
      INSERT INTO media_objects (key, owner_id, kind, thumb_key, bytes, width, height, created_at, delete_after)
      VALUES (${key}, ${row.user_id}::uuid, 'photo', ${thumbKey}, ${out.bytes}, ${out.width}, ${out.height},
              now(), now() + make_interval(hours => ${UPLOAD_ORPHAN_TTL_H}::int))`;
    try {
      await Promise.all([
        storage.put(key, out.main, 'image/jpeg'),
        storage.put(thumbKey, out.thumb, 'image/jpeg'),
      ]);
    } catch (err) {
      await db.$executeRaw`UPDATE media_objects SET delete_after = now() WHERE key = ${key}`;
      fail(`storage: ${(err as Error).message}`);
      continue;
    }

    const urgentDays = isUrgentPhoto(row.moderation_labels) ? URGENT_RETENTION_DAYS : 0;
    const swapped = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // troca só se a linha ainda é a que lemos (a pessoa pode ter apagado/trocado no meio)
      const n = await tx.$executeRaw`
        UPDATE photos SET url = ${key}, thumbnail_url = ${thumbKey}
         WHERE id = ${row.id}::uuid AND url = ${row.url}
           AND COALESCE(thumbnail_url, '') = ${row.thumbnail_url ?? ''}`;
      if (!n) return false;
      await tx.$executeRaw`
        UPDATE media_objects SET attached_at = now(), delete_after = NULL WHERE key = ${key}`;
      // antigos na fila do GC (mesma regra do gatilho; ele confere referência e denúncia aberta antes de apagar)
      for (const old of plan.oldKeys) {
        await tx.$executeRaw`
          INSERT INTO media_objects AS m (key, owner_id, kind, delete_after)
          VALUES (${old}, ${row.user_id}::uuid, 'photo',
                  now() + make_interval(days => ${urgentDays}::int, hours => ${grace}::int))
          ON CONFLICT (key) DO UPDATE SET
            attached_at = NULL,
            delete_after = GREATEST(COALESCE(m.delete_after, EXCLUDED.delete_after), EXCLUDED.delete_after)`;
      }
      return true;
    });
    if (!swapped) {
      await db.$executeRaw`UPDATE media_objects SET delete_after = now() WHERE key = ${key}`;
      report.changed++;
      log(`mudou no meio ${row.id}: cópia nova vai pro GC`);
      continue;
    }
    report.reprocessed++;
    report.written.push(key, thumbKey);
    log(`ok ${row.id}: ${plan.sourceKey} → ${key}`);
  }
  return report;
}
