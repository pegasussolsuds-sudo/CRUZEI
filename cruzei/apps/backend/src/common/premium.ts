import type { PremiumTier } from '@cruzei/shared-types';

/** Premium vigente: tier pago e (sem vencimento ou vencendo no futuro) — mesma regra do /me e do allowedTiersFor */
export function effectiveTier(
  tier: PremiumTier,
  expiresAt: Date | null,
  now = new Date(),
): PremiumTier {
  if (tier === 'free') return 'free';
  return expiresAt === null || expiresAt > now ? tier : 'free';
}
