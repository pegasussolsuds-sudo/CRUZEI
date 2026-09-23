import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { bboxAround, distanceMeters } from '@cruzei/shared-utils';

@Injectable()
export class PoisService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async nearby(lat: number, lng: number, radiusM: number, categories?: string[]) {
    const bbox = bboxAround(lat, lng, radiusM);
    const pois = await this.prisma.pOI.findMany({
      where: {
        latitude: { gte: bbox.south, lte: bbox.north },
        longitude: { gte: bbox.west, lte: bbox.east },
        ...(categories && categories.length > 0 ? { category: { in: categories as never } } : {}),
      },
      take: 100,
    });

    const enriched = await Promise.all(
      pois.map(async (poi) => {
        const dist = distanceMeters(lat, lng, Number(poi.latitude), Number(poi.longitude));
        if (dist > radiusM) return null;
        const userCount = await this.countUsersAtPOI(Number(poi.id));
        return {
          id: Number(poi.id),
          name: poi.name,
          category: poi.category,
          subcategory: poi.subcategory,
          latitude: Number(poi.latitude),
          longitude: Number(poi.longitude),
          address: poi.address,
          rating: poi.rating ? Number(poi.rating) : null,
          totalRatings: poi.totalRatings,
          isPartner: poi.isPartner,
          partnerOffer: poi.partnerOffer,
          distanceM: Math.round(dist),
          userCount,
        };
      }),
    );

    return enriched.filter((p): p is NonNullable<typeof p> => p !== null);
  }

  async get(id: number) {
    const poi = await this.prisma.pOI.findUnique({ where: { id: BigInt(id) } });
    if (!poi) throw new NotFoundException('POI não encontrado');
    const userCount = await this.countUsersAtPOI(id);
    return {
      id: Number(poi.id),
      name: poi.name,
      category: poi.category,
      subcategory: poi.subcategory,
      latitude: Number(poi.latitude),
      longitude: Number(poi.longitude),
      address: poi.address,
      neighborhood: poi.neighborhood,
      city: poi.city,
      state: poi.state,
      rating: poi.rating ? Number(poi.rating) : null,
      totalRatings: poi.totalRatings,
      phone: poi.phone,
      website: poi.website,
      hours: poi.hours,
      photos: poi.photos,
      isPartner: poi.isPartner,
      partnerOffer: poi.partnerOffer,
      userCount,
    };
  }

  async getPeople(id: number) {
    const users = await this.prisma.user.findMany({
      where: {
        locations: { some: { poiId: BigInt(id), expiresAt: { gt: new Date() } } },
        visibilityMode: 'visible',
      },
      select: {
        id: true,
        name: true,
        birthDate: true,
        photos: { where: { isMain: true }, select: { url: true } },
      },
      take: 50,
    });
    return {
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        age: this.age(u.birthDate),
        mainPhotoUrl: u.photos[0]?.url ?? null,
        isVisible: true,
        isAnonymous: false,
      })),
      count: users.length,
    };
  }

  async checkin(userId: string, poiId: number) {
    const c = await this.prisma.poisCheckin.create({
      data: { userId, poiId: BigInt(poiId) },
    });
    return { checkinId: Number(c.id), expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString() };
  }

  async hotspotsInCity(city: string) {
    // POIs com >= 3 usuários ativos via Redis ZSET
    const candidates = await this.prisma.pOI.findMany({
      where: { city },
      take: 200,
    });
    const enriched = await Promise.all(
      candidates.map(async (poi) => {
        const users = await this.countUsersAtPOI(Number(poi.id));
        return { poi, userCount: users };
      }),
    );
    return enriched
      .filter((e) => e.userCount >= 3)
      .map((e) => ({
        poi: {
          id: Number(e.poi.id),
          name: e.poi.name,
          category: e.poi.category,
          rating: e.poi.rating ? Number(e.poi.rating) : null,
        },
        userCount: e.userCount,
        latitude: Number(e.poi.latitude),
        longitude: Number(e.poi.longitude),
        lastUserAt: new Date().toISOString(),
      }))
      .sort((a, b) => b.userCount - a.userCount);
  }

  private async countUsersAtPOI(poiId: number): Promise<number> {
    const recent = await this.prisma.location.findMany({
      where: { poiId: BigInt(poiId), expiresAt: { gt: new Date() } },
      distinct: ['userId'],
      select: { userId: true },
    });
    return recent.length;
  }

  private age(birth: Date): number {
    const t = new Date();
    let a = t.getFullYear() - birth.getFullYear();
    const m = t.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < birth.getDate())) a -= 1;
    return a;
  }
}
