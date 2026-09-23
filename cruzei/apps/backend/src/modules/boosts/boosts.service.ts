import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { v4 as uuid } from 'uuid';

const PRICE_CENTS_PER_HOUR = 990;

@Injectable()
export class BoostsService {
  constructor(private readonly prisma: PrismaService) {}

  async purchase(
    userId: string,
    durationHours: number,
    lat: number,
    lng: number,
    platform: 'ios' | 'android',
  ) {
    if (durationHours < 1 || durationHours > 24) {
      throw new BadRequestException('durationHours deve ser 1..24');
    }

    // bloqueia boost ativo
    const active = await this.prisma.boost.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
    });
    if (active) {
      throw new BadRequestException('Você já tem um boost ativo');
    }

    const expiresAt = new Date(Date.now() + durationHours * 3_600_000);
    const boost = await this.prisma.boost.create({
      data: {
        id: uuid(),
        userId,
        durationHours,
        expiresAt,
        latitude: lat,
        longitude: lng,
        amountCents: durationHours * PRICE_CENTS_PER_HOUR,
        platform,
      } as never,
    });

    return {
      id: boost.id,
      expiresAt: expiresAt.toISOString(),
      visibilityRadiusMeters: 5000,
    };
  }

  async getActive(userId: string) {
    const boost = await this.prisma.boost.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
    });
    if (!boost) return null;
    const minutesRemaining = Math.max(
      0,
      Math.ceil((boost.expiresAt.getTime() - Date.now()) / 60_000),
    );
    return {
      id: boost.id,
      startedAt: boost.startedAt.toISOString(),
      expiresAt: boost.expiresAt.toISOString(),
      minutesRemaining,
    };
  }
}
