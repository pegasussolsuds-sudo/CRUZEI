import type { CampaignAudience, CampaignChannels } from '@cruzei/shared-types';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Público das campanhas: validação do que o painel mandou e o SQL que devolve os ids. Regras puras (sem banco),
// testadas em audience.spec.ts. Quem executa é o CampaignsService.

/** acima disso (ou público 'all') o painel precisa confirmar digitando o número */
export const CONFIRM_ABOVE = 1_000;
const RADIUS_MIN_M = 100;
const RADIUS_MAX_M = 200_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** qual preferência da pessoa vale: campanha comum ou aviso de evento (NotificationSettings) */
export type PrefKind = 'campaigns' | 'events';

const bad = (message: string) => new BadRequestException({ error: 'invalid_audience', message });

/** o que veio do painel → público válido (sem campos extras); inválido → 400 */
export function parseAudience(raw: unknown): CampaignAudience {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Público inválido');
  const a = raw as Record<string, unknown>;
  switch (a.kind) {
    case 'all':
    case 'premium':
    case 'free':
      return { kind: a.kind };
    case 'city': {
      const city = typeof a.city === 'string' ? a.city.trim() : '';
      if (city.length < 2 || city.length > 100) throw bad('Cidade inválida');
      return { kind: 'city', city };
    }
    case 'radius': {
      const lat = Number(a.lat);
      const lng = Number(a.lng);
      const radiusM = Number(a.radiusM);
      if (
        !Number.isFinite(lat) ||
        Math.abs(lat) > 90 ||
        !Number.isFinite(lng) ||
        Math.abs(lng) > 180
      )
        throw bad('Ponto inválido');
      if (!Number.isFinite(radiusM) || radiusM < RADIUS_MIN_M || radiusM > RADIUS_MAX_M) {
        throw bad(`Raio entre ${RADIUS_MIN_M} m e ${RADIUS_MAX_M / 1000} km`);
      }
      return { kind: 'radius', lat, lng, radiusM: Math.round(radiusM) };
    }
    case 'user':
      if (typeof a.userId !== 'string' || !UUID.test(a.userId)) throw bad('Pessoa inválida');
      return { kind: 'user', userId: a.userId.toLowerCase() };
    default:
      throw bad('Tipo de público desconhecido');
  }
}

export function parseChannels(raw: unknown): CampaignChannels {
  const c = (raw ?? {}) as Record<string, unknown>;
  const out = { push: c.push === true, inbox: c.inbox === true };
  if (!out.push && !out.inbox) {
    throw new BadRequestException({
      error: 'invalid_channels',
      message: 'Escolha push, central de avisos ou os dois',
    });
  }
  return out;
}

/** "Uberlândia", "Uberlândia/MG" ou "Uberlândia - MG" → nome + UF (a UF desempata cidades com o mesmo nome) */
export function parseCity(city: string): { name: string; state: string | null } {
  const m = city.trim().match(/^(.+?)\s*[/,-]\s*([A-Za-z]{2})$/);
  return m ? { name: m[1].trim(), state: m[2].toUpperCase() } : { name: city.trim(), state: null };
}

/** confirmação obrigatória: público inteiro ou grande */
export function needsConfirmation(a: CampaignAudience, count: number): boolean {
  return a.kind === 'all' || count > CONFIRM_ABOVE;
}

/**
 * Quem pode receber qualquer campanha: conta que existe, ativa (fora apagadas, suspensas e banidas) e que não
 * desligou aquele tipo de aviso (sem linha em notification_prefs = recebe).
 */
export function baseCondition(pref: PrefKind): Prisma.Sql {
  const col = pref === 'events' ? Prisma.raw('p.events') : Prisma.raw('p.campaigns');
  return Prisma.sql`u.deleted_at IS NULL AND u.account_status = 'active'
    AND NOT EXISTS (SELECT 1 FROM notification_prefs p WHERE p.user_id = u.id AND ${col} = false)`;
}

/** Premium vigente (mesma regra do /me): tier pago e sem vencimento ou vencendo no futuro */
const PAID_NOW = Prisma.sql`u.premium_tier IN ('premium', 'premium_plus')
  AND (u.premium_expires_at IS NULL OR u.premium_expires_at > (now() AT TIME ZONE 'UTC'))`;

/** última posição conhecida de cada pessoa (histórico de posições: só os últimos dias) */
const LAST_POSITION = Prisma.sql`last_pos AS (
  SELECT DISTINCT ON (l.user_id) l.user_id, l.location, l.city
    FROM locations l
   ORDER BY l.user_id, l.recorded_at DESC)`;

/** SELECT dos ids (coluna `id`) de quem recebe */
export function audienceSql(a: CampaignAudience, pref: PrefKind): Prisma.Sql {
  const base = baseCondition(pref);
  switch (a.kind) {
    case 'all':
      return Prisma.sql`SELECT u.id FROM users u WHERE ${base}`;
    case 'premium':
      return Prisma.sql`SELECT u.id FROM users u WHERE ${base} AND ${PAID_NOW}`;
    case 'free':
      return Prisma.sql`SELECT u.id FROM users u WHERE ${base} AND NOT (${PAID_NOW})`;
    case 'user':
      return Prisma.sql`SELECT u.id FROM users u WHERE ${base} AND u.id = ${a.userId}::uuid`;
    case 'radius':
      return Prisma.sql`WITH ${LAST_POSITION}
        SELECT u.id FROM users u JOIN last_pos lp ON lp.user_id = u.id
         WHERE ${base}
           AND ST_DWithin(lp.location, ST_SetSRID(ST_MakePoint(${a.lng}::float8, ${a.lat}::float8), 4326)::geography, ${a.radiusM}::float8)`;
    case 'city': {
      const c = parseCity(a.city);
      const state = c.state ? Prisma.sql`AND ga.state = ${c.state}` : Prisma.empty;
      // polígono do município (geo_areas, IBGE/OSM) contendo a última posição; ou a cidade gravada na posição
      return Prisma.sql`WITH ${LAST_POSITION}, area AS (
          SELECT ga.geom FROM geo_areas ga WHERE ga.kind = 'city' AND ga.name_norm = f_norm(${c.name}) ${state})
        SELECT u.id FROM users u JOIN last_pos lp ON lp.user_id = u.id
         WHERE ${base}
           AND (EXISTS (SELECT 1 FROM area WHERE ST_Covers(area.geom, lp.location::geometry))
                OR (lp.city IS NOT NULL AND f_norm(lp.city) = f_norm(${c.name})))`;
    }
  }
}
