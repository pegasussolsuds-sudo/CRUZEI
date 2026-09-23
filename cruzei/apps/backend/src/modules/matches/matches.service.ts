import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { MatchContextService } from './match-context.service';
import { v4 as uuid } from 'uuid';

const CHAT_TTL_HOURS = 48;
const DAILY_LIKE_LIMIT = 200;

const USER_CARD_SELECT = {
  id: true,
  name: true,
  birthDate: true,
  photos: { where: { isMain: true }, select: { url: true } },
} as const;

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly context: MatchContextService,
    private readonly gateway: ChatGateway,
  ) {}

  // Curtir alguém. Se já tinha curtida contrária → match.
  async like(likerId: string, likedId: string, isSuper = false) {
    if (likerId === likedId) throw new BadRequestException('Não dá pra curtir você mesmo');

    const target = await this.prisma.user.findUnique({
      where: { id: likedId },
      select: { id: true, deletedAt: true, visibilityMode: true },
    });
    if (!target || target.deletedAt) throw new NotFoundException('Usuário não encontrado');
    if (target.visibilityMode === 'anonymous') {
      throw new BadRequestException('Essa pessoa está em modo anônimo — só dá match quando ela se revelar');
    }

    // rate limit diário
    const used = await this.redis.incrRate(likerId, 'like', 86_400);
    if (used > DAILY_LIKE_LIMIT) {
      throw new ForbiddenException('Limite diário de curtidas atingido');
    }

    // bloqueado?
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: likerId, blockedId: likedId },
          { blockerId: likedId, blockedId: likerId },
        ],
      },
    });
    if (blocked) throw new BadRequestException('Não é possível interagir com esse usuário');

    // verifica se já curtiu
    const existing = await this.prisma.like.findUnique({
      where: { likerId_likedId: { likerId, likedId } },
    });
    if (existing) {
      const match = await this.findMatch(likerId, likedId);
      return {
        likeId: String(existing.id),
        isMatch: Boolean(match),
        matchId: match?.id,
        context: match?.contextText ?? null,
        chatExpiresAt: match?.chatExpiresAt?.toISOString(),
        remainingToday: Math.max(0, DAILY_LIKE_LIMIT - used),
      };
    }

    // cria like
    const like = await this.prisma.like.create({
      data: { likerId, likedId, isSuper },
    });

    // verifica reciprocidade
    const reverse = await this.prisma.like.findUnique({
      where: { likerId_likedId: { likerId: likedId, likedId: likerId } },
    });

    if (reverse) {
      const match = await this.createMatch(likerId, likedId);
      return {
        likeId: String(like.id),
        isMatch: true,
        matchId: match.id,
        context: match.contextText,
        chatExpiresAt: match.chatExpiresAt.toISOString(),
        remainingToday: Math.max(0, DAILY_LIKE_LIMIT - used),
      };
    }

    this.gateway.emitToUser(likedId, 'like_received', { fromUserId: likerId, isSuper });
    await this.redis.invalidateProfile(likedId); // stats.likesReceived

    return {
      likeId: String(like.id),
      isMatch: false,
      remainingToday: Math.max(0, DAILY_LIKE_LIMIT - used),
    };
  }

  async pass(userId: string, targetId: string) {
    // pass = like reverso registrado como skipped (não armazenamos, só audit)
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'pass',
        metadata: { target_id: targetId } as never,
      },
    });
    return { ok: true };
  }

  async listMatches(userId: string, limit = 20, offset = 0) {
    const matches = await this.prisma.match.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
        status: 'active',
      },
      orderBy: { matchedAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        userA: { select: USER_CARD_SELECT },
        userB: { select: USER_CARD_SELECT },
        poi: { select: { name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: {
          select: { messages: { where: { readAt: null, senderId: { not: userId } } } },
        },
      },
    });

    return matches.map((m) => {
      const other = m.userAId === userId ? m.userB : m.userA;
      const last = m.messages[0];
      return {
        id: m.id,
        user: this.card(other),
        context: m.contextText,
        poiName: m.poi?.name ?? null,
        chatExpiresAt: m.chatExpiresAt.toISOString(),
        lastMessage: last
          ? {
              content: last.content ?? (last.messageType === 'photo_temp' ? '📸 foto' : ''),
              senderId: last.senderId,
              createdAt: last.createdAt.toISOString(),
            }
          : null,
        unreadCount: m._count.messages,
        matchedAt: m.matchedAt.toISOString(),
      };
    });
  }

  async getMatch(matchId: string, userId: string) {
    const m = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        userA: { select: { ...USER_CARD_SELECT, bio: true } },
        userB: { select: { ...USER_CARD_SELECT, bio: true } },
        poi: true,
      },
    });
    if (!m) throw new NotFoundException('Match não encontrado');
    if (m.userAId !== userId && m.userBId !== userId) {
      throw new ForbiddenException('Sem acesso');
    }
    const other = m.userAId === userId ? m.userB : m.userA;
    return {
      id: m.id,
      status: m.status,
      user: { ...this.card(other), bio: other.bio },
      context: m.contextText,
      poiName: m.poi?.name ?? null,
      poi: m.poi ? { id: Number(m.poi.id), name: m.poi.name, address: m.poi.address } : null,
      chatExpiresAt: m.chatExpiresAt.toISOString(),
      matchedAt: m.matchedAt.toISOString(),
    };
  }

  async unmatch(matchId: string, userId: string) {
    await this.getMatch(matchId, userId); // valida ownership
    await this.prisma.match.update({
      where: { id: matchId },
      data: { status: 'unmatched' } as never,
    });
    return { ok: true };
  }

  async renewChat(matchId: string, userId: string) {
    await this.getMatch(matchId, userId);
    const shouldRenew = await this.context.shouldRenewChat(matchId);
    if (!shouldRenew) {
      throw new BadRequestException('Sem re-cruzamento pra renovar');
    }
    const newExpiry = new Date(Date.now() + CHAT_TTL_HOURS * 3_600_000);
    await this.prisma.match.update({
      where: { id: matchId },
      data: { chatExpiresAt: newExpiry, lastRenewedAt: new Date() } as never,
    });
    return { chatExpiresAt: newExpiry.toISOString(), renewedByHours: CHAT_TTL_HOURS };
  }

  async firstMessageTemplates(matchId: string, userId: string) {
    const match = await this.getMatch(matchId, userId);
    const place = match.poi?.name;
    const templates = place
      ? [
          `Oi! A gente se cruzou no ${place}. Curtiu?`,
          `E aí! Vi que você também tava no ${place}. Bora trocar uma ideia?`,
          `Oi! Match no ${place}. Topa um café qualquer dia?`,
        ]
      : [
          'Oi! A gente se cruzou por aqui hoje. Curtiu?',
          'E aí! Vi que você também tava por perto. Bora trocar uma ideia?',
          'Oi! Deu match — topa um café qualquer dia?',
        ];
    return { templates };
  }

  private async findMatch(aId: string, bId: string) {
    return this.prisma.match.findFirst({
      where: {
        OR: [
          { userAId: aId, userBId: bId },
          { userAId: bId, userBId: aId },
        ],
      },
    });
  }

  private async createMatch(likerId: string, likedId: string) {
    const expires = new Date(Date.now() + CHAT_TTL_HOURS * 3_600_000);
    const contextText = await this.context.generate(likerId, likedId);

    // garante ordem canônica pra UNIQUE (a < b)
    const [a, b] = [likerId, likedId].sort();
    const match = await this.prisma.match.create({
      data: {
        id: uuid(),
        userAId: a,
        userBId: b,
        contextText,
        chatExpiresAt: expires,
      } as never,
      include: {
        userA: { select: USER_CARD_SELECT },
        userB: { select: USER_CARD_SELECT },
      },
    });

    // stats do perfil mudaram (matches) → derruba o cache dos dois
    await Promise.all([this.redis.invalidateProfile(match.userAId), this.redis.invalidateProfile(match.userBId)]);

    // avisa os dois lados em tempo real, cada um vendo o perfil do outro
    const base = {
      context: match.contextText,
      poiName: null,
      chatExpiresAt: match.chatExpiresAt.toISOString(),
      lastMessage: null,
      unreadCount: 0,
      matchedAt: match.matchedAt.toISOString(),
    };
    this.gateway.emitToUser(match.userAId, 'match_created', {
      match: { id: match.id, user: this.card(match.userB), ...base },
    });
    this.gateway.emitToUser(match.userBId, 'match_created', {
      match: { id: match.id, user: this.card(match.userA), ...base },
    });

    return match;
  }

  private card(u: { id: string; name: string; birthDate: Date; photos: { url: string }[] }) {
    return {
      id: u.id,
      name: u.name,
      age: this.age(u.birthDate),
      mainPhotoUrl: u.photos[0]?.url ?? null,
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
