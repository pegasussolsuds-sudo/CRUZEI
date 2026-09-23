import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const PLANS = [
  { id: 'premium_monthly', tier: 'premium', interval: 'month', priceCents: 2990, currency: 'BRL', trialDays: 7 },
  { id: 'premium_quarterly', tier: 'premium', interval: 'quarter', priceCents: 7990, currency: 'BRL' },
  { id: 'premium_yearly', tier: 'premium', interval: 'year', priceCents: 19990, currency: 'BRL', savingsPercent: 44 },
  { id: 'premium_plus_monthly', tier: 'premium_plus', interval: 'month', priceCents: 4990, currency: 'BRL' },
];

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  listPlans() {
    return { plans: PLANS };
  }

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premiumTier: true, premiumExpiresAt: true },
    });
    const expiresAt = user?.premiumExpiresAt?.toISOString();
    const daysRemaining = expiresAt
      ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
      : 0;
    return {
      tier: user?.premiumTier ?? 'free',
      expiresAt,
      trialActive: false,
      autoRenew: false,
      daysRemaining,
    };
  }

  async subscribe(
    userId: string,
    planId: string,
    platform: 'ios' | 'android' | 'web',
    _receipt: string,
  ) {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new BadRequestException('Plano inválido');

    // Em produção: validar receipt via Apple/Google/Stripe.
    // Aqui aceitamos e marcamos como ativo por 30 dias.
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);

    await this.prisma.subscription.create({
      data: {
        userId,
        tier: plan.tier as never,
        platform,
        startsAt: new Date(),
        expiresAt,
      },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { premiumTier: plan.tier, premiumExpiresAt: expiresAt } as never,
    });

    return {
      subscriptionId: 'pending',
      tier: plan.tier,
      expiresAt: expiresAt.toISOString(),
      trialActive: Boolean(plan.trialDays),
    };
  }

  async cancel(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { premiumTier: 'free' } as never,
    });
    return { expiresAt: null, cancelledAt: new Date().toISOString() };
  }
}
