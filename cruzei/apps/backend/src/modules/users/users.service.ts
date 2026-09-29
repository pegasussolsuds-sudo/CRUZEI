import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AvatarTier } from '@cruzei/shared-types';
import { AVATAR_CONFIG_MAX_BYTES, FREE_TIERS, isValidAvatarConfig, normalizeAvatarConfig } from '@cruzei/shared-utils';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { avatarOrFallback } from '../../common/avatar';
import { PRIVACY } from '../location/discovery-privacy';
import { LEGAL_VERSION } from '@cruzei/shared-types';
import { PhotoModerationService } from '../moderation/photo-moderation.service';
import { ChatGateway } from '../../realtime/chat.gateway';

const PREMIUM_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free', 'premium']);

/** modo anônimo no plano grátis: 24 h por vez (sorted set userId → vencimento em ms; o cron devolve ao visível) */
export const ANON_FREE_KEY = 'anon:free:until';
export const ANON_FREE_HOURS = 24;
/** mesmo teto do app (PhotoUploadScreen): o servidor é quem garante */
export const MAX_PHOTOS = 6;

/**
 * Tiers de avatar liberados: premium/premium_plus com assinatura vigente (sem premiumExpiresAt ou no futuro)
 * → free + premium; senão só free. 'event' fica bloqueado pra todos por enquanto.
 */
export function allowedTiersFor(user: { premiumTier: string; premiumExpiresAt: Date | null } | null | undefined): ReadonlySet<AvatarTier> {
  if (!user || user.premiumTier === 'free') return FREE_TIERS;
  const active = user.premiumExpiresAt == null || user.premiumExpiresAt > new Date();
  return active ? PREMIUM_TIERS : FREE_TIERS;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly photoModeration: PhotoModerationService,
    private readonly chat: ChatGateway,
  ) {}

  async me(userId: string) {
    const cached = await this.redis.getCachedProfile<unknown>(userId);
    if (cached) return cached;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        photos: { orderBy: { orderIndex: 'asc' } },
        userInterests: { include: { interest: true } },
        seals: true,
        _count: { select: { likesReceived: true } },
      },
    });
    if (!user || user.deletedAt) throw new NotFoundException('Usuário não encontrado');

    // "matches" do perfil = pares com curtida mútua (não existe mais o estado match; as duas linhas de likes bastam)
    const [mutual] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM likes a
       WHERE a.liker_id = ${userId}::uuid
         AND EXISTS (SELECT 1 FROM likes b WHERE b.liker_id = a.liked_id AND b.liked_id = a.liker_id)`;
    const matchesCount = mutual?.n ?? 0;

    // assinatura vencida → itens premium do avatar caem pro default (salva só se mudou)
    let avatarConfig: unknown = user.avatarConfig;
    if (user.premiumTier !== 'free' && user.premiumExpiresAt && user.premiumExpiresAt <= new Date()) {
      avatarConfig = await this.downgradeAvatarToFree(userId, avatarConfig);
    }

    // pausa vencida → volta na hora (o cron unpauseExpired cobre quem não abre o app)
    let isPaused = user.isPaused;
    let pausedUntil = user.pausedUntil;
    if (isPaused && pausedUntil && pausedUntil <= new Date()) {
      // só se ainda vencida: não desfaz uma pausa nova feita no meio do caminho
      await this.prisma.user.updateMany({ where: { id: userId, isPaused: true, pausedUntil: { lte: new Date() } }, data: { isPaused: false, pausedUntil: null } as never });
      isPaused = false;
      pausedUntil = null;
    }

    // tier efetivo: assinatura vencida conta como free (mesma regra que o update() usa pra validar o avatar)
    const premiumTier = allowedTiersFor(user).has('premium') ? user.premiumTier : 'free';

    const profile = {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      birthDate: user.birthDate.toISOString().slice(0, 10),
      age: this.age(user.birthDate),
      gender: user.gender,
      orientation: user.orientation,
      lookingFor: user.lookingFor,
      bio: user.bio,
      photos: user.photos.map((p) => ({
        id: p.id,
        url: p.url,
        thumbnailUrl: p.thumbnailUrl,
        orderIndex: p.orderIndex,
        isMain: p.isMain,
        // em análise / recusada: só o dono vê (e o app avisa)
        status: p.status,
        rejectReason: p.rejectReason,
      })),
      interests: user.userInterests.map((ui) => ui.interest.name),
      seals: user.seals.map((s) => ({
        type: s.sealType,
        progress: s.progress,
        target: s.target,
        isCompleted: s.isCompleted,
      })),
      premiumTier,
      isVerified: user.isVerified,
      profileCompleteness: user.profileCompleteness,
      avatar: avatarOrFallback({ id: user.id, gender: user.gender, avatarConfig }),
      settings: {
        visibilityMode: user.visibilityMode,
        showDistance: user.showDistance,
        showAge: user.showAge,
        showPhotoOnMap: user.showPhotoOnMap,
        discoveryMode: user.discoveryMode,
        isPaused,
        pausedUntil: pausedUntil?.toISOString() ?? null,
      },
      stats: {
        likesReceived: user._count.likesReceived ?? 0,
        matches: matchesCount,
        superLikesToday: 0, // TODO: integrar Redis
      },
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: user.lastActiveAt.toISOString(),
      role: user.role,
      legal: { acceptedVersion: user.termsVersion, currentVersion: LEGAL_VERSION },
    };

    // cache não passa do fim da pausa/assinatura, senão o app vê estado vencido por até 1h
    const now = Date.now();
    const edges = [pausedUntil, user.premiumExpiresAt]
      .filter((d): d is Date => !!d && d.getTime() > now)
      .map((d) => Math.ceil((d.getTime() - now) / 1000));
    await this.redis.cacheProfile(userId, profile, Math.max(1, Math.min(3600, ...edges)));
    return profile;
  }

  async update(
    userId: string,
    dto: { name?: string; bio?: string; lookingFor?: string; orientation?: string; interests?: string[]; avatar?: unknown },
  ) {
    const data: Record<string, unknown> = {};
    if (dto.name) data.name = dto.name.trim();
    if (dto.bio !== undefined) data.bio = dto.bio.trim() || null;
    if (dto.lookingFor) data.lookingFor = dto.lookingFor;
    if (dto.orientation) data.orientation = dto.orientation;

    if (dto.avatar !== undefined) {
      if (Buffer.byteLength(JSON.stringify(dto.avatar) ?? '') > AVATAR_CONFIG_MAX_BYTES) {
        throw new BadRequestException('avatar muito grande');
      }
      // free só usa itens free; premium/premium_plus com assinatura vigente liberam 'premium'
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { premiumTier: true, premiumExpiresAt: true },
      });
      const tiers = allowedTiersFor(me);
      if (!isValidAvatarConfig(dto.avatar, tiers)) {
        throw new BadRequestException('avatar inválido ou com itens bloqueados');
      }
      data.avatarConfig = normalizeAvatarConfig(dto.avatar, tiers);
    }

    if (dto.interests) {
      await this.prisma.userInterest.deleteMany({ where: { userId } });
      const interestRows = await this.prisma.interest.findMany({
        where: { name: { in: dto.interests } },
      });
      if (interestRows.length > 0) {
        await this.prisma.userInterest.createMany({
          data: interestRows.map((i) => ({ userId, interestId: i.id })),
          skipDuplicates: true,
        });
      }
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: userId }, data: data as never });
    }

    await this.refreshCompleteness(userId);
    return this.me(userId);
  }

  async updateSettings(
    userId: string,
    dto: {
      visibilityMode?: 'visible' | 'anonymous';
      showDistance?: boolean;
      showAge?: boolean;
      showPhotoOnMap?: boolean;
      discoveryMode?: 'everyone' | 'compatible' | 'nobody';
    },
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: dto as never,
    });
    // anônimo no plano grátis tem prazo (24 h); o cron devolve a pessoa ao modo visível quando vence
    let anonymousUntil: string | null = null;
    if (dto.visibilityMode === 'anonymous') {
      const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { premiumTier: true, premiumExpiresAt: true } });
      if (allowedTiersFor(u).has('premium')) await this.redis.client.zrem(ANON_FREE_KEY, userId);
      else {
        const until = Date.now() + ANON_FREE_HOURS * 3_600_000;
        await this.redis.client.zadd(ANON_FREE_KEY, until, userId);
        anonymousUntil = new Date(until).toISOString();
        // invisível sem Premium não manda nem recebe mensagens (inbox/visibility.messagingLocked): sai dos chats abertos
        await this.chat.leaveAllConversations(userId).catch(() => undefined);
      }
    } else if (dto.visibilityMode === 'visible') {
      await this.redis.client.zrem(ANON_FREE_KEY, userId);
    }
    await this.redis.invalidateProfile(userId);
    return { ok: true, ...dto, ...(dto.visibilityMode === 'anonymous' ? { anonymousUntil } : {}) };
  }

  // ---- áreas privadas: coordenada precisa do PRÓPRIO usuário; a resposta só devolve rótulo/raio ----
  async listPrivateAreas(userId: string) {
    const rows = await this.prisma.privateArea.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => ({ id: a.id, label: a.label, radiusM: a.radiusM, createdAt: a.createdAt.toISOString() }));
  }

  async addPrivateArea(userId: string, dto: { label: string; latitude: number; longitude: number; radiusM?: number }) {
    const count = await this.prisma.privateArea.count({ where: { userId } });
    if (count >= PRIVACY.PRIVATE_AREAS_MAX) throw new BadRequestException(`No máximo ${PRIVACY.PRIVATE_AREAS_MAX} áreas privadas`);
    const radiusM = Math.round(
      Math.min(PRIVACY.PRIVATE_AREA_MAX_RADIUS_M, Math.max(PRIVACY.PRIVATE_AREA_MIN_RADIUS_M, dto.radiusM ?? PRIVACY.PRIVATE_AREA_DEFAULT_RADIUS_M)),
    );
    const a = await this.prisma.privateArea.create({
      data: { userId, label: dto.label.trim() || 'Área privada', latitude: dto.latitude, longitude: dto.longitude, radiusM },
    });
    // a presença atual pode já estar dentro da área nova: some do mapa na hora
    await this.redis.markPresenceHidden(userId).catch(() => {});
    return { id: a.id, label: a.label, radiusM: a.radiusM, createdAt: a.createdAt.toISOString() };
  }

  async removePrivateArea(userId: string, id: string) {
    await this.prisma.privateArea.deleteMany({ where: { id, userId } });
    return { ok: true };
  }

  async pause(userId: string, durationHours: number) {
    const pausedUntil = new Date(Date.now() + durationHours * 3_600_000);
    await this.prisma.user.update({
      where: { id: userId },
      data: { isPaused: true, pausedUntil } as never,
    });
    await this.redis.invalidateProfile(userId);
    return { pausedUntil: pausedUntil.toISOString() };
  }

  /** retomar perfil antes do fim da pausa */
  async resume(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { isPaused: false, pausedUntil: null } as never,
    });
    // a próxima atualização de posição é aceita na hora (sem esperar o intervalo mínimo nem a resposta em cache "pausado")
    await this.redis.client.del(`loc:gate:${userId}`, `loc:last:${userId}`);
    await this.redis.invalidateProfile(userId);
    return { ok: true };
  }

  async addPhoto(userId: string, url: string, thumbnailUrl?: string, isMain?: boolean) {
    const count = await this.prisma.photo.count({ where: { userId } });
    const makeMain = isMain ?? count === 0; // primeira foto vira principal automaticamente

    if (makeMain) {
      await this.prisma.photo.updateMany({ where: { userId }, data: { isMain: false } });
    }
    if (count >= MAX_PHOTOS) throw new BadRequestException(`Máximo de ${MAX_PHOTOS} fotos`);
    const photo = await this.prisma.photo.create({
      data: {
        userId,
        url,
        thumbnailUrl: thumbnailUrl ?? url,
        isMain: makeMain,
        orderIndex: count,
        // com a moderação ligada a foto nasce "em análise": ninguém além do dono vê até ser aprovada
        status: this.photoModeration.initialStatus(),
      },
    });
    this.photoModeration.enqueue(photo.id);
    await this.refreshCompleteness(userId);
    return {
      id: photo.id,
      url: photo.url,
      thumbnailUrl: photo.thumbnailUrl,
      orderIndex: photo.orderIndex,
      isMain: photo.isMain,
      status: photo.status,
      rejectReason: photo.rejectReason,
    };
  }

  /** aceite dos Termos/Política (cadastro antigo ou versão nova): grava a versão e a data */
  async acceptTerms(userId: string, version: string) {
    if (version !== LEGAL_VERSION) throw new BadRequestException({ error: 'terms_outdated', message: 'Os termos mudaram: abra de novo pra ver a versão atual' });
    await this.prisma.user.update({ where: { id: userId }, data: { termsVersion: version, termsAcceptedAt: new Date() } });
    await this.redis.invalidateProfile(userId);
    return { acceptedVersion: version, currentVersion: LEGAL_VERSION };
  }

  async deletePhoto(userId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, userId } });
    if (!photo) throw new NotFoundException('Foto não encontrada');
    await this.prisma.photo.delete({ where: { id: photoId } });

    // reindexa e garante uma principal
    const rest = await this.prisma.photo.findMany({ where: { userId }, orderBy: { orderIndex: 'asc' } });
    for (let i = 0; i < rest.length; i++) {
      await this.prisma.photo.update({
        where: { id: rest[i].id },
        data: { orderIndex: i, isMain: photo.isMain ? i === 0 : rest[i].isMain },
      });
    }
    await this.refreshCompleteness(userId);
    return { ok: true };
  }

  async reorderPhotos(userId: string, photoIds: string[]) {
    const own = await this.prisma.photo.findMany({ where: { userId }, select: { id: true } });
    const ownIds = new Set(own.map((p) => p.id));
    const ordered = photoIds.filter((id) => ownIds.has(id));
    // dois passos pra não violar UNIQUE(userId, orderIndex)
    for (let i = 0; i < ordered.length; i++) {
      await this.prisma.photo.update({ where: { id: ordered[i] }, data: { orderIndex: 1000 + i } });
    }
    for (let i = 0; i < ordered.length; i++) {
      await this.prisma.photo.update({ where: { id: ordered[i] }, data: { orderIndex: i } });
    }
    await this.redis.invalidateProfile(userId);
    return { ok: true };
  }

  async setMain(userId: string, photoId: string) {
    await this.prisma.photo.updateMany({ where: { userId }, data: { isMain: false } });
    await this.prisma.photo.updateMany({ where: { id: photoId, userId }, data: { isMain: true } });
    await this.redis.invalidateProfile(userId);
    return { ok: true };
  }

  listInterests() {
    return this.prisma.interest.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Garante que o avatar só usa itens free (assinatura cancelada ou vencida): normaliza e salva se mudou.
   * Devolve a config vigente. `current` evita uma query quando o caller já tem a config em mãos.
   */
  async downgradeAvatarToFree(userId: string, current?: unknown): Promise<unknown> {
    const cfg =
      current !== undefined
        ? current
        : (await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarConfig: true } }))?.avatarConfig;
    if (cfg == null || isValidAvatarConfig(cfg, FREE_TIERS)) return cfg ?? null;
    const normalized = normalizeAvatarConfig(cfg, FREE_TIERS);
    await this.prisma.user.update({ where: { id: userId }, data: { avatarConfig: normalized as never } });
    await this.redis.invalidateProfile(userId);
    return normalized;
  }

  private async refreshCompleteness(userId: string) {
    const completeness = await this.computeCompleteness(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { profileCompleteness: completeness } as never,
    });
    await this.redis.invalidateProfile(userId);
  }

  private async computeCompleteness(userId: string): Promise<number> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { photos: true, userInterests: true },
    });
    if (!u) return 0;
    let score = 0;
    if (u.name) score += 10;
    if (u.bio) score += 15;
    if (u.photos.length >= 1) score += 20;
    if (u.photos.length >= 2) score += 10;
    if (u.photos.length >= 4) score += 5;
    if (u.userInterests.length >= 3) score += 15;
    if (u.userInterests.length >= 6) score += 5;
    if (u.lookingFor && u.lookingFor !== 'unspecified') score += 5;
    if (u.isVerified) score += 15;
    return Math.min(100, score);
  }

  private age(birth: Date): number {
    const t = new Date();
    let a = t.getFullYear() - birth.getFullYear();
    const m = t.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < birth.getDate())) a -= 1;
    return a;
  }
}
