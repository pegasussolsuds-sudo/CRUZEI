import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ChatGateway } from '../../realtime/chat.gateway';

@Injectable()
export class BlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ChatGateway,
  ) {}

  async block(blockerId: string, blockedId: string, reason?: string) {
    if (blockerId === blockedId) throw new BadRequestException('Não pode bloquear você mesmo');
    const exists = await this.prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Usuário não encontrado');
    const b = await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      update: { reason: reason?.slice(0, 255) },
      create: { blockerId, blockedId, reason: reason?.slice(0, 255) },
    });
    // bloqueou → o match entre os dois (ativo ou vencido) fecha na hora: sai da lista, do chat e da sala do socket
    const match = await this.prisma.match.findFirst({
      where: {
        status: { in: ['active', 'expired'] },
        OR: [
          { userAId: blockerId, userBId: blockedId },
          { userAId: blockedId, userBId: blockerId },
        ],
      },
      select: { id: true },
    });
    if (match) {
      await this.prisma.match.update({ where: { id: match.id }, data: { status: 'blocked' } });
      this.gateway.closeMatch(match.id, [blockerId, blockedId]);
    }
    await Promise.all([this.redis.invalidateProfile(blockerId), this.redis.invalidateProfile(blockedId)]);
    // linhas do Prisma têm BigInt (id): nunca devolver cru — o JSON.stringify estoura em 500
    return { id: String(b.id), blockedId: b.blockedId, reason: b.reason ?? null, createdAt: b.createdAt.toISOString() };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    // sem bloqueio nenhum entre os dois, o match fechado pelo bloqueio vira "desfeito": podem dar match de novo
    const still = await this.prisma.block.findFirst({ where: { blockerId: blockedId, blockedId: blockerId }, select: { id: true } });
    if (!still) {
      await this.prisma.match.updateMany({
        where: {
          status: 'blocked',
          OR: [
            { userAId: blockerId, userBId: blockedId },
            { userAId: blockedId, userBId: blockerId },
          ],
        },
        data: { status: 'unmatched' },
      });
    }
    return { ok: true };
  }

  async list(blockerId: string) {
    const rows = await this.prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: {
          select: {
            id: true,
            name: true,
            photos: { where: { status: 'approved' }, orderBy: [{ isMain: 'desc' }, { orderIndex: 'asc' }], take: 1, select: { url: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: String(r.id),
      reason: r.reason ?? null,
      createdAt: r.createdAt.toISOString(),
      user: { id: r.blocked.id, name: r.blocked.name, mainPhotoUrl: r.blocked.photos[0]?.url ?? null },
    }));
  }
}
