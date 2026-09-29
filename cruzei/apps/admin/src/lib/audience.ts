// Público e canais de campanha/aviso: descrição, validação e a regra de confirmação digitada.
import type { CampaignAudience, CampaignChannels, NotificationTarget } from '@cruzei/shared-types';
import { formatNumber } from './format';
import { formatRadius } from './geo';

/** acima disso (ou público "todo mundo") o painel pede pra digitar o número de pessoas antes de enviar */
export const BIG_AUDIENCE = 1000;

export const RADIUS_MIN_M = 200;
export const RADIUS_MAX_M = 100_000;

export type AudienceKind = CampaignAudience['kind'];

export const AUDIENCE_KIND_LABEL: Record<AudienceKind, string> = {
  all: 'Todo mundo',
  premium: 'Só Premium',
  free: 'Só grátis',
  city: 'Uma cidade',
  radius: 'Raio no mapa',
  user: 'Uma pessoa',
};

export function describeAudience(a: CampaignAudience): string {
  switch (a.kind) {
    case 'all':
      return 'Todo mundo';
    case 'premium':
      return 'Quem tem Premium';
    case 'free':
      return 'Quem está no plano grátis';
    case 'city':
      return a.city.trim() ? `Quem está em ${a.city.trim()}` : 'Uma cidade';
    case 'radius':
      return `Até ${formatRadius(a.radiusM)} do ponto`;
    case 'user':
      return 'Uma pessoa específica';
  }
}

export function audienceError(a: CampaignAudience): string | null {
  switch (a.kind) {
    case 'city':
      return a.city.trim().length < 2 ? 'Diz qual cidade.' : null;
    case 'radius':
      if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || Math.abs(a.lat) > 90 || Math.abs(a.lng) > 180) {
        return 'Marca o centro no mapa.';
      }
      if (!Number.isFinite(a.radiusM) || a.radiusM < RADIUS_MIN_M || a.radiusM > RADIUS_MAX_M) {
        return `O raio vai de ${formatRadius(RADIUS_MIN_M)} a ${formatRadius(RADIUS_MAX_M)}.`;
      }
      return null;
    case 'user':
      return a.userId ? null : 'Escolhe a pessoa.';
    default:
      return null;
  }
}

export function describeChannels(c: CampaignChannels): string {
  if (c.push && c.inbox) return 'Push + central de avisos';
  if (c.push) return 'Só push';
  if (c.inbox) return 'Só central de avisos';
  return 'Nenhum canal';
}

export function channelsError(c: CampaignChannels): string | null {
  return c.push || c.inbox ? null : 'Escolhe pelo menos um canal.';
}

/** público grande: confirma digitando o número (evita mandar pra todo mundo sem querer) */
export function needsTypedConfirmation(a: CampaignAudience, targetCount: number): boolean {
  return a.kind === 'all' || targetCount > BIG_AUDIENCE;
}

/** aceita "1.234", "1234" ou "1 234" */
export function confirmationMatches(typed: string, targetCount: number): boolean {
  const digits = typed.replace(/[\s.]/g, '');
  return /^\d+$/.test(digits) && Number(digits) === targetCount;
}

export function describeTarget(t: NotificationTarget | null | undefined): string {
  if (!t) return 'Abre o app';
  switch (t.kind) {
    case 'map':
      return 'Abre o mapa';
    case 'event':
      return 'Abre o evento';
    case 'place':
      return 'Abre o lugar';
    case 'premium':
      return 'Abre o Premium';
    case 'support':
      return 'Abre o suporte';
    case 'conversation':
      return 'Abre uma conversa';
    case 'likes':
      return 'Abre as curtidas';
  }
}

export function targetError(t: NotificationTarget | null): string | null {
  if (!t) return null;
  if (t.kind === 'event' && !t.eventId) return 'Escolhe o evento.';
  if (t.kind === 'place' && !t.poiId) return 'Escolhe o lugar.';
  return null;
}

export function formatAudienceCount(n: number): string {
  return n === 1 ? '1 pessoa' : `${formatNumber(n)} pessoas`;
}
