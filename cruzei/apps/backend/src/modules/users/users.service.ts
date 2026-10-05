import type { AvatarTier, Gender, InterestItem, Orientation, ShowMe } from '@cruzei/shared-types';
import { AGE_RANGE_DAILY_CHANGES, LEGAL_VERSION } from '@cruzei/shared-types';
import {
  AVATAR_CONFIG_MAX_BYTES,
  checkProfileText,
  FREE_TIERS,
  isValidAvatarConfig,
  normalizeAvatarConfig,
} from '@cruzei/shared-utils';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import { avatarOrFallback } from '../../common/avatar';
import { isValidKey, keyFromPhotoUrl, photoUrl } from '../../common/photo-url';
import {
  ANON_FREE_MS,
  anonymousWindowAction,
  decideAnonymous,
  isPremiumActive,
  visibleAnonymousUntil,
} from '../../common/premium';
import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { RedisService } from '../../redis/redis.service';
import { readSuperLikeQuota, superLikeDay, superLikeResetsAt } from '../likes/super-like-quota';
import { PRIVACY } from '../location/discovery-privacy';
import { PhotoModerationService } from '../moderation/photo-moderation.service';
import { MediaGcService, ownersOnEvidenceHold } from '../uploads/media-gc.service';
import {
  isRetainedPhoto,
  ownerVisible,
  retainedOrderIndex,
  withRetainedMark,
} from '../uploads/photo-retention';
import { UPLOAD_ATTACH_WINDOW_H, UPLOAD_ORPHAN_TTL_H } from '../uploads/uploads.constants';

import {
  AGE_RANGE_INVALID,
  ageRangeLimitBody,
  ageRangeUpdate,
  cleanBio,
  cleanInterestNames,
  cleanName,
  INSTAGRAM_INVALID,
  NAME_INVALID,
  nextAgeRange,
  ORIENTATION_REQUIRED,
  orientationFlagsBlocked,
  orientationPatch,
  parseInstagramInput,
  profileCompleteness,
} from './profile-prefs';

const PREMIUM_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free', 'premium']);

/** mesmo teto do app (PhotoUploadScreen): o servidor é quem garante */
export const MAX_PHOTOS = 6;

/** id de foto (uuid): fora disso é 404 sem chegar no cast ::uuid do SQL */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** upload de outra conta, vencido, já usado ou inexistente */
export const UPLOAD_NOT_FOUND = {
  error: 'upload_not_found',
  message: 'Essa foto não chegou direito. Envia de novo?',
};

/**
 * Tiers de avatar liberados: premium/premium_plus com assinatura vigente (sem premiumExpiresAt ou no futuro)
 * → free + premium; senão só free. 'event' fica bloqueado pra todos por enquanto.
 */
export function allowedTiersFor(
  user: { premiumTier: string; premiumExpiresAt: Date | null } | null | undefined,
): ReadonlySet<AvatarTier> {
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
    // opcional: apagar foto só adianta o GC (o cron pega o resto); specs antigos constroem sem ele
    @Optional() private readonly mediaGc?: MediaGcService,
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
        // conta com exclusão pedida não conta (some na hora; a linha fica pro arrependimento)
        _count: { select: { likesReceived: { where: { liker: { deletedAt: null } } } } },
      },
    });
    if (!user || user.deletedAt) throw new NotFoundException('Usuário não encontrado');

    // "matches" do perfil = pares com curtida mútua (não existe mais o estado match; as duas linhas de likes bastam)
    const [mutual] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM likes a
       WHERE a.liker_id = ${userId}::uuid
         AND EXISTS (SELECT 1 FROM likes b WHERE b.liker_id = a.liked_id AND b.liked_id = a.liker_id)
         AND EXISTS (SELECT 1 FROM users p WHERE p.id = a.liked_id AND p.deleted_at IS NULL)`;
    const matchesCount = mutual?.n ?? 0;

    // assinatura vencida → itens premium do avatar caem pro default (salva só se mudou)
    let avatarConfig: unknown = user.avatarConfig;
    if (
      user.premiumTier !== 'free' &&
      user.premiumExpiresAt &&
      user.premiumExpiresAt <= new Date()
    ) {
      avatarConfig = await this.downgradeAvatarToFree(userId, avatarConfig);
    }

    // pausa vencida → volta na hora (o cron unpauseExpired cobre quem não abre o app)
    let isPaused = user.isPaused;
    let pausedUntil = user.pausedUntil;
    if (isPaused && pausedUntil && pausedUntil <= new Date()) {
      // só se ainda vencida: não desfaz uma pausa nova feita no meio do caminho
      await this.prisma.user.updateMany({
        where: { id: userId, isPaused: true, pausedUntil: { lte: new Date() } },
        data: { isPaused: false, pausedUntil: null } as never,
      });
      isPaused = false;
      pausedUntil = null;
    }

    // invisível grátis: janela vencida → visível na hora; sem janela gravada → ganha as 24 h agora (a tarefa do
    // PremiumLifecycleService faz o mesmo e avisa quem não abre o app). Premium vencido espera o rebaixamento
    let visibilityMode = user.visibilityMode;
    let anonymousUntil = user.anonymousUntil;
    const anonAction = anonymousWindowAction(user);
    if (anonAction === 'expire') {
      const r = await this.prisma.user.updateMany({
        where: {
          id: userId,
          visibilityMode: 'anonymous',
          premiumTier: 'free',
          anonymousUntil: { lte: new Date() },
        },
        data: { visibilityMode: 'visible', anonymousUntil: null },
      });
      if (r.count) {
        visibilityMode = 'visible';
        anonymousUntil = null;
        await this.redis.invalidateProfile(userId); // volta pro mapa dos outros
      }
    } else if (anonAction === 'open') {
      const until = new Date(Date.now() + ANON_FREE_MS);
      const r = await this.prisma.user.updateMany({
        where: {
          id: userId,
          visibilityMode: 'anonymous',
          premiumTier: 'free',
          anonymousUntil: null,
        },
        data: { anonymousUntil: until },
      });
      if (r.count) anonymousUntil = until;
    }

    // tier efetivo: assinatura vencida conta como free (mesma regra que o update() usa pra validar o avatar)
    const premiumTier = allowedTiersFor(user).has('premium') ? user.premiumTier : 'free';
    // super curtidas de hoje (dia de São Paulo, plano efetivo); o cache abaixo não passa da meia-noite de lá
    const superLikes = await readSuperLikeQuota(this.prisma, userId, user);

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
      // @ do Instagram sem o @ (público no cartão)
      instagram: user.instagramHandle ?? null,
      // retida por denúncia: pro dono, apagada (photo-retention.ts)
      photos: ownerVisible(user.photos).map((p) => ({
        id: p.id,
        url: photoUrl(p.url),
        thumbnailUrl: photoUrl(p.thumbnailUrl),
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
        visibilityMode,
        // fim da janela do invisível grátis (null: visível ou Premium vigente, sem prazo)
        anonymousUntil:
          visibleAnonymousUntil({
            premiumTier: user.premiumTier,
            premiumExpiresAt: user.premiumExpiresAt,
            visibilityMode,
            anonymousUntil,
          })?.toISOString() ?? null,
        showDistance: user.showDistance,
        showAge: user.showAge,
        showPhotoOnMap: user.showPhotoOnMap,
        discoveryMode: user.discoveryMode,
        // orientação: exibir no cartão / mesma orientação primeiro (padrão false); "Mostrar" recíproco (padrão everyone)
        showOrientation: user.showOrientation,
        sameOrientationFirst: user.sameOrientationFirst,
        showMe: user.showMe,
        // faixa de idade que eu vejo (não recíproca; 18–99 = sem limite)
        ageMin: user.ageMin,
        ageMax: user.ageMax,
        isPaused,
        pausedUntil: pausedUntil?.toISOString() ?? null,
      },
      stats: {
        likesReceived: user._count.likesReceived ?? 0,
        matches: matchesCount,
        superLikesToday: superLikes.used,
        superLikesRemainingToday: superLikes.remaining,
        superLikeDailyLimit: superLikes.limit,
      },
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: user.lastActiveAt.toISOString(),
      role: user.role,
      legal: { acceptedVersion: user.termsVersion, currentVersion: LEGAL_VERSION },
    };

    // cache não passa do fim da pausa/assinatura/janela do invisível, senão o app vê estado vencido por até 1h
    const now = Date.now();
    const edges = [
      pausedUntil,
      user.premiumExpiresAt,
      visibilityMode === 'anonymous' ? anonymousUntil : null,
      new Date(superLikes.resetsAt),
    ]
      .filter((d): d is Date => !!d && d.getTime() > now)
      .map((d) => Math.ceil((d.getTime() - now) / 1000));
    await this.redis.cacheProfile(userId, profile, Math.max(1, Math.min(3600, ...edges)));
    return profile;
  }

  async update(
    userId: string,
    dto: {
      name?: string;
      bio?: string;
      gender?: Gender;
      lookingFor?: string;
      orientation?: Orientation | null;
      instagram?: string | null;
      interests?: string[];
      avatar?: unknown;
    },
  ) {
    const data: Record<string, unknown> = {};
    // nome: sem espaços sobrando e com 2+ letras (só espaço não apaga o nome de ninguém)
    if (dto.name !== undefined) {
      const name = cleanName(dto.name);
      if (!name) throw new BadRequestException(NAME_INVALID);
      data.name = name;
    }
    const bio = cleanBio(dto.bio);
    if (bio !== undefined) data.bio = bio;
    // gênero: Mulher / Homem / Outro (o DTO já barra o resto; a descoberta relê do banco)
    if (dto.gender) data.gender = dto.gender;
    if (dto.lookingFor) data.lookingFor = dto.lookingFor;

    // @ do Instagram: normaliza (@, link, maiúsculas) e valida pela regra do Instagram; '' ou null apaga
    const insta = parseInstagramInput(dto.instagram);
    if (insta && !insta.ok) throw new BadRequestException(INSTAGRAM_INVALID);
    if (insta?.ok) data.instagramHandle = insta.handle;

    // filtro de abuso só no que está mudando (nome, bio, @), antes de gravar qualquer coisa: 400 text_blocked
    const blocked = checkProfileText({
      name: data.name as string | undefined,
      bio: data.bio as string | null | undefined,
      instagram: data.instagramHandle as string | null | undefined,
    });
    if (blocked) throw new BadRequestException(blocked);

    // orientação (dado sensível): null apaga e revoga (flags e carimbo zeram); valor novo carimba o consentimento
    if (dto.orientation !== undefined) {
      const cur = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { orientation: true },
      });
      Object.assign(data, orientationPatch(cur?.orientation ?? null, dto.orientation));
    }

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
      // troca a lista inteira numa transação (nunca fica pela metade); nome fora do catálogo é ignorado
      const names = cleanInterestNames(dto.interests);
      await this.prisma.$transaction(async (tx) => {
        await tx.userInterest.deleteMany({ where: { userId } });
        if (!names.length) return;
        const rows = await tx.interest.findMany({
          where: { name: { in: names } },
          select: { id: true },
        });
        if (rows.length > 0) {
          await tx.userInterest.createMany({
            data: rows.map((i) => ({ userId, interestId: i.id })),
            skipDuplicates: true,
          });
        }
      });
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
      showOrientation?: boolean;
      sameOrientationFirst?: boolean;
      showMe?: ShowMe;
      ageMin?: number;
      ageMax?: number;
    },
  ) {
    // faixa de idade: fora da regra = 400 age_range_invalid (nunca o 500 do CHECK users_age_range_chk)
    const { ageMin, ageMax, visibilityMode, ...rest } = dto;
    const age = ageRangeUpdate(ageMin, ageMax);
    if (age && !age.ok) throw new BadRequestException(AGE_RANGE_INVALID);
    // exibir/ordenar pela orientação sem ter orientação: 400 claro (o CHECK users_orientation_flags_chk viraria 500)
    if (rest.showOrientation === true || rest.sameOrientationFirst === true) {
      const cur = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { orientation: true },
      });
      if (orientationFlagsBlocked(rest, cur?.orientation ?? null))
        throw new BadRequestException(ORIENTATION_REQUIRED);
    }
    // a faixa grava antes do resto: uma ponta só trava contra a outra no próprio UPDATE (sem corrida com outro PATCH);
    // se não pegar, nada mais foi gravado. Antes, gasta 1 das mudanças do dia (429 age_range_limit)
    if (age?.ok) {
      await this.spendAgeRangeChange(userId, age.data);
      const r = await this.prisma.user.updateMany({
        where: { id: userId, ...(age.guard ?? {}) },
        data: age.data,
      });
      if (!r.count) throw new BadRequestException(AGE_RANGE_INVALID);
    }
    // visibilidade tem regra própria (prazo do invisível grátis no banco): vai pelo setVisibility, depois dos outros
    if (Object.keys(rest).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: rest as never,
      });
    }
    let anonymousUntil: string | null = null;
    if (visibilityMode)
      anonymousUntil = (await this.setVisibility(userId, visibilityMode)).anonymousUntil;
    await this.redis.invalidateProfile(userId);
    return { ok: true, ...dto, ...(visibilityMode ? { anonymousUntil } : {}) };
  }

  /**
   * Faixa de idade: no máximo AGE_RANGE_DAILY_CHANGES mudanças por dia de São Paulo (contador no Redis por pessoa e
   * dia). Igual ao gravado não gasta; faixa final fora da regra = 400 sem gastar. Sem o limite, trocar a faixa e olhar
   * o /nearby achava o bloco de idade de quem esconde em poucos minutos.
   */
  private async spendAgeRangeChange(
    userId: string,
    data: { ageMin?: number; ageMax?: number },
    now: Date = new Date(),
  ): Promise<void> {
    const cur = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ageMin: true, ageMax: true },
    });
    if (!cur) throw new NotFoundException('Usuário não encontrado');
    const next = nextAgeRange(cur, data);
    if (!next) throw new BadRequestException(AGE_RANGE_INVALID);
    if (!next.changed) return;
    // chave com o dia: vira sozinha à meia-noite de São Paulo (o prazo de 2 dias só limpa o Redis)
    const used = await this.redis.incrRate(userId, `age_range:${superLikeDay(now)}`, 2 * 86_400);
    if (used > AGE_RANGE_DAILY_CHANGES)
      throw new HttpException(
        ageRangeLimitBody(superLikeResetsAt(now)),
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  /**
   * Liga/desliga o invisível (PATCH /me/settings e POST /anonymous/enable|disable): uma regra só (common/premium).
   * Grátis: janela de 24 h gravada em anonymous_until; PATCH repetido com a janela valendo NÃO estende; desligar e
   * religar abre janela nova (pode religar quando quiser). Premium vigente: sem prazo. A linha fica travada (FOR
   * UPDATE) contra a tarefa que expira a janela no mesmo instante.
   */
  async setVisibility(
    userId: string,
    mode: 'visible' | 'anonymous',
  ): Promise<{ visibilityMode: 'visible' | 'anonymous'; anonymousUntil: string | null }> {
    const r = await this.prisma.$transaction(async (tx) => {
      const [u] = await tx.$queryRaw<
        {
          premium_tier: string;
          premium_expires_at: Date | null;
          visibility_mode: string;
          anonymous_until: Date | null;
        }[]
      >`
        SELECT premium_tier::text AS premium_tier, premium_expires_at, visibility_mode::text AS visibility_mode, anonymous_until
          FROM users WHERE id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!u) throw new NotFoundException('Usuário não encontrado');
      if (mode === 'visible') {
        await tx.user.update({
          where: { id: userId },
          data: { visibilityMode: 'visible', anonymousUntil: null },
        });
        return { until: null, locked: false };
      }
      const premium = isPremiumActive({
        premiumTier: u.premium_tier,
        premiumExpiresAt: u.premium_expires_at,
      });
      const d = decideAnonymous({
        premium,
        visibilityMode: u.visibility_mode,
        anonymousUntil: u.anonymous_until,
      });
      await tx.user.update({
        where: { id: userId },
        data: { visibilityMode: 'anonymous', anonymousUntil: d.until },
      });
      return { until: d.until, locked: !premium };
    });
    // invisível sem Premium não manda nem recebe mensagens (inbox/visibility.messagingLocked): sai dos chats abertos
    if (r.locked) await this.chat.leaveAllConversations(userId).catch(() => undefined);
    await this.redis.invalidateProfile(userId);
    return { visibilityMode: mode, anonymousUntil: r.until?.toISOString() ?? null };
  }

  // ---- áreas privadas: coordenada precisa do PRÓPRIO usuário; a resposta só devolve rótulo/raio ----
  async listPrivateAreas(userId: string) {
    const rows = await this.prisma.privateArea.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((a) => ({
      id: a.id,
      label: a.label,
      radiusM: a.radiusM,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async addPrivateArea(
    userId: string,
    dto: { label: string; latitude: number; longitude: number; radiusM?: number },
  ) {
    const count = await this.prisma.privateArea.count({ where: { userId } });
    if (count >= PRIVACY.PRIVATE_AREAS_MAX)
      throw new BadRequestException(`No máximo ${PRIVACY.PRIVATE_AREAS_MAX} áreas privadas`);
    const radiusM = Math.round(
      Math.min(
        PRIVACY.PRIVATE_AREA_MAX_RADIUS_M,
        Math.max(
          PRIVACY.PRIVATE_AREA_MIN_RADIUS_M,
          dto.radiusM ?? PRIVACY.PRIVATE_AREA_DEFAULT_RADIUS_M,
        ),
      ),
    );
    const a = await this.prisma.privateArea.create({
      data: {
        userId,
        label: dto.label.trim() || 'Área privada',
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusM,
      },
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

  /**
   * Anexa um upload ao perfil. Só vale upload do PRÓPRIO usuário, fresco (menos de 23 h) e ainda não usado
   * (media_objects); a miniatura vem do upload, nunca do cliente. Repetir o mesmo pedido devolve a mesma foto.
   * Trava a linha do usuário: dois POSTs juntos não colidem no UNIQUE(user_id, order_index).
   */
  async addPhoto(userId: string, ref: { key?: string; url?: string }, isMain?: boolean) {
    const key = ref.key ?? keyFromPhotoUrl(ref.url);
    if (!isValidKey(key)) throw new BadRequestException(UPLOAD_NOT_FOUND);
    const { photo, created } = await this.prisma.$transaction(async (tx) => {
      const [u] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM users WHERE id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!u) throw new NotFoundException('Usuário não encontrado');
      const same = await tx.photo.findFirst({ where: { userId, url: key } });
      // a retida não volta pelo anexo repetido (o claim abaixo falha: o upload já foi usado)
      if (same && !isRetainedPhoto(same.moderationLabels)) return { photo: same, created: false };
      // teto ANTES de mexer na principal (antes zerava a principal e só depois dava 400); retida não conta
      const count = ownerVisible(
        await tx.photo.findMany({ where: { userId }, select: { moderationLabels: true } }),
      ).length;
      if (count >= MAX_PHOTOS) throw new BadRequestException(`Máximo de ${MAX_PHOTOS} fotos`);
      // posse + frescor: delete_after = created_at + TTL é a marca de upload que ninguém liberou nem o GC pegou
      const [claim] = await tx.$queryRaw<{ thumb_key: string | null }[]>`
        UPDATE media_objects SET attached_at = now(), delete_after = NULL
         WHERE key = ${key} AND owner_id = ${userId}::uuid AND kind = 'photo' AND attached_at IS NULL
           AND created_at > now() - make_interval(hours => ${UPLOAD_ATTACH_WINDOW_H}::int)
           AND delete_after = created_at + make_interval(hours => ${UPLOAD_ORPHAN_TTL_H}::int)
        RETURNING thumb_key`;
      if (!claim) throw new BadRequestException(UPLOAD_NOT_FOUND);
      const makeMain = isMain ?? count === 0; // primeira foto vira principal automaticamente
      if (makeMain) await tx.photo.updateMany({ where: { userId }, data: { isMain: false } });
      const last = await tx.photo.aggregate({ where: { userId }, _max: { orderIndex: true } });
      const row = await tx.photo.create({
        data: {
          userId,
          url: key,
          thumbnailUrl: claim.thumb_key ?? key,
          isMain: makeMain,
          // retidas ficam no negativo: a nova nunca nasce abaixo de 0
          orderIndex: Math.max(last._max.orderIndex ?? -1, -1) + 1,
          // com a moderação ligada a foto nasce "em análise": ninguém além do dono vê até ser aprovada
          status: this.photoModeration.initialStatus(),
        },
      });
      return { photo: row, created: true };
    });
    if (created) {
      this.photoModeration.enqueue(photo.id);
      await this.refreshCompleteness(userId);
    }
    return {
      id: photo.id,
      url: photoUrl(photo.url),
      thumbnailUrl: photoUrl(photo.thumbnailUrl),
      orderIndex: photo.orderIndex,
      isMain: photo.isMain,
      status: photo.status,
      rejectReason: photo.rejectReason,
    };
  }

  /** aceite dos Termos/Política (cadastro antigo ou versão nova): grava a versão e a data */
  async acceptTerms(userId: string, version: string) {
    if (version !== LEGAL_VERSION)
      throw new BadRequestException({
        error: 'terms_outdated',
        message: 'Os termos mudaram: abra de novo pra ver a versão atual',
      });
    await this.prisma.user.update({
      where: { id: userId },
      data: { termsVersion: version, termsAcceptedAt: new Date() },
    });
    await this.redis.invalidateProfile(userId);
    return { acceptedVersion: version, currentVersion: LEGAL_VERSION };
  }

  /**
   * Apaga a foto: o gatilho photos_release_media põe original e miniatura na fila media_objects (rótulo 'urgent' =
   * guarda 180 dias) e o GC apaga o arquivo logo depois do commit. Com denúncia underage/child_safety pendente ou em
   * análise contra o dono, a foto NÃO sai (sumiria da frente do moderador): fica retida — some do perfil dele e do
   * público, a ficha da moderação mostra com a marca — até a denúncia fechar (photo-retention.ts). Pro dono é igual:
   * a foto some. Reindexa e garante uma principal na mesma transação.
   */
  async deletePhoto(userId: string, photoId: string) {
    if (!UUID_RE.test(photoId)) throw new NotFoundException('Foto não encontrada');
    const { photo, retained } = await this.prisma.$transaction(async (tx) => {
      // mesma trava do addPhoto: não cruza com um anexo simultâneo
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      // e a da foto: a decisão da moderação (PhotoModerationService.decide) não cruza com a retenção
      await tx.$queryRaw`SELECT 1 FROM photos WHERE id = ${photoId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      const found = await tx.photo.findFirst({ where: { id: photoId, userId } });
      // retida já saiu da vista do dono: pra ele, não existe mais
      if (!found || isRetainedPhoto(found.moderationLabels))
        throw new NotFoundException('Foto não encontrada');
      const wasMain = found.isMain;
      const hold = (await ownersOnEvidenceHold(tx, [userId])).has(userId);
      if (hold) {
        const min = await tx.photo.aggregate({ where: { userId }, _min: { orderIndex: true } });
        await tx.photo.update({
          where: { id: photoId },
          data: {
            status: 'rejected',
            isMain: false,
            orderIndex: retainedOrderIndex(min._min.orderIndex),
            moderationLabels: withRetainedMark(found.moderationLabels, {
              at: new Date().toISOString(),
              prevStatus: found.status,
              wasMain: found.isMain,
            }),
          },
        });
        await tx.moderationAction.create({
          data: {
            moderatorId: null,
            targetUserId: userId,
            action: 'photo_retain',
            photoId,
            note: 'apagada pela pessoa com denúncia aberta de menor/abuso infantil: retida pra análise',
          },
        });
      } else {
        await tx.photo.delete({ where: { id: photoId } });
      }
      const rest = ownerVisible(
        await tx.photo.findMany({ where: { userId }, orderBy: { orderIndex: 'asc' } }),
      );
      for (let i = 0; i < rest.length; i++) {
        const isMainNow = wasMain ? i === 0 : rest[i].isMain;
        if (rest[i].orderIndex === i && rest[i].isMain === isMainNow) continue;
        await tx.photo.update({
          where: { id: rest[i].id },
          data: { orderIndex: i, isMain: isMainNow },
        });
      }
      return { photo: found, retained: hold };
    });
    // retida: o arquivo fica (continua em photos); o GC só entra quando a denúncia fechar
    if (!retained) this.mediaGc?.kick([photo.url, photo.thumbnailUrl]);
    await this.refreshCompleteness(userId);
    return { ok: true };
  }

  async reorderPhotos(userId: string, photoIds: string[]) {
    const own = ownerVisible(
      await this.prisma.photo.findMany({
        where: { userId },
        select: { id: true, moderationLabels: true },
      }),
    );
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
    // retida (ou de outra conta / inexistente) nunca vira principal: antes zerava a principal e não punha nenhuma
    const target = UUID_RE.test(photoId)
      ? await this.prisma.photo.findFirst({
          where: { id: photoId, userId },
          select: { moderationLabels: true },
        })
      : null;
    if (!target || isRetainedPhoto(target.moderationLabels))
      throw new NotFoundException('Foto não encontrada');
    await this.prisma.photo.updateMany({ where: { userId }, data: { isMain: false } });
    await this.prisma.photo.updateMany({ where: { id: photoId, userId }, data: { isMain: true } });
    await this.redis.invalidateProfile(userId);
    return { ok: true };
  }

  listInterests(): Promise<InterestItem[]> {
    return this.prisma.interest.findMany({
      select: { id: true, name: true, icon: true, category: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Garante que o avatar só usa itens free (assinatura cancelada ou vencida): normaliza e salva se mudou.
   * Devolve a config vigente. `current` evita uma query quando o caller já tem a config em mãos.
   */
  async downgradeAvatarToFree(userId: string, current?: unknown): Promise<unknown> {
    const cfg =
      current !== undefined
        ? current
        : (
            await this.prisma.user.findUnique({
              where: { id: userId },
              select: { avatarConfig: true },
            })
          )?.avatarConfig;
    if (cfg == null || isValidAvatarConfig(cfg, FREE_TIERS)) return cfg ?? null;
    const normalized = normalizeAvatarConfig(cfg, FREE_TIERS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarConfig: normalized as never },
    });
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
    return profileCompleteness({
      name: u.name,
      bio: u.bio,
      photos: ownerVisible(u.photos).length,
      interests: u.userInterests.length,
      lookingFor: u.lookingFor,
      isVerified: u.isVerified,
    });
  }

  private age(birth: Date): number {
    const t = new Date();
    let a = t.getFullYear() - birth.getFullYear();
    const m = t.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < birth.getDate())) a -= 1;
    return a;
  }
}
