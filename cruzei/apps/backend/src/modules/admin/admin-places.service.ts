import type {
  AdminPlaceCandidate,
  AdminPlaceCandidateList,
  AdminPoi,
  AdminPoiList,
  AdminPoiReportList,
  CandidateStatus,
  ResolvePoiReportsPayload,
  UpsertPoiPayload,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { POICategory, Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma.service';
import { localDateBrazil } from '../location/discovery-privacy';
import { LocationService } from '../location/location.service';
import { NotifyService } from '../notifications/notify.service';
import { addDays, evaluateCandidate, type CandidateDecision } from '../pois/crowd-rules';
import { PlaceDiscoveryService } from '../pois/place-discovery.service';

import { AuditService } from './audit.service';
import { cursorBigInt, decodeCursor, encodeCursor, pageSize } from './cursor';

const POI_CATEGORIES = new Set<string>(Object.values(POICategory));
const CANDIDATE_STATUSES: readonly CandidateStatus[] = [
  'pending',
  'promoted',
  'rejected',
  'expired',
];

/** o que o robô da galera faria hoje com o candidato pendente (só informativo pra equipe) */
const HINTS: Record<CandidateDecision, string> = {
  promote_crowd: 'O robô publicaria: multidão no lugar',
  promote_onsite: 'O robô publicaria: 2 confirmações no local',
  promote_requests: 'O robô publicaria: 4 pedidos',
  reject: 'O robô recusaria (negações no local ou tipo de lugar não aceito)',
  expire: 'O robô deixaria vencer (sem sinal há 14 dias)',
  keep: 'Esperando mais sinais',
};

interface PoiDb {
  id: bigint;
  name: string;
  category: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  address: string | null;
  city: string | null;
  source: string;
  hiddenAt: Date | null;
  isPartner: boolean;
  eventId: string | null;
}

const POI_SELECT = {
  id: true,
  name: true,
  category: true,
  latitude: true,
  longitude: true,
  address: true,
  city: true,
  source: true,
  hiddenAt: true,
  isPartner: true,
  eventId: true,
} as const;

export function toAdminPoi(p: PoiDb): AdminPoi {
  return {
    id: String(p.id),
    name: p.name,
    category: p.category,
    lat: Number(p.latitude),
    lng: Number(p.longitude),
    address: p.address,
    city: p.city,
    source: p.source,
    hiddenAt: p.hiddenAt?.toISOString() ?? null,
    isPartner: p.isPartner,
    eventId: p.eventId,
  };
}

function poiIdOf(raw: string): bigint {
  if (!/^\d{1,18}$/.test(raw) || raw === '0')
    throw new NotFoundException({ error: 'not_found', message: 'Lugar não encontrado' });
  return BigInt(raw);
}

/**
 * Lugares no painel: sugestões da galera ("Pôr no Metch"), denúncias de lugar, POIs (criar, editar, ocultar).
 * Ocultar nunca apaga: o POI some de toda leitura do app e volta com o mesmo id.
 */
@Injectable()
export class AdminPlacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: PlaceDiscoveryService,
    private readonly location: LocationService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  // ---------- sugestões ----------

  async candidates(q: {
    status?: string;
    cursor?: string;
    limit?: unknown;
  }): Promise<AdminPlaceCandidateList> {
    const status = (CANDIDATE_STATUSES as readonly string[]).includes(q.status ?? '')
      ? (q.status as CandidateStatus)
      : 'pending';
    const limit = pageSize(q.limit, 30, 100);
    const cur = decodeCursor(q.cursor, 1);
    const today = localDateBrazil();
    const rows = await this.prisma.$queryRaw<CandidateDbRow[]>`
      SELECT c.id, c.status, c.name, c.category::text AS category, c.kind, c.latitude, c.longitude, c.address, c.neighborhood,
             c.city, c.ambiguous, to_char(c.crowd_pass_on, 'YYYY-MM-DD') AS crowd_pass_on,
             to_char(c.created_on, 'YYYY-MM-DD') AS created_on, to_char(c.last_evidence_on, 'YYYY-MM-DD') AS last_evidence_on, c.poi_id,
             count(v.user_id) FILTER (WHERE v.kind = 'request')::int AS requests,
             count(v.user_id) FILTER (WHERE v.kind = 'onsite')::int AS onsite,
             count(v.user_id) FILTER (WHERE v.kind = 'deny')::int AS deny,
             count(v.user_id) FILTER (WHERE v.kind = 'onsite' AND v.voted_on >= ${addDays(today, -2)}::date)::int AS onsite3,
             count(v.user_id) FILTER (WHERE v.kind IN ('request', 'onsite') AND v.voted_on >= ${addDays(today, -13)}::date)::int AS req14,
             count(v.user_id) FILTER (WHERE v.kind = 'deny' AND v.voted_on >= ${addDays(today, -2)}::date)::int AS deny3
        FROM place_candidates c LEFT JOIN place_votes v ON v.candidate_id = c.id
       WHERE c.status = ${status} ${cur ? Prisma.sql`AND c.id < ${cursorBigInt(cur[0])}` : Prisma.empty}
       GROUP BY c.id
       ORDER BY c.id DESC
       LIMIT ${limit + 1}`;
    const items = rows.slice(0, limit).map((r) => this.candidate(r, today));
    return {
      items,
      nextCursor: rows.length > limit ? encodeCursor([items[items.length - 1].id]) : null,
    };
  }

  private candidate(r: CandidateDbRow, today: string): AdminPlaceCandidate {
    const hint =
      r.status === 'pending'
        ? HINTS[
            evaluateCandidate(
              {
                name: r.name,
                kind: r.kind as never,
                ambiguous: r.ambiguous,
                crowdPassOn: r.crowd_pass_on,
                lastEvidenceOn: r.last_evidence_on,
              },
              { onsite3: r.onsite3, req14: r.req14, deny3: r.deny3 },
              today,
            )
          ]
        : null;
    return {
      id: String(r.id),
      status: r.status as CandidateStatus,
      name: r.name,
      category: r.category,
      lat: Number(r.latitude),
      lng: Number(r.longitude),
      address: r.address,
      neighborhood: r.neighborhood,
      city: r.city,
      votes: { requests: r.requests, onsite: r.onsite, deny: r.deny },
      crowdHint: hint,
      firstSeenOn: r.created_on,
      lastEvidenceOn: r.last_evidence_on,
      poiId: r.poi_id != null ? String(r.poi_id) : null,
    };
  }

  private async candidateById(id: bigint): Promise<AdminPlaceCandidate> {
    const today = localDateBrazil();
    const [r] = await this.prisma.$queryRaw<CandidateDbRow[]>`
      SELECT c.id, c.status, c.name, c.category::text AS category, c.kind, c.latitude, c.longitude, c.address, c.neighborhood,
             c.city, c.ambiguous, to_char(c.crowd_pass_on, 'YYYY-MM-DD') AS crowd_pass_on,
             to_char(c.created_on, 'YYYY-MM-DD') AS created_on, to_char(c.last_evidence_on, 'YYYY-MM-DD') AS last_evidence_on, c.poi_id,
             count(v.user_id) FILTER (WHERE v.kind = 'request')::int AS requests,
             count(v.user_id) FILTER (WHERE v.kind = 'onsite')::int AS onsite,
             count(v.user_id) FILTER (WHERE v.kind = 'deny')::int AS deny,
             0 AS onsite3, 0 AS req14, 0 AS deny3
        FROM place_candidates c LEFT JOIN place_votes v ON v.candidate_id = c.id
       WHERE c.id = ${id}
       GROUP BY c.id`;
    if (!r) throw new NotFoundException({ error: 'not_found', message: 'Sugestão não encontrada' });
    return this.candidate(r, today);
  }

  /** aprova (idempotente) e avisa quem pediu/confirmou que o lugar entrou no mapa */
  async approve(staff: AuthenticatedUser, rawId: string): Promise<AdminPlaceCandidate> {
    const id = candidateIdOf(rawId);
    const r = await this.discovery.approveCandidate(id);
    if (r.changed) {
      const poi = await this.prisma.pOI.findUnique({
        where: { id: r.poiId },
        select: { name: true },
      });
      await this.audit.record(
        staff.id,
        'admin.place.approve',
        { kind: 'candidate', id: String(id) },
        poi ? `No mapa: ${poi.name}` : null,
        {
          poiId: String(r.poiId),
        },
      );
      if (r.voters.length && poi) {
        await this.notify.notify(r.voters, {
          type: 'place_approved',
          title: 'Seu lugar entrou no mapa 📍',
          body: `${poi.name} já aparece no Metch. Valeu por ajudar!`,
          target: { kind: 'place', poiId: String(r.poiId) },
        });
      }
    }
    return this.candidateById(id);
  }

  async reject(
    staff: AuthenticatedUser,
    rawId: string,
    reason: string,
  ): Promise<AdminPlaceCandidate> {
    const id = candidateIdOf(rawId);
    const why = reason.trim().slice(0, 255);
    if (!why) throw new BadRequestException({ error: 'reason_required', message: 'Diga o motivo' });
    await this.discovery.rejectCandidate(id);
    await this.audit.record(
      staff.id,
      'admin.place.reject',
      { kind: 'candidate', id: String(id) },
      why,
    );
    return this.candidateById(id);
  }

  // ---------- denúncias ----------

  async reports(): Promise<AdminPoiReportList> {
    const rows = await this.prisma.$queryRaw<
      { poi_id: bigint; user_id: string; reason: string; reported_on: string }[]
    >`
      SELECT r.poi_id, r.user_id, r.reason, to_char(r.reported_on, 'YYYY-MM-DD') AS reported_on
        FROM poi_reports r
       WHERE r.resolved_at IS NULL
       ORDER BY r.reported_on DESC
       LIMIT 2000`;
    const byPoi = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = String(r.poi_id);
      byPoi.set(k, [...(byPoi.get(k) ?? []), r]);
    }
    const pois = await this.prisma.pOI.findMany({
      where: { id: { in: [...byPoi.keys()].map((k) => BigInt(k)) } },
      select: POI_SELECT,
    });
    const items = pois
      .map((p) => ({
        poi: toAdminPoi(p),
        reports: (byPoi.get(String(p.id)) ?? []).map((r) => ({
          id: `${r.poi_id}:${r.user_id}`,
          reason: r.reason,
          // a denúncia guarda só o DIA (privacidade): meio-dia de Brasília pra não virar o dia anterior no fuso do painel
          createdAt: new Date(`${r.reported_on}T15:00:00.000Z`).toISOString(),
          reporterId: r.user_id,
        })),
      }))
      .sort((a, b) => b.reports.length - a.reports.length);
    return { items };
  }

  /** 'hide': oculta o lugar e fecha as denúncias; 'dismiss': descarta (deixam de contar pra retirada automática) */
  async resolveReports(
    staff: AuthenticatedUser,
    rawPoiId: string,
    p: ResolvePoiReportsPayload,
  ): Promise<{ ok: true }> {
    const poiId = poiIdOf(rawPoiId);
    const poi = await this.prisma.pOI.findUnique({
      where: { id: poiId },
      select: { id: true, name: true },
    });
    if (!poi) throw new NotFoundException({ error: 'not_found', message: 'Lugar não encontrado' });
    if (p.action === 'hide') await this.setHidden(staff, poiId, true, false);
    const n = await this.prisma.$executeRaw`
      UPDATE poi_reports SET resolved_at = now(), resolved_by = ${staff.id}::uuid, resolution = ${p.action === 'hide' ? 'hidden' : 'dismissed'}
       WHERE poi_id = ${poiId} AND resolved_at IS NULL`;
    await this.audit.record(
      staff.id,
      p.action === 'hide' ? 'admin.place.reports_hide' : 'admin.place.reports_dismiss',
      { kind: 'poi', id: String(poiId) },
      [`${n} denúncia(s)`, p.note?.trim().slice(0, 300)].filter(Boolean).join(' · '),
    );
    return { ok: true };
  }

  // ---------- POIs ----------

  async pois(q: {
    q?: string;
    cursor?: string;
    limit?: unknown;
    hidden?: string;
  }): Promise<AdminPoiList> {
    const limit = pageSize(q.limit, 30, 100);
    const cur = decodeCursor(q.cursor, 1);
    const text = q.q?.trim().slice(0, 100);
    const where: Prisma.POIWhereInput = {
      ...(cur ? { id: { lt: cursorBigInt(cur[0]) } } : {}),
      ...(q.hidden === '1'
        ? { hiddenAt: { not: null } }
        : q.hidden === '0'
          ? { hiddenAt: null }
          : {}),
    };
    if (text) {
      where.OR = /^\d{1,18}$/.test(text)
        ? [{ id: BigInt(text) }, { name: { contains: text, mode: 'insensitive' } }]
        : [
            { name: { contains: text, mode: 'insensitive' } },
            { address: { contains: text, mode: 'insensitive' } },
            { neighborhood: { contains: text, mode: 'insensitive' } },
          ];
    }
    const rows = await this.prisma.pOI.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: POI_SELECT,
    });
    const items = rows.slice(0, limit).map(toAdminPoi);
    return {
      items,
      nextCursor: rows.length > limit ? encodeCursor([items[items.length - 1].id]) : null,
    };
  }

  async createPoi(staff: AuthenticatedUser, p: UpsertPoiPayload): Promise<AdminPoi> {
    assertCategory(p.category);
    const poi = await this.prisma.pOI.create({
      data: {
        source: 'admin',
        name: p.name.trim(),
        category: p.category as POICategory,
        latitude: p.lat,
        longitude: p.lng,
        address: p.address?.trim() || null,
        city: p.city?.trim() || null,
        isPartner: p.isPartner ?? false,
        partnerOffer: p.partnerOffer?.trim() || null,
        lastVerifiedAt: new Date(),
      },
      select: POI_SELECT,
    });
    this.location.invalidatePoiIndex();
    await this.audit.record(
      staff.id,
      'admin.poi.create',
      { kind: 'poi', id: String(poi.id) },
      poi.name,
    );
    return toAdminPoi(poi);
  }

  async updatePoi(
    staff: AuthenticatedUser,
    rawId: string,
    p: Partial<UpsertPoiPayload>,
  ): Promise<AdminPoi> {
    const id = poiIdOf(rawId);
    const cur = await this.prisma.pOI.findUnique({ where: { id }, select: { eventId: true } });
    if (!cur) throw new NotFoundException({ error: 'not_found', message: 'Lugar não encontrado' });
    // POI de evento é espelho do evento: edita o evento (senão a próxima publicação desfaz)
    if (cur.eventId)
      throw new ConflictException({
        error: 'event_poi',
        message: 'Esse lugar é de um evento: edite o evento',
      });
    if (p.category !== undefined) assertCategory(p.category);
    const data: Prisma.POIUpdateInput = {};
    if (p.name !== undefined) data.name = p.name.trim();
    if (p.category !== undefined) data.category = p.category as POICategory;
    if (p.lat !== undefined) data.latitude = p.lat;
    if (p.lng !== undefined) data.longitude = p.lng;
    if (p.address !== undefined) data.address = p.address?.trim() || null;
    if (p.city !== undefined) data.city = p.city?.trim() || null;
    if (p.isPartner !== undefined) data.isPartner = p.isPartner;
    if (p.partnerOffer !== undefined) data.partnerOffer = p.partnerOffer?.trim() || null;
    const poi = await this.prisma.pOI.update({ where: { id }, data, select: POI_SELECT });
    this.location.invalidatePoiIndex();
    await this.audit.record(
      staff.id,
      'admin.poi.update',
      { kind: 'poi', id: String(id) },
      Object.keys(data).join(', '),
    );
    return toAdminPoi(poi);
  }

  async hide(staff: AuthenticatedUser, rawId: string): Promise<AdminPoi> {
    return this.setHidden(staff, poiIdOf(rawId), true, true);
  }

  async unhide(staff: AuthenticatedUser, rawId: string): Promise<AdminPoi> {
    return this.setHidden(staff, poiIdOf(rawId), false, true);
  }

  private async setHidden(
    staff: AuthenticatedUser,
    id: bigint,
    hidden: boolean,
    audit: boolean,
  ): Promise<AdminPoi> {
    const cur = await this.prisma.pOI.findUnique({
      where: { id },
      select: { eventId: true, name: true },
    });
    if (!cur) throw new NotFoundException({ error: 'not_found', message: 'Lugar não encontrado' });
    if (!hidden && cur.eventId) {
      // POI de evento só volta enquanto o evento está publicado e não terminou
      const ev = await this.prisma.event.findUnique({
        where: { id: cur.eventId },
        select: { status: true, endsAt: true },
      });
      if (!ev || ev.status !== 'published' || ev.endsAt <= new Date()) {
        throw new ConflictException({
          error: 'event_over',
          message: 'O evento desse lugar foi cancelado ou já terminou',
        });
      }
    }
    const poi = await this.prisma.pOI.update({
      where: { id },
      data: { hiddenAt: hidden ? new Date() : null },
      select: POI_SELECT,
    });
    // leitura do app (mapa, vibe, detalhe) é direto no banco: some na hora; o índice de presença deste processo também
    this.location.invalidatePoiIndex();
    if (audit)
      await this.audit.record(
        staff.id,
        hidden ? 'admin.poi.hide' : 'admin.poi.unhide',
        { kind: 'poi', id: String(id) },
        cur.name,
      );
    return toAdminPoi(poi);
  }
}

interface CandidateDbRow {
  id: bigint;
  status: string;
  name: string;
  category: string;
  kind: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  ambiguous: boolean;
  crowd_pass_on: string | null;
  created_on: string;
  last_evidence_on: string;
  poi_id: bigint | null;
  requests: number;
  onsite: number;
  deny: number;
  onsite3: number;
  req14: number;
  deny3: number;
}

function candidateIdOf(raw: string): bigint {
  if (!/^\d{1,18}$/.test(raw))
    throw new NotFoundException({ error: 'not_found', message: 'Sugestão não encontrada' });
  return BigInt(raw);
}

function assertCategory(c: string): void {
  if (!POI_CATEGORIES.has(c))
    throw new BadRequestException({
      error: 'invalid_category',
      message: `Categoria inválida: ${c}`,
    });
}
