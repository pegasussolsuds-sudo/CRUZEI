import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';

/** dias por intervalo do plano */
const INTERVAL_DAYS: Record<string, number> = { month: 30, quarter: 90, year: 365 };

const PLANS = [
  { id: 'premium_monthly', tier: 'premium', interval: 'month', priceCents: 2990, currency: 'BRL', trialDays: 7 },
  { id: 'premium_quarterly', tier: 'premium', interval: 'quarter', priceCents: 7990, currency: 'BRL' },
  { id: 'premium_yearly', tier: 'premium', interval: 'year', priceCents: 19990, currency: 'BRL', savingsPercent: 44 },
  { id: 'premium_plus_monthly', tier: 'premium_plus', interval: 'month', priceCents: 4990, currency: 'BRL' },
];

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
  ) {}

  listPlans() {
    return { plans: PLANS };
  }

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premiumTier: true, premiumExpiresAt: true },
    });
    // vencida → free de verdade (senão o paywall mostra "Premium · 0 dias" sem como renovar)
    const expired = Boolean(user && user.premiumTier !== 'free' && user.premiumExpiresAt && user.premiumExpiresAt <= new Date());
    if (expired) {
      await this.prisma.user.update({ where: { id: userId }, data: { premiumTier: 'free' } as never });
      await this.users.downgradeAvatarToFree(userId);
      await this.redis.invalidateProfile(userId);
    }
    const tier = expired ? 'free' : (user?.premiumTier ?? 'free');
    const expiresAt = tier === 'free' ? undefined : user?.premiumExpiresAt?.toISOString();
    const daysRemaining = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)) : 0;
    const latest =
      tier === 'free'
        ? null
        : await this.prisma.subscription.findFirst({ where: { userId }, orderBy: { expiresAt: 'desc' }, select: { productId: true, startsAt: true, cancelledAt: true } });
    const plan = latest?.productId ? PLANS.find((p) => p.id === latest.productId) : undefined;
    const trialActive = Boolean(latest && plan?.trialDays && Date.now() < latest.startsAt.getTime() + plan.trialDays * 86_400_000);
    return {
      tier,
      expiresAt,
      trialActive,
      autoRenew: Boolean(latest && !latest.cancelledAt),
      cancelledAt: latest?.cancelledAt?.toISOString() ?? null,
      daysRemaining,
    };
  }

  async subscribe(
    userId: string,
    planId: string,
    platform: 'ios' | 'android' | 'web',
    receipt: string,
  ) {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new BadRequestException('Plano inválido');

    // Recibo: a validação de verdade (App Store Server API / Google Play Developer API) ainda não existe.
    // O recibo "dev" só vale fora de produção (ou com ALLOW_DEV_RECEIPTS=true); qualquer outro é recusado com 402.
    const devOk = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_RECEIPTS === 'true';
    if (!(receipt === 'dev' && devOk)) throw new HttpException('Recibo inválido ou validação indisponível', 402);

    // já assinante: não cria uma 2ª linha nem rebaixa o vencimento — devolve o estado atual
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { premiumTier: true, premiumExpiresAt: true } });
    if (current && current.premiumTier !== 'free' && current.premiumExpiresAt && current.premiumExpiresAt > new Date()) {
      throw new BadRequestException('Você já tem uma assinatura ativa');
    }

    // duração = intervalo do plano + dias de teste (não 30 dias fixos)
    const trialDays = plan.trialDays ?? 0;
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + ((INTERVAL_DAYS[plan.interval] ?? 30) + trialDays) * 86_400_000);

    await this.prisma.subscription.create({
      data: {
        userId,
        tier: plan.tier as never,
        platform,
        productId: plan.id,
        startsAt,
        expiresAt,
      },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { premiumTier: plan.tier, premiumExpiresAt: expiresAt } as never,
    });
    await this.redis.invalidateProfile(userId); // premiumTier mudou → /me em cache está velho

    return {
      subscriptionId: 'pending',
      tier: plan.tier,
      expiresAt: expiresAt.toISOString(),
      trialActive: Boolean(plan.trialDays),
    };
  }

  /** cancela a renovação: o acesso continua até o fim do período já pago (o cron/leitura rebaixa quando vencer) */
  async cancel(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { premiumTier: true, premiumExpiresAt: true } });
    if (!user || user.premiumTier === 'free') throw new BadRequestException('Você não tem assinatura ativa');
    const cancelledAt = new Date();
    const latest = await this.prisma.subscription.findFirst({ where: { userId, cancelledAt: null }, orderBy: { expiresAt: 'desc' }, select: { id: true } });
    if (latest) await this.prisma.subscription.update({ where: { id: latest.id }, data: { cancelledAt } });
    await this.redis.invalidateProfile(userId);
    return { expiresAt: user.premiumExpiresAt?.toISOString() ?? null, cancelledAt: cancelledAt.toISOString() };
  }
}
