import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { LocationService } from '../location/location.service';
import { avatarOrFallback } from '../../common/avatar';
import { approxDistanceM, distanceMeters } from '@cruzei/shared-utils';

// Cartão público de outro usuário (tela UserCard). Nunca expõe telefone/e-mail/posição exata.
@UseGuards(JwtAuthGuard)
@Controller('users')
export class PublicUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly location: LocationService,
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

    // distância e lugar só se a pessoa deixou ("mostrar distância"). Distância em degraus (50/100/250/500/1000…)
    // entre a minha presença e a posição BORRADA dela (mesmo helper do /nearby) — nunca a real.
    let distanceM: number | null = null;
    let placeName: string | null = null;
    if (u.showDistance) {
      const presences = await this.location.getPresences([me.id, id]);
      const mine = presences.get(me.id);
      const theirs = presences.get(id);
      if (theirs) {
        placeName = theirs.poi?.name ?? null;
        if (mine) {
          const pos = this.location.blurPosition(id, theirs.lat, theirs.lng, theirs.poi);
          distanceM = approxDistanceM(distanceMeters(mine.lat, mine.lng, pos.lat, pos.lng));
        }
      }
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
      avatar: avatarOrFallback(u),
      placeName,
      photos: u.photos.map((p) => ({ id: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl, isMain: p.isMain })),
      interests: u.userInterests.map((ui) => ui.interest.name),
      seals: u.seals.map((s) => s.sealType),
      lookingFor: u.lookingFor,
      isVerified: u.isVerified,
      premiumTier: u.premiumTier,
      lastActiveAt: u.lastActiveAt.toISOString(),
      distanceM,
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
