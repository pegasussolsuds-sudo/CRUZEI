import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { distanceMeters } from '@cruzei/shared-utils';

// Cartão público de outro usuário (tela UserCard). Nunca expõe telefone/e-mail/posição exata.
@UseGuards(JwtAuthGuard)
@Controller('users')
export class PublicUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get(':id')
  async card(@CurrentUser() me: AuthenticatedUser, @Param('id') id: string) {
    if (id === me.id) throw new NotFoundException('Use /me pro seu próprio perfil');

    const blocked = await this.prisma.block.findFirst({
      where: { OR: [{ blockerId: me.id, blockedId: id }, { blockerId: id, blockedId: me.id }] },
      select: { id: true },
    });
    if (blocked) throw new NotFoundException('Usuário não encontrado');

    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        photos: { orderBy: { orderIndex: 'asc' } },
        userInterests: { include: { interest: true } },
        seals: { where: { isCompleted: true } },
      },
    });
    if (!u || u.deletedAt || u.isPaused) throw new NotFoundException('Usuário não encontrado');
    if (u.visibilityMode === 'anonymous') throw new NotFoundException('Essa pessoa está em modo anônimo');

    // distância aproximada (arredondada) a partir das presenças no Redis — nunca exata
    let distanceM: number | null = null;
    const [mine, theirs] = await Promise.all([
      this.redis.client.hgetall(`user:loc:${me.id}`),
      this.redis.client.hgetall(`user:loc:${id}`),
    ]);
    if (mine?.lat && theirs?.lat) {
      const d = distanceMeters(Number(mine.lat), Number(mine.lng), Number(theirs.lat), Number(theirs.lng));
      distanceM = d < 1000 ? Math.max(50, Math.round(d / 50) * 50) : Math.round(d / 500) * 500;
    }

    const [likedByMe, likedMe, match] = await Promise.all([
      this.prisma.like.findUnique({ where: { likerId_likedId: { likerId: me.id, likedId: id } }, select: { id: true } }),
      this.prisma.like.findUnique({ where: { likerId_likedId: { likerId: id, likedId: me.id } }, select: { id: true } }),
      this.prisma.match.findFirst({
        where: { OR: [{ userAId: me.id, userBId: id }, { userAId: id, userBId: me.id }], status: 'active' },
        select: { id: true, contextText: true },
      }),
    ]);

    return {
      id: u.id,
      name: u.name,
      age: u.showAge ? this.age(u.birthDate) : null,
      bio: u.bio,
      photos: u.photos.map((p) => ({ id: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl, isMain: p.isMain })),
      interests: u.userInterests.map((ui) => ui.interest.name),
      seals: u.seals.map((s) => s.sealType),
      lookingFor: u.lookingFor,
      isVerified: u.isVerified,
      premiumTier: u.premiumTier,
      lastActiveAt: u.lastActiveAt.toISOString(),
      distanceM: u.showDistance ? distanceM : null,
      likedByMe: Boolean(likedByMe),
      likedMe: Boolean(likedMe), // só é revelado pra Premium+ no app (o cliente decide)
      match: match ? { id: match.id, context: match.contextText } : null,
    };
  }

  private age(birth: Date): number {
    const t = new Date();
    let a = t.getFullYear() - birth.getFullYear();
    const m = t.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < birth.getDate())) a -= 1;
    return a;
  }
}
