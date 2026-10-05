// Coleta de lixo dos arquivos de foto (fila media_objects). A linha entra na fila pelo gatilho photos_release_media
// (foto apagada por qualquer caminho) ou por upload nunca anexado (24 h). Apagar no storage é IRREVERSÍVEL, então:
// lease atômico (SKIP LOCKED), só chave gerenciada, checagem de referência logo antes, retenção de evidência
// (rótulo 'urgent' = 180 dias pelo gatilho; dono com denúncia underage/child_safety aberta = adia) e modo dry.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

import { isManagedKey, keyFromPhotoUrl, photoBaseUrl } from '../../common/photo-url';
import { PrismaService } from '../../database/prisma.service';

import {
  OBJECT_STORAGE,
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

export type GcAction = 'forget' | 'reattach' | 'hold' | 'dry' | 'delete';

export interface GcCandidate {
  key: string;
  /** chave (ou miniatura) apontada por uma linha de photos: voltou a estar em uso */
  inPhotos: boolean;
  /** citada fora de photos (selfie de verificação, capa de evento, evidence_urls de denúncia) */
  referencedElsewhere: boolean;
  /** dono com denúncia underage/child_safety aberta */
  ownerOnHold: boolean;
}

/**
 * Decisão pura sobre um item da fila. A ordem importa: nunca apaga o que não é nosso nem o que está em uso.
 * Citação fora de photos SEGURA (confere de novo em 30 dias) em vez de reanexar: quando a citação sai (denúncia
 * limpa, selfie trocada), o arquivo sai na rodada seguinte, sem ficar guardado pra sempre sem dono.
 */
export function gcDecision(c: GcCandidate, mode: StorageGcMode): GcAction {
  if (!isManagedKey(c.key)) return 'forget';
  if (c.inPhotos) return 'reattach';
  if (c.referencedElsewhere || c.ownerOnHold) return 'hold';
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
      RETURNING m.key, m.thumb_key, m.owner_id::text AS owner_id, m.delete_attempts`;
    report.leased = rows.length;
    if (!rows.length) return report;

    const allKeys = rows.flatMap((r) => (r.thumb_key ? [r.key, r.thumb_key] : [r.key]));
    const refs = await this.references(allKeys);
    const owners = [...new Set(rows.map((r) => r.owner_id).filter((o): o is string => !!o))];
    const held = await this.ownersOnHold(owners);
    const cited = (set: Set<string>, r: LeasedRow) =>
      set.has(r.key) || (!!r.thumb_key && set.has(r.thumb_key));

    for (const r of rows) {
      const action = gcDecision(
        {
          key: r.key,
          inPhotos: cited(refs.inPhotos, r),
          referencedElsewhere: cited(refs.elsewhere, r),
          ownerOnHold: !!r.owner_id && held.has(r.owner_id),
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
   * desligada; tabela grande). Roda a cada kick, então nada de varrer tabela inteira: photos por igualdade na chave
   * normalizada (índices de expressão da migration 20261005000300 — a expressão aqui TEM que ser a mesma, literal) e
   * na URL da base atual (photos_url_idx); fora de photos, só as poucas linhas preenchidas (índices parciais).
   */
  async references(keys: string[], db: Db = this.prisma): Promise<KeyReferences> {
    const out: KeyReferences = { inPhotos: new Set(), elsewhere: new Set() };
    if (!keys.length) return out;
    const base = `${photoBaseUrl()}/`;
    const baseUrls = keys.map((k) => `${base}${k}`);
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
        SELECT CASE WHEN starts_with(o.raw, ${base}) THEN substr(o.raw, ${base.length}::int + 1)
                    ELSE regexp_replace(o.raw, '^https?://[^/]+/uploads/', '') END,
               'other'
          FROM (
            SELECT u.verification_selfie_url::text AS raw FROM users u WHERE u.verification_selfie_url IS NOT NULL
            UNION ALL
            SELECT e.cover_url FROM events e WHERE e.cover_url IS NOT NULL
            UNION ALL
            SELECT x.v FROM reports rp
             CROSS JOIN LATERAL jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(rp.evidence_urls) = 'array' THEN rp.evidence_urls ELSE '[]'::jsonb END) AS x(v)
             WHERE rp.evidence_urls IS NOT NULL
          ) o
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
   * em análise: agora sim saem (o gatilho enfileira, com os 180 dias do 'urgent') e o GC apaga. Cron de hora em hora.
   * O predicado de retida é o do índice parcial photos_retained_idx (literal, igual ao da migration).
   */
  async releaseRetainedPhotos(limit = 200): Promise<number> {
    const n = Math.max(1, Math.min(1000, limit));
    const rows = await this.prisma.$queryRaw<{ url: string; thumbnail_url: string | null }[]>`
      DELETE FROM photos p
       WHERE p.id IN (
             SELECT x.id FROM photos x
              WHERE (x.moderation_labels -> 'retainedByReport') IS NOT NULL
                AND NOT EXISTS (
                      SELECT 1 FROM reports r
                       WHERE r.reported_id = x.user_id
                         AND r.reason = ANY(${[...EVIDENCE_HOLD_REASONS]}::text[])
                         AND r.status IN ('pending', 'reviewing'))
              LIMIT ${n}
                FOR UPDATE SKIP LOCKED)
      RETURNING p.url, p.thumbnail_url`;
    if (!rows.length) return 0;
    this.kick(rows.flatMap((r) => [r.url, r.thumbnail_url]));
    this.log.log(`${rows.length} foto(s) retida(s) por denúncia saíram: a denúncia foi encerrada`);
    return rows.length;
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
