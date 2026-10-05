import type { LocationHistoryForgetResponse } from '@cruzei/shared-types';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

import { privacyConfig } from './privacy-config';
import { forgetLocationKeys, markLocationForget } from './user-redis';

export const FORGET_LIMIT = {
  error: 'too_many_requests',
  message: 'Você já apagou o histórico várias vezes hoje. Tenta de novo amanhã.',
} as const;

/**
 * "Apagar histórico de localização": posições (tabela locations e a fila do gravador), check-ins, votos "estou aqui", a
 * posição dos Boosts vencidos, a posição atual no mapa (volta na próxima atualização do app) e as âncoras do
 * anti-GPS-falso; com learnedHome, também a residência aprendida. Fica: o sinal de multidão (anônimo, sem id) e, com
 * alerta de GPS falso ativo, as âncoras até ele passar.
 */
@Injectable()
export class LocationHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async forget(
    userId: string,
    opts: { learnedHome: boolean },
    now = new Date(),
  ): Promise<LocationHistoryForgetResponse> {
    const { forgetDaily } = privacyConfig();
    const n = await this.redis.incrRate(userId, 'loc-forget', 86_400);
    if (n > forgetDaily) {
      const ttl = await this.redis.client.ttl(`rate:${userId}:loc-forget`).catch(() => -1);
      throw new HttpException(
        { ...FORGET_LIMIT, retryAfter: ttl > 0 ? ttl : 86_400 },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // corte ANTES do banco: o que ainda está na fila do gravador em lote não volta depois do DELETE
    await markLocationForget(this.redis.client, userId, now.getTime());
    const [positions, checkins, placeVotes] = await this.prisma.$transaction(async (tx) => {
      const pos = await tx.location.deleteMany({ where: { userId } });
      const chk = await tx.poisCheckin.deleteMany({ where: { userId } });
      const votes = await tx.$executeRaw`
        DELETE FROM place_votes WHERE user_id = ${userId}::uuid AND kind = 'onsite'`;
      // Boost vencido não precisa mais da posição (o ativo ainda usa pra aparecer no raio)
      await tx.boost.updateMany({
        where: {
          userId,
          expiresAt: { lt: now },
          OR: [{ latitude: { not: null } }, { longitude: { not: null } }],
        },
        data: { latitude: null, longitude: null },
      });
      return [pos.count, chk.count, votes];
    });
    await forgetLocationKeys(this.redis.client, userId, { learnedHome: opts.learnedHome });
    return { positions, checkins, placeVotes, learnedHome: opts.learnedHome };
  }
}
