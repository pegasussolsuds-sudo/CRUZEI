// Super curtida: limite por dia (grátis 1, Premium e Premium+ 7), pelo plano EFETIVO (assinatura vencida = grátis).
// O dia vira à meia-noite de São Paulo. O contador vive em super_like_uses (um por pessoa e dia): desfazer a curtida
// NÃO devolve o uso. O gasto é atômico (INSERT ... ON CONFLICT ... WHERE used < limite), então nem toque duplo nem
// requisições em paralelo passam do limite.
import {
  SUPER_LIKE_DAILY,
  SUPER_LIKE_TIMEZONE,
  type PremiumTier,
  type SuperLikeLimitError,
  type SuperLikeQuota,
} from '@cruzei/shared-types';
import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { effectiveTier } from '../../common/premium';

/** o que a cota precisa do banco: um $queryRaw (PrismaService ou a transação) */
export type QuotaDb = { $queryRaw: Prisma.TransactionClient['$queryRaw'] };

/** campos do plano como vêm do banco */
export interface QuotaPlan {
  premiumTier: string;
  premiumExpiresAt: Date | null;
}

const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: SUPER_LIKE_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** relógio de parede de São Paulo nesse instante */
function wallClock(now: Date) {
  const p: Record<string, number> = {};
  for (const part of FMT.formatToParts(now)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** dia de São Paulo ('YYYY-MM-DD') desse instante: a chave de super_like_uses */
export function superLikeDay(now: Date = new Date()): string {
  const w = wallClock(now);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** próxima meia-noite de São Paulo (quando a cota volta) */
export function superLikeResetsAt(now: Date = new Date()): Date {
  const w = wallClock(now);
  // diferença entre o relógio de parede (lido como UTC) e o instante = fuso de São Paulo nesse momento
  const wallMs = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  const offset = wallMs - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(w.y, w.m - 1, w.d + 1) - offset);
}

/** plano que vale pra cota (assinatura vencida = grátis) */
export function superLikeTier(
  u: QuotaPlan | null | undefined,
  now: Date = new Date(),
): PremiumTier {
  if (!u) return 'free';
  return effectiveTier(u.premiumTier as PremiumTier, u.premiumExpiresAt, now);
}

/** super curtidas por dia desse plano */
export function superLikeLimit(tier: PremiumTier): number {
  return SUPER_LIKE_DAILY[tier] ?? SUPER_LIKE_DAILY.free;
}

/** a cota do dia a partir do que já foi usado */
export function buildQuota(
  tier: PremiumTier,
  used: number,
  now: Date = new Date(),
): SuperLikeQuota {
  const limit = superLikeLimit(tier);
  return {
    tier,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt: superLikeResetsAt(now).toISOString(),
  };
}

/** 403 super_like_limit: no grátis o app convida pro Premium (canUpgrade) */
export function superLikeLimitError(tier: PremiumTier, now: Date = new Date()): ForbiddenException {
  const limit = superLikeLimit(tier);
  const canUpgrade = tier === 'free';
  const body: SuperLikeLimitError = {
    error: 'super_like_limit',
    message: canUpgrade
      ? `A super curtida de hoje já foi. No Premium são ${SUPER_LIKE_DAILY.premium} por dia ⭐`
      : `As ${limit} super curtidas de hoje já foram. Amanhã tem mais ⭐`,
    limit,
    resetsAt: superLikeResetsAt(now).toISOString(),
    canUpgrade,
  };
  return new ForbiddenException(body);
}

/** super curtidas já usadas nesse dia de São Paulo */
export async function superLikesUsed(db: QuotaDb, userId: string, day: string): Promise<number> {
  const rows = await db.$queryRaw<{ used: number }[]>`
    SELECT used FROM super_like_uses WHERE user_id = ${userId}::uuid AND day = ${day}::date`;
  return rows[0] ? Number(rows[0].used) : 0;
}

/**
 * Gasta UMA super curtida do dia, atômico: devolve quantas foram usadas depois deste gasto, ou null se o limite já
 * tinha acabado (nada gravado). Chamar dentro da transação da curtida: se a curtida não for gravada, o gasto volta junto.
 */
export async function spendSuperLike(
  db: QuotaDb,
  userId: string,
  day: string,
  limit: number,
): Promise<number | null> {
  if (limit < 1) return null;
  const rows = await db.$queryRaw<{ used: number }[]>`
    INSERT INTO super_like_uses (user_id, day, used) VALUES (${userId}::uuid, ${day}::date, 1)
    ON CONFLICT (user_id, day) DO UPDATE SET used = super_like_uses.used + 1
    WHERE super_like_uses.used < ${limit}
    RETURNING used`;
  return rows[0] ? Number(rows[0].used) : null;
}

/** a cota de hoje de uma pessoa (GET /likes/super/quota e as stats do /me) */
export async function readSuperLikeQuota(
  db: QuotaDb,
  userId: string,
  plan: QuotaPlan | null | undefined,
  now: Date = new Date(),
): Promise<SuperLikeQuota> {
  const used = await superLikesUsed(db, userId, superLikeDay(now));
  return buildQuota(superLikeTier(plan, now), used, now);
}
