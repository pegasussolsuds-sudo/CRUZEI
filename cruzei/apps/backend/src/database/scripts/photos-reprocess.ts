/* Fotos antigas (antes do image-pipeline) → reprocessadas sem metadado (EXIF/GPS) e em JPEG de verdade.
 *
 *   pnpm photos:reprocess --dry-run     lê e reprocessa em memória: diz o que faria, não grava nada
 *   pnpm photos:reprocess               grava as cópias novas, troca as linhas e põe os arquivos antigos na fila do GC
 *   opções: --limit <n>   --grace-hours <h>  (padrão 24: o cache do app/CDN ainda pode pedir a URL antiga)
 *
 * Produção: pnpm photos:reprocess:prod (dist). Banco e storage vêm dos mesmos .env do backend (DATABASE_URL,
 * STORAGE_*, UPLOAD_DIR); rode da pasta apps/backend com o mesmo NODE_ENV do servidor. Idempotente: rodar de novo só
 * pega o que faltou (arquivo sumido ou formato recusado ficam como estão e aparecem no relatório).
 * Nunca imprime segredo: só chaves de foto e contagens.
 */
import { PrismaClient } from '@prisma/client';

import { photoUrl } from '../../common/photo-url';
import { loadEnvFiles } from '../../config/env-files';
import {
  REPROCESS_GRACE_HOURS,
  reprocessLegacyPhotos,
} from '../../modules/uploads/photo-reprocess';
import { sharedObjectStorage } from '../../modules/uploads/storage/object-storage';

const USAGE = 'uso: photos-reprocess [--dry-run] [--limit <n>] [--grace-hours <h>]';

export interface CliArgs {
  dryRun: boolean;
  limit?: number;
  graceHours: number;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, graceHours: REPROCESS_GRACE_HOURS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = (name: string): number => {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0)
        throw new Error(`${name} precisa de um número ≥ 0\n${USAGE}`);
      return Math.floor(v);
    };
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--limit') out.limit = num('--limit');
    else if (a === '--grace-hours') out.graceHours = num('--grace-hours');
    else if (a === '--') continue;
    else throw new Error(`opção desconhecida: ${a}\n${USAGE}`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  loadEnvFiles();
  const storage = sharedObjectStorage();
  const db = new PrismaClient();
  try {
    console.info(
      `[photos] ${args.dryRun ? 'DRY-RUN (nada é gravado)' : 'gravando'} · storage ${storage.driver} · folga ${args.graceHours} h`,
    );
    const r = await reprocessLegacyPhotos(
      { db, storage, log: (m) => console.info(`[photos] ${m}`) },
      { dryRun: args.dryRun, limit: args.limit, graceHours: args.graceHours },
    );
    console.info(
      `[photos] legado ${r.legacy} · reprocessadas ${r.reprocessed} · dry ${r.dry} · sem arquivo ${r.missing} · ` +
        `recusadas ${r.failed} · mudaram no meio ${r.changed}`,
    );
    for (const k of r.written.slice(0, 10)) console.info(`[photos] nova: ${photoUrl(k)}`);
    if (r.failed) process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(`[photos] erro: ${err.message}`);
    process.exit(1);
  });
}
