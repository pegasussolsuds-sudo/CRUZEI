import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { LocationService } from '../location/location.service';
import { avatarOrFallback } from '../../common/avatar';
import { loadPeerSocial } from '../location/peer-social';

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
        // só fotos aprovadas pela moderação (em análise e recusadas não aparecem pra ninguém além do dono)
        photos: { where: { status: 'approved' }, orderBy: { orderIndex: 'asc' } },
        userInterests: { include: { interest: true } },
        seals: { where: { isCompleted: true } },
      },
    });
    const paused = u?.isPaused && (!u.pausedUntil || u.pausedUntil > new Date()); // pausa vencida não conta
    // suspensa, banida ou fora da descoberta pela moderação: some do cartão também
    if (!u || u.deletedAt || paused || u.accountStatus !== 'active' || u.reviewHoldAt) throw notFound();
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

    // curtida nos dois sentidos + conversa do par (a mesma consulta do /nearby); RECEIVED só pra Premium+
    const social = (await loadPeerSocial(this.prisma, me.id, [id])).get(id);
    const likeStatus = social?.likeStatus ?? 'NONE';

    return {
      id: u.id,
      name: u.name,
      age: u.showAge ? this.age(u.birthDate) : null,
      bio: u.bio,
      avatar: avatarOrFallback(u),
      placeName,
      photos: u.photos.map((p) => ({ id: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl, isMain: p.isMain })),
      interests: u.userInterests.map((ui) => ui.interest.name),
      // mesmo formato UserSeal do /me (o app lê type/progress/target/isCompleted)
      seals: u.seals.map((s) => ({ type: s.sealType, progress: s.progress, target: s.target, isCompleted: s.isCompleted })),
      lookingFor: u.lookingFor,
      isVerified: u.isVerified,
      premiumTier: u.premiumTier,
      lastActiveAt: u.lastActiveAt.toISOString(),
      proximityBand,
      likedByMe: social?.likedByMe ?? false,
      // derivado do likeStatus já filtrado: fora do Premium+ só vem true quando é mútuo (o servidor decide, não o app)
      likedMe: likeStatus === 'RECEIVED' || likeStatus === 'MUTUAL',
      likeStatus,
      conversation: social?.conversation ?? null,
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
