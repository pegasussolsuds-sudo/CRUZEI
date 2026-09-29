// Regras PURAS da descoberta de lugares pela galera (sem banco, sem Redis): o job e os testes usam as mesmas funções.
//
// Ideia: quando muita gente DIFERENTE fica parada no mesmo pedaço da cidade em dias diferentes, ali tem um lugar
// (bar, restaurante, praça…). O lugar publicado é SEMPRE um lugar público do catálogo (nome + ponto do place_catalog) —
// nunca uma coordenada tirada das pessoas, nunca um nome digitado por alguém.
import type { CatalogPlace, PlaceKind } from '@cruzei/shared-types';
import { decodeGeohash, distanceMeters } from '@cruzei/shared-utils';
import { CROWD } from '../location/discovery-privacy';
import { haversineMeters, isBlocked, isOffVibe, nameScore, normalize } from '../places/places.ranking';

/** tipos que o detector pode pôr no mapa sozinho (lugares de rolê/encontro; campus/estádio/marco ficam de fora) */
export const AUTO_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>([
  'nightclub', 'pub', 'bar', 'cocktail', 'brewery', 'lounge', 'music', 'theatre', 'cinema', 'events', 'entertainment',
  'nightlife', 'cafe', 'fastfood', 'restaurant', 'park', 'mall', 'museum', 'gallery', 'beach',
]);

/** tipos que as PESSOAS podem pedir/confirmar (tudo menos "outro": saúde, religião, escritório, loja, casa…) */
export const USER_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>([...AUTO_KINDS, 'stadium', 'campus', 'landmark']);

type CrowdCfg = Pick<typeof CROWD, 'MIN_DAILY' | 'MIN_ACTIVE_DAYS' | 'MIN_UNION' | 'MAX_REPEAT' | 'NIGHT_MAX_SHARE' | 'VENUE_RADIUS_M' | 'VENUE_MIN_SHARE'>;

/** estatística agregada de uma célula geohash-7 na janela (hoje, D-1, D-2) — só contagens, nenhum id */
export interface CellStats {
  /** pessoas distintas (HyperLogLog) por dia da janela */
  daily: number[];
  /** pessoas distintas na janela inteira (união dos HyperLogLogs) */
  union: number;
  /** atualizações de permanência por faixa do dia: [04–08 h, 08–18 h, 18–04 h] */
  bands: [number, number, number];
  /** residências aprendidas na célula + centros de áreas privadas dentro dela */
  homes: number;
}

export type CellVerdict = { ok: true } | { ok: false; reason: 'few_days' | 'few_people' | 'repeat' | 'night' | 'residential' };

/**
 * A célula parece um LUGAR (e não casa, escritório ou um grupo de amigos)?
 * - dias ativos: pelo menos MIN_ACTIVE_DAYS dias com MIN_DAILY pessoas distintas (festa única não passa)
 * - pessoas distintas na janela >= MIN_UNION (maior que um grupo de amigos)
 * - repetição (soma diária ÷ distintos) <= MAX_REPEAT: casa/escritório repetem as mesmas pessoas todo dia
 * - madrugada (04–08 h) <= NIGHT_MAX_SHARE da permanência: madrugada parado = casa
 * - residências não dominam: bloqueia se homes >= 3 E homes >= metade dos distintos
 */
export function evaluateCell(s: CellStats, cfg: CrowdCfg = CROWD): CellVerdict {
  const activeDays = s.daily.filter((d) => d >= cfg.MIN_DAILY).length;
  if (activeDays < cfg.MIN_ACTIVE_DAYS) return { ok: false, reason: 'few_days' };
  if (s.union < cfg.MIN_UNION) return { ok: false, reason: 'few_people' };
  const sum = s.daily.reduce((a, b) => a + b, 0);
  if (sum / s.union > cfg.MAX_REPEAT) return { ok: false, reason: 'repeat' };
  const bandTotal = s.bands[0] + s.bands[1] + s.bands[2];
  if (bandTotal > 0 && s.bands[0] / bandTotal > cfg.NIGHT_MAX_SHARE) return { ok: false, reason: 'night' };
  if (s.homes >= 3 && s.homes >= 0.5 * s.union) return { ok: false, reason: 'residential' };
  return { ok: true };
}

/** permanência somada numa sub-célula geohash-8 (~38 × 19 m) */
export interface SubStay {
  /** geohash-8 da sub-célula */
  sub: string;
  stays: number;
}

/** o lugar pode ser publicado/pedido pelo nome e tipo (filtro adulto, fora do clima, tipo permitido) */
export function venueAllowed(v: Pick<CatalogPlace, 'name' | 'kind'>, kinds: ReadonlySet<PlaceKind>): boolean {
  return kinds.has(v.kind) && !isBlocked(v.name) && !isOffVibe(v.name);
}

/**
 * Qual lugar do catálogo "leva" a multidão da célula: fatia da permanência das sub-células cujo centro fica a
 * <= VENUE_RADIUS_M do ponto do lugar, sobre o total da célula (teto 1). Fica quem tem >= VENUE_MIN_SHARE, no máximo
 * 2; dois lugares acima do piso = ambíguo (pergunta pra quem está lá em vez de publicar sozinho).
 */
export function pickVenues(
  venues: readonly CatalogPlace[],
  subs: readonly SubStay[],
  cellTotal: number,
  cfg: CrowdCfg = CROWD,
): { picks: CatalogPlace[]; ambiguous: boolean } {
  if (cellTotal <= 0 || subs.length === 0) return { picks: [], ambiguous: false };
  const centers = subs.map((s) => ({ ...decodeGeohash(s.sub), stays: s.stays }));
  const scored: { v: CatalogPlace; share: number }[] = [];
  for (const v of venues) {
    if (!venueAllowed(v, AUTO_KINDS)) continue;
    let near = 0;
    for (const c of centers) if (haversineMeters(v.latitude, v.longitude, c.latitude, c.longitude) <= cfg.VENUE_RADIUS_M) near += c.stays;
    const share = Math.min(1, near / cellTotal);
    if (share >= cfg.VENUE_MIN_SHARE) scored.push({ v, share });
  }
  scored.sort((a, b) => b.share - a.share || (a.v.name < b.v.name ? -1 : 1));
  const picks = scored.slice(0, 2).map((s) => s.v);
  return { picks, ambiguous: picks.length >= 2 };
}

/** estado do candidato que as regras leem (datas yyyy-mm-dd de Brasília) */
export interface CandidateFacts {
  name: string;
  kind: PlaceKind;
  ambiguous: boolean;
  crowdPassOn: string | null;
  lastEvidenceOn: string;
}

/** votos distintos por janela (a consulta agrega; aqui só números) */
export interface VoteCounts {
  /** "tô aqui" nos últimos 3 dias */
  onsite3: number;
  /** pedidos + "tô aqui" nos últimos 14 dias */
  req14: number;
  /** "aqui não é lugar público" nos últimos 3 dias */
  deny3: number;
}

export type CandidateDecision = 'promote_crowd' | 'promote_onsite' | 'promote_requests' | 'reject' | 'expire' | 'keep';

/**
 * Máquina de estados do candidato pendente:
 * - reject: 2 negações no lugar em 3 dias, ou nome/tipo reprovado ao reavaliar
 * - A (multidão): a regra da célula passou hoje ou ontem, lugar dominante (não ambíguo) de tipo automático
 * - B (no lugar): 2 pessoas diferentes confirmaram estando lá em 3 dias
 * - C (pedidos): 4 pessoas diferentes pediram (ou confirmaram) em 14 dias
 * - expire: sem evidência nova há mais de 14 dias
 */
export function evaluateCandidate(c: CandidateFacts, v: VoteCounts, today: string): CandidateDecision {
  if (v.deny3 >= 2) return 'reject';
  if (!venueAllowed(c, USER_KINDS)) return 'reject';
  if (c.crowdPassOn && c.crowdPassOn >= addDays(today, -1) && !c.ambiguous && AUTO_KINDS.has(c.kind)) return 'promote_crowd';
  if (v.onsite3 >= 2) return 'promote_onsite';
  if (v.req14 >= 4) return 'promote_requests';
  if (c.lastEvidenceOn < addDays(today, -14)) return 'expire';
  return 'keep';
}

/** mesmo lugar: a até 60 m com nome parecido, ou a até 8 m com qualquer nome */
export const SAME_PLACE_NAME_M = 60;
export const SAME_PLACE_POINT_M = 8;
/** candidato recusado, retirado por denúncia ou publicado segura o MESMO LUGAR por 90 dias, com qualquer id */
export const TOMBSTONE_DAYS = 90;

/** nome + ponto de um lugar (do catálogo, de um POI ou de um candidato) */
export interface PlacePoint {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * `b` é o mesmo lugar que `a`? (a = lugar que vai entrar; b = POI no mapa ou candidato antigo). Regra única do
 * "já está no mapa" e da lápide: a até 8 m com qualquer nome, ou a até 60 m com nome igual, contido ou parecido.
 */
export function samePlace(a: PlacePoint, b: PlacePoint): boolean {
  const d = distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
  if (d <= SAME_PLACE_POINT_M) return true;
  if (d > SAME_PLACE_NAME_M) return false;
  const want = normalize(a.name);
  const got = normalize(b.name);
  return got === want || got.includes(want) || want.includes(got) || nameScore(b.name, a.name, null) >= 75;
}

/** candidato antigo lido pra lápide (data yyyy-mm-dd de Brasília: resolvido ou, sem data, última evidência) */
export interface TombstoneFacts extends PlacePoint {
  key: string;
  status: string;
  resolvedOn: string;
}

/** recusado/retirado ou publicado há até 90 dias */
export function isTombstone(t: Pick<TombstoneFacts, 'status' | 'resolvedOn'>, today: string): boolean {
  return (t.status === 'rejected' || t.status === 'promoted') && t.resolvedOn >= addDays(today, -TOMBSTONE_DAYS);
}

/**
 * Lápide do MESMO LUGAR, independente do id: o id do catálogo muda (linhas 'mbx:' da era Mapbox, canônico que troca
 * no re-import), então vale a mesma chave OU a regra do samePlace. Achando, o lugar não vira candidato de novo.
 */
export function findTombstone<T extends TombstoneFacts>(p: PlacePoint & { id: string }, rows: readonly T[], today: string): T | null {
  return rows.find((t) => isTombstone(t, today) && (t.key === p.id || samePlace(p, t))) ?? null;
}

/** soma dias a uma data yyyy-mm-dd (aritmética em UTC: não sofre com horário de verão) */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
