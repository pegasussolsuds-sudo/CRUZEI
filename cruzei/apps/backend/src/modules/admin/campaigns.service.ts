import type {
  AdminCampaign,
  AdminCampaignList,
  CampaignAudience,
  CampaignChannels,
  CampaignConfirmError,
  CampaignPreview,
  CampaignStatus,
  CreateCampaignPayload,
  NotificationTarget,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type PushCampaign } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { parseTarget } from '../notifications/notification-target';
import { NotifyService } from '../notifications/notify.service';

import {
  audienceSql,
  needsConfirmation,
  parseAudience,
  parseChannels,
  type PrefKind,
} from './audience';
import { AuditService } from './audit.service';
import { cursorDate, decodeCursor, encodeCursor, pageSize } from './cursor';

/** agendada até 60 dias; "agora" = até 30 s no futuro */
const MAX_AHEAD_MS = 60 * 86_400_000;
const NOW_SLACK_MS = 30_000;
/** lote de envio: grava/avisa 1000 por vez e atualiza os contadores (o painel acompanha o progresso) */
const SEND_CHUNK = 1_000;
/** 'sending' sem sinal de vida (processo caiu no meio): vira 'failed' — nunca reenvia sozinho (evita duplicar) */
const STALE_SENDING_MIN = 10;

export interface CampaignInput extends CreateCampaignPayload {
  /** campanha ligada a evento (aviso de evento): preferência 'events' e tipo 'event' */
  eventId?: string | null;
}

/**
 * Campanhas do painel (push + central de avisos). Envio "agora" é pego na criação (status 'sending'); o agendado é
 * pego pelo cron do minuto com UPDATE ... FOR UPDATE SKIP LOCKED — cada campanha sai uma vez só, mesmo com vários
 * workers/hosts rodando o cron. Tudo passa pelo NotifyService.
 */
@Injectable()
export class CampaignsService {
  private readonly log = new Logger(CampaignsService.name);
  /** envios em andamento neste processo (testes esperam por eles; nada depende disso em produção) */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  // ---------- público ----------

  private async audienceIds(a: CampaignAudience, pref: PrefKind): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(audienceSql(a, pref));
    return rows.map((r) => r.id);
  }

  async preview(rawAudience: unknown, eventId?: string | null): Promise<CampaignPreview> {
    const a = parseAudience(rawAudience);
    const [r] = await this.prisma.$queryRaw<{ total: number; with_push: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = a.id))::int AS with_push
        FROM (${audienceSql(a, eventId ? 'events' : 'campaigns')}) a`;
    return { targetCount: r?.total ?? 0, withPushDevice: r?.with_push ?? 0 };
  }

  // ---------- criar / cancelar ----------

  async create(admin: AuthenticatedUser, p: CampaignInput): Promise<AdminCampaign> {
    const title = p.title?.trim() ?? '';
    const body = p.body?.trim() ?? '';
    if (title.length < 1 || title.length > 80)
      throw new BadRequestException({
        error: 'invalid_title',
        message: 'Título de 1 a 80 caracteres',
      });
    if (body.length < 1 || body.length > 240)
      throw new BadRequestException({
        error: 'invalid_body',
        message: 'Texto de 1 a 240 caracteres',
      });
    const audience = parseAudience(p.audience);
    const channels: CampaignChannels = parseChannels(p.channels);
    let target: NotificationTarget | null = null;
    if (p.target != null) {
      target = parseTarget(p.target);
      // match é pessoal (push social): o painel não aponta pra ele
      if (!target || target.kind === 'match')
        throw new BadRequestException({
          error: 'invalid_target',
          message: 'Destino do toque inválido',
        });
    }
    const now = Date.now();
    let scheduledAt: Date | null = null;
    if (p.scheduledAt) {
      const d = new Date(p.scheduledAt);
      if (Number.isNaN(d.getTime()))
        throw new BadRequestException({
          error: 'invalid_schedule',
          message: 'Data de envio inválida',
        });
      if (d.getTime() > now + MAX_AHEAD_MS)
        throw new BadRequestException({
          error: 'invalid_schedule',
          message: 'Agende no máximo 60 dias à frente',
        });
      if (d.getTime() > now + NOW_SLACK_MS) scheduledAt = d;
    }
    const preview = await this.preview(audience, p.eventId);
    if (preview.targetCount === 0) {
      throw new UnprocessableEntityException({
        error: 'empty_audience',
        message: 'Ninguém recebe essa campanha com esse público',
      });
    }
    if (
      needsConfirmation(audience, preview.targetCount) &&
      p.confirmCount !== preview.targetCount
    ) {
      const body409: CampaignConfirmError = {
        error: 'confirm_required',
        message: `Confirme digitando o número de pessoas: ${preview.targetCount}`,
        targetCount: preview.targetCount,
      };
      throw new ConflictException(body409);
    }
    const c = await this.prisma.pushCampaign.create({
      data: {
        title,
        body,
        target: (target ?? Prisma.DbNull) as Prisma.InputJsonValue,
        audience: audience as unknown as Prisma.InputJsonValue,
        channels: channels as unknown as Prisma.InputJsonValue,
        // "agora" já nasce pego por este processo (o cron só pega 'scheduled'): não sai duas vezes
        status: scheduledAt ? 'scheduled' : 'sending',
        scheduledAt: scheduledAt ?? new Date(),
        startedAt: scheduledAt ? null : new Date(),
        eventId: p.eventId ?? null,
        createdBy: admin.id,
        targetCount: preview.targetCount,
        // em ms (e não o now() do banco, em µs): o cursor da lista compara exatamente o que o JS guardou
        createdAt: new Date(),
      },
    });
    await this.audit.record(
      admin.id,
      p.eventId
        ? 'admin.event.announce'
        : scheduledAt
          ? 'admin.campaign.schedule'
          : 'admin.campaign.send',
      p.eventId ? { kind: 'event', id: p.eventId } : { kind: 'campaign', id: c.id },
      `${title} → ${preview.targetCount} pessoa(s)${scheduledAt ? ` em ${scheduledAt.toISOString()}` : ''}`,
      { campaignId: c.id, audience, channels },
    );
    if (!scheduledAt) this.startDelivery(c.id);
    return (await this.toAdmin([c]))[0];
  }

  async cancel(admin: AuthenticatedUser, id: string): Promise<AdminCampaign> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE push_campaigns SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = ${id}::uuid AND status = 'scheduled' RETURNING id`;
    const c = await this.prisma.pushCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException({ error: 'not_found', message: 'Campanha não encontrada' });
    if (!rows.length)
      throw new ConflictException({
        error: 'not_scheduled',
        message: 'Só dá pra cancelar campanha agendada',
      });
    await this.audit.record(admin.id, 'admin.campaign.cancel', { kind: 'campaign', id }, c.title);
    return (await this.toAdmin([c]))[0];
  }

  /** agendadas de um evento cancelado não saem */
  async cancelForEvent(eventId: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE push_campaigns SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE event_id = ${eventId}::uuid AND status = 'scheduled'`;
  }

  // ---------- envio ----------

  private startDelivery(id: string): void {
    const p = this.deliver(id).finally(() => this.running.delete(id));
    this.running.set(id, p);
  }

  /** espera o envio em andamento neste processo (testes e a fumaça) */
  async settle(id: string): Promise<void> {
    await this.running.get(id);
  }

  /**
   * Cron do minuto: pega UMA agendada vencida por vez (UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED))
   * e envia. Duas instâncias ao mesmo tempo nunca pegam a mesma: a segunda pula a linha travada ou já vê 'sending'.
   */
  async dispatchDue(max = 20): Promise<number> {
    await this.failStale();
    let n = 0;
    for (; n < max; n++) {
      const [claimed] = await this.prisma.$queryRaw<{ id: string }[]>`
        UPDATE push_campaigns SET status = 'sending', started_at = now(), updated_at = now()
         WHERE id = (SELECT id FROM push_campaigns WHERE status = 'scheduled' AND scheduled_at <= now()
                      ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`;
      if (!claimed) break;
      await this.deliver(claimed.id);
    }
    return n;
  }

  private async failStale(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE push_campaigns SET status = 'failed', error = 'envio interrompido (servidor reiniciou no meio)', updated_at = now()
       WHERE status = 'sending' AND updated_at < now() - (${STALE_SENDING_MIN}::int * interval '1 minute')`;
  }

  /** envia uma campanha já pega ('sending'): público calculado AGORA, em lotes, contadores a cada lote */
  private async deliver(id: string): Promise<void> {
    try {
      const c = await this.prisma.pushCampaign.findUnique({ where: { id } });
      if (!c || c.status !== 'sending') return;
      const audience = parseAudience(c.audience);
      const channels = parseChannels(c.channels);
      const target = parseTarget(c.target);
      const ids = await this.audienceIds(audience, c.eventId ? 'events' : 'campaigns');
      await this.prisma.pushCampaign.update({ where: { id }, data: { targetCount: ids.length } });
      for (let i = 0; i < ids.length; i += SEND_CHUNK) {
        const r = await this.notify.notify(
          ids.slice(i, i + SEND_CHUNK),
          {
            type: c.eventId ? 'event' : 'campaign',
            title: c.title,
            body: c.body,
            target,
            campaignId: id,
          },
          channels,
        );
        await this.prisma.$executeRaw`
          UPDATE push_campaigns SET notified = notified + ${r.notified}::int, push_sent = push_sent + ${r.pushSent}::int,
                 push_failed = push_failed + ${r.pushFailed}::int, updated_at = now()
           WHERE id = ${id}::uuid`;
      }
      await this.prisma.pushCampaign.update({
        where: { id },
        data: { status: 'sent', sentAt: new Date() },
      });
      this.log.log(`campanha ${id} enviada pra ${ids.length} pessoa(s)`);
    } catch (e) {
      this.log.error(`campanha ${id} falhou: ${(e as Error).message}`);
      await this.prisma.pushCampaign
        .update({
          where: { id },
          data: { status: 'failed', error: (e as Error).message.slice(0, 255) },
        })
        .catch(() => undefined);
    }
  }

  // ---------- leitura ----------

  async list(q: {
    cursor?: string;
    limit?: unknown;
    eventId?: string;
  }): Promise<AdminCampaignList> {
    const limit = pageSize(q.limit, 30, 100);
    const cur = decodeCursor(q.cursor, 2);
    const rows = await this.prisma.pushCampaign.findMany({
      where: {
        ...(q.eventId ? { eventId: q.eventId } : {}),
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: cursorDate(cur[0]) } },
                { createdAt: cursorDate(cur[0]), id: { lt: cur[1] } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.toAdmin(page),
      nextCursor:
        rows.length > limit && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
      pushEnabled: this.notify.pushEnabled,
    };
  }

  async get(id: string): Promise<AdminCampaign> {
    const c = await this.prisma.pushCampaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundException({ error: 'not_found', message: 'Campanha não encontrada' });
    return (await this.toAdmin([c]))[0];
  }

  async toAdmin(rows: PushCampaign[]): Promise<AdminCampaign[]> {
    const creators = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => !!v))];
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: creators } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      body: c.body,
      target: parseTarget(c.target),
      audience: c.audience as unknown as CampaignAudience,
      channels: c.channels as unknown as CampaignChannels,
      status: c.status as CampaignStatus,
      scheduledAt: c.scheduledAt?.toISOString() ?? null,
      sentAt: c.sentAt?.toISOString() ?? null,
      eventId: c.eventId,
      createdBy: c.createdBy ? { id: c.createdBy, name: names.get(c.createdBy) ?? '—' } : null,
      createdAt: c.createdAt.toISOString(),
      stats: {
        targetCount: c.targetCount,
        notified: c.notified,
        pushSent: c.pushSent,
        pushFailed: c.pushFailed,
        opened: c.opened,
      },
    }));
  }
}
