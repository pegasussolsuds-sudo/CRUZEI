import type { AppNotification, NotificationTarget, PushData } from '@cruzei/shared-types';

// Regras puras das notificações: validar o destino do toque (nunca URL livre), montar o item da central e os dados
// do push. Testadas em notification-target.spec.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** id de POI (bigint no banco) em texto */
const POI_ID = /^\d{1,18}$/;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** id de POI vindo como número (app/pois) ou texto (painel): sempre texto, ou null se não for um id */
function poiIdOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === 'string' && POI_ID.test(v) && v !== '0') return v;
  return null;
}

/**
 * Destino válido ou null. Lê o que veio do painel (corpo da campanha) e o que está gravado em notifications.data:
 * só os tipos conhecidos, com ids no formato certo e SEM campos extras (o app nunca recebe nada fora do contrato).
 */
export function parseTarget(raw: unknown): NotificationTarget | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  switch (t.kind) {
    case 'map':
      return { kind: 'map' };
    case 'premium':
      return { kind: 'premium' };
    case 'support':
      return { kind: 'support' };
    case 'likes':
      return { kind: 'likes' };
    case 'event': {
      if (!isUuid(t.eventId)) return null;
      const poiId = t.poiId == null ? null : poiIdOf(t.poiId);
      if (t.poiId != null && poiId === null) return null;
      return { kind: 'event', eventId: t.eventId.toLowerCase(), poiId };
    }
    case 'place': {
      const poiId = poiIdOf(t.poiId);
      return poiId ? { kind: 'place', poiId } : null;
    }
    case 'conversation':
      return isUuid(t.conversationId)
        ? { kind: 'conversation', conversationId: t.conversationId.toLowerCase() }
        : null;
    // comemoração do match (só push social; campanha recusa esse destino)
    case 'match':
      return isUuid(t.userId) ? { kind: 'match', userId: t.userId.toLowerCase() } : null;
    default:
      return null;
  }
}

/** o destino fica em notifications.data.target (data pode ter outras chaves antigas: só o destino sai pro app) */
export function targetFromData(data: unknown): NotificationTarget | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return parseTarget((data as { target?: unknown }).target);
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: unknown;
  readAt: Date | null;
  sentAt: Date;
}

/** linha da tabela notifications → item da central de avisos */
export function toAppNotification(n: NotificationRow): AppNotification {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    target: targetFromData(n.data),
    readAt: n.readAt?.toISOString() ?? null,
    sentAt: n.sentAt.toISOString(),
  };
}

/** dados do push (FCM data só aceita texto): o app monta o destino a partir deles */
export function pushDataOf(
  notificationId: string | null,
  type: string,
  target: NotificationTarget | null,
): PushData {
  const data: PushData = { notificationId: notificationId ?? '', type };
  if (target) data.target = JSON.stringify(target);
  return data;
}

/** PushData como mapa de texto (formato do FCM), sem chaves vazias além do notificationId */
export function pushDataRecord(d: PushData): Record<string, string> {
  const out: Record<string, string> = { notificationId: d.notificationId, type: d.type };
  if (d.target) out.target = d.target;
  return out;
}
