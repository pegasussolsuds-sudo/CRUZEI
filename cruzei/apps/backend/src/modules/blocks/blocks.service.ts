import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  async block(blockerId: string, blockedId: string, reason?: string) {
    if (blockerId === blockedId) throw new BadRequestException('Não pode bloquear você mesmo');
    const b = await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      update: { reason },
      create: { blockerId, blockedId, reason },
    });
    // bloqueou → o match ativo entre os dois (se houver) fecha na hora
    await this.prisma.match.updateMany({
      where: {
        status: 'active',
        OR: [
          { userAId: blockerId, userBId: blockedId },
          { userAId: blockedId, userBId: blockerId },
        ],
      },
      data: { status: 'blocked' } as never,
    });
    // linhas do Prisma têm BigInt (id): nunca devolver cru — o JSON.stringify estoura em 500
    return { id: String(b.id), blockedId: b.blockedId, reason: b.reason ?? null, createdAt: b.createdAt.toISOString() };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    return { ok: true };
  }

  async list(blockerId: string) {
    const rows = await this.prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: {
          select: { id: true, name: true, photos: { where: { isMain: true }, select: { url: true } } },
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
