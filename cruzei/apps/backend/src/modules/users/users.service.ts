import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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
        _count: { select: { likesReceived: true, matchesAsA: true, matchesAsB: true } },
      },
    });
    if (!user || user.deletedAt) throw new NotFoundException('Usuário não encontrado');

    const matchesCount = (user._count.matchesAsA ?? 0) + (user._count.matchesAsB ?? 0);

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
      })),
      interests: user.userInterests.map((ui) => ui.interest.name),
      seals: user.seals.map((s) => ({
        type: s.sealType,
        progress: s.progress,
        target: s.target,
        isCompleted: s.isCompleted,
      })),
      premiumTier: user.premiumTier,
      isVerified: user.isVerified,
      profileCompleteness: user.profileCompleteness,
      settings: {
        visibilityMode: user.visibilityMode,
        showDistance: user.showDistance,
        showAge: user.showAge,
        isPaused: user.isPaused,
        pausedUntil: user.pausedUntil?.toISOString() ?? null,
      },
      stats: {
        likesReceived: user._count.likesReceived ?? 0,
        matches: matchesCount,
        superLikesToday: 0, // TODO: integrar Redis
      },
      createdAt: user.createdAt.toISOString(),
      lastActiveAt: user.lastActiveAt.toISOString(),
    };

    await this.redis.cacheProfile(userId, profile, 3600);
    return profile;
  }

  async update(
    userId: string,
    dto: { name?: string; bio?: string; lookingFor?: string; orientation?: string; interests?: string[] },
  ) {
    const data: Record<string, unknown> = {};
    if (dto.name) data.name = dto.name.trim();
    if (dto.bio !== undefined) data.bio = dto.bio.trim() || null;
    if (dto.lookingFor) data.lookingFor = dto.lookingFor;
    if (dto.orientation) data.orientation = dto.orientation;

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
    dto: { visibilityMode?: 'visible' | 'anonymous'; showDistance?: boolean; showAge?: boolean },
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: dto as never,
    });
    await this.redis.invalidateProfile(userId);
    return { ok: true, ...dto };
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

  async addPhoto(userId: string, url: string, thumbnailUrl?: string, isMain?: boolean) {
    const count = await this.prisma.photo.count({ where: { userId } });
    const makeMain = isMain ?? count === 0; // primeira foto vira principal automaticamente

    if (makeMain) {
      await this.prisma.photo.updateMany({ where: { userId }, data: { isMain: false } });
    }
    const photo = await this.prisma.photo.create({
      data: {
        userId,
        url,
        thumbnailUrl: thumbnailUrl ?? url,
        isMain: makeMain,
        orderIndex: count,
      },
    });
    await this.refreshCompleteness(userId);
    return {
      id: photo.id,
      url: photo.url,
      thumbnailUrl: photo.thumbnailUrl,
      orderIndex: photo.orderIndex,
      isMain: photo.isMain,
    };
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
