import {
  ANALYTICS_LIMITS,
  ANALYTICS_RETENTION_MONTHS,
  type AnalyticsBatchResult,
} from '@cruzei/shared-types';
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

import {
  allowedEvents,
  FIRST_STEP,
  gateUnstarted,
  isFirstStep,
  isValidInstallId,
  NEW_INSTALLS_PER_IP_DAY,
  sanitizeBatch,
} from './analytics-sanitize';

const TZ = 'America/Sao_Paulo';
/** limpeza em fatias (não segura a tabela num DELETE gigante) */
const PURGE_CHUNK = 5_000;
/** o /analytics/link só grava o signup_done que faltou se a conta é nova (o cadastro normalmente já gravou) */
const LINK_SIGNUP_WINDOW_MIN = 60;
/** ligar à conta (login/cadastro) só puxa eventos anônimos desta janela (h) */
export const LINK_WINDOW_HOURS = 24;

/** quem mandou o lote: conta (Bearer válido) ou nada, e o IP (chave do limite de instalações novas) */
export interface IngestSource {
  userId: string | null;
  /** ipTracker(req): 'ip:<endereço>' */
  ip: string;
}

const tooMany = () =>
  new HttpException(
    {
      error: 'too_many_requests',
      message: 'Muitas tentativas. Espera um minuto e tenta de novo.',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/**
 * Métricas próprias (tabela analytics_events; sem empresa de fora, sem posição). O app manda em lote; aqui só entra o
 * que é da lista fechada. Antes da conta vale o installId (id aleatório da instalação, não é id do aparelho); no
 * cadastro/login os eventos daquela instalação ganham o user_id.
 */
@Injectable()
export class AnalyticsService {
  private readonly log = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * POST /analytics/events: grava o que sobrar do saneamento; `accepted` = linhas gravadas. Sem conta só entra
   * onboarding_* e app_open; instalação que nunca mandou o 1º passo tem o lote ignorado (menos app_open com conta) e,
   * ao mandar o 1º passo, conta no limite de instalações novas do IP.
   */
  async ingest(
    installId: string,
    raw: readonly unknown[],
    src: IngestSource,
    now = new Date(),
  ): Promise<AnalyticsBatchResult> {
    await this.assertInstallRate(installId);
    const { userId } = src;
    const hasAccount = userId != null;
    let events = allowedEvents(sanitizeBatch(raw, now), hasAccount);
    // app_open de quem tem conta entra sempre: nem vai ao banco ver o 1º passo
    if (events.length && !(hasAccount && events.every((e) => e.name === 'app_open'))) {
      if (!(await this.hasFirstStep(installId))) {
        events = gateUnstarted(events, hasAccount);
        if (events.some(isFirstStep)) await this.assertNewInstallQuota(src.ip);
      }
    }
    if (!events.length) return { accepted: 0 };
    const names = events.map((e) => e.name);
    // sem null dentro dos arrays (o Prisma não infere o tipo de array com null): '' = vazio, NULLIF no SQL
    const steps = events.map((e) => e.step ?? '');
    const props = events.map((e) => (e.props ? JSON.stringify(e.props) : ''));
    const ats = events.map((e) => e.at.toISOString());
    // user_id só se a conta existe (conta apagada no meio do caminho vira anônimo em vez de estourar a FK);
    // app_open: um por instalação por dia de São Paulo, conferido contra o que já está gravado
    const accepted = await this.prisma.$executeRaw`
      INSERT INTO analytics_events (user_id, install_id, name, step, props, created_at)
      SELECT (SELECT id FROM users WHERE id = ${userId}::uuid), ${installId}, e.name,
             NULLIF(e.step, ''), NULLIF(e.props, '')::jsonb, e.at::timestamptz
        FROM unnest(${names}::text[], ${steps}::text[], ${props}::text[], ${ats}::text[]) AS e(name, step, props, at)
       WHERE e.name <> 'app_open'
          OR NOT EXISTS (
            SELECT 1 FROM analytics_events x
             WHERE x.install_id = ${installId} AND x.name = 'app_open'
               AND x.created_at >= (date_trunc('day', e.at::timestamptz AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ})
               AND x.created_at < ((date_trunc('day', e.at::timestamptz AT TIME ZONE ${TZ}) + interval '1 day') AT TIME ZONE ${TZ}))`;
    return { accepted };
  }

  /**
   * POST /analytics/link: os eventos anônimos desta instalação (das últimas LINK_WINDOW_HOURS h) passam a ser da
   * conta — se ela não é de OUTRA conta. Se a conta acabou de nascer e o cadastro não gravou o signup_done
   * (app/servidor sem o installId no cadastro), grava agora.
   */
  async link(userId: string, installId: string, now = new Date()): Promise<void> {
    const mine = await this.claimInstall(userId, installId, now);
    await this.insertSignup(userId, mine ? installId : null, true);
  }

  /**
   * Chamado pelo POST /auth/register quando vem RegisterRequest.installId: liga os eventos anônimos da instalação
   * (mesmas regras do link) e grava signup_done (uma vez por conta). Nunca derruba o cadastro: erro aqui só vira aviso
   * no log.
   */
  async recordSignup(userId: string, installId?: string | null, now = new Date()): Promise<void> {
    try {
      const inst = isValidInstallId(installId) ? installId : null;
      const mine = inst ? await this.claimInstall(userId, inst, now) : false;
      await this.insertSignup(userId, mine ? inst : null, false);
    } catch (e) {
      this.log.warn(`signup_done não gravado: ${(e as Error).message}`);
    }
  }

  /** apaga o que passou de ANALYTICS_RETENTION_MONTHS (cron diário), em fatias */
  async purgeOld(now = new Date()): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - ANALYTICS_RETENTION_MONTHS);
    let total = 0;
    for (let i = 0; i < 1_000; i++) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM analytics_events
         WHERE id IN (SELECT id FROM analytics_events WHERE created_at < ${cutoff} LIMIT ${PURGE_CHUNK})`;
      total += n;
      if (n < PURGE_CHUNK) break;
    }
    return total;
  }

  /**
   * signup_done na hora da criação da conta, uma vez por conta (duplicata numa corrida é inofensiva: o painel conta
   * pessoas distintas). `recentOnly`: só se a conta tem menos de LINK_SIGNUP_WINDOW_MIN (login antigo não é cadastro).
   */
  private async insertSignup(
    userId: string,
    installId: string | null,
    recentOnly: boolean,
  ): Promise<void> {
    const recent = recentOnly
      ? Prisma.sql`AND u.created_at > (now() AT TIME ZONE 'UTC') - make_interval(mins => ${LINK_SIGNUP_WINDOW_MIN}::int)`
      : Prisma.empty;
    await this.prisma.$executeRaw`
      INSERT INTO analytics_events (user_id, install_id, name, created_at)
      SELECT u.id, ${installId}, 'signup_done', (u.created_at AT TIME ZONE 'UTC')
        FROM users u
       WHERE u.id = ${userId}::uuid ${recent}
         AND NOT EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id = u.id AND e.name = 'signup_done')`;
  }

  /**
   * O installId vem do app (livre): só liga os eventos anônimos das últimas LINK_WINDOW_HOURS h, e nada se a
   * instalação já tem evento de OUTRA conta (aparelho de outra pessoa / id copiado). false = é de outra conta.
   */
  private async claimInstall(userId: string, installId: string, now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - LINK_WINDOW_HOURS * 3_600_000).toISOString();
    // o UPDATE no WITH roda sempre (Postgres), mesmo sem ninguém ler a saída; `o` enxerga o antes
    const [r] = await this.prisma.$queryRaw<{ other: boolean }[]>`
      WITH o AS (
        SELECT EXISTS (
          SELECT 1 FROM analytics_events
           WHERE install_id = ${installId} AND user_id IS NOT NULL AND user_id <> ${userId}::uuid) AS other
      ), upd AS (
        UPDATE analytics_events SET user_id = ${userId}::uuid
         WHERE install_id = ${installId} AND user_id IS NULL AND created_at >= ${since}::timestamptz
           AND NOT (SELECT other FROM o)
      )
      SELECT other FROM o`;
    return !r?.other;
  }

  /** a instalação já mandou o 1º passo do funil (índice por install_id) */
  private async hasFirstStep(installId: string): Promise<boolean> {
    const [r] = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM analytics_events
         WHERE install_id = ${installId} AND step = ${FIRST_STEP}
           AND name IN ('onboarding_step_view', 'onboarding_step_done')) AS ok`;
    return r?.ok === true;
  }

  /** ANALYTICS_LIMITS.perMinute POSTs por instalação (o throttle da rota cuida do IP/conta); Redis fora = deixa passar */
  private async assertInstallRate(installId: string): Promise<void> {
    const n = await this.redis.incrRate(`install:${installId}`, 'analytics', 60).catch(() => 0);
    if (n > ANALYTICS_LIMITS.perMinute) throw tooMany();
  }

  /**
   * NEW_INSTALLS_PER_IP_DAY instalações novas por IP por dia (quem inventa installId à vontade para aqui). 429: o app
   * guarda o lote e tenta de novo mais tarde. Redis fora = deixa passar.
   */
  private async assertNewInstallQuota(ip: string): Promise<void> {
    const n = await this.redis.incrRate(ip, 'analytics_new_install', 86_400).catch(() => 0);
    if (n > NEW_INSTALLS_PER_IP_DAY) throw tooMany();
  }
}
