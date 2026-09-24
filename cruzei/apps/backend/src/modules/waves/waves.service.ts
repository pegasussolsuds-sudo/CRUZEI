import { BadRequestException, Injectable } from '@nestjs/common';
import { distanceMeters } from '@cruzei/shared-utils';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { avatarOrFallback } from '../../common/avatar';

const WAVE_TTL_SECONDS = 86_400; // 1 aceno por par a cada 24h
const WAVE_MAX_DISTANCE_M = 5000; // só dá pra acenar pra quem está por perto (distância REAL, nunca exposta)

// Aceno: um "oi" leve, sem persistência — dedupe no Redis + evento em tempo real pro alvo.
@Injectable()
export class WavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ChatGateway,
  ) {}

  async wave(fromId: string, toId: string) {
    if (fromId === toId) throw new BadRequestException('Não dá pra acenar pra você mesmo');

    // resposta idêntica a um aceno normal em todos os casos "não pode" → não vaza se a pessoa existe,
    // bloqueou, está anônima/pausada ou longe. Nada é emitido nem gravado.
    const silent = { ok: true, duplicate: false };

    const [target, blocked, [mine, theirs]] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: toId },
        select: { id: true, deletedAt: true, isPaused: true, visibilityMode: true },
      }),
      this.prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: fromId, blockedId: toId },
            { blockerId: toId, blockedId: fromId },
          ],
        },
        select: { id: true },
      }),
      Promise.all([this.redis.client.hgetall(`user:loc:${fromId}`), this.redis.client.hgetall(`user:loc:${toId}`)]),
    ]);
    if (!target || target.deletedAt || target.isPaused || target.visibilityMode === 'anonymous' || blocked) {
      return silent;
    }

    // os dois precisam ter presença ativa e estar a <= 5 km um do outro
    if (!mine?.lat || !mine?.lng || !theirs?.lat || !theirs?.lng) return silent;
    const dist = distanceMeters(Number(mine.lat), Number(mine.lng), Number(theirs.lat), Number(theirs.lng));
    if (!Number.isFinite(dist) || dist > WAVE_MAX_DISTANCE_M) return silent;

    // NX: só o primeiro aceno do par entra na janela de 24h
    const created = await this.redis.client.set(`wave:${fromId}:${toId}`, '1', 'EX', WAVE_TTL_SECONDS, 'NX');
    if (created !== 'OK') return { ok: true, duplicate: true };

    const me = await this.prisma.user.findUnique({
      where: { id: fromId },
      select: { id: true, name: true, gender: true, avatarConfig: true },
    });
    this.gateway.emitToUser(toId, 'wave_received', {
      fromUserId: fromId,
      name: me?.name ?? '',
      avatar: me ? avatarOrFallback(me) : null,
      at: new Date().toISOString(),
    });

    return { ok: true, duplicate: false };
  }
}
