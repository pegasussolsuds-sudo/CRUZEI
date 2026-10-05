// Regras PURAS da limpeza definitiva da conta ("conta limpa"): a linha de users fica sem dado pessoal (as FKs das
// denúncias, da moderação e do fiscal apontam pra ela); o que é prova fica o tempo da lei. Sem Prisma nem Redis aqui.
import type { AccountStatus } from '@cruzei/shared-types';
import { Prisma } from '@prisma/client';

import { contextConversationIds } from '../reports/report-context';

/** denúncia em análise: segura a limpeza (a prova não some antes da decisão) */
export const OPEN_REPORT_STATUSES = ['pending', 'reviewing'] as const;

/** motivos que nunca saem sozinhos (comunicação às autoridades; padroes-seguranca-infantil) */
export const LEGAL_KEEP_REASONS = ['child_safety', 'underage'] as const;

/**
 * Colunas de users na conta limpa. Satisfaz users_purged_clean_chk (telefone, e-mail, senha, bio, @, orientação,
 * consentimento, avatar e selfie nulos), users_orientation_flags_chk (sem orientação → flags false) e
 * users_age_range_chk (18–99). O resto vira valor neutro; placeholders só aparecem se alguma consulta nova esquecer o
 * filtro deleted_at IS NULL.
 */
export function tombstoneData(now: Date, deletedAt: Date | null): Prisma.UserUpdateInput {
  return {
    phone: null,
    email: null,
    passwordHash: null,
    bio: null,
    instagramHandle: null,
    orientation: null,
    orientationConsentedAt: null,
    showOrientation: false,
    sameOrientationFirst: false,
    avatarConfig: Prisma.DbNull,
    verificationSelfieUrl: null,
    verifiedAt: null,
    isVerified: false,
    name: 'Conta excluída',
    birthDate: new Date('1900-01-01T00:00:00.000Z'),
    gender: 'other',
    showMe: 'everyone',
    ageMin: 18,
    ageMax: 99,
    lookingFor: 'unspecified',
    premiumTier: 'free',
    premiumExpiresAt: null,
    visibilityMode: 'visible',
    anonymousUntil: null,
    trialUsedAt: null,
    isPaused: true,
    pausedUntil: null,
    discoveryMode: 'nobody',
    showDistance: false,
    showAge: false,
    showPhotoOnMap: false,
    profileCompleteness: 0,
    dataRetentionUntil: null,
    lastActiveAt: deletedAt ?? now,
    sessionsValidAfter: now,
    // deleted_at continua (o CHECK exige): a conta nunca "volta"
    deletedAt: deletedAt ?? now,
    purgedAt: now,
  };
}

/**
 * Guarda o mínimo de conta banida (número em phone_releases + nota na moderação)? Banida/suspensa (o cadastro novo com
 * o número nasce em revisão) ou em revisão sem denúncia que passou do teto (fica o número, sem segurar o próximo dono).
 */
export function keepPhoneOnPurge(
  status: AccountStatus | string,
  reviewHoldAt: Date | null = null,
): boolean {
  return status === 'banned' || status === 'suspended' || !!reviewHoldAt;
}

export type HoldReason = 'open_reports' | 'review_hold';

/** revisão SEM denúncia em análise segura a limpeza no máximo até este tanto depois do fim do prazo */
export const REVIEW_HOLD_MAX_DAYS = 30;

/** teto da revisão sem denúncia: fim do prazo de arrependimento (pedido + graceDays) + REVIEW_HOLD_MAX_DAYS */
export function reviewHoldDeadline(requestedAt: Date, graceDays: number): Date {
  return new Date(requestedAt.getTime() + (graceDays + REVIEW_HOLD_MAX_DAYS) * 86_400_000);
}

/** denúncia em análise contra a pessoa, do jeito que a regra da limpeza olha */
export interface OpenReportRef {
  reporterId: string | null;
  reason: string;
}

/**
 * Separa as denúncias em análise: `blocking` = feita por alguém (reporterId) ou de segurança infantil/menor
 * (LEGAL_KEEP_REASONS) — segura sem prazo; `automatic` = gerada pelo sistema (número reciclado de conta banida, GPS
 * falso, filtro de golpe: reporterId nulo) — segura só até o teto, como a revisão.
 */
export function splitOpenReports(reports: OpenReportRef[]): {
  blocking: number;
  automatic: number;
} {
  let blocking = 0;
  for (const r of reports) {
    if (r.reporterId || (LEGAL_KEEP_REASONS as readonly string[]).includes(r.reason)) blocking++;
  }
  return { blocking, automatic: reports.length - blocking };
}

/**
 * Por que a limpeza espera; null = pode limpar. Denúncia de alguém (ou de segurança infantil/menor) em análise segura
 * sem prazo (a decisão vem antes). Revisão sem denúncia (ex.: número reciclado de conta banida) ou denúncia automática
 * em análise (a do número reciclado nasce 'pending' e ninguém precisa decidir pra conta sair) seguram só até `deadline`:
 * depois limpa, guardando o mínimo (keepPhoneOnPurge com reviewHoldAt).
 */
export function holdReasonFor(
  blockingReportsAgainst: number,
  reviewHoldAt: Date | null,
  now: Date,
  deadline: Date,
  automaticReportsAgainst = 0,
): HoldReason | null {
  if (blockingReportsAgainst > 0) return 'open_reports';
  if ((reviewHoldAt || automaticReportsAgainst > 0) && now.getTime() < deadline.getTime())
    return 'review_hold';
  return null;
}

/** data como timestamptz no SQL cru (colunas TIMESTAMPTZ; independe do fuso da sessão) */
function tsz(d: Date): Prisma.Sql {
  return Prisma.sql`${d.toISOString()}::timestamptz`;
}

/**
 * Conta limpa NÃO banida: IP/porta/app do pedido de liberação que a PRÓPRIA pessoa fez (new_user_id = ela, sem admin)
 * saem quando passam dos 6 meses do Marco Civil (casam com os access_logs até lá). `userId` = só dela (na limpeza, antes
 * do purged_at); sem ele = todas as contas limpas não banidas (retenção diária).
 */
export function phoneReleaseMetaExpirySql(cutoff: Date, userId?: string): Prisma.Sql {
  const meta = Prisma.sql`(pr.ip IS NOT NULL OR pr.port IS NOT NULL OR pr.user_agent IS NOT NULL)`;
  if (userId) {
    return Prisma.sql`
      UPDATE phone_releases pr SET ip = NULL, port = NULL, user_agent = NULL
       WHERE pr.new_user_id = ${userId}::uuid AND pr.released_by IS NULL
         AND pr.created_at < ${tsz(cutoff)} AND ${meta}`;
  }
  return Prisma.sql`
    UPDATE phone_releases pr SET ip = NULL, port = NULL, user_agent = NULL
      FROM users u
     WHERE u.id = pr.new_user_id AND u.purged_at IS NOT NULL
       AND u.account_status = 'active' AND u.review_hold_at IS NULL
       AND pr.released_by IS NULL AND pr.created_at < ${tsz(cutoff)} AND ${meta}`;
}

/** hash do número antigo (phone_releases de conta limpa) sai PHONE_HASH_RETENTION_MONTHS depois da limpeza */
export function phoneReleaseHashExpirySql(purgedBefore: Date): Prisma.Sql {
  return Prisma.sql`
    UPDATE phone_releases pr SET phone_hash = NULL
      FROM users u
     WHERE u.id = pr.user_id AND pr.phone_hash IS NOT NULL AND u.purged_at < ${utcSql(purgedBefore)}`;
}

/**
 * Número que veio PRA uma conta limpa não banida (phone_releases.new_user_id = ela): passados PHONE_HASH_RETENTION_MONTHS
 * da limpeza, o vínculo sai (new_user_id NULL + new_user_unlinked_at). A linha continua sendo o histórico da conta
 * ANTIGA (o número inteiro fica se ela foi banida: evasão de banimento), mas não aponta mais pra pessoa que excluiu a
 * conta. O IP/porta/app do pedido dela (sem admin) sai junto, se ainda estiver lá. A marca impede que o cadastro
 * seguinte com o número pegue a linha de novo (PhoneReleaseService.pendingReleases).
 */
export function phoneReleaseUnlinkSql(purgedBefore: Date): Prisma.Sql {
  return Prisma.sql`
    UPDATE phone_releases pr
       SET new_user_id = NULL,
           new_user_unlinked_at = now(),
           ip = CASE WHEN pr.released_by IS NULL THEN NULL ELSE pr.ip END,
           port = CASE WHEN pr.released_by IS NULL THEN NULL ELSE pr.port END,
           user_agent = CASE WHEN pr.released_by IS NULL THEN NULL ELSE pr.user_agent END
      FROM users u
     WHERE u.id = pr.new_user_id AND u.purged_at < ${utcSql(purgedBefore)}
       AND u.account_status = 'active' AND u.review_hold_at IS NULL`;
}

/** motivos de LEGAL_KEEP_REASONS como lista SQL ('child_safety', 'underage') */
function legalKeepSql(): Prisma.Sql {
  return Prisma.join(LEGAL_KEEP_REASONS.map((r) => Prisma.sql`${r}`));
}

/** página da retenção (ordem por id, cursor exclusivo) */
export const RETENTION_PAGE = 1000;
/** cursor inicial (menor uuid) */
export const FIRST_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Conversas de conta limpa, uma página por id. Fora já no SQL o que nunca vence: citada (o id aparece no contexto) em
 * denúncia de segurança infantil/menor que envolve uma das duas pessoas — conservador: na dúvida, fica.
 */
export function evidenceConversationsPageSql(after: string, limit = RETENTION_PAGE): Prisma.Sql {
  return Prisma.sql`
    SELECT c.id::text AS id, c.user_low_id::text AS user_low_id, c.user_high_id::text AS user_high_id
      FROM conversations c
     WHERE c.id > ${after}::uuid
       AND EXISTS (SELECT 1 FROM users u WHERE u.id IN (c.user_low_id, c.user_high_id) AND u.purged_at IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM reports r
          WHERE r.reason IN (${legalKeepSql()})
            AND (r.reported_id IN (c.user_low_id, c.user_high_id) OR r.reporter_id IN (c.user_low_id, c.user_high_id))
            AND strpos(lower(r.context::text), c.id::text) > 0)
     ORDER BY c.id
     LIMIT ${limit}`;
}

/**
 * Atendimentos urgentes de conta limpa, uma página por id. Fora já no SQL o que ainda não pode vencer: última mensagem
 * há menos de `days` dias, ou pessoa envolvida em denúncia de segurança infantil/menor (nunca sai sozinho).
 */
export function urgentSupportPageSql(
  after: string,
  now: Date,
  days: number,
  limit = RETENTION_PAGE,
): Prisma.Sql {
  const cut = new Date(now.getTime() - days * 86_400_000);
  return Prisma.sql`
    SELECT t.id::text AS id, t.user_id::text AS user_id, t.last_message_at
      FROM support_threads t JOIN users u ON u.id = t.user_id
     WHERE u.purged_at IS NOT NULL
       AND t.id > ${after}::uuid
       AND t.last_message_at < ${tsz(cut)}
       AND NOT EXISTS (
         SELECT 1 FROM reports r
          WHERE r.reason IN (${legalKeepSql()}) AND (r.reported_id = t.user_id OR r.reporter_id = t.user_id))
     ORDER BY t.id
     LIMIT ${limit}`;
}

/**
 * Conversas da pessoa citadas em denúncias (feitas por ela ou contra ela): ficam guardadas, invisíveis pros dois, só pra
 * moderação. Usa a MESMA leitura da moderação (conversationId, matchId antigo e occurrences do filtro automático).
 */
export function evidenceConversationIds(
  reportContexts: unknown[],
  myConversationIds: Iterable<string>,
): Set<string> {
  const mine = new Set([...myConversationIds].map((id) => id.toLowerCase()));
  const out = new Set<string>();
  for (const ctx of reportContexts) {
    for (const id of contextConversationIds(ctx)) if (mine.has(id)) out.add(id);
  }
  return out;
}

export interface CitingReport {
  reason: string;
  status: string;
  reviewedAt: Date | null;
  createdAt: Date;
}

/**
 * Prova de conta limpa já pode sair? Nunca com denúncia em análise nem com motivo de segurança infantil; senão, depois
 * de `days` dias do fim da última denúncia que cita (reviewed_at; sem ele, a criação). Nada citando = sai.
 */
export function evidenceExpired(citing: CitingReport[], now: Date, days: number): boolean {
  if (citing.some((r) => (LEGAL_KEEP_REASONS as readonly string[]).includes(r.reason)))
    return false;
  if (citing.some((r) => (OPEN_REPORT_STATUSES as readonly string[]).includes(r.status)))
    return false;
  if (!citing.length) return true;
  const last = Math.max(...citing.map((r) => (r.reviewedAt ?? r.createdAt).getTime()));
  return last + days * 86_400_000 < now.getTime();
}

/**
 * Atendimento urgente (botão de emergência) de conta limpa: mesma régua da prova, contando também a última mensagem do
 * atendimento — as denúncias consideradas são todas as que envolvem a pessoa.
 */
export function supportThreadExpired(
  lastMessageAt: Date,
  reports: CitingReport[],
  now: Date,
  days: number,
): boolean {
  if (lastMessageAt.getTime() + days * 86_400_000 >= now.getTime()) return false;
  return evidenceExpired(reports, now, days);
}

/** install_id que substitui o da conta limpa: quebra o link() das métricas (a mesma instalação não religa) */
export function anonymizedInstallId(random: string): string {
  return `del:${random.replace(/[^a-f0-9]/gi, '').slice(0, 32)}`;
}

/** Date → "timestamp sem fuso em UTC" no SQL cru (colunas TIMESTAMP(6) guardam UTC; independe do fuso da sessão) */
export function utcSql(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}
