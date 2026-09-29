import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type POICategory } from '@prisma/client';
import * as ngeohash from 'ngeohash';
import type { CatalogPlace, PlaceKind } from '@cruzei/shared-types';
import { distanceMeters } from '@cruzei/shared-utils';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PlacesService } from '../places/places.service';
import { LocationService } from '../location/location.service';
import { CROWD, CROWD_CELL_PRECISION, PRIVACY, cellOf, localDateBrazil } from '../location/discovery-privacy';
import {
  SAME_PLACE_NAME_M,
  TOMBSTONE_DAYS,
  USER_KINDS,
  addDays,
  evaluateCandidate,
  evaluateCell,
  findTombstone,
  pickVenues,
  samePlace,
  venueAllowed,
  type CandidateFacts,
  type PlacePoint,
  type SubStay,
} from './crowd-rules';

/** "tô aqui": presença fresca, não oculta e a até isto do lugar */
const ONSITE_M = 150;
/** pedido de longe só vale na mesma região */
const REQUEST_MAX_M = 30_000;
/** id do catálogo ('ovt:<gers>', 'osm:n123'); 'mbx:' (app antigo, busca do Mapbox) passa no formato e cai no 404 do lookup */
const PLACE_ID = /^(ovt|osm|mbx):[A-Za-z0-9_\-.=:]{2,120}$/;
const REPORT_REASONS = ['not_public', 'residence', 'closed', 'wrong_place', 'offensive'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** 3 pessoas diferentes denunciando em 30 dias tiram um lugar descoberto do mapa */
const TAKEDOWN_REPORTS = 3;

export interface SuggestResult {
  status: 'pending' | 'active';
  poi?: { id: number; name: string; category: string; latitude: number; longitude: number; source: string };
}

export interface CrowdRunSummary {
  cells: number;
  busyCells: number;
  passingCells: number;
  venueLookups: number;
  candidatesTouched: number;
  promoted: number;
  rejected: number;
  expired: number;
  takenDown: number;
  wouldPromote: number;
  /** candidato que ia ser publicado, mas o mesmo lugar já estava no mapa: aponta pro POI que existe */
  merged: number;
  /** lugar que a multidão levaria, mas tem lápide do mesmo lugar (qualquer id): não vira candidato */
  blocked: number;
  ms: number;
}

/** lugar a comparar: id do catálogo + nome + ponto */
type PlaceRef = PlacePoint & { id: string };

/** o que o upsert devolve; tombstone = achou lápide do mesmo lugar e não criou nem reabriu nada */
type CandidateRef = Pick<CandidateRow, 'id' | 'status' | 'poi_id'> & { tombstone: boolean };

interface PresenceRow {
  lat: number;
  lng: number;
  updatedAt: number;
  hidden: boolean;
  cell: string;
}

interface CandidateRow {
  id: bigint;
  /** id do lugar no catálogo (linhas antigas: 'mbx:…', só na coluna legada mapbox_id) */
  ext_id: string;
  cell: string;
  status: string;
  name: string;
  category: string;
  kind: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  ambiguous: boolean;
  crowd_pass_on: string | null;
  last_evidence_on: string;
  poi_id: bigint | null;
}

/**
 * Descoberta de lugares pela galera.
 * - suggest/vote/report: o que as pessoas fazem no app (sempre respostas uniformes: nunca "quem", "quantos" ou "por quê")
 * - runOnce: o detector (cron a cada 3 h): células com muita gente DIFERENTE parada em dias diferentes → lugar público
 *   do catálogo que leva a multidão → candidato → promovido pelas regras A (multidão), B (2 no lugar) ou C (4 pedidos).
 * Nada aqui guarda id de usuário junto com posição: a multidão vive no Redis como HyperLogLog de hashes com chave.
 */
@Injectable()
export class PlaceDiscoveryService {
  private readonly log = new Logger(PlaceDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly places: PlacesService,
    private readonly location: LocationService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Contribuições
  // ---------------------------------------------------------------------------------------------

  /** "📌 Pôr no Metch" num lugar do catálogo (id ovt:…/osm:… que a busca devolveu). Nome e ponto vêm do catálogo, nunca do cliente. */
  async suggest(userId: string, placeId: string, now = new Date()): Promise<SuggestResult> {
    if (!PLACE_ID.test(placeId)) throw new UnprocessableEntityException({ error: 'invalid_place', message: 'Lugar inválido' });
    await this.limit(userId, 'poi_suggest', 10);
    await this.requireContributor(userId, now);
    const place = await this.places.lookup(placeId);
    if (!place) throw new NotFoundException({ error: 'place_not_found', message: 'Busca o lugar de novo' });
    if (!venueAllowed(place, USER_KINDS)) throw new UnprocessableEntityException({ error: 'place_kind_not_supported', message: 'Esse tipo de lugar não entra no mapa' });

    const existing = await this.findExisting(place);
    if (existing) return { status: 'active', poi: existing };

    const me = await this.presence(userId);
    if (!me) throw new UnprocessableEntityException({ error: 'no_presence', message: 'Liga a localização pra ajudar a pôr lugares no mapa' });
    const dist = distanceMeters(me.lat, me.lng, place.latitude, place.longitude);
    const fresh = now.getTime() - me.updatedAt <= PRIVACY.ONLINE_MIN * 60_000;
    const onsite = fresh && !me.hidden && dist <= ONSITE_M;
    if (!onsite && dist > REQUEST_MAX_M) throw new UnprocessableEntityException({ error: 'far_away', message: 'Só dá pra pedir lugares da sua região' });

    const today = localDateBrazil(now);
    const cand = await this.upsertCandidate(place, today, null);
    if (cand && cand.status === 'pending') await this.upsertVote(cand.id, userId, onsite ? 'onsite' : 'request', today);
    if (cand?.status === 'promoted' && cand.poi_id != null) {
      const poi = await this.poiLite(cand.poi_id);
      if (poi) return { status: 'active', poi };
    }
    // novo, pendente, recusado ou vencido: mesma resposta (não revela o estado nem quem mais pediu)
    return { status: 'pending' };
  }

  /** "É o <nome>?" / "Aqui não é lugar público" — só vale estando NO lugar agora; senão 404 igual a "não existe" */
  async vote(userId: string, candidateId: string, vote: 'confirm' | 'deny', now = new Date()): Promise<{ ok: true }> {
    const notFound = () => new NotFoundException({ error: 'not_found' });
    if (!/^\d{1,18}$/.test(candidateId)) throw notFound();
    await this.limit(userId, 'poi_vote', 30);
    const [cand] = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT id, cell, status, latitude, longitude FROM place_candidates WHERE id = ${BigInt(candidateId)} AND status = 'pending'`;
    if (!cand) throw notFound();
    if (!(await this.isContributor(userId, now))) throw notFound();
    const me = await this.presence(userId);
    if (!me || me.hidden || now.getTime() - me.updatedAt > PRIVACY.ONLINE_MIN * 60_000) throw notFound();
    const around = new Set([cand.cell, ...ngeohash.neighbors(cand.cell)]);
    const myCell = me.cell || cellOf(me.lat, me.lng, CROWD_CELL_PRECISION);
    if (!around.has(myCell) || distanceMeters(me.lat, me.lng, Number(cand.latitude), Number(cand.longitude)) > ONSITE_M) throw notFound();
    await this.upsertVote(cand.id, userId, vote === 'confirm' ? 'onsite' : 'deny', localDateBrazil(now));
    return { ok: true };
  }

  /** "⚑ Reportar": sempre { ok: true } pra qualquer lugar que existe */
  async report(userId: string, poiId: number, reason: string, now = new Date()): Promise<{ ok: true }> {
    if (!Number.isSafeInteger(poiId) || poiId <= 0) throw new NotFoundException({ error: 'not_found' });
    if (!(REPORT_REASONS as readonly string[]).includes(reason)) throw new UnprocessableEntityException({ error: 'invalid_reason' });
    await this.limit(userId, 'poi_report', 20);
    const poi = await this.prisma.pOI.findUnique({ where: { id: BigInt(poiId) }, select: { id: true } });
    if (!poi) throw new NotFoundException({ error: 'not_found' });
    await this.prisma.$executeRaw`
      INSERT INTO poi_reports (poi_id, user_id, reason, reported_on)
      VALUES (${poi.id}, ${userId}::uuid, ${reason}, ${localDateBrazil(now)}::date)
      ON CONFLICT (poi_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, reported_on = EXCLUDED.reported_on`;
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------
  // Detector (cron)
  // ---------------------------------------------------------------------------------------------

  async runOnce(now = new Date(), opts: { promote: boolean } = { promote: CROWD.MODE === 'on' }): Promise<CrowdRunSummary> {
    const t0 = Date.now();
    const today = localDateBrazil(now);
    const days = [today, addDays(today, -1), addDays(today, -2)];
    const sum: CrowdRunSummary = { cells: 0, busyCells: 0, passingCells: 0, venueLookups: 0, candidatesTouched: 0, promoted: 0, rejected: 0, expired: 0, takenDown: 0, wouldPromote: 0, merged: 0, blocked: 0, ms: 0 };
    const r = this.redis.client;

    // 1) células com alguma permanência na janela
    const cells = await r.sunion(...days.map((d) => `crowd:cells:${d}`));
    sum.cells = cells.length;

    // 2) filtro barato: distintos por dia (HyperLogLog) — dias ativos e soma (a união nunca passa da soma)
    const busy: { cell: string; daily: number[] }[] = [];
    for (let i = 0; i < cells.length; i += 1_000) {
      const part = cells.slice(i, i + 1_000);
      const pipe = r.pipeline();
      for (const c of part) for (const d of days) pipe.pfcount(`crowd:u:${d}:${c}`);
      const res = (await pipe.exec()) ?? [];
      part.forEach((cell, k) => {
        const daily = days.map((_, j) => Number(res[k * days.length + j]?.[1] ?? 0));
        const active = daily.filter((n) => n >= CROWD.MIN_DAILY).length;
        if (active >= CROWD.MIN_ACTIVE_DAYS && daily.reduce((a, b) => a + b, 0) >= CROWD.MIN_UNION) busy.push({ cell, daily });
      });
    }
    sum.busyCells = busy.length;

    // 3) só as sobreviventes: união, faixas do dia, residências → regra da célula → lugar do catálogo que leva a multidão
    for (const { cell, daily } of busy) {
      const union = await r.pfcount(...days.map((d) => `crowd:u:${d}:${cell}`));
      const around = [cell, ...ngeohash.neighbors(cell)];
      const pipe = r.pipeline();
      for (const c of around) for (const d of days) pipe.hgetall(`crowd:d:${d}:${c}`);
      pipe.get(`home:cnt:${cell}`);
      const res = (await pipe.exec()) ?? [];
      const bands: [number, number, number] = [0, 0, 0];
      const subs = new Map<string, number>();
      let cellTotal = 0;
      around.forEach((c, ci) => {
        for (let di = 0; di < days.length; di++) {
          const h = (res[ci * days.length + di]?.[1] ?? {}) as Record<string, string>;
          for (const [k, v] of Object.entries(h)) {
            const n = Number(v) || 0;
            if (k.startsWith('s')) {
              subs.set(c + k.slice(1), (subs.get(c + k.slice(1)) ?? 0) + n);
              if (c === cell) cellTotal += n;
            } else if (c === cell && (k === 'b0' || k === 'b1' || k === 'b2')) bands[Number(k[1])] += n;
          }
        }
      });
      const homes = Number(res[around.length * days.length]?.[1] ?? 0) + (await this.privateAreasIn(cell));
      const verdict = evaluateCell({ daily, union, bands, homes });
      if (!verdict.ok) continue;
      sum.passingCells++;

      const venues = await this.places.venuesInCell(cell);
      sum.venueLookups++;
      if (!venues || venues.length === 0) continue;
      const subList: SubStay[] = [...subs].map(([sub, stays]) => ({ sub, stays }));
      const { picks, ambiguous } = pickVenues(venues, subList, cellTotal);
      for (const v of picks) {
        if (await this.findExisting(v)) continue; // já está no mapa
        const c = await this.upsertCandidate(v, today, { crowdPassOn: today, ambiguous });
        if (c?.tombstone) sum.blocked++;
        else if (c) sum.candidatesTouched++;
      }
    }

    // 4) cada candidato pendente: regras A/B/C, negações, validade. Os da época do Mapbox ('mbx:') nunca são publicados
    //    (o dado do Mapbox não pode virar lugar permanente): vencem aqui e somem na faxina.
    sum.expired += await this.prisma.$executeRaw`
      UPDATE place_candidates SET status = 'expired' WHERE status = 'pending' AND COALESCE(ext_id, mapbox_id) LIKE 'mbx:%'`;
    const pending = await this.prisma.$queryRaw<(CandidateRow & { onsite3: number; req14: number; deny3: number })[]>`
      SELECT c.id, COALESCE(c.ext_id, c.mapbox_id) AS ext_id, c.cell, c.status, c.name, c.category::text AS category, c.kind, c.latitude, c.longitude,
             c.address, c.neighborhood, c.city, c.state, c.ambiguous,
             to_char(c.crowd_pass_on, 'YYYY-MM-DD') AS crowd_pass_on, to_char(c.last_evidence_on, 'YYYY-MM-DD') AS last_evidence_on, c.poi_id,
             count(v.user_id) FILTER (WHERE v.kind = 'onsite' AND v.voted_on >= ${days[2]}::date)::int AS onsite3,
             count(v.user_id) FILTER (WHERE v.kind IN ('request', 'onsite') AND v.voted_on >= ${addDays(today, -13)}::date)::int AS req14,
             count(v.user_id) FILTER (WHERE v.kind = 'deny' AND v.voted_on >= ${days[2]}::date)::int AS deny3
        FROM place_candidates c LEFT JOIN place_votes v ON v.candidate_id = c.id
       WHERE c.status = 'pending'
       GROUP BY c.id`;
    let changedMap = false;
    for (const c of pending) {
      const facts: CandidateFacts = { name: c.name, kind: c.kind as PlaceKind, ambiguous: c.ambiguous, crowdPassOn: c.crowd_pass_on, lastEvidenceOn: c.last_evidence_on };
      const decision = evaluateCandidate(facts, { onsite3: c.onsite3, req14: c.req14, deny3: c.deny3 }, today);
      if (decision.startsWith('promote')) {
        // o mesmo lugar pode já estar no mapa (outro candidato, com outro id, publicado antes) ou ter lápide: nada de POI duplicado
        const place: PlaceRef = { id: c.ext_id, name: c.name, latitude: Number(c.latitude), longitude: Number(c.longitude) };
        const existing = await this.findExisting(place);
        const tomb = existing ? null : await this.findTombstone(place, today);
        if (!opts.promote) {
          if (!existing && !tomb) sum.wouldPromote++;
          continue;
        }
        if (existing) {
          await this.prisma.$executeRaw`
            UPDATE place_candidates SET status = 'promoted', poi_id = ${BigInt(existing.id)}, resolved_on = ${today}::date WHERE id = ${c.id} AND status = 'pending'`;
          sum.merged++;
        } else if (tomb) {
          // lápide do mesmo lugar com outro id: vence (a faxina apaga; só volta a pendente depois que a lápide vencer)
          await this.prisma.$executeRaw`UPDATE place_candidates SET status = 'expired' WHERE id = ${c.id} AND status = 'pending'`;
          sum.expired++;
        } else {
          await this.promote(c, today);
          sum.promoted++;
          changedMap = true;
        }
      } else if (decision === 'reject') {
        await this.prisma.$executeRaw`UPDATE place_candidates SET status = 'rejected', resolved_on = ${today}::date WHERE id = ${c.id} AND status = 'pending'`;
        sum.rejected++;
      } else if (decision === 'expire') {
        await this.prisma.$executeRaw`UPDATE place_candidates SET status = 'expired' WHERE id = ${c.id} AND status = 'pending'`;
        sum.expired++;
      }
    }

    // 5) lugares descobertos denunciados por várias pessoas saem do mapa (lápide de 90 dias no candidato)
    const flagged = await this.prisma.$queryRaw<{ poi_id: bigint }[]>`
      SELECT r.poi_id FROM poi_reports r JOIN pois p ON p.id = r.poi_id
       WHERE p.source IN ('catalog', 'mapbox') AND r.reported_on >= ${addDays(today, -29)}::date
       GROUP BY r.poi_id HAVING count(DISTINCT r.user_id) >= ${TAKEDOWN_REPORTS}`;
    for (const f of flagged) {
      await this.prisma.$transaction([
        this.prisma.$executeRaw`UPDATE place_candidates SET status = 'rejected', resolved_on = ${today}::date WHERE poi_id = ${f.poi_id}`,
        this.prisma.$executeRaw`DELETE FROM pois WHERE id = ${f.poi_id} AND source IN ('catalog', 'mapbox')`,
      ]);
      sum.takenDown++;
      changedMap = true;
    }

    // 6) faxina: votos no lugar viram pedido depois de 3 dias; negações e pedidos velhos somem; lápides vencem
    await this.prisma.$executeRaw`UPDATE place_votes SET kind = 'request' WHERE kind = 'onsite' AND voted_on < ${days[2]}::date`;
    await this.prisma.$executeRaw`DELETE FROM place_votes WHERE (kind = 'deny' AND voted_on < ${days[2]}::date) OR (kind = 'request' AND voted_on < ${addDays(today, -13)}::date)`;
    await this.prisma.$executeRaw`DELETE FROM place_candidates WHERE (status = 'rejected' AND resolved_on < ${addDays(today, -90)}::date) OR (status = 'expired' AND last_evidence_on < ${addDays(today, -44)}::date)`;
    await this.prisma.$executeRaw`DELETE FROM poi_reports WHERE reported_on < ${addDays(today, -30)}::date`;

    if (changedMap) this.location.invalidatePoiIndex();
    sum.ms = Date.now() - t0;
    // só números agregados no log
    this.log.log(
      `descoberta: ${sum.cells} células, ${sum.busyCells} movimentadas, ${sum.passingCells} passaram, ${sum.candidatesTouched} candidatos, ` +
        `${sum.promoted} publicados${opts.promote ? '' : ` (sombra: ${sum.wouldPromote})`}, ${sum.merged} já no mapa, ${sum.blocked} com lápide, ` +
        `${sum.rejected} recusados, ${sum.expired} vencidos, ${sum.takenDown} retirados, ${sum.ms} ms`,
    );
    return sum;
  }

  // ---------------------------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------------------------

  /**
   * publica: POI normal com source 'catalog' e external_id = id do catálogo (a mesma chave do scripts/geo/rematch-mapbox-pois),
   * criado "no começo do dia" (horário não revela quando alguém confirmou)
   */
  private async promote(c: CandidateRow, today: string): Promise<void> {
    const externalId = c.ext_id;
    const startOfDay = new Date(`${today}T03:00:00Z`); // 00:00 em Brasília
    await this.prisma.$transaction(async (tx) => {
      const poi = await tx.pOI.upsert({
        where: { source_externalId: { source: 'catalog', externalId } },
        create: {
          source: 'catalog',
          externalId,
          name: c.name,
          category: c.category as POICategory,
          subcategory: c.kind,
          latitude: c.latitude,
          longitude: c.longitude,
          address: c.address,
          neighborhood: c.neighborhood,
          city: c.city,
          state: c.state,
          createdAt: startOfDay,
          lastVerifiedAt: startOfDay,
        },
        update: {},
        select: { id: true },
      });
      await tx.$executeRaw`UPDATE place_candidates SET status = 'promoted', poi_id = ${poi.id}, resolved_on = ${today}::date WHERE id = ${c.id} AND status = 'pending'`;
    });
  }

  /**
   * cria/atualiza o candidato (chave = id do catálogo); vencido volta a pendente. Antes, procura lápide do MESMO LUGAR com
   * qualquer id (recusado, retirado ou publicado há até 90 dias): achando, não cria nem reabre nada e devolve a lápide.
   */
  private async upsertCandidate(p: CatalogPlace, today: string, crowd: { crowdPassOn: string; ambiguous: boolean } | null): Promise<CandidateRef | null> {
    const tomb = await this.findTombstone(p, today);
    if (tomb) return { id: tomb.id, status: tomb.status, poi_id: tomb.poi_id, tombstone: true };
    const category = p.category ?? 'other';
    const cell = cellOf(p.latitude, p.longitude, CROWD_CELL_PRECISION); // célula do LUGAR (público), nunca de pessoa
    // mapbox_id é a coluna legada (NOT NULL no backend antigo, que ainda a lê): recebe o mesmo id até ser apagada
    const rows = await this.prisma.$queryRaw<Pick<CandidateRow, 'id' | 'status' | 'poi_id'>[]>`
      INSERT INTO place_candidates (key, ext_id, mapbox_id, cell, status, name, category, kind, latitude, longitude, address, neighborhood, city, state,
                                    ambiguous, crowd_pass_on, last_evidence_on, created_on)
      VALUES (${p.id}, ${p.id}, ${p.id}, ${cell}, 'pending', ${p.name.slice(0, 255)}, ${category}::"POICategory", ${p.kind}, ${p.latitude}, ${p.longitude},
              ${p.address?.slice(0, 500) ?? null}, ${p.neighborhood?.slice(0, 100) ?? null}, ${p.city?.slice(0, 100) ?? null}, ${p.state?.slice(0, 2) ?? null},
              ${crowd?.ambiguous ?? false}, ${crowd ? crowd.crowdPassOn : null}::date, ${today}::date, ${today}::date)
      ON CONFLICT (key) DO UPDATE SET
        status = CASE WHEN place_candidates.status = 'expired' THEN 'pending' ELSE place_candidates.status END,
        last_evidence_on = CASE WHEN place_candidates.status = 'rejected' THEN place_candidates.last_evidence_on ELSE EXCLUDED.last_evidence_on END,
        crowd_pass_on = COALESCE(EXCLUDED.crowd_pass_on, place_candidates.crowd_pass_on),
        ambiguous = CASE WHEN EXCLUDED.crowd_pass_on IS NOT NULL THEN EXCLUDED.ambiguous ELSE place_candidates.ambiguous END
      RETURNING id, status, poi_id`;
    return rows[0] ? { ...rows[0], tombstone: false } : null;
  }

  /**
   * lápide do MESMO LUGAR, independente do id ('mbx:' da era Mapbox, canônico antigo do catálogo): candidato recusado,
   * retirado ou publicado há até 90 dias, com a mesma chave ou pela regra do samePlace (60 m + nome parecido, ou 8 m)
   */
  private async findTombstone(p: PlaceRef, today: string): Promise<{ id: bigint; status: string; poi_id: bigint | null } | null> {
    const cell = cellOf(p.latitude, p.longitude, CROWD_CELL_PRECISION);
    const cells = [cell, ...ngeohash.neighbors(cell)]; // célula-7 (~150 m) + vizinhas cobrem os 60 m (índice status, cell)
    const dLat = SAME_PLACE_NAME_M / 111_195;
    const dLng = dLat / Math.cos((p.latitude * Math.PI) / 180);
    const rows = await this.prisma.$queryRaw<
      { id: bigint; key: string; status: string; name: string; latitude: Prisma.Decimal; longitude: Prisma.Decimal; poi_id: bigint | null; resolved_on: string }[]
    >`
      SELECT id, key, status, name, latitude, longitude, poi_id, to_char(COALESCE(resolved_on, last_evidence_on), 'YYYY-MM-DD') AS resolved_on
        FROM place_candidates
       WHERE status IN ('rejected', 'promoted') AND COALESCE(resolved_on, last_evidence_on) >= ${addDays(today, -TOMBSTONE_DAYS)}::date
         AND (key = ${p.id}
              OR (cell = ANY(${cells}::text[])
                  AND latitude BETWEEN ${p.latitude - dLat} AND ${p.latitude + dLat}
                  AND longitude BETWEEN ${p.longitude - dLng} AND ${p.longitude + dLng}))`;
    const facts = rows.map((r) => ({ ...r, latitude: Number(r.latitude), longitude: Number(r.longitude), resolvedOn: r.resolved_on }));
    return findTombstone(p, facts, today);
  }

  /** voto único por pessoa e candidato; "no lugar" nunca é rebaixado pra "pedido" */
  private async upsertVote(candidateId: bigint, userId: string, kind: 'request' | 'onsite' | 'deny', today: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO place_votes (candidate_id, user_id, kind, voted_on) VALUES (${candidateId}, ${userId}::uuid, ${kind}, ${today}::date)
      ON CONFLICT (candidate_id, user_id) DO UPDATE SET
        kind = CASE WHEN place_votes.kind = 'onsite' AND EXCLUDED.kind = 'request' THEN 'onsite' ELSE EXCLUDED.kind END,
        voted_on = EXCLUDED.voted_on`;
  }

  /** o lugar já está no mapa? mesmo id do catálogo, ou POI a até 60 m com nome parecido, ou a até 8 m com qualquer nome */
  private async findExisting(p: PlaceRef): Promise<SuggestResult['poi'] | null> {
    const same = await this.prisma.pOI.findUnique({
      where: { source_externalId: { source: 'catalog', externalId: p.id } },
      select: { id: true, name: true, category: true, latitude: true, longitude: true, source: true },
    });
    if (same) return lite(same);
    const dLat = SAME_PLACE_NAME_M / 111_195;
    const dLng = dLat / Math.cos((p.latitude * Math.PI) / 180);
    const near = await this.prisma.pOI.findMany({
      where: {
        latitude: { gte: p.latitude - dLat, lte: p.latitude + dLat },
        longitude: { gte: p.longitude - dLng, lte: p.longitude + dLng },
      },
      select: { id: true, name: true, category: true, latitude: true, longitude: true, source: true },
      take: 50,
    });
    for (const q of near) {
      if (samePlace(p, { name: q.name, latitude: Number(q.latitude), longitude: Number(q.longitude) })) return lite(q);
    }
    return null;
  }

  private async poiLite(id: bigint): Promise<SuggestResult['poi'] | null> {
    const q = await this.prisma.pOI.findUnique({ where: { id }, select: { id: true, name: true, category: true, latitude: true, longitude: true, source: true } });
    return q ? lite(q) : null;
  }

  private async presence(userId: string): Promise<PresenceRow | null> {
    const m = await this.redis.client.hgetall(`user:loc:${userId}`);
    if (!m?.lat || !m?.lng) return null;
    return { lat: Number(m.lat), lng: Number(m.lng), updatedAt: Number(m.updated_at) || 0, hidden: m.hidden === '1', cell: m.cell ?? '' };
  }

  /** conta com idade mínima (ou selfie verificada), não pausada, não excluída */
  private async isContributor(userId: string, now: Date): Promise<boolean> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, isVerified: true, isPaused: true, deletedAt: true } });
    if (!u || u.isPaused || u.deletedAt) return false;
    return u.isVerified || now.getTime() - u.createdAt.getTime() >= CROWD.MIN_ACCOUNT_AGE_D * 86_400_000;
  }

  private async requireContributor(userId: string, now: Date): Promise<void> {
    if (!(await this.isContributor(userId, now))) {
      throw new ForbiddenException({ error: 'account_too_new', message: 'Em breve você vai poder pôr lugares no mapa' });
    }
  }

  private async limit(userId: string, action: string, perDay: number): Promise<void> {
    if ((await this.redis.incrRate(userId, action)) > perDay) {
      throw new HttpException({ error: 'rate_limited', message: 'Calma aí: tenta de novo amanhã' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** centros de áreas privadas dentro da célula (só a contagem) — entra no teste de "residencial" */
  private async privateAreasIn(cell: string): Promise<number> {
    const b = ngeohash.decode_bbox(cell); // [minLat, minLon, maxLat, maxLon]
    const [row] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM private_areas WHERE latitude BETWEEN ${b[0]} AND ${b[2]} AND longitude BETWEEN ${b[1]} AND ${b[3]}`;
    return row?.n ?? 0;
  }
}

function lite(q: { id: bigint; name: string; category: string; latitude: Prisma.Decimal; longitude: Prisma.Decimal; source: string }): NonNullable<SuggestResult['poi']> {
  return { id: Number(q.id), name: q.name, category: q.category, latitude: Number(q.latitude), longitude: Number(q.longitude), source: q.source };
}
