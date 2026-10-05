// Coleta de lixo dos arquivos de foto (fila media_objects). A linha entra na fila pelo gatilho photos_release_media
// (foto apagada por qualquer caminho) ou por upload nunca anexado (24 h). Apagar no storage é IRREVERSÍVEL, então:
// lease atômico (SKIP LOCKED), só chave gerenciada, checagem de referência logo antes, retenção de evidência
// (rótulo 'urgent' = 180 dias pelo gatilho; dono com denúncia underage/child_safety aberta = adia) e modo dry.
// Foto retida por denúncia: o arquivo vai pra uma cópia privada (held/<uuid novo>) e a cópia pública sai da fila
// marcada com moved_to — essa sai mesmo com o dono em retenção, porque a prova já está na cópia privada.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

import {
  imageContentType,
  isHeldKey,
  isManagedKey,
  keyFromPhotoUrl,
  newHeldKey,
  photoBaseUrl,
} from '../../common/photo-url';
import { PrismaService } from '../../database/prisma.service';

import {
  OBJECT_STORAGE,
  PRIVATE_CACHE_CONTROL,
  sharedObjectStorage,
  type ObjectStorage,
  type StorageGcMode,
} from './storage/object-storage';
import { UPLOAD_ORPHAN_TTL_H } from './uploads.constants';

/** denúncias que seguram TODOS os arquivos do dono enquanto abertas (= LEGAL_KEEP_REASONS da limpeza da conta) */
export const EVIDENCE_HOLD_REASONS = ['underage', 'child_safety'] as const;
/** item segurado volta a ser conferido depois disso */
export const HOLD_RETRY_DAYS = 30;
/** a partir daqui avisa o Sentry (uma vez) */
export const GC_ALERT_ATTEMPTS = 12;
/** cópia privada registrada antes da troca da linha: se a troca não acontecer, vira órfã e sai depois disso */
export const HELD_ORPHAN_TTL_MIN = 60;
/** retidas movidas pra held/ por rodada do cron (as que não deram na hora do apagar e as de antes da mudança) */
export const HELD_MOVE_BATCH = 50;

export type GcAction = 'forget' | 'reattach' | 'hold' | 'dry' | 'delete';

export interface GcCandidate {
  key: string;
  /** chave (ou miniatura) apontada por uma linha de photos: voltou a estar em uso */
  inPhotos: boolean;
  /** citada fora de photos (selfie de verificação, capa de evento, evidence_urls de denúncia) */
  referencedElsewhere: boolean;
  /** dono com denúncia underage/child_safety aberta */
  ownerOnHold: boolean;
  /** cópia PÚBLICA de foto retida cuja cópia privada (held/) existe: a retenção do dono não segura esta */
  movedToHeld?: boolean;
}

/**
 * Decisão pura sobre um item da fila. A ordem importa: nunca apaga o que não é nosso nem o que está em uso.
 * Citação fora de photos SEGURA (confere de novo em 30 dias) em vez de reanexar: quando a citação sai (denúncia
 * limpa, selfie trocada), o arquivo sai na rodada seguinte, sem ficar guardado pra sempre sem dono.
 */
export function gcDecision(c: GcCandidate, mode: StorageGcMode): GcAction {
  if (!isManagedKey(c.key)) return 'forget';
  if (c.inPhotos) return 'reattach';
  if (c.referencedElsewhere || (c.ownerOnHold && !c.movedToHeld)) return 'hold';
  if (mode !== 'on') return 'dry';
  return 'delete';
}

/** chaves citadas, separadas por onde (photos reanexa; o resto segura) */
export interface KeyReferences {
  inPhotos: Set<string>;
  elsewhere: Set<string>;
}

export interface GcReport {
  leased: number;
  deleted: number;
  forgotten: number;
  reattached: number;
  held: number;
  dry: number;
  failed: number;
}

interface LeasedRow {
  key: string;
  thumb_key: string | null;
  owner_id: string | null;
  delete_attempts: number;
  /** cópia pública de foto retida: chave da cópia privada (held/) */
  moved_to: string | null;
}

/** linha de photos que vai ser retida (o que a troca pra held/ precisa) */
export interface RetainedSource {
  id: string;
  userId: string;
  url: string;
  thumbnailUrl: string | null;
}

type Db = Pick<PrismaService, '$queryRaw' | '$executeRaw'>;

/** donos com denúncia underage/child_safety pendente ou em análise (o GC segura; apagar foto vira reter) */
export async function ownersOnEvidenceHold(db: Db, owners: string[]): Promise<Set<string>> {
  if (!owners.length) return new Set();
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT reported_id::text AS id FROM reports
     WHERE reported_id = ANY(${owners}::uuid[])
       AND reason = ANY(${[...EVIDENCE_HOLD_REASONS]}::text[])
       AND status IN ('pending', 'reviewing')`;
  return new Set(rows.map((r) => r.id));
}

export function gcModeFromEnv(env: NodeJS.ProcessEnv = process.env): StorageGcMode {
  const v = (env.STORAGE_GC ?? 'on').trim().toLowerCase();
  return v === 'dry' || v === 'off' ? v : 'on';
}

@Injectable()
export class MediaGcService {
  private readonly log = new Logger(MediaGcService.name);
  readonly mode: StorageGcMode;
  private storageRef: ObjectStorage | null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(OBJECT_STORAGE) storage?: ObjectStorage,
    @Optional() @Inject('MEDIA_GC_MODE') mode?: StorageGcMode,
  ) {
    this.storageRef = storage ?? null;
    this.mode = mode ?? gcModeFromEnv();
  }

  private get storage(): ObjectStorage {
    this.storageRef ??= sharedObjectStorage();
    return this.storageRef;
  }

  /** drena as chaves dadas fora da requisição (depois do commit); o cron pega o que sobrar */
  kick(keysOrUrls: (string | null | undefined)[]): void {
    const keys = [
      ...new Set(keysOrUrls.map((k) => keyFromPhotoUrl(k)).filter((k): k is string => !!k)),
    ];
    if (!keys.length || this.mode === 'off') return;
    setImmediate(() => {
      this.drain({ keys }).catch((e: Error) => this.log.warn(`GC imediato falhou: ${e.message}`));
    });
  }

  /**
   * Um lote da fila: lease atômico (delete_after vira now()+10 min·2^tentativas), decide e executa cada item.
   * `keys` limita a essas chaves (kick); sem `keys` pega as vencidas mais antigas.
   */
  async drain(opts: { keys?: string[]; limit?: number } = {}): Promise<GcReport> {
    const report: GcReport = {
      leased: 0,
      deleted: 0,
      forgotten: 0,
      reattached: 0,
      held: 0,
      dry: 0,
      failed: 0,
    };
    if (this.mode === 'off') return report;
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const onlyKeys = opts.keys?.length ? opts.keys : null;

    const rows = await this.prisma.$queryRaw<LeasedRow[]>`
      UPDATE media_objects m
         SET delete_after = now() + LEAST(interval '10 minutes' * power(2, LEAST(m.delete_attempts, 8)), interval '1 day'),
             delete_attempts = LEAST(m.delete_attempts + 1, 32000)
       WHERE m.key IN (
             SELECT key FROM media_objects
              WHERE delete_after IS NOT NULL AND delete_after <= now()
                AND (${onlyKeys}::text[] IS NULL OR key = ANY(${onlyKeys}::text[]))
              ORDER BY delete_after
              LIMIT ${limit}
                FOR UPDATE SKIP LOCKED)
      RETURNING m.key, m.thumb_key, m.owner_id::text AS owner_id, m.delete_attempts, m.moved_to`;
    report.leased = rows.length;
    if (!rows.length) return report;

    const allKeys = rows.flatMap((r) => (r.thumb_key ? [r.key, r.thumb_key] : [r.key]));
    const refs = await this.references(allKeys);
    const owners = [...new Set(rows.map((r) => r.owner_id).filter((o): o is string => !!o))];
    const held = await this.ownersOnHold(owners);
    const cited = (set: Set<string>, r: LeasedRow) =>
      set.has(r.key) || (!!r.thumb_key && set.has(r.thumb_key));

    for (const r of rows) {
      const ownerOnHold = !!r.owner_id && held.has(r.owner_id);
      const action = gcDecision(
        {
          key: r.key,
          inPhotos: cited(refs.inPhotos, r),
          referencedElsewhere: cited(refs.elsewhere, r),
          ownerOnHold,
          // só confia na cópia privada se ela existe mesmo (senão a pública é a única prova e fica)
          movedToHeld: ownerOnHold && !!r.moved_to && (await this.heldCopyExists(r.moved_to)),
        },
        this.mode,
      );
      try {
        await this.apply(action, r);
        if (action === 'delete') report.deleted++;
        else if (action === 'forget') report.forgotten++;
        else if (action === 'reattach') report.reattached++;
        else if (action === 'hold') report.held++;
        else report.dry++;
      } catch (err) {
        report.failed++;
        const msg = (err as Error).message ?? String(err);
        await this.prisma
          .$executeRaw`UPDATE media_objects SET last_error = left(${msg}, 200) WHERE key = ${r.key}`.catch(
          () => 0,
        );
        this.log.warn(`GC de ${r.key} falhou (tentativa ${r.delete_attempts}): ${msg}`);
        if (r.delete_attempts === GC_ALERT_ATTEMPTS) {
          Sentry.captureMessage(
            `media GC: ${r.key} falhou ${GC_ALERT_ATTEMPTS} vezes (${msg.slice(0, 120)})`,
            'warning',
          );
        }
      }
    }
    if (report.deleted || report.failed || report.dry) {
      this.log.log(
        `GC de fotos: ${report.deleted} apagadas, ${report.dry} em dry, ${report.held} retidas, ${report.reattached} em uso, ${report.failed} com erro`,
      );
    }
    return report;
  }

  private async heldCopyExists(key: string): Promise<boolean> {
    if (!isHeldKey(key) || !isManagedKey(key)) return false;
    return this.storage.exists(key).catch(() => false);
  }

  private async apply(action: GcAction, r: LeasedRow): Promise<void> {
    switch (action) {
      case 'forget':
        // fakes/, URL externa, lixo: some da fila sem tocar no storage
        await this.prisma
          .$executeRaw`DELETE FROM media_objects WHERE key = ${r.key} AND attached_at IS NULL`;
        return;
      case 'reattach':
        await this.prisma.$executeRaw`
          UPDATE media_objects SET delete_after = NULL, delete_attempts = 0, last_error = NULL, attached_at = COALESCE(attached_at, now())
           WHERE key = ${r.key}`;
        return;
      case 'hold':
        await this.prisma.$executeRaw`
          UPDATE media_objects SET delete_after = now() + make_interval(days => ${HOLD_RETRY_DAYS}::int), delete_attempts = 0
           WHERE key = ${r.key}`;
        return;
      case 'dry':
        this.log.log(`[STORAGE_GC=dry] apagaria ${r.key}${r.thumb_key ? ` e ${r.thumb_key}` : ''}`);
        await this.prisma.$executeRaw`
          UPDATE media_objects SET delete_after = now() + interval '1 day', delete_attempts = 0 WHERE key = ${r.key}`;
        return;
      case 'delete':
        // miniatura primeiro: se o original falhar, a linha fica e tenta de novo (delete é idempotente)
        if (r.thumb_key && isManagedKey(r.thumb_key)) await this.storage.delete(r.thumb_key);
        await this.storage.delete(r.key);
        await this.prisma
          .$executeRaw`DELETE FROM media_objects WHERE key = ${r.key} AND attached_at IS NULL`;
        return;
    }
  }

  /**
   * Onde cada chave ainda é citada: photos (url/miniatura) de um lado; selfie de verificação, capa de evento e
   * evidence_urls de denúncia do outro. Reconhece a chave crua, a URL da base pública atual (STORAGE_PUBLIC_BASE_URL,
   * ex.: domínio do R2) e o legado http(s)://<host>/uploads/<chave>. messages.media_url fica de fora (mídia do chat
   * desligada; tabela grande). Roda a cada kick, então nada de varrer tabela inteira: todo ramo filtra por igualdade
   * — a chave normalizada (chave crua e legado dão o mesmo valor) nos índices de expressão das migrations
   * 20261005000300 (photos) e 20261005000400 (selfie, capa) e a URL da base atual nos índices simples; evidence_urls
   * (jsonb) pelo GIN em media_ref_keys(), que guarda cada item cru e normalizado. As expressões aqui TÊM que ser as
   * mesmas dos índices, literais (o spec confere), senão o índice não entra.
   */
  async references(keys: string[], db: Db = this.prisma): Promise<KeyReferences> {
    const out: KeyReferences = { inPhotos: new Set(), elsewhere: new Set() };
    if (!keys.length) return out;
    const base = `${photoBaseUrl()}/`;
    const baseUrls = keys.map((k) => `${base}${k}`);
    // evidence_urls: o item pode ser a chave, a URL da base atual ou o legado (normalizado vira a chave)
    const needles = [...keys, ...baseUrls];
    const rows = await db.$queryRaw<{ k: string; src: 'photos' | 'other' }[]>`
      SELECT DISTINCT r.k, r.src FROM (
        SELECT regexp_replace(p.url, '^https?://[^/]+/uploads/', '') AS k, 'photos' AS src FROM photos p
         WHERE regexp_replace(p.url, '^https?://[^/]+/uploads/', '') = ANY(${keys}::text[])
        UNION ALL
        SELECT regexp_replace(p.thumbnail_url, '^https?://[^/]+/uploads/', ''), 'photos' FROM photos p
         WHERE p.thumbnail_url IS NOT NULL
           AND regexp_replace(p.thumbnail_url, '^https?://[^/]+/uploads/', '') = ANY(${keys}::text[])
        UNION ALL
        SELECT substr(p.url, ${base.length}::int + 1), 'photos' FROM photos p
         WHERE p.url = ANY(${baseUrls}::text[])
        UNION ALL
        SELECT substr(p.thumbnail_url, ${base.length}::int + 1), 'photos' FROM photos p
         WHERE p.thumbnail_url = ANY(${baseUrls}::text[])
        UNION ALL
        SELECT regexp_replace(u.verification_selfie_url, '^https?://[^/]+/uploads/', ''), 'other' FROM users u
         WHERE u.verification_selfie_url IS NOT NULL
           AND regexp_replace(u.verification_selfie_url, '^https?://[^/]+/uploads/', '') = ANY(${keys}::text[])
        UNION ALL
        SELECT substr(u.verification_selfie_url, ${base.length}::int + 1), 'other' FROM users u
         WHERE u.verification_selfie_url IS NOT NULL AND u.verification_selfie_url = ANY(${baseUrls}::text[])
        UNION ALL
        SELECT regexp_replace(e.cover_url, '^https?://[^/]+/uploads/', ''), 'other' FROM events e
         WHERE e.cover_url IS NOT NULL
           AND regexp_replace(e.cover_url, '^https?://[^/]+/uploads/', '') = ANY(${keys}::text[])
        UNION ALL
        SELECT substr(e.cover_url, ${base.length}::int + 1), 'other' FROM events e
         WHERE e.cover_url IS NOT NULL AND e.cover_url = ANY(${baseUrls}::text[])
        UNION ALL
        SELECT CASE WHEN starts_with(x.v, ${base}) THEN substr(x.v, ${base.length}::int + 1)
                    ELSE regexp_replace(x.v, '^https?://[^/]+/uploads/', '') END,
               'other'
          FROM reports rp
         CROSS JOIN LATERAL jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(rp.evidence_urls) = 'array' THEN rp.evidence_urls ELSE '[]'::jsonb END) AS x(v)
         WHERE rp.evidence_urls IS NOT NULL
           AND media_ref_keys(rp.evidence_urls) && ${needles}::text[]
      ) r
      WHERE r.k = ANY(${keys}::text[])`;
    for (const r of rows) (r.src === 'photos' ? out.inPhotos : out.elsewhere).add(r.k);
    return out;
  }

  /** donos com denúncia underage/child_safety pendente ou em análise */
  ownersOnHold(owners: string[], db: Db = this.prisma): Promise<Set<string>> {
    return ownersOnEvidenceHold(db, owners);
  }

  /**
   * Fotos retidas por denúncia (photo-retention.ts) cujo dono não tem mais denúncia underage/child_safety pendente ou
   * em análise: agora a linha sai (o gatilho enfileira o arquivo) e o GC apaga. Se a denúncia fechou COM ação
   * (resolvida: advertência, suspensão, banimento) ou a conta está banida, a foto ganha o rótulo 'urgent' ANTES de
   * sair e o gatilho guarda o arquivo 180 dias; dispensada sem ação, sai na hora. Cron de hora em hora.
   * O predicado de retida é o do índice parcial photos_retained_idx (literal, igual ao da migration).
   */
  async releaseRetainedPhotos(limit = 200): Promise<number> {
    const n = Math.max(1, Math.min(1000, limit));
    const reasons = [...EVIDENCE_HOLD_REASONS];
    const rows = await this.prisma.$transaction(async (tx) => {
      const picked = await tx.$queryRaw<{ id: string; acted: boolean }[]>`
        SELECT x.id::text AS id,
               (u.account_status::text = 'banned' OR EXISTS (
                  SELECT 1 FROM reports r
                   WHERE r.reported_id = x.user_id
                     AND r.reason = ANY(${reasons}::text[])
                     AND r.status = 'resolved')) AS acted
          FROM photos x JOIN users u ON u.id = x.user_id
         WHERE (x.moderation_labels -> 'retainedByReport') IS NOT NULL
           AND NOT EXISTS (
                 SELECT 1 FROM reports r
                  WHERE r.reported_id = x.user_id
                    AND r.reason = ANY(${reasons}::text[])
                    AND r.status IN ('pending', 'reviewing'))
         LIMIT ${n}
           FOR UPDATE OF x SKIP LOCKED`;
      if (!picked.length) return [];
      const acted = picked.filter((p) => p.acted).map((p) => p.id);
      if (acted.length) {
        // o gatilho lê o 'urgent' da linha apagada: na mesma transação, antes do DELETE
        await tx.$executeRaw`
          UPDATE photos SET moderation_labels = moderation_labels || '{"urgent": true}'::jsonb
           WHERE id = ANY(${acted}::uuid[])`;
      }
      return tx.$queryRaw<{ url: string; thumbnail_url: string | null }[]>`
        DELETE FROM photos WHERE id = ANY(${picked.map((p) => p.id)}::uuid[])
        RETURNING url, thumbnail_url`;
    });
    if (!rows.length) return 0;
    this.kick(rows.flatMap((r) => [r.url, r.thumbnail_url]));
    this.log.log(`${rows.length} foto(s) retida(s) por denúncia saíram: a denúncia foi encerrada`);
    return rows.length;
  }

  // ---------------------------------------------------------------------------------------------
  // Foto retida por denúncia → cópia privada (held/)
  // ---------------------------------------------------------------------------------------------

  /**
   * Copia o arquivo de uma foto que vai ser retida pra held/<uuid novo> (sem cache público). A linha da cópia entra
   * na fila ANTES do PUT como órfã (sai em 1 h se a troca não acontecer). null = não deu (chave que não é nossa,
   * arquivo sumido, storage fora): quem chama retém no lugar e o cron (moveRetainedToHeld) tenta de novo.
   */
  async copyToHeld(ownerId: string, sourceKey: string | null): Promise<string | null> {
    if (!isManagedKey(sourceKey) || isHeldKey(sourceKey)) return null;
    try {
      const body = await this.storage.get(sourceKey);
      if (!body) return null;
      const heldKey = newHeldKey(sourceKey);
      await this.prisma.$executeRaw`
        INSERT INTO media_objects (key, owner_id, kind, bytes, delete_after)
        VALUES (${heldKey}, ${ownerId}::uuid, 'held', ${body.length},
                now() + make_interval(mins => ${HELD_ORPHAN_TTL_MIN}::int))`;
      await this.storage.put(heldKey, body, imageContentType(sourceKey), {
        cacheControl: PRIVATE_CACHE_CONTROL,
      });
      return heldKey;
    } catch (err) {
      this.log.warn(`cópia privada de ${sourceKey} falhou: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Na transação de quem retém, DEPOIS de apontar a linha de photos pra `heldKey`: a cópia privada fica anexada e as
   * chaves públicas (original + miniatura) vão pra fila marcadas com moved_to, pra sair já — mesmo com o dono em
   * retenção. Devolve as chaves públicas: quem chama faz kick() depois do commit.
   */
  async attachHeld(
    tx: Db,
    ownerId: string,
    heldKey: string,
    oldUrl: string,
    oldThumbnailUrl: string | null,
  ): Promise<string[]> {
    await tx.$executeRaw`
      UPDATE media_objects SET attached_at = now(), delete_after = NULL, delete_attempts = 0, last_error = NULL
       WHERE key = ${heldKey}`;
    const k = keyFromPhotoUrl(oldUrl);
    if (!isManagedKey(k) || isHeldKey(k)) return [];
    const t0 = keyFromPhotoUrl(oldThumbnailUrl);
    const t = isManagedKey(t0) && t0 !== k ? t0 : null;
    await tx.$executeRaw`
      INSERT INTO media_objects AS m (key, owner_id, kind, thumb_key, delete_after, moved_to)
      VALUES (${k}, ${ownerId}::uuid, 'photo', ${t}, now(), ${heldKey})
      ON CONFLICT (key) DO UPDATE SET
        thumb_key = COALESCE(m.thumb_key, EXCLUDED.thumb_key),
        attached_at = NULL,
        delete_after = now(),
        delete_attempts = 0,
        moved_to = EXCLUDED.moved_to`;
    return t ? [k, t] : [k];
  }

  /** cópia privada que não chegou a ser usada (a linha mudou no meio): vence agora e vai pro GC */
  async abandonHeld(heldKey: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE media_objects SET delete_after = now() WHERE key = ${heldKey} AND attached_at IS NULL`;
    this.kick([heldKey]);
  }

  /**
   * Retidas que ainda apontam pra chave pública (a cópia não deu na hora do apagar, ou retidas de antes da held/):
   * copia, troca a linha (só se ela não mudou no meio) e manda as públicas pro GC. Cron de hora em hora, depois da
   * soltura. Só chave nossa (fakes/ e URL externa ficam onde estão). Devolve quantas mudaram.
   */
  async moveRetainedToHeld(limit = HELD_MOVE_BATCH): Promise<number> {
    const n = Math.max(1, Math.min(500, limit));
    const rows = await this.prisma.$queryRaw<
      { id: string; user_id: string; url: string; thumbnail_url: string | null }[]
    >`
      SELECT x.id::text AS id, x.user_id::text AS user_id, x.url, x.thumbnail_url FROM photos x
       WHERE (x.moderation_labels -> 'retainedByReport') IS NOT NULL
         AND x.url !~ '^held/'
         AND x.url ~ '^(https?://[^/]+/uploads/)?(p/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]{1,5}$'
       ORDER BY x.created_at, x.id
       LIMIT ${n}`;
    let moved = 0;
    for (const r of rows) {
      const heldKey = await this.copyToHeld(r.user_id, keyFromPhotoUrl(r.url));
      if (!heldKey) continue;
      const publicKeys = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.$executeRaw`
          UPDATE photos SET url = ${heldKey}, thumbnail_url = ${heldKey}
           WHERE id = ${r.id}::uuid AND url = ${r.url}
             AND COALESCE(thumbnail_url, '') = ${r.thumbnail_url ?? ''}
             AND (moderation_labels -> 'retainedByReport') IS NOT NULL`;
        if (!changed) return null;
        return this.attachHeld(tx, r.user_id, heldKey, r.url, r.thumbnail_url);
      });
      if (!publicKeys) {
        await this.abandonHeld(heldKey);
        continue;
      }
      this.kick(publicKeys);
      moved++;
    }
    if (moved) this.log.log(`${moved} foto(s) retida(s) movida(s) pra cópia privada (held/)`);
    return moved;
  }

  /**
   * Limpeza da conta: apaga as linhas de photos (o gatilho enfileira os arquivos, com a retenção do 'urgent') menos
   * `keepPhotoIds` (fotos citadas em denúncia) e vence na hora os uploads soltos. Devolve as chaves enfileiradas.
   * Com `tx`, quem chama faz `kick(chaves)` DEPOIS do commit; sem `tx`, roda numa transação própria e já chama.
   */
  async releaseUser(
    userId: string,
    opts: { keepPhotoIds?: string[]; tx?: Prisma.TransactionClient } = {},
  ): Promise<string[]> {
    const run = async (db: Db): Promise<string[]> => {
      const keep = opts.keepPhotoIds ?? [];
      const deleted = await db.$queryRaw<{ url: string; thumbnail_url: string | null }[]>`
        DELETE FROM photos WHERE user_id = ${userId}::uuid AND NOT (id = ANY(${keep}::uuid[]))
        RETURNING url, thumbnail_url`;
      // só upload fresco (delete_after = created_at + TTL): não encurta a retenção de 180 dias de quem veio do gatilho
      const orphans = await db.$queryRaw<{ key: string }[]>`
        UPDATE media_objects SET delete_after = now()
         WHERE owner_id = ${userId}::uuid AND attached_at IS NULL
           AND delete_after = created_at + make_interval(hours => ${UPLOAD_ORPHAN_TTL_H}::int)
        RETURNING key`;
      const keys = deleted.flatMap((d) => [
        keyFromPhotoUrl(d.url),
        keyFromPhotoUrl(d.thumbnail_url),
      ]);
      return [...new Set([...keys, ...orphans.map((o) => o.key)].filter((k): k is string => !!k))];
    };
    if (opts.tx) return run(opts.tx);
    const keys = await this.prisma.$transaction((tx) => run(tx));
    this.kick(keys);
    return keys;
  }
}
