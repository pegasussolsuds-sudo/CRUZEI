import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
// Gera o "Vocês se cruzaram no Bar do Léo" — a frase que aparece no match.
@Injectable()
export class MatchContextService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(userAId: string, userBId: string): Promise<string | null> {
    // 1) POI em comum nas últimas 5h
    const commonPoi = await this.prisma.$queryRaw<
      { poi_id: string; times: number }[]
    >`
      SELECT poi_id::text, COUNT(*)::int as times
      FROM locations
      WHERE user_id IN (${userAId}::uuid, ${userBId}::uuid)
        AND expires_at > NOW()
        AND poi_id IS NOT NULL
      GROUP BY poi_id
      HAVING COUNT(DISTINCT user_id) = 2
      ORDER BY times DESC
      LIMIT 1
    `;

    if (commonPoi[0]?.poi_id) {
      const poi = await this.prisma.pOI.findUnique({ where: { id: BigInt(commonPoi[0].poi_id) } });
      if (poi) return `Vocês se cruzaram no ${poi.name}`;
    }

    // 2) Proximidade direta (< 500m) nas últimas 5h
    const close = await this.prisma.$queryRaw<
      { dist: number; lat: number; lng: number }[]
    >`
      SELECT
        ST_Distance(a.location::geography, b.location::geography) as dist,
        ST_Y(a.location::geometry) as lat,
        ST_X(a.location::geometry) as lng
      FROM locations a, locations b
      WHERE a.user_id = ${userAId}::uuid
        AND b.user_id = ${userBId}::uuid
        AND a.expires_at > NOW()
        AND b.expires_at > NOW()
        AND ST_DWithin(a.location::geography, b.location::geography, 500)
      ORDER BY dist ASC
      LIMIT 1
    `;

    if (close[0]) {
      const when = this.formatWhen(new Date());
      // nunca metros (privacidade): só "bem perto" / "perto" — o histórico já é grosseiro (~110 m)
      const dist = Number(close[0].dist);
      return dist <= 150 ? `Vocês estiveram bem perto ${when}` : `Vocês estiveram perto ${when}`;
    }

    return null;
  }

  async shouldRenewChat(matchId: string): Promise<boolean> {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return false;
    const shared = await this.prisma.$queryRaw<{ poi_id: string }[]>`
      SELECT poi_id::text
      FROM locations
      WHERE user_id IN (${match.userAId}::uuid, ${match.userBId}::uuid)
        AND recorded_at > NOW() - INTERVAL '72 hours'
        AND poi_id IS NOT NULL
      GROUP BY poi_id
      HAVING COUNT(DISTINCT user_id) = 2
      LIMIT 1
    `;
    return shared.length > 0;
  }

  private formatWhen(d: Date): string {
    const today = new Date();
    const same = today.toDateString() === d.toDateString();
    if (same) return 'hoje';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (yesterday.toDateString() === d.toDateString()) return 'ontem';
    return d.toLocaleDateString('pt-BR');
  }
}
