import type {
  AdminCampaign,
  AdminEvent,
  AdminEventList,
  AnnouncePayload,
  CampaignStatus,
  EventCategory,
  EventStatus,
  UpsertEventPayload,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Event } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { LocationService } from '../location/location.service';

import { AuditService } from './audit.service';
import { CampaignsService } from './campaigns.service';
import { cursorDate, decodeCursor, encodeCursor, pageSize } from './cursor';

export const EVENT_CATEGORIES: readonly EventCategory[] = [
  'event',
  'show',
  'party',
  'festival',
  'sports',
  'other',
];

const SP_TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
});

/** categoria do POI de mapa: 'show' vira show; o resto é evento (o app já filtra/mostra os dois como evento) */
export function mapCategoryOf(c: EventCategory): 'event' | 'show' {
  return c === 'show' ? 'show' : 'event';
}

/**
 * horários no POI: startsAt/endsAt (ISO) pro rótulo calculado na leitura (PoisService.adminEventLabel) e start/end
 * ("20:00") no formato antigo, que o app mais velho já sabe mostrar
 */
export function poiHoursOf(startsAt: Date, endsAt: Date) {
  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    start: SP_TIME.format(startsAt),
    end: SP_TIME.format(endsAt),
  };
}

/**
 * Eventos do painel. Publicar cria/atualiza o POI de mapa (source 'admin', event_id, category event/show) visível até
 * ends_at — o app já mostra "⚡ Evento perto" e o filtro de eventos sem mudança. Cancelar esconde na hora; o cron do
 * minuto esconde os que terminaram. Aviso por push (announce) é campanha ligada ao evento, só admin.
 */
@Injectable()
export class EventsService {
  private readonly log = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly location: LocationService,
    private readonly campaigns: CampaignsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- leitura ----------

  async list(q: {
    status?: string;
    when?: string;
    cursor?: string;
    limit?: unknown;
  }): Promise<AdminEventList> {
    const limit = pageSize(q.limit, 30, 100);
    const cur = decodeCursor(q.cursor, 2);
    const now = new Date();
    const where: Prisma.EventWhereInput = {};
    if (q.status === 'draft' || q.status === 'published' || q.status === 'cancelled')
      where.status = q.status;
    if (q.when === 'upcoming') where.startsAt = { gt: now };
    else if (q.when === 'live')
      Object.assign(where, { startsAt: { lte: now }, endsAt: { gt: now } });
    else if (q.when === 'past') where.endsAt = { lte: now };
    // próximos: o mais perto primeiro; o resto: o mais recente primeiro
    const asc = q.when === 'upcoming';
    if (cur) {
      const at = cursorDate(cur[0]);
      where.OR = asc
        ? [{ startsAt: { gt: at } }, { startsAt: at, id: { gt: cur[1] } }]
        : [{ startsAt: { lt: at } }, { startsAt: at, id: { lt: cur[1] } }];
    }
    const rows = await this.prisma.event.findMany({
      where,
      orderBy: asc ? [{ startsAt: 'asc' }, { id: 'asc' }] : [{ startsAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.toAdmin(page),
      nextCursor:
        rows.length > limit && last ? encodeCursor([last.startsAt.toISOString(), last.id]) : null,
    };
  }

  async get(id: string): Promise<AdminEvent> {
    return (await this.toAdmin([await this.find(id)]))[0];
  }

  private async find(id: string): Promise<Event> {
    const e = await this.prisma.event.findUnique({ where: { id } });
    if (!e) throw new NotFoundException({ error: 'not_found', message: 'Evento não encontrado' });
    return e;
  }

  private async toAdmin(rows: Event[]): Promise<AdminEvent[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const creators = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => !!v))];
    const [names, anns] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: creators } },
        select: { id: true, name: true },
      }),
      this.prisma.pushCampaign.findMany({
        where: { eventId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, eventId: true, status: true, sentAt: true, targetCount: true },
      }),
    ]);
    const nameOf = new Map(names.map((u) => [u.id, u.name]));
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      category: e.category as EventCategory,
      status: e.status as EventStatus,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      venueName: e.venueName,
      lat: Number(e.latitude),
      lng: Number(e.longitude),
      address: e.address,
      city: e.city,
      coverUrl: e.coverUrl,
      poiId: e.poiId != null ? String(e.poiId) : null,
      mapPoiId: e.mapPoiId != null ? String(e.mapPoiId) : null,
      createdBy: e.createdBy ? { id: e.createdBy, name: nameOf.get(e.createdBy) ?? '—' } : null,
      createdAt: e.createdAt.toISOString(),
      publishedAt: e.publishedAt?.toISOString() ?? null,
      cancelledAt: e.cancelledAt?.toISOString() ?? null,
      announcements: anns
        .filter((a) => a.eventId === e.id)
        .map((a) => ({
          campaignId: a.id,
          status: a.status as CampaignStatus,
          sentAt: a.sentAt?.toISOString() ?? null,
          targetCount: a.targetCount,
        })),
    }));
  }

  // ---------- escrita ----------

  /** valida e normaliza (PATCH manda o evento inteiro mesclado com o que já existe) */
  private async normalize(p: UpsertEventPayload) {
    const title = p.title?.trim() ?? '';
    if (title.length < 1 || title.length > 120)
      throw new BadRequestException({
        error: 'invalid_title',
        message: 'Título de 1 a 120 caracteres',
      });
    if (!EVENT_CATEGORIES.includes(p.category))
      throw new BadRequestException({ error: 'invalid_category', message: 'Categoria inválida' });
    const startsAt = new Date(p.startsAt);
    const endsAt = new Date(p.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException({ error: 'invalid_dates', message: 'Datas inválidas' });
    }
    if (endsAt <= startsAt)
      throw new BadRequestException({
        error: 'invalid_dates',
        message: 'O fim tem que ser depois do início',
      });
    if (endsAt.getTime() - startsAt.getTime() > 31 * 86_400_000) {
      throw new BadRequestException({
        error: 'invalid_dates',
        message: 'Evento de no máximo 31 dias',
      });
    }
    if (
      !Number.isFinite(p.lat) ||
      Math.abs(p.lat) > 90 ||
      !Number.isFinite(p.lng) ||
      Math.abs(p.lng) > 180
    ) {
      throw new BadRequestException({ error: 'invalid_point', message: 'Ponto inválido' });
    }
    const description = p.description?.trim() || null;
    if (description && description.length > 2000)
      throw new BadRequestException({
        error: 'invalid_description',
        message: 'Descrição de até 2000 caracteres',
      });
    const coverUrl = p.coverUrl?.trim() || null;
    if (coverUrl && (!/^https?:\/\/[^\s]+$/i.test(coverUrl) || coverUrl.length > 500)) {
      throw new BadRequestException({
        error: 'invalid_cover',
        message: 'Capa precisa ser um link http(s)',
      });
    }
    let poiId: bigint | null = null;
    if (p.poiId) {
      if (!/^\d{1,18}$/.test(p.poiId))
        throw new BadRequestException({ error: 'invalid_poi', message: 'Lugar inválido' });
      const poi = await this.prisma.pOI.findUnique({
        where: { id: BigInt(p.poiId) },
        select: { id: true },
      });
      if (!poi)
        throw new BadRequestException({ error: 'invalid_poi', message: 'Lugar não encontrado' });
      poiId = poi.id;
    }
    return {
      title,
      description,
      category: p.category,
      startsAt,
      endsAt,
      venueName: p.venueName?.trim().slice(0, 255) || null,
      latitude: p.lat,
      longitude: p.lng,
      address: p.address?.trim().slice(0, 500) || null,
      city: p.city?.trim().slice(0, 100) || null,
      coverUrl,
      poiId,
    };
  }

  async create(staff: AuthenticatedUser, p: UpsertEventPayload): Promise<AdminEvent> {
    const data = await this.normalize(p);
    const e = await this.prisma.event.create({
      data: { ...data, createdBy: staff.id, status: 'draft' },
    });
    await this.audit.record(staff.id, 'admin.event.create', { kind: 'event', id: e.id }, e.title);
    return this.get(e.id);
  }

  async update(
    staff: AuthenticatedUser,
    id: string,
    patch: Partial<UpsertEventPayload>,
  ): Promise<AdminEvent> {
    const cur = await this.find(id);
    const merged: UpsertEventPayload = {
      title: patch.title ?? cur.title,
      description: patch.description !== undefined ? patch.description : cur.description,
      category: patch.category ?? (cur.category as EventCategory),
      startsAt: patch.startsAt ?? cur.startsAt.toISOString(),
      endsAt: patch.endsAt ?? cur.endsAt.toISOString(),
      venueName: patch.venueName !== undefined ? patch.venueName : cur.venueName,
      lat: patch.lat ?? Number(cur.latitude),
      lng: patch.lng ?? Number(cur.longitude),
      address: patch.address !== undefined ? patch.address : cur.address,
      city: patch.city !== undefined ? patch.city : cur.city,
      coverUrl: patch.coverUrl !== undefined ? patch.coverUrl : cur.coverUrl,
      poiId: patch.poiId !== undefined ? patch.poiId : cur.poiId != null ? String(cur.poiId) : null,
    };
    const data = await this.normalize(merged);
    const e = await this.prisma.event.update({ where: { id }, data });
    // publicado: o POI do mapa acompanha na hora (terminou com a mudança de horário → some)
    if (e.status === 'published') await this.syncMapPoi(e);
    await this.audit.record(
      staff.id,
      'admin.event.update',
      { kind: 'event', id },
      Object.keys(patch).join(', '),
    );
    return this.get(id);
  }

  async publish(staff: AuthenticatedUser, id: string): Promise<AdminEvent> {
    const cur = await this.find(id);
    if (cur.status === 'cancelled')
      throw new ConflictException({
        error: 'event_cancelled',
        message: 'Evento cancelado não volta: crie outro',
      });
    if (cur.endsAt <= new Date())
      throw new ConflictException({ error: 'event_over', message: 'Esse evento já terminou' });
    const e = await this.prisma.event.update({
      where: { id },
      data: { status: 'published', publishedAt: cur.publishedAt ?? new Date() },
    });
    await this.syncMapPoi(e);
    await this.audit.record(staff.id, 'admin.event.publish', { kind: 'event', id }, e.title);
    return this.get(id);
  }

  /** cria/atualiza o POI de mapa do evento publicado; visível só enquanto não terminou */
  private async syncMapPoi(e: Event): Promise<void> {
    const visible = e.status === 'published' && e.endsAt > new Date();
    const data = {
      name: e.title.slice(0, 255),
      category: mapCategoryOf(e.category as EventCategory),
      subcategory: e.category,
      latitude: e.latitude,
      longitude: e.longitude,
      address: [e.venueName, e.address].filter(Boolean).join(' · ').slice(0, 500) || null,
      city: e.city,
      hours: poiHoursOf(e.startsAt, e.endsAt),
      eventId: e.id,
      hiddenAt: visible ? null : new Date(),
      lastVerifiedAt: new Date(),
    };
    const poi = await this.prisma.pOI.upsert({
      where: { source_externalId: { source: 'admin', externalId: `event:${e.id}` } },
      create: { source: 'admin', externalId: `event:${e.id}`, ...data },
      update: data,
      select: { id: true },
    });
    if (e.mapPoiId !== poi.id)
      await this.prisma.event.update({ where: { id: e.id }, data: { mapPoiId: poi.id } });
    this.location.invalidatePoiIndex();
  }

  async cancel(staff: AuthenticatedUser, id: string): Promise<AdminEvent> {
    const cur = await this.find(id);
    if (cur.status === 'cancelled') return this.get(id);
    await this.prisma.event.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    // some do mapa na hora (o POI fica, oculto: check-ins e denúncias continuam apontando pra ele)
    await this.prisma.pOI.updateMany({
      where: { eventId: id, hiddenAt: null },
      data: { hiddenAt: new Date() },
    });
    const cancelled = await this.campaigns.cancelForEvent(id);
    this.location.invalidatePoiIndex();
    await this.audit.record(
      staff.id,
      'admin.event.cancel',
      { kind: 'event', id },
      cancelled ? `${cur.title} (${cancelled} aviso(s) agendado(s) cancelado(s))` : cur.title,
    );
    return this.get(id);
  }

  async remove(staff: AuthenticatedUser, id: string): Promise<void> {
    const cur = await this.find(id);
    if (cur.status !== 'draft')
      throw new ConflictException({
        error: 'not_draft',
        message: 'Só rascunho pode ser apagado: cancele o evento',
      });
    await this.prisma.event.delete({ where: { id } });
    await this.audit.record(staff.id, 'admin.event.delete', { kind: 'event', id }, cur.title);
  }

  /** aviso por push/central do evento publicado (só admin: a rota exige 'events.push') */
  async announce(admin: AuthenticatedUser, id: string, p: AnnouncePayload): Promise<AdminCampaign> {
    const e = await this.find(id);
    if (e.status !== 'published')
      throw new ConflictException({
        error: 'not_published',
        message: 'Publique o evento antes de avisar',
      });
    if (e.endsAt <= new Date())
      throw new ConflictException({ error: 'event_over', message: 'Esse evento já terminou' });
    return this.campaigns.create(admin, {
      title: p.title,
      body: p.body,
      audience: p.audience,
      channels: p.channels,
      scheduledAt: p.scheduledAt ?? null,
      confirmCount: p.confirmCount,
      target: {
        kind: 'event',
        eventId: e.id,
        poiId: e.mapPoiId != null ? String(e.mapPoiId) : null,
      },
      eventId: e.id,
    });
  }

  /** cron do minuto: POI de evento que terminou (ou não está mais publicado) sai do mapa */
  async hideEnded(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      UPDATE pois p SET hidden_at = now()
        FROM events e
       WHERE p.event_id = e.id AND p.hidden_at IS NULL AND (e.ends_at <= now() OR e.status <> 'published')
      RETURNING p.id`;
    if (rows.length) {
      this.location.invalidatePoiIndex();
      this.log.log(`${rows.length} POI(s) de evento terminado(s) fora do mapa`);
    }
    return rows.length;
  }
}
