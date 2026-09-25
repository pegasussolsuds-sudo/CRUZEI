import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { avatarOrFallback } from '../../common/avatar';
import { LocationService } from '../location/location.service';

const WAVE_TTL_SECONDS = 86_400; // 1 aceno por par a cada 24h

// Aceno: um "oi" leve, sem persistência — dedupe no Redis + evento em tempo real pro alvo.
@Injectable()
export class WavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ChatGateway,
    private readonly location: LocationService,
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

    // só dá pra acenar pra quem eu DESCUBRO agora (mesmas regras do /nearby: raio de 350 m, reciprocidade, área privada)
    if (!mine?.lat || !mine?.lng || !theirs?.lat || !theirs?.lng) return silent;
    const d = await this.location.discoverability(fromId, toId);
    if (!d.ok) return silent;

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
