// Regras do plano num lugar só (decisão 8 do dono, 03/10/2026):
// - acesso SEMPRE pelo plano efetivo: assinatura vencida conta como 'free' mesmo antes da tarefa rebaixar no banco
// - invisível grátis: janela de ANON_FREE_HOURS guardada em users.anonymous_until; pode religar quando quiser (sem
//   intervalo de espera); PATCH repetido com a janela valendo NÃO estende. Premium vigente: invisível sem prazo
// Colunas de users/subscriptions são TIMESTAMP em UTC: SQL compara com (now() AT TIME ZONE 'UTC').
import { ANON_FREE_HOURS, type PremiumTier } from '@cruzei/shared-types';
import { Prisma } from '@prisma/client';

export { ANON_FREE_HOURS };
export const ANON_FREE_MS = ANON_FREE_HOURS * 3_600_000;

/** Premium vigente: tier pago e (sem vencimento ou vencendo no futuro) — mesma regra do /me e do allowedTiersFor */
export function effectiveTier(
  tier: PremiumTier,
  expiresAt: Date | null,
  now = new Date(),
): PremiumTier {
  if (tier !== 'premium' && tier !== 'premium_plus') return 'free';
  return expiresAt === null || expiresAt > now ? tier : 'free';
}

/** campos do plano como vêm do banco */
export interface PremiumFields {
  premiumTier: string;
  premiumExpiresAt: Date | null;
}

/** Premium vigente (premium ou premium_plus, sem vencimento ou no futuro): a fonte única da regra */
export function isPremiumActive(
  u: PremiumFields | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!u || (u.premiumTier !== 'premium' && u.premiumTier !== 'premium_plus')) return false;
  return u.premiumExpiresAt == null || u.premiumExpiresAt > now;
}

/** "agora" das colunas TIMESTAMP (sem fuso, gravadas em UTC) */
export const NOW_UTC_SQL = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** Premium vigente em SQL, na tabela users com apelido `u` */
export const PREMIUM_ACTIVE_U_SQL = Prisma.sql`(u.premium_tier <> 'free' AND (u.premium_expires_at IS NULL OR u.premium_expires_at > (now() AT TIME ZONE 'UTC')))`;

/**
 * Ligar o invisível: o que gravar em anonymous_until.
 * - unlimited: Premium vigente → sem prazo (null)
 * - keep: já está invisível com a janela valendo → mesmo prazo (PATCH repetido não estende)
 * - new: estava visível (ou a janela já passou) → janela nova de 24 h a partir de agora (religa quando quiser)
 */
export type AnonDecision =
  | { kind: 'unlimited'; until: null }
  | { kind: 'keep'; until: Date }
  | { kind: 'new'; until: Date };

export function decideAnonymous(
  s: { premium: boolean; visibilityMode: string; anonymousUntil: Date | null },
  now: Date = new Date(),
): AnonDecision {
  if (s.premium) return { kind: 'unlimited', until: null };
  if (s.visibilityMode === 'anonymous' && s.anonymousUntil && s.anonymousUntil > now) {
    return { kind: 'keep', until: s.anonymousUntil };
  }
  return { kind: 'new', until: new Date(now.getTime() + ANON_FREE_MS) };
}

/** prazo que o /me mostra: só invisível sem Premium vigente com janela no futuro; senão null */
export function visibleAnonymousUntil(
  u: PremiumFields & { visibilityMode: string; anonymousUntil: Date | null },
  now: Date = new Date(),
): Date | null {
  if (u.visibilityMode !== 'anonymous' || isPremiumActive(u, now)) return null;
  return u.anonymousUntil && u.anonymousUntil > now ? u.anonymousUntil : null;
}

/**
 * O que o /me faz com o invisível grátis na leitura (a mesma regra da tarefa periódica, pelo tier GRAVADO no banco:
 * Premium vencido e ainda não rebaixado espera o rebaixamento, que é quem dá a janela de 24 h — ninguém aparece de
 * surpresa):
 * - expire: janela vencida → volta ao visível
 * - open: invisível grátis sem janela gravada (caminho antigo) → ganha a janela a partir de agora
 */
export function anonymousWindowAction(
  u: { premiumTier: string; visibilityMode: string; anonymousUntil: Date | null },
  now: Date = new Date(),
): 'none' | 'expire' | 'open' {
  if (u.visibilityMode !== 'anonymous' || u.premiumTier !== 'free') return 'none';
  if (!u.anonymousUntil) return 'open';
  return u.anonymousUntil <= now ? 'expire' : 'none';
}
