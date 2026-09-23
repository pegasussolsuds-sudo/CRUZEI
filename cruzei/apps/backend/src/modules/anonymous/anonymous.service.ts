import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const ANON_LIMIT_FREE_HOURS = 24;

@Injectable()
export class AnonymousService {
  constructor(private readonly prisma: PrismaService) {}

  async enable(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premiumTier: true },
    });
    const isPremium = user?.premiumTier === 'premium' || user?.premiumTier === 'premium_plus';

    const expiresAt = isPremium
      ? null // ilimitado
      : new Date(Date.now() + ANON_LIMIT_FREE_HOURS * 3_600_000);

    await this.prisma.user.update({
      where: { id: userId },
      data: { visibilityMode: 'anonymous' } as never,
    });

    return { visibilityMode: 'anonymous', expiresAt: expiresAt?.toISOString() ?? null };
  }

  async disable(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { visibilityMode: 'visible' } as never,
    });
    return { visibilityMode: 'visible' };
  }

  async getLimits(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premiumTier: true, visibilityMode: true },
    });
    const isPremium = user?.premiumTier === 'premium' || user?.premiumTier === 'premium_plus';
    return {
      unlimited: isPremium,
      isActive: user?.visibilityMode === 'anonymous',
    };
  }
}
