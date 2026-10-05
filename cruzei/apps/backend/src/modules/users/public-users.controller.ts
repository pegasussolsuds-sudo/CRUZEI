import type { PublicUserCard } from '@cruzei/shared-types';
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { avatarOrFallback } from '../../common/avatar';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { photoUrl } from '../../common/photo-url';
import { effectiveTier } from '../../common/premium';
import { PrismaService } from '../../database/prisma.service';
import { LocationService } from '../location/location.service';
import { loadPeerSocial } from '../location/peer-social';

import { cardLastSeen, publicOrientation } from './profile-prefs';

// Cartão público de outro usuário (tela UserCard). Nunca expõe telefone/e-mail/posição/distância nem o horário exato
// da última atividade (só a faixa online/há pouco, pra quem descobre a pessoa agora ou deu match).
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
  async card(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PublicUserCard> {
    const notFound = () => new NotFoundException('Usuário não encontrado');
    if (id === me.id) throw notFound();

    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: me.id, blockedId: id },
          { blockerId: id, blockedId: me.id },
        ],
      },
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
    if (!u || u.deletedAt || paused || u.accountStatus !== 'active' || u.reviewHoldAt)
      throw notFound();
    if (u.visibilityMode === 'anonymous') throw notFound();

    // está descoberta por mim agora? (mesmas regras do /nearby) — decide a faixa/lugar e a última atividade
    const [d, peers, superFrom] = await Promise.all([
      this.location.discoverability(me.id, id),
      loadPeerSocial(this.prisma, me.id, [id]),
      // super curtida pendente pra mim (mesma regra do topo do deck)
      this.location.superLikedMeFrom(me.id, [id]),
    ]);
    const superLikedMe = superFrom.has(id);
    // faixa e lugar só se a pessoa deixou ("mostrar distância") E está descoberta por mim agora
    let proximityBand: PublicUserCard['proximityBand'] = null;
    let placeName: string | null = null;
    if (u.showDistance && d.ok) {
      proximityBand = d.band;
      placeName = d.poi?.name ?? null;
    }

    // curtida nos dois sentidos + conversa do par (a mesma consulta do /nearby); RECEIVED só pra Premium+,
    // menos na super curtida pendente: ela revela quem mandou pra qualquer plano
    const social = peers.get(id);
    const baseStatus = social?.likeStatus ?? 'NONE';
    const likeStatus = superLikedMe && baseStatus === 'NONE' ? 'RECEIVED' : baseStatus;
    // última atividade: nunca o horário exato; faixa só pra quem a descobre agora ou deu match (senão null)
    const lastSeen = cardLastSeen(u.lastActiveAt, d.ok || likeStatus === 'MUTUAL');

    return {
      id: u.id,
      name: u.name,
      age: u.showAge ? this.age(u.birthDate) : null,
      bio: u.bio,
      avatar: avatarOrFallback(u),
      placeName,
      // o banco guarda a chave: a URL pública sai do photoUrl()
      photos: u.photos.flatMap((p) => {
        const url = photoUrl(p.url);
        return url
          ? [{ id: p.id, url, thumbnailUrl: photoUrl(p.thumbnailUrl), isMain: p.isMain }]
          : [];
      }),
      interests: u.userInterests.map((ui) => ui.interest.name),
      // mesmo formato UserSeal do /me (o app lê type/progress/target/isCompleted)
      seals: u.seals.map((s) => ({
        type: s.sealType,
        progress: s.progress,
        target: s.target,
        isCompleted: s.isCompleted,
      })),
      lookingFor: u.lookingFor,
      isVerified: u.isVerified,
      // plano EFETIVO: assinatura vencida não mostra selo antes da tarefa rebaixar
      premiumTier: effectiveTier(u.premiumTier, u.premiumExpiresAt),
      proximityBand,
      likedByMe: social?.likedByMe ?? false,
      // derivado do likeStatus já filtrado: fora do Premium+ só vem true quando é mútuo (o servidor decide, não o app)
      likedMe: likeStatus === 'RECEIVED' || likeStatus === 'MUTUAL',
      likeStatus,
      conversation: social?.conversation ?? null,
      // orientação só quando a pessoa EXIBE; @ do Instagram é público (quem abre o cartão vê)
      orientation: publicOrientation(u),
      instagram: u.instagramHandle ?? null,
      lastSeen,
      ...(superLikedMe ? { superLikedMe: true } : {}),
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
