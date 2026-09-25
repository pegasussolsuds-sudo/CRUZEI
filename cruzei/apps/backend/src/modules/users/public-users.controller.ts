import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { LocationService } from '../location/location.service';
import { avatarOrFallback } from '../../common/avatar';

// Cartão público de outro usuário (tela UserCard). Nunca expõe telefone/e-mail/posição/distância.
// Localização de terceiros só como FAIXA de proximidade e lugar, e só enquanto a pessoa é descoberta por quem
// consulta (mesmas regras do /nearby: raio de 350 m, reciprocidade, bloqueio, área privada). Fora disso: null.
// Mensagens de "não encontrado" são idênticas em todos os casos → o endpoint não confirma que um id existe.
@UseGuards(JwtAuthGuard)
@Controller('users')
export class PublicUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly location: LocationService,
  ) {}

  @Get(':id')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async card(@CurrentUser() me: AuthenticatedUser, @Param('id') id: string) {
    const notFound = () => new NotFoundException('Usuário não encontrado');
    if (id === me.id) throw notFound();

    const blocked = await this.prisma.block.findFirst({
      where: { OR: [{ blockerId: me.id, blockedId: id }, { blockerId: id, blockedId: me.id }] },
      select: { id: true },
    });
    if (blocked) throw notFound();

    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        photos: { orderBy: { orderIndex: 'asc' } },
        userInterests: { include: { interest: true } },
        seals: { where: { isCompleted: true } },
      },
    });
    if (!u || u.deletedAt || u.isPaused) throw notFound();
    if (u.visibilityMode === 'anonymous') throw notFound();

    // faixa e lugar só se a pessoa deixou ("mostrar distância") E está descoberta por mim agora
    let proximityBand: 'very_near' | 'near' | 'region' | null = null;
    let placeName: string | null = null;
    if (u.showDistance) {
      const d = await this.location.discoverability(me.id, id);
      if (d.ok) {
        proximityBand = d.band;
        placeName = d.poi?.name ?? null;
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
      proximityBand,
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
