import type { AdminStats, DailyPoint } from '@cruzei/shared-types';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

const CACHE_KEY = 'admin:stats:v1';
/** o painel recarrega sozinho; 60 s de cache seguram vários admins abertos sem repetir as contagens */
const CACHE_S = 60;
const TZ = 'America/Sao_Paulo';
const DAYS = 30;

// colunas TIMESTAMP (sem fuso) do banco guardam UTC: compara com "agora em UTC" (não depende do fuso da sessão)
const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
/** início (00:00 de São Paulo) do 1º dia da série, em UTC sem fuso — cabe no índice das colunas TIMESTAMP */
const SERIES_START_UTC = Prisma.sql`((((now() AT TIME ZONE ${TZ})::date - ${DAYS - 1}::int)::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')`;

type SeriesSource = 'users' | 'access_logs' | 'messages' | 'likes';

/** tabela/coluna/contagem de cada série (identificadores fixos, nunca vindos da requisição) */
const SERIES: Record<SeriesSource, { from: Prisma.Sql; count: Prisma.Sql; where: Prisma.Sql }> = {
  users: {
    from: Prisma.raw('users'),
    count: Prisma.raw('count(*)'),
    where: Prisma.raw('deleted_at IS NULL'),
  },
  // ativos por dia: quem renovou o token/logou naquele dia (registro de acesso guardado por 6 meses)
  access_logs: {
    from: Prisma.raw('access_logs'),
    count: Prisma.raw('count(DISTINCT user_id)'),
    where: Prisma.raw('true'),
  },
  messages: {
    from: Prisma.raw('messages'),
    count: Prisma.raw('count(*)'),
    where: Prisma.raw("message_type <> 'system'"),
  },
  likes: { from: Prisma.raw('likes'), count: Prisma.raw('count(*)'), where: Prisma.raw('true') },
};

/** Números do painel (GET /admin/stats). Só agregados; séries de 30 dias no fuso de São Paulo. */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async stats(): Promise<AdminStats> {
    const cached = await this.redis.client.get(CACHE_KEY).catch(() => null);
    if (cached) return JSON.parse(cached) as AdminStats;
    const out = await this.compute();
    await this.redis.client
      .set(CACHE_KEY, JSON.stringify(out), 'EX', CACHE_S)
      .catch(() => undefined);
    return out;
  }

  private async compute(): Promise<AdminStats> {
    const [
      users,
      anon,
      mod,
      places,
      support,
      activity,
      push,
      signups,
      activeUsers,
      messages,
      likes,
    ] = await Promise.all([
      this.prisma.$queryRaw<Record<string, number>[]>`
        SELECT count(*) FILTER (WHERE deleted_at IS NULL)::int AS total,
               count(*) FILTER (WHERE deleted_at IS NULL AND created_at > ${NOW_UTC} - interval '24 hours')::int AS new24h,
               count(*) FILTER (WHERE deleted_at IS NULL AND created_at > ${NOW_UTC} - interval '7 days')::int AS new7d,
               count(*) FILTER (WHERE deleted_at IS NULL AND last_active_at > ${NOW_UTC} - interval '24 hours')::int AS active24h,
               count(*) FILTER (WHERE deleted_at IS NULL AND last_active_at > ${NOW_UTC} - interval '7 days')::int AS active7d,
               count(*) FILTER (WHERE deleted_at IS NULL AND premium_tier = 'premium'
                                  AND (premium_expires_at IS NULL OR premium_expires_at > ${NOW_UTC}))::int AS premium,
               count(*) FILTER (WHERE deleted_at IS NULL AND premium_tier = 'premium_plus'
                                  AND (premium_expires_at IS NULL OR premium_expires_at > ${NOW_UTC}))::int AS premium_plus,
               count(*) FILTER (WHERE deleted_at IS NULL AND account_status = 'suspended')::int AS suspended,
               count(*) FILTER (WHERE deleted_at IS NULL AND account_status = 'banned')::int AS banned,
               count(*) FILTER (WHERE deleted_at IS NULL AND review_hold_at IS NOT NULL)::int AS review_hold
          FROM users`,
      // no mapa agora em modo anônimo: a última posição viva de cada pessoa é anônima
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM (
          SELECT DISTINCT ON (user_id) is_anonymous FROM locations WHERE expires_at > ${NOW_UTC}
           ORDER BY user_id, recorded_at DESC) t
         WHERE t.is_anonymous`,
      this.prisma.$queryRaw<Record<string, number>[]>`
        SELECT (SELECT count(*) FROM reports WHERE status = 'pending')::int AS reports_pending,
               (SELECT count(*) FROM photos WHERE status = 'pending')::int AS photos_pending`,
      this.prisma.$queryRaw<Record<string, number>[]>`
        SELECT (SELECT count(*) FROM place_candidates WHERE status = 'pending')::int AS candidates,
               (SELECT count(DISTINCT r.poi_id) FROM poi_reports r JOIN pois p ON p.id = r.poi_id
                 WHERE r.resolved_at IS NULL AND p.hidden_at IS NULL)::int AS poi_reports,
               (SELECT count(*) FROM events WHERE status = 'published' AND starts_at <= now() AND ends_at > now())::int AS live,
               (SELECT count(*) FROM events WHERE status = 'published' AND starts_at > now())::int AS upcoming`,
      this.prisma.$queryRaw<
        { open: number; unassigned: number; waiting: number; avg_min: number | null }[]
      >`
        SELECT count(*) FILTER (WHERE status <> 'resolved')::int AS open,
               count(*) FILTER (WHERE status <> 'resolved' AND assigned_to IS NULL)::int AS unassigned,
               count(*) FILTER (WHERE status = 'open')::int AS waiting,
               (SELECT round(avg(extract(epoch FROM (first_response_at - created_at)) / 60)::numeric, 1)::float8
                  FROM support_threads WHERE created_at > now() - interval '7 days' AND first_response_at IS NOT NULL) AS avg_min
          FROM support_threads`,
      this.prisma.$queryRaw<Record<string, number>[]>`
        SELECT (SELECT count(*) FROM messages WHERE created_at > ${NOW_UTC} - interval '24 hours' AND message_type <> 'system')::int AS messages,
               (SELECT count(*) FROM likes WHERE created_at > ${NOW_UTC} - interval '24 hours')::int AS likes,
               -- par que virou mútuo nas últimas 24 h: a 2ª curtida do par caiu na janela
               (SELECT count(*) FROM likes a
                 WHERE a.created_at > ${NOW_UTC} - interval '24 hours'
                   AND EXISTS (SELECT 1 FROM likes b WHERE b.liker_id = a.liked_id AND b.liked_id = a.liker_id AND b.created_at <= a.created_at))::int AS mutual,
               (SELECT count(*) FROM conversations WHERE created_at > ${NOW_UTC} - interval '24 hours')::int AS conversations`,
      this.prisma.$queryRaw<Record<string, number>[]>`
        SELECT (SELECT count(*) FROM device_tokens)::int AS devices,
               (SELECT count(*) FROM push_campaigns WHERE status = 'sent' AND sent_at > now() - interval '7 days')::int AS campaigns`,
      this.series('users'),
      this.series('access_logs'),
      this.series('messages'),
      this.series('likes'),
    ]);
    const u = users[0] ?? {};
    const s = support[0];
    return {
      generatedAt: new Date().toISOString(),
      users: {
        total: u.total ?? 0,
        new24h: u.new24h ?? 0,
        new7d: u.new7d ?? 0,
        active24h: u.active24h ?? 0,
        active7d: u.active7d ?? 0,
        premium: u.premium ?? 0,
        premiumPlus: u.premium_plus ?? 0,
        suspended: u.suspended ?? 0,
        banned: u.banned ?? 0,
        anonymousNow: anon[0]?.n ?? 0,
      },
      moderation: {
        reportsPending: mod[0]?.reports_pending ?? 0,
        photosPending: mod[0]?.photos_pending ?? 0,
        reviewHold: u.review_hold ?? 0,
      },
      places: {
        candidatesPending: places[0]?.candidates ?? 0,
        poiReportsPending: places[0]?.poi_reports ?? 0,
        eventsLive: places[0]?.live ?? 0,
        eventsUpcoming: places[0]?.upcoming ?? 0,
      },
      support: {
        open: s?.open ?? 0,
        unassigned: s?.unassigned ?? 0,
        waitingStaff: s?.waiting ?? 0,
        avgFirstResponseMin7d: s?.avg_min ?? null,
      },
      activity: {
        messages24h: activity[0]?.messages ?? 0,
        likes24h: activity[0]?.likes ?? 0,
        mutualLikes24h: activity[0]?.mutual ?? 0,
        conversationsNew24h: activity[0]?.conversations ?? 0,
      },
      push: { devices: push[0]?.devices ?? 0, campaignsSent7d: push[0]?.campaigns ?? 0 },
      series: { signups, activeUsers, messages, likes },
    };
  }

  /** 30 dias (fuso de São Paulo), com zero nos dias sem nada; uma consulta agrupada por série */
  private async series(source: SeriesSource): Promise<DailyPoint[]> {
    const t = SERIES[source];
    const rows = await this.prisma.$queryRaw<{ day: string; n: number }[]>`
      WITH days AS (
        SELECT generate_series((now() AT TIME ZONE ${TZ})::date - ${DAYS - 1}::int, (now() AT TIME ZONE ${TZ})::date, interval '1 day')::date AS day
      ), agg AS (
        SELECT ((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date AS day, ${t.count}::int AS n
          FROM ${t.from}
         WHERE created_at >= ${SERIES_START_UTC} AND ${t.where}
         GROUP BY 1
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(a.n, 0)::int AS n
        FROM days d LEFT JOIN agg a ON a.day = d.day
       ORDER BY d.day`;
    return rows.map((r) => ({ day: r.day, n: r.n }));
  }
}
