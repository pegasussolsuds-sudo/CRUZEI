// Gente invisível (modo anônimo) por perto: o que o app mostra pra quem tem Premium. O servidor já manda tudo agrupado
// por LUGAR ou QUADRA (InvisibleGroup: ponto do lugar ou centro da quadra + contagem), sem id, nome, foto nem avatar;
// pra quem é grátis vem null e nada aparece. Aqui os grupos só viram texto e GeoJSON, em funções puras: nada é
// guardado, registrado (log/Sentry/analytics) nem cruzado entre respostas, e o que vai pro mapa é só contagem, posição
// do grupo e o nome público do lugar. A chave do grupo serve só pra não repetir marcador e não sai daqui.

import type { InvisibleGroup } from '@cruzei/shared-types';

/** teto de marcadores: o servidor já limita ao raio de 350 m; isso só protege o mapa de uma resposta fora do normal */
export const MAX_INVISIBLE_GROUPS = 60;
/**
 * Com o mapa inclinado, meu avatar (alto na tela) cobre uma "coluna" atrás de mim: o que fica perto de mim ou ao norte,
 * alinhado comigo, some embaixo dele. Nessa região o marcador vai pro LADO (leste/oeste), a NUDGE_M de mim.
 */
export const NUDGE_UNDER_M = 40;
export const BEHIND_AHEAD_M = 170;
export const BEHIND_HALF_WIDTH_M = 55;
export const NUDGE_M = 70;

/**
 * Onde DESENHAR o grupo: o ponto do servidor, ou — se cair embaixo/atrás do meu avatar — o mesmo ponto deslocado pro
 * lado (leste ou oeste, o lado em que ele já estava; alinhado, leste), a NUDGE_M de mim. Não muda o que o grupo é nem
 * aproxima ninguém de posição real nenhuma: o ponto já é o centro da quadra ou o lugar.
 */
export function drawPosition(
  g: { lat: number; lng: number },
  me: { lat: number; lng: number } | null | undefined,
): { lat: number; lng: number } {
  if (!me) return g;
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos((me.lat * Math.PI) / 180);
  const dy = (g.lat - me.lat) * mPerLat;
  const dx = (g.lng - me.lng) * mPerLng;
  const close = Math.hypot(dx, dy) < NUDGE_UNDER_M;
  const behind = dy > 0 && dy < BEHIND_AHEAD_M && Math.abs(dx) < BEHIND_HALF_WIDTH_M;
  if (!close && !behind) return g;
  const side = dx < 0 ? -1 : 1;
  return { lat: g.lat, lng: me.lng + (side * NUDGE_M) / mPerLng };
}
/** nome de lugar comprido corta com reticências no toast */
const PLACE_MAX = 40;

// type (não interface): entra no GeoJsonProperties ({ [name: string]: any }) sem cast
/** propriedades de cada marcador no mapa: `inv` identifica a feature no toque (nenhuma outra fonte usa essa chave) */
export type InvisibleFeatureProps = {
  /** quantas pessoas invisíveis no lugar/quadra */
  inv: number;
  /** rótulo pronto ("2 invisíveis"), só texto */
  label: string;
  /** nome público do lugar (grupo de quadra não tem) */
  place?: string;
};

export type InvisibleFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, InvisibleFeatureProps>;

/** contagem inteira válida (≥ 1) ou 0 */
function countOf(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  const k = Math.floor(n);
  return k >= 1 ? k : 0;
}

function shortCount(n: number): string {
  return n > 99 ? '99+' : String(n);
}

function placeName(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return null;
  return name.length > PLACE_MAX ? `${name.slice(0, PLACE_MAX - 1).trimEnd()}…` : name;
}

/**
 * Rótulo do marcador no mapa: "1 invisível" / "2 invisíveis". Só texto — a fonte SDF do MapLibre não tem glifo de
 * emoji (sairia um quadrado). Contagem inválida → ''.
 */
export function invisibleLabel(count: number): string {
  const n = countOf(count);
  if (!n) return '';
  return n === 1 ? '1 invisível' : `${shortCount(n)} invisíveis`;
}

/** Resumo da folha de baixo (Premium): " · 👻 N invisíveis por perto"; ninguém invisível ou grátis (null) → ''. */
export function invisibleSummary(total: number | null | undefined): string {
  const n = countOf(total);
  if (!n) return '';
  return ` · 👻 ${n === 1 ? '1 invisível' : `${shortCount(n)} invisíveis`} por perto`;
}

/** Texto do toque no marcador: quantos (e o lugar, que é público), nunca quem. */
export function invisibleTapText(count: number, place?: string | null): string {
  const n = Math.max(1, countOf(count));
  const name = placeName(place);
  const where = name ? `em ${name}` : 'aqui';
  return n === 1
    ? `👻 1 pessoa invisível ${where} — o Metch não mostra quem é`
    : `👻 ${shortCount(n)} pessoas invisíveis ${where} — o Metch não mostra quem são`;
}

/**
 * GeoJSON dos grupos pro mapa: um ponto por lugar/quadra (a posição que o servidor mandou, nunca a de alguém), com a
 * contagem e o rótulo. Descarta grupo sem contagem ou com coordenada inválida, repete a chave uma vez só e para em
 * MAX_INVISIBLE_GROUPS. Sem id de feature nem chave do grupo nas propriedades.
 */
export function invisibleFeatures(
  groups: readonly InvisibleGroup[] | null | undefined,
  me?: { lat: number; lng: number } | null,
): InvisibleFeatureCollection {
  const features: GeoJSON.Feature<GeoJSON.Point, InvisibleFeatureProps>[] = [];
  if (!Array.isArray(groups)) return { type: 'FeatureCollection', features };
  const seen = new Set<string>();
  for (const g of groups) {
    if (features.length >= MAX_INVISIBLE_GROUPS) break;
    if (!g || typeof g !== 'object') continue;
    const n = countOf(g.count);
    const { lat, lng } = g;
    if (!n || typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const key = typeof g.key === 'string' && g.key ? g.key : `${lat},${lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const properties: InvisibleFeatureProps = { inv: n, label: invisibleLabel(n) };
    const place = placeName(g.poi?.name);
    if (place) properties.place = place;
    const at = drawPosition({ lat, lng }, me);
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [at.lng, at.lat] } });
  }
  return { type: 'FeatureCollection', features };
}
