import { randomUUID } from 'node:crypto';

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

import { phoneHash } from '../../common/phone-hash';
import { isManagedKey, keyFromPhotoUrl } from '../../common/photo-url';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AccountStateService } from '../account/account-state.service';
import { contextConversationIds } from '../reports/report-context';
import { deleteUserPhotos, MediaGcService } from '../uploads/media-gc.service';
import { UPLOAD_ORPHAN_TTL_H } from '../uploads/uploads.constants';

import {
  ACCESS_LOG_RETENTION_MONTHS,
  HOLD_RETRY_MS,
  PHONE_HASH_RETENTION_MONTHS,
  privacyConfig,
} from './privacy-config';
import {
  anonymizedInstallId,
  evidenceConversationIds,
  evidenceConversationsPageSql,
  evidenceExpired,
  FIRST_UUID,
  holdReasonFor,
  keepPhoneOnPurge,
  OPEN_REPORT_STATUSES,
  phoneReleaseHashExpirySql,
  phoneReleaseMetaExpirySql,
  phoneReleaseUnlinkSql,
  RETENTION_PAGE,
  reviewHoldDeadline,
  splitOpenReports,
  supportThreadExpired,
  tombstoneData,
  urgentSupportPageSql,
  utcSql,
  type CitingReport,
} from './purge-plan';
import { purgeUserKeys } from './user-redis';

type Tx = Prisma.TransactionClient;

export type PurgeOutcome = 'completed' | 'held' | 'cancelled' | 'failed';

export interface PurgeRunResult {
  completed: number;
  held: number;
  cancelled: number;
  failed: number;
}

/** avisa o Sentry quando a mesma conta falha tantas vezes seguidas */
const ALERT_AFTER_ATTEMPTS = 3;

const NOTE_PHONE_KEPT =
  'Número guardado na limpeza da conta excluída (estava banida/suspensa): cadastro novo com ele nasce em revisão';
const NOTE_PHONE_KEPT_HOLD =
  'Número guardado na limpeza da conta excluída (estava em revisão, sem denúncia de alguém aberta, e passou do prazo da revisão)';
const NOTE_PHONE_KEPT_AUTO =
  'Número guardado na limpeza da conta excluída (tinha denúncia automática em análise, como golpe ou GPS falso, e passou do prazo da revisão)';

interface UserRow {
  id: string;
  phone: string | null;
  deleted_at: Date | null;
  purged_at: Date | null;
  account_status: string;
  review_hold_at: Date | null;
  trial_used_at: Date | null;
  verification_selfie_url: string | null;
}

/**
 * Limpeza definitiva ("conta limpa") no fim do prazo, uma transação por conta, e a retenção diária do que ficou como
 * prova. Nunca DELETE FROM users: o cascade apagaria as denúncias contra a pessoa, as provas do outro lado e o fiscal.
 * Todo passo é DELETE/UPDATE por user_id (idempotente): se cair no meio, a próxima rodada termina.
 */
@Injectable()
export class AccountPurgeService {
  private readonly log = new Logger(AccountPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountStateService,
    /** fila de arquivos (UploadsModule global); ausente nos testes = só o gatilho photos_release_media */
    @Optional() private readonly mediaGc?: MediaGcService,
  ) {}

  /** até `limit` pedidos vencidos; pedido que falhou não é tentado de novo na mesma rodada */
  async purgeDue(limit = 20, now = new Date()): Promise<PurgeRunResult> {
    const res: PurgeRunResult = { completed: 0, held: 0, cancelled: 0, failed: 0 };
    const skip: string[] = [];
    for (let i = 0; i < limit; i++) {
      const r = await this.purgeNext(now, skip);
      if (!r) break;
      res[r.outcome]++;
      if (r.outcome === 'failed') skip.push(r.requestId);
    }
    if (res.completed || res.held || res.failed)
      this.log.log(
        `limpeza de contas: ${res.completed} concluídas, ${res.held} adiadas, ${res.cancelled} canceladas, ${res.failed} com erro`,
      );
    return res;
  }

  /** pega UM pedido vencido (FOR UPDATE SKIP LOCKED: duas rodadas juntas nunca pegam o mesmo) e processa */
  async purgeNext(
    now = new Date(),
    skip: string[] = [],
  ): Promise<{ requestId: string; userId: string; outcome: PurgeOutcome } | null> {
    // o pedido pego fica fora do callback: a falha é registrada nele depois do rollback
    const st: {
      picked: { id: string; user_id: string; requested_at: Date } | null;
      phone: string | null;
      media: string[];
    } = {
      picked: null,
      phone: null,
      media: [],
    };
    try {
      const outcome = await this.prisma.$transaction(
        async (tx) => {
          const [r] = await tx.$queryRaw<{ id: string; user_id: string; requested_at: Date }[]>`
            SELECT id::text AS id, user_id::text AS user_id, requested_at FROM data_deletion_requests
             WHERE status = 'pending' AND scheduled_for <= ${utcSql(now)}
               AND NOT (id::text = ANY(${skip}::text[]))
             ORDER BY scheduled_for
             LIMIT 1
             FOR UPDATE SKIP LOCKED`;
          if (!r) return null;
          st.picked = r;
          const done = await this.purgeInTx(tx, r.id, r.user_id, now, r.requested_at);
          st.phone = done.phone;
          st.media = done.media;
          return done.outcome;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      if (!outcome || !st.picked) return null;
      if (outcome === 'completed') await this.afterPurge(st.picked.user_id, st.phone, st.media);
      return { requestId: st.picked.id, userId: st.picked.user_id, outcome };
    } catch (e) {
      if (!st.picked) throw e;
      await this.recordFailure(st.picked.id, e as Error);
      return { requestId: st.picked.id, userId: st.picked.user_id, outcome: 'failed' };
    }
  }

  /** passos da limpeza dentro da transação (o pedido já está travado) */
  private async purgeInTx(
    tx: Tx,
    requestId: string,
    userId: string,
    now: Date,
    requestedAt: Date,
  ): Promise<{ outcome: Exclude<PurgeOutcome, 'failed'>; phone: string | null; media: string[] }> {
    // a) mesma trava da restauração: se a pessoa cancelou antes, o pedido já não é 'pending' e nem chegaria aqui
    const [u] = await tx.$queryRaw<UserRow[]>`
      SELECT id::text AS id, phone, deleted_at, purged_at, account_status::text AS account_status, review_hold_at,
             trial_used_at, verification_selfie_url
        FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!u || u.purged_at) {
      await tx.dataDeletionRequest.update({
        where: { id: requestId },
        data: { status: 'completed', completedAt: u?.purged_at ?? now, holdReason: null },
      });
      return { outcome: 'completed', phone: null, media: [] };
    }
    if (!u.deleted_at) {
      await tx.dataDeletionRequest.update({
        where: { id: requestId },
        data: { status: 'cancelled', cancelledAt: now, holdReason: null },
      });
      return { outcome: 'cancelled', phone: null, media: [] };
    }

    // b) bloqueio legal: denúncia de alguém (ou de menor/abuso infantil) em análise → espera a decisão; revisão ou
    // denúncia automática (ex.: a do número reciclado, sem quem denunciou) → espera só até o teto
    const open = await tx.report.findMany({
      where: { reportedId: userId, status: { in: [...OPEN_REPORT_STATUSES] } },
      select: { reporterId: true, reason: true },
    });
    const { blocking, automatic } = splitOpenReports(open);
    const deadline = reviewHoldDeadline(requestedAt, privacyConfig().graceDays);
    const hold = holdReasonFor(blocking, u.review_hold_at, now, deadline, automatic);
    if (hold) {
      await tx.dataDeletionRequest.update({
        where: { id: requestId },
        data: { holdReason: hold, scheduledFor: new Date(now.getTime() + HOLD_RETRY_MS) },
      });
      return { outcome: 'held', phone: null, media: [] };
    }

    // c) prova: conversas da pessoa citadas em denúncias feitas por ela ou contra ela
    const convs = await tx.conversation.findMany({
      where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
      select: { id: true },
    });
    const reports = await tx.report.findMany({
      where: { OR: [{ reportedId: userId }, { reporterId: userId }] },
      select: { context: true },
    });
    const evidence = evidenceConversationIds(
      reports.map((r) => r.context),
      convs.map((c) => c.id),
    );
    const toDelete = convs.map((c) => c.id).filter((id) => !evidence.has(id.toLowerCase()));

    // d) telefone: banida/suspensa (ou revisão/denúncia automática que passou do teto) guarda o número; teste grátis
    // vira marca permanente
    const hash = u.phone ? phoneHash(u.phone) : null;
    const keepPhone = keepPhoneOnPurge(u.account_status, u.review_hold_at, automatic);
    if (!keepPhone) await this.anonymizePhoneReleases(tx, userId, now);
    if (u.phone && keepPhone) {
      await tx.phoneRelease.create({
        data: {
          userId,
          phone: u.phone,
          reason: 'account_deleted',
          accountStatus: u.account_status as never,
          lastUsedAt: u.deleted_at,
        },
      });
      await tx.moderationAction.create({
        data: {
          moderatorId: null,
          targetUserId: userId,
          action: 'phone_released',
          note: keepPhoneOnPurge(u.account_status)
            ? NOTE_PHONE_KEPT
            : u.review_hold_at
              ? NOTE_PHONE_KEPT_HOLD
              : NOTE_PHONE_KEPT_AUTO,
        },
      });
    }
    if (u.phone && u.trial_used_at) {
      await tx.$executeRaw`
        INSERT INTO trial_claims (phone_hash, user_id) VALUES (${hash}, ${userId}::uuid)
        ON CONFLICT (phone_hash) DO NOTHING`;
    }

    // e) o que é da relação com outras pessoas, dos dois lados
    await tx.like.deleteMany({ where: { OR: [{ likerId: userId }, { likedId: userId }] } });
    await tx.pass.deleteMany({ where: { OR: [{ userId }, { targetId: userId }] } });
    await tx.matchCelebration.deleteMany({ where: { OR: [{ userId }, { peerId: userId }] } });
    await tx.visit.deleteMany({ where: { OR: [{ visitorId: userId }, { visitedId: userId }] } });
    await tx.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    await tx.match.deleteMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
    // conversa fora da prova sai com as mensagens das duas pessoas (cascade em messages e members)
    if (toDelete.length) await tx.conversation.deleteMany({ where: { id: { in: toDelete } } });
    // conversa de prova: fica, invisível pros dois (só a moderação lê); a retenção apaga depois
    if (evidence.size) {
      await tx.conversationMember.updateMany({
        where: { conversationId: { in: [...evidence] }, archivedAt: null },
        data: { archivedAt: now, unreadCount: 0 },
      });
    }

    // f) perfil, localização e o resto da pessoa. Fotos: o gatilho photos_release_media põe os arquivos na fila
    // media_objects (rótulo 'urgent' fica 180 dias; denúncia underage/child_safety aberta segura no GC) e o upload
    // solto vence na hora; os arquivos saem no GC (kick depois do commit). Retida por denúncia que fechou com ação
    // (banida ou denúncia resolvida) ganha 'urgent' antes, como na soltura (deleteUserPhotos)
    const media = this.mediaGc
      ? await this.mediaGc.releaseUser(userId, { tx })
      : await this.releasePhotosInTx(tx, userId);
    // selfie: chave pela mesma regra do resto (legado /uploads/ e base pública atual, inclusive R2)
    const selfieKey = keyFromPhotoUrl(u.verification_selfie_url);
    const selfieManaged = isManagedKey(selfieKey) ? selfieKey : null;
    if (selfieManaged) {
      await tx.$executeRaw`
        INSERT INTO media_objects AS m (key, owner_id, kind, delete_after)
        VALUES (${selfieManaged}, ${userId}::uuid, 'photo', now())
        ON CONFLICT (key) DO UPDATE SET attached_at = NULL, delete_after = COALESCE(m.delete_after, EXCLUDED.delete_after)`;
    }
    await tx.userInterest.deleteMany({ where: { userId } });
    await tx.privateArea.deleteMany({ where: { userId } });
    await tx.seal.deleteMany({ where: { userId } });
    await tx.poisCheckin.deleteMany({ where: { userId } });
    await tx.location.deleteMany({ where: { userId } });
    await tx.$executeRaw`DELETE FROM place_votes WHERE user_id = ${userId}::uuid`;
    await tx.$executeRaw`DELETE FROM poi_reports WHERE user_id = ${userId}::uuid`;
    await tx.notification.deleteMany({ where: { userId } });
    await tx.notificationPref.deleteMany({ where: { userId } });
    await tx.deviceToken.deleteMany({ where: { userId } });
    await tx.superLikeUse.deleteMany({ where: { userId } });
    // atendimento urgente (botão de emergência) fica como prova até a retenção
    await tx.supportThread.deleteMany({ where: { userId, urgent: false } });

    // g) o que fica sem apontar pra pessoa
    await tx.boost.updateMany({ where: { userId }, data: { latitude: null, longitude: null } });
    await tx.$executeRaw`
      UPDATE analytics_events SET user_id = NULL, install_id = ${anonymizedInstallId(randomUUID())}
       WHERE user_id = ${userId}::uuid`;
    // audit_log é só-anexar: a exceção vale só nesta transação e só pras linhas não-admin
    await tx.$queryRaw`SELECT set_config('metch.audit_erasure', 'on', true)`;
    await tx.$executeRaw`DELETE FROM audit_log WHERE user_id = ${userId}::uuid AND action NOT LIKE 'admin.%'`;
    await tx.$queryRaw`SELECT set_config('metch.audit_erasure', 'off', true)`;

    // h) conta limpa (a linha fica pras FKs de denúncias, moderação e fiscal)
    await tx.user.update({ where: { id: userId }, data: tombstoneData(now, u.deleted_at) });

    // i) pedido concluído, com a marca do número (6 meses, pra casar ordem judicial com os access_logs)
    await tx.dataDeletionRequest.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        completedAt: now,
        holdReason: null,
        lastError: null,
        phoneHash: hash,
      },
    });
    // selfie de verificação também sai no kick (sem esperar o cron)
    return {
      outcome: 'completed',
      phone: u.phone,
      media: selfieManaged ? [...media, selfieManaged] : media,
    };
  }

  /** sem o MediaGcService (testes): mesmas regras do releaseUser (inclusive a da retida), sem o kick */
  private async releasePhotosInTx(tx: Tx, userId: string): Promise<string[]> {
    await deleteUserPhotos(tx, userId);
    // só upload fresco: não encurta a retenção de 180 dias que o gatilho deu às fotos 'urgent'
    await tx.$executeRaw`
      UPDATE media_objects SET delete_after = now()
       WHERE owner_id = ${userId}::uuid AND attached_at IS NULL
         AND delete_after = created_at + make_interval(hours => ${UPLOAD_ORPHAN_TTL_H}::int)`;
    return [];
  }

  /**
   * Conta NÃO banida: o número inteiro que saiu dela (phone_releases.user_id) vira hash por 6 meses (ordem judicial com
   * os access_logs) e o IP/porta/app do pedido que ELA fez (new_user_id) sai se já passou dos 6 meses; o resto dos 6
   * meses a retenção diária termina (phoneReleaseMetaExpirySql).
   */
  private async anonymizePhoneReleases(tx: Tx, userId: string, now: Date): Promise<void> {
    const rows = await tx.$queryRaw<{ id: bigint; phone: string }[]>`
      SELECT id, phone FROM phone_releases WHERE user_id = ${userId}::uuid AND phone IS NOT NULL`;
    for (const r of rows) {
      await tx.$executeRaw`
        UPDATE phone_releases SET phone = NULL, phone_hash = ${phoneHash(r.phone)} WHERE id = ${r.id}`;
    }
    const cut = new Date(now);
    cut.setMonth(cut.getMonth() - ACCESS_LOG_RETENTION_MONTHS);
    await tx.$executeRaw(phoneReleaseMetaExpirySql(cut, userId));
  }

  /** depois do commit: Redis (presença, casa aprendida, âncoras, caches) e o estado da conta em todos os processos */
  private async afterPurge(userId: string, phone: string | null, media: string[]): Promise<void> {
    this.mediaGc?.kick(media);
    try {
      await purgeUserKeys(this.redis.client, userId, phone);
    } catch (e) {
      this.log.warn(`limpeza do Redis de ${userId} falhou: ${(e as Error).message}`);
    }
    await this.accounts.invalidate(userId);
    await this.redis.invalidateProfile(userId).catch(() => undefined);
    this.log.log(`conta limpa (${userId})`);
  }

  private async recordFailure(requestId: string, e: Error): Promise<void> {
    const msg = (e.message || String(e)).replace(/\s+/g, ' ').slice(0, 255);
    this.log.warn(`limpeza do pedido ${requestId} falhou: ${msg}`);
    try {
      const r = await this.prisma.dataDeletionRequest.update({
        where: { id: requestId },
        data: { attempts: { increment: 1 }, lastError: msg },
        select: { attempts: true },
      });
      if (r.attempts === ALERT_AFTER_ATTEMPTS) Sentry.captureException(e);
    } catch {
      /* pedido sumiu no meio: nada a registrar */
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Retenção diária do que ficou de contas limpas
  // ---------------------------------------------------------------------------------------------

  async retention(now = new Date()): Promise<{
    conversations: number;
    supportThreads: number;
    phoneHashes: number;
    releaseHashes: number;
    releaseMeta: number;
    releaseLinks: number;
    subscriptions: number;
    boosts: number;
  }> {
    const cfg = privacyConfig();
    const conversations = await this.expireEvidenceConversations(now, cfg.evidenceDays);
    const supportThreads = await this.expireUrgentSupport(now, cfg.evidenceDays);

    const hashCut = new Date(now);
    hashCut.setMonth(hashCut.getMonth() - PHONE_HASH_RETENTION_MONTHS);
    const phoneHashes = await this.prisma.$executeRaw`
      UPDATE data_deletion_requests SET phone_hash = NULL
       WHERE phone_hash IS NOT NULL AND completed_at < ${utcSql(hashCut)}`;
    // número reciclado de conta limpa não banida: hash do número antigo (6 meses) e IP/porta/app do pedido dela
    const releaseHashes = await this.prisma.$executeRaw(phoneReleaseHashExpirySql(hashCut));
    const logCut = new Date(now);
    logCut.setMonth(logCut.getMonth() - ACCESS_LOG_RETENTION_MONTHS);
    const releaseMeta = await this.prisma.$executeRaw(phoneReleaseMetaExpirySql(logCut));
    // número que veio PRA conta limpa não banida: o vínculo com ela sai 6 meses depois da limpeza
    const releaseLinks = await this.prisma.$executeRaw(phoneReleaseUnlinkSql(hashCut));

    const payCut = new Date(now);
    payCut.setFullYear(payCut.getFullYear() - cfg.paymentYears);
    const subscriptions = await this.prisma.$executeRaw`
      DELETE FROM subscriptions s USING users u
       WHERE u.id = s.user_id AND u.purged_at IS NOT NULL AND s.expires_at < ${utcSql(payCut)}`;
    const boosts = await this.prisma.$executeRaw`
      DELETE FROM boosts b USING users u
       WHERE u.id = b.user_id AND u.purged_at IS NOT NULL AND b.expires_at < ${utcSql(payCut)}`;

    const out = {
      conversations,
      supportThreads,
      phoneHashes,
      releaseHashes,
      releaseMeta,
      releaseLinks,
      subscriptions,
      boosts,
    };
    if (Object.values(out).some((n) => n > 0))
      this.log.log(`retenção de contas limpas: ${JSON.stringify(out)}`);
    return out;
  }

  /** denúncias que envolvem estas pessoas (feitas por elas ou contra elas) */
  private async reportsInvolving(ids: string[]) {
    if (!ids.length) return [];
    return this.prisma.report.findMany({
      where: { OR: [{ reportedId: { in: ids } }, { reporterId: { in: ids } }] },
      select: {
        reportedId: true,
        reporterId: true,
        reason: true,
        status: true,
        reviewedAt: true,
        createdAt: true,
        context: true,
      },
    });
  }

  /**
   * conversa de prova de conta limpa: sai quando nenhuma denúncia que a cita segura mais (evidenceExpired). Página por
   * id até acabar: o que fica (denúncia aberta, prazo correndo) não trava as páginas seguintes
   */
  private async expireEvidenceConversations(now: Date, days: number): Promise<number> {
    let removed = 0;
    for (let after = FIRST_UUID; ; ) {
      const convs = await this.prisma.$queryRaw<
        { id: string; user_low_id: string; user_high_id: string }[]
      >(evidenceConversationsPageSql(after));
      if (!convs.length) break;
      removed += await this.expireEvidencePage(convs, now, days);
      if (convs.length < RETENTION_PAGE) break;
      after = convs[convs.length - 1].id;
    }
    return removed;
  }

  private async expireEvidencePage(
    convs: { id: string; user_low_id: string; user_high_id: string }[],
    now: Date,
    days: number,
  ): Promise<number> {
    const people = [...new Set(convs.flatMap((c) => [c.user_low_id, c.user_high_id]))];
    const reports = await this.reportsInvolving(people);
    const citing = new Map<string, CitingReport[]>();
    for (const r of reports) {
      for (const id of contextConversationIds(r.context)) {
        const list = citing.get(id) ?? [];
        list.push(r);
        citing.set(id, list);
      }
    }
    const expired = convs
      .filter((c) => evidenceExpired(citing.get(c.id.toLowerCase()) ?? [], now, days))
      .map((c) => c.id);
    if (!expired.length) return 0;
    const r = await this.prisma.conversation.deleteMany({ where: { id: { in: expired } } });
    return r.count;
  }

  /** atendimento urgente de conta limpa: mesma régua, com todas as denúncias que envolvem a pessoa; página por id */
  private async expireUrgentSupport(now: Date, days: number): Promise<number> {
    let removed = 0;
    for (let after = FIRST_UUID; ; ) {
      const threads = await this.prisma.$queryRaw<
        { id: string; user_id: string; last_message_at: Date }[]
      >(urgentSupportPageSql(after, now, days));
      if (!threads.length) break;
      removed += await this.expireSupportPage(threads, now, days);
      if (threads.length < RETENTION_PAGE) break;
      after = threads[threads.length - 1].id;
    }
    return removed;
  }

  private async expireSupportPage(
    threads: { id: string; user_id: string; last_message_at: Date }[],
    now: Date,
    days: number,
  ): Promise<number> {
    const reports = await this.reportsInvolving([...new Set(threads.map((t) => t.user_id))]);
    const expired = threads
      .filter((t) =>
        supportThreadExpired(
          t.last_message_at,
          reports.filter((r) => r.reportedId === t.user_id || r.reporterId === t.user_id),
          now,
          days,
        ),
      )
      .map((t) => t.id);
    if (!expired.length) return 0;
    const r = await this.prisma.supportThread.deleteMany({ where: { id: { in: expired } } });
    return r.count;
  }
}
