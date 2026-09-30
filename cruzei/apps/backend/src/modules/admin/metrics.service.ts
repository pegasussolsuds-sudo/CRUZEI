import type {
  AdminActive,
  AdminFunnel,
  AdminRetention,
  DailyPoint,
  WeeklyPoint,
} from '@cruzei/shared-types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

import { cohortReady, funnelSteps, retentionCell } from './metrics';

const TZ = 'America/Sao_Paulo';
const CACHE_PREFIX = 'admin:metrics:v1:';
/** contas pesadas (funil, retenção): 2 min de cache seguram vários admins com a página aberta */
const CACHE_S = 120;
/** semanas no gráfico de ativos por semana */
const ACTIVE_WEEKS = 12;

/**
 * Página "Métricas" do painel (só admin): funil do cadastro, retenção D1/D7/D30 por semana de cadastro e ativos.
 * Tudo agregado (nenhuma pessoa aparece), dia e semana (segunda a domingo) de São Paulo.
 *
 * Fontes: analytics_events (TIMESTAMPTZ) pro funil e app_open; users.created_at e access_logs.created_at são
 * TIMESTAMP em UTC — comparados sempre com "UTC sem fuso" (não dependem do fuso da sessão).
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  funnel(days: number): Promise<AdminFunnel> {
    return this.cached(`funnel:${days}`, () => this.computeFunnel(days));
  }

  retention(weeks: number): Promise<AdminRetention> {
    return this.cached(`retention:${weeks}`, () => this.computeRetention(weeks));
  }

  active(days: number): Promise<AdminActive> {
    return this.cached(`active:${days}`, () => this.computeActive(days));
  }

  /**
   * Instalações distintas que viram / concluíram cada etapa desde a 00:00 (São Paulo) de `days` dias atrás.
   * Fica de fora quem só ENTROU numa conta que já existia (login em aparelho novo passa por boas-vindas, telefone e
   * código e sairia como "desistiu no nome"): instalação cujas contas ligadas nasceram todas antes do 1º evento dela.
   */
  async computeFunnel(days: number): Promise<AdminFunnel> {
    const [rows, head] = await Promise.all([
      this.prisma.$queryRaw<{ step: string; viewed: number; done: number }[]>`
        WITH ev AS (
          SELECT e.install_id, e.user_id, e.name, e.step
            FROM analytics_events e
           WHERE e.name IN ('onboarding_step_view', 'onboarding_step_done')
             AND e.install_id IS NOT NULL
             AND e.created_at >= ((((now() AT TIME ZONE ${TZ})::date - ${days - 1}::int)::timestamp) AT TIME ZONE ${TZ})
        ),
        first_seen AS (
          SELECT e.install_id, min(e.created_at) AS first_at
            FROM analytics_events e
           WHERE e.install_id IN (SELECT DISTINCT install_id FROM ev)
             AND e.name IN ('onboarding_step_view', 'onboarding_step_done')
           GROUP BY e.install_id
        ),
        logins AS (
          SELECT ev.install_id
            FROM ev
            JOIN first_seen f ON f.install_id = ev.install_id
            JOIN users u ON u.id = ev.user_id
           GROUP BY ev.install_id, f.first_at
          HAVING bool_and((u.created_at AT TIME ZONE 'UTC') < f.first_at - interval '1 minute')
        )
        SELECT ev.step,
               count(DISTINCT ev.install_id) FILTER (WHERE ev.name = 'onboarding_step_view')::int AS viewed,
               count(DISTINCT ev.install_id) FILTER (WHERE ev.name = 'onboarding_step_done')::int AS done
          FROM ev
         WHERE NOT EXISTS (SELECT 1 FROM logins l WHERE l.install_id = ev.install_id)
         GROUP BY ev.step`,
      this.prisma.$queryRaw<{ from_ts: Date; now_ts: Date; signups: number }[]>`
        WITH b AS (
          SELECT ((((now() AT TIME ZONE ${TZ})::date - ${days - 1}::int)::timestamp) AT TIME ZONE ${TZ}) AS from_ts
        )
        SELECT b.from_ts, now() AS now_ts,
               (SELECT count(DISTINCT COALESCE(e.user_id::text, e.install_id))
                  FROM analytics_events e
                 WHERE e.name = 'signup_done' AND e.created_at >= b.from_ts)::int AS signups
          FROM b`,
    ]);
    const steps = funnelSteps(rows);
    const h = head[0];
    return {
      from: new Date(h?.from_ts ?? Date.now()).toISOString(),
      to: new Date(h?.now_ts ?? Date.now()).toISOString(),
      installs: steps.find((s) => s.step === 'welcome')?.viewed ?? 0,
      signups: h?.signups ?? 0,
      steps,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Grupos = contas 'user' criadas por semana (as últimas `weeks`, a mais recente primeiro; semana sem cadastro vem
   * com 0). Voltou no dia N = login/renovação do token (access_logs) ou app_open EXATAMENTE no dia do cadastro + N.
   */
  async computeRetention(weeks: number): Promise<AdminRetention> {
    const rows = await this.prisma.$queryRaw<
      { week: string; signups: number; d1: number; d7: number; d30: number; today: string }[]
    >`
      WITH b AS (
        SELECT (now() AT TIME ZONE ${TZ})::date AS today,
               date_trunc('week', (now() AT TIME ZONE ${TZ}))::date - ${(weeks - 1) * 7}::int AS w0
      ),
      wk AS (
        SELECT generate_series(b.w0::timestamp, date_trunc('week', b.today::timestamp), interval '7 days')::date AS week
          FROM b
      ),
      cohort AS (
        SELECT u.id, ((u.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date AS d0
          FROM users u, b
         WHERE u.created_at >= ((b.w0::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')
           AND u.role = 'user'
      ),
      act AS (
        SELECT a.user_id, ((a.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date AS day
          FROM access_logs a, b
         WHERE a.created_at >= ((b.w0::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')
           AND a.user_id IN (SELECT id FROM cohort)
        UNION
        SELECT e.user_id, (e.created_at AT TIME ZONE ${TZ})::date
          FROM analytics_events e, b
         WHERE e.name = 'app_open'
           AND e.created_at >= (b.w0::timestamp AT TIME ZONE ${TZ})
           AND e.user_id IN (SELECT id FROM cohort)
      ),
      per_user AS (
        SELECT c.id, date_trunc('week', c.d0::timestamp)::date AS week,
               COALESCE(bool_or(a.day = c.d0 + 1), false) AS r1,
               COALESCE(bool_or(a.day = c.d0 + 7), false) AS r7,
               COALESCE(bool_or(a.day = c.d0 + 30), false) AS r30
          FROM cohort c
          LEFT JOIN act a ON a.user_id = c.id AND a.day IN (c.d0 + 1, c.d0 + 7, c.d0 + 30)
         GROUP BY c.id, c.d0
      )
      SELECT to_char(wk.week, 'YYYY-MM-DD') AS week,
             count(p.id)::int AS signups,
             count(p.id) FILTER (WHERE p.r1)::int AS d1,
             count(p.id) FILTER (WHERE p.r7)::int AS d7,
             count(p.id) FILTER (WHERE p.r30)::int AS d30,
             (SELECT to_char(today, 'YYYY-MM-DD') FROM b) AS today
        FROM wk
        LEFT JOIN per_user p ON p.week = wk.week
       GROUP BY wk.week
       ORDER BY wk.week DESC`;
    return {
      cohorts: rows.map((r) => ({
        week: r.week,
        signups: r.signups,
        d1: retentionCell(r.signups, r.d1, cohortReady(r.week, 1, r.today)),
        d7: retentionCell(r.signups, r.d7, cohortReady(r.week, 7, r.today)),
        d30: retentionCell(r.signups, r.d30, cohortReady(r.week, 30, r.today)),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Contas distintas que abriram o app (access_logs ∪ app_open com conta) por dia (`days` dias) e por semana
   * (ACTIVE_WEEKS), mais hoje / 7 / 30 dias. O UNION já deixa uma linha por pessoa por dia.
   */
  async computeActive(days: number): Promise<AdminActive> {
    const [r] = await this.prisma.$queryRaw<
      {
        daily: DailyPoint[] | null;
        weekly: WeeklyPoint[] | null;
        dau: number;
        wau: number;
        mau: number;
      }[]
    >`
      WITH b AS (
        SELECT (now() AT TIME ZONE ${TZ})::date AS today
      ),
      w AS (
        SELECT today,
               today - ${days - 1}::int AS day0,
               date_trunc('week', today::timestamp)::date - ${(ACTIVE_WEEKS - 1) * 7}::int AS week0
          FROM b
      ),
      s AS (
        SELECT today, day0, week0, LEAST(day0, week0, today - 29) AS start FROM w
      ),
      act AS (
        SELECT a.user_id, ((a.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date AS day
          FROM access_logs a, s
         WHERE a.created_at >= ((s.start::timestamp AT TIME ZONE ${TZ}) AT TIME ZONE 'UTC')
        UNION
        SELECT e.user_id, (e.created_at AT TIME ZONE ${TZ})::date
          FROM analytics_events e, s
         WHERE e.name = 'app_open' AND e.user_id IS NOT NULL
           AND e.created_at >= (s.start::timestamp AT TIME ZONE ${TZ})
      )
      SELECT
        (SELECT json_agg(json_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n', COALESCE(x.n, 0)) ORDER BY d.day)
           FROM (SELECT generate_series(s.day0::timestamp, s.today::timestamp, interval '1 day')::date AS day FROM s) d
           LEFT JOIN (SELECT day, count(*)::int AS n FROM act GROUP BY day) x ON x.day = d.day) AS daily,
        (SELECT json_agg(json_build_object('week', to_char(d.week, 'YYYY-MM-DD'), 'n', COALESCE(x.n, 0)) ORDER BY d.week)
           FROM (SELECT generate_series(s.week0::timestamp, date_trunc('week', s.today::timestamp), interval '7 days')::date AS week
                   FROM s) d
           LEFT JOIN (SELECT date_trunc('week', day::timestamp)::date AS week, count(DISTINCT user_id)::int AS n
                        FROM act GROUP BY 1) x ON x.week = d.week) AS weekly,
        (SELECT count(DISTINCT user_id) FROM act, s WHERE act.day = s.today)::int AS dau,
        (SELECT count(DISTINCT user_id) FROM act, s WHERE act.day > s.today - 7)::int AS wau,
        (SELECT count(DISTINCT user_id) FROM act, s WHERE act.day > s.today - 30)::int AS mau`;
    return {
      daily: r?.daily ?? [],
      weekly: r?.weekly ?? [],
      dau: r?.dau ?? 0,
      wau: r?.wau ?? 0,
      mau: r?.mau ?? 0,
      generatedAt: new Date().toISOString(),
    };
  }

  private async cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const k = CACHE_PREFIX + key;
    const hit = await this.redis.client.get(k).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
    const out = await compute();
    await this.redis.client.set(k, JSON.stringify(out), 'EX', CACHE_S).catch(() => undefined);
    return out;
  }
}
