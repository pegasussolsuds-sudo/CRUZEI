import type {
  PremiumPlan,
  PremiumPlansResponse,
  PremiumStatus,
  PremiumTier,
  SubscribeResult,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { phoneHash } from '../../common/phone-hash';
import { effectiveTier } from '../../common/premium';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

import { PremiumLifecycleService } from './premium-lifecycle.service';

/** dias por intervalo do plano */
const INTERVAL_DAYS: Record<string, number> = { month: 30, quarter: 90, year: 365 };
const DAY_MS = 86_400_000;

export const PLANS: readonly PremiumPlan[] = [
  {
    id: 'premium_monthly',
    tier: 'premium',
    interval: 'month',
    priceCents: 2990,
    currency: 'BRL',
    trialDays: 7,
  },
  {
    id: 'premium_quarterly',
    tier: 'premium',
    interval: 'quarter',
    priceCents: 7990,
    currency: 'BRL',
  },
  {
    id: 'premium_yearly',
    tier: 'premium',
    interval: 'year',
    priceCents: 19990,
    currency: 'BRL',
    savingsPercent: 44,
  },
  {
    id: 'premium_plus_monthly',
    tier: 'premium_plus',
    interval: 'month',
    priceCents: 4990,
    currency: 'BRL',
  },
];

/** o plano sem o teste grátis (quem já usou o seu não vê a promessa) */
export function withoutTrial(p: PremiumPlan): PremiumPlan {
  const { trialDays: _trial, ...rest } = p;
  return rest;
}

/**
 * Teste grátis (decisão 8b): UMA vez por conta (users.trial_used_at) E por número (trial_claims, HMAC do telefone —
 * sobrevive à exclusão/liberação da conta), permanente. A 1ª assinatura paga, de QUALQUER plano, consome os dois
 * (igual ao "só cliente novo" das lojas); Premium manual do painel não conta. Conta sem telefone não ganha teste.
 */
export function trialDaysFor(
  plan: PremiumPlan,
  s: { trialUsedAt: Date | null; phoneClaimed: boolean },
): number {
  if (!plan.trialDays || s.trialUsedAt || !s.phoneClaimed) return 0;
  return plan.trialDays;
}

@Injectable()
export class SubscriptionsService {
  private readonly log = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly lifecycle: PremiumLifecycleService,
  ) {}

  /** planos; quem não pode mais ganhar o teste recebe sem trialDays (a Paywall só promete o que vale) */
  async listPlans(userId: string): Promise<PremiumPlansResponse> {
    const eligible = await this.trialEligible(userId);
    return { plans: PLANS.map((p) => (eligible ? { ...p } : withoutTrial(p))) };
  }

  /** ainda pode ganhar o teste: a conta nunca assinou e o número nunca ganhou */
  async trialEligible(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trialUsedAt: true, phone: true },
    });
    if (!u || u.trialUsedAt || !u.phone) return false;
    const claim = await this.prisma.trialClaim.findUnique({
      where: { phoneHash: phoneHash(u.phone) },
      select: { phoneHash: true },
    });
    return !claim;
  }

  async getStatus(userId: string): Promise<PremiumStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premiumTier: true, premiumExpiresAt: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const now = new Date();
    // vencida e a tarefa ainda não passou: rebaixa agora pela MESMA rotina (aviso, janela do invisível, avatar)
    if (user.premiumTier !== 'free' && user.premiumExpiresAt && user.premiumExpiresAt <= now) {
      await this.lifecycle
        .downgradeOne(userId)
        .catch((e: Error) => this.log.warn(`rebaixar ${userId}: ${e.message}`));
    }
    const tier = effectiveTier(user.premiumTier, user.premiumExpiresAt, now);
    const expiresAt = tier === 'free' ? undefined : user.premiumExpiresAt?.toISOString();
    const daysRemaining = expiresAt
      ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS))
      : 0;
    const latest =
      tier === 'free'
        ? null
        : await this.prisma.subscription.findFirst({
            where: { userId },
            orderBy: { expiresAt: 'desc' },
            select: { cancelledAt: true, trialEndsAt: true },
          });
    // em teste = a assinatura vigente tem trial_ends_at no futuro (não deduz mais do plano: quem assinou de novo sem
    // teste não aparece "em teste")
    const trialEndsAt = latest?.trialEndsAt && latest.trialEndsAt > now ? latest.trialEndsAt : null;
    return {
      tier,
      expiresAt,
      daysRemaining,
      trialActive: trialEndsAt !== null,
      trialEndsAt: trialEndsAt?.toISOString() ?? null,
      trialEligible: await this.trialEligible(userId),
      autoRenew: Boolean(latest && !latest.cancelledAt),
      cancelledAt: latest?.cancelledAt?.toISOString() ?? null,
    };
  }

  async subscribe(
    userId: string,
    planId: string,
    platform: 'ios' | 'android' | 'web',
    receipt: string,
  ): Promise<SubscribeResult> {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new BadRequestException('Plano inválido');

    // Recibo: a validação de verdade (App Store Server API / Google Play Developer API) ainda não existe.
    // O recibo "dev" só vale fora de produção (ou com ALLOW_DEV_RECEIPTS=true); qualquer outro é recusado com 402.
    const devOk =
      process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_RECEIPTS === 'true';
    if (!(receipt === 'dev' && devOk))
      throw new HttpException('Recibo inválido ou validação indisponível', 402);

    const out = await this.prisma.$transaction(async (tx) => {
      // trava a linha: duas compras ao mesmo tempo não viram duas assinaturas nem dois testes
      const [u] = await tx.$queryRaw<
        {
          premium_tier: PremiumTier;
          premium_expires_at: Date | null;
          trial_used_at: Date | null;
          phone: string | null;
          deleted_at: Date | null;
        }[]
      >`
        SELECT premium_tier::text AS premium_tier, premium_expires_at, trial_used_at, phone, deleted_at
          FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (!u || u.deleted_at) throw new NotFoundException('Usuário não encontrado');
      const now = new Date();
      // já assinante (plano EFETIVO): não cria uma 2ª linha nem rebaixa o vencimento
      if (effectiveTier(u.premium_tier, u.premium_expires_at, now) !== 'free') {
        throw new BadRequestException('Você já tem uma assinatura ativa');
      }

      // 1ª assinatura paga consome o teste do número (mesmo num plano sem teste); o INSERT que ganha é o que vale
      let phoneClaimed = false;
      if (u.phone) {
        const ins = await tx.$queryRaw<{ phone_hash: string }[]>`
          INSERT INTO trial_claims (phone_hash, user_id) VALUES (${phoneHash(u.phone)}, ${userId}::uuid)
          ON CONFLICT (phone_hash) DO NOTHING
          RETURNING phone_hash`;
        phoneClaimed = ins.length > 0;
      }
      const trialDays = trialDaysFor(plan, { trialUsedAt: u.trial_used_at, phoneClaimed });

      // duração = intervalo do plano + dias de teste (não 30 dias fixos)
      const startsAt = now;
      const expiresAt = new Date(
        startsAt.getTime() + ((INTERVAL_DAYS[plan.interval] ?? 30) + trialDays) * DAY_MS,
      );
      const sub = await tx.subscription.create({
        data: {
          userId,
          tier: plan.tier,
          platform,
          productId: plan.id,
          startsAt,
          expiresAt,
          trialEndsAt: trialDays ? new Date(startsAt.getTime() + trialDays * DAY_MS) : null,
        },
        select: { id: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          premiumTier: plan.tier,
          premiumExpiresAt: expiresAt,
          // Premium: invisível sem prazo (a janela grátis volta se o plano vencer invisível)
          anonymousUntil: null,
          trialUsedAt: u.trial_used_at ?? startsAt,
        },
      });
      return { id: sub.id, expiresAt, trialDays };
    });
    await this.redis.invalidateProfile(userId); // premiumTier mudou → /me em cache está velho

    return {
      subscriptionId: out.id,
      tier: plan.tier,
      expiresAt: out.expiresAt.toISOString(),
      trialActive: out.trialDays > 0,
    };
  }

  /** cancela a renovação: o acesso continua até o fim do período já pago (a tarefa rebaixa quando vencer) */
  async cancel(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premiumTier: true, premiumExpiresAt: true },
    });
    if (!user || effectiveTier(user.premiumTier, user.premiumExpiresAt) === 'free') {
      throw new BadRequestException('Você não tem assinatura ativa');
    }
    const cancelledAt = new Date();
    const latest = await this.prisma.subscription.findFirst({
      where: { userId, cancelledAt: null },
      orderBy: { expiresAt: 'desc' },
      select: { id: true },
    });
    if (latest)
      await this.prisma.subscription.update({ where: { id: latest.id }, data: { cancelledAt } });
    await this.redis.invalidateProfile(userId);
    return {
      expiresAt: user.premiumExpiresAt?.toISOString() ?? null,
      cancelledAt: cancelledAt.toISOString(),
    };
  }
}
