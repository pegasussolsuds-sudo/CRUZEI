import type { AppNotification, NotificationTarget, PushData } from '@cruzei/shared-types';

// Destino do toque (push, central de avisos ou aviso rápido no app). Funções puras: nada de navegação nem módulo
// nativo aqui (a execução fica em navigation/openTarget.ts), pra dar pra testar a tabela inteira.

/** destino já resolvido pro que o app sabe abrir */
export type TargetRoute =
  | { screen: 'Map'; focusPoiId?: number }
  | { screen: 'Likes' }
  | { screen: 'Paywall' }
  | { screen: 'SupportChat' }
  | { screen: 'Chat'; conversationId: string }
  | { screen: 'Notifications' };

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** JSON que veio como texto (FCM data é sempre mapa de strings) */
function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** id de lugar do contrato (texto: BIGINT no banco) → o número que o mapa usa; qualquer coisa estranha = null */
export function poiIdOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  const s = str(v);
  if (!s || !/^\d{1,15}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** poiId do contrato é texto; aceita número também (o mapa usa número) */
function poiText(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return str(v);
}

/**
 * NotificationTarget vindo de fora (push, linha da central, socket): só os destinos conhecidos e com os campos que
 * cada um exige. Nunca URL livre: destino desconhecido vira null.
 */
export function parseTarget(raw: unknown): NotificationTarget | null {
  const o = asObj(parseJson(raw));
  if (!o) return null;
  switch (o.kind) {
    case 'map':
      return { kind: 'map' };
    case 'premium':
      return { kind: 'premium' };
    case 'support':
      return { kind: 'support' };
    case 'likes':
      return { kind: 'likes' };
    case 'event': {
      const eventId = str(o.eventId);
      if (!eventId) return null;
      return { kind: 'event', eventId, poiId: poiText(o.poiId) };
    }
    case 'place': {
      const poiId = poiText(o.poiId);
      return poiId ? { kind: 'place', poiId } : null;
    }
    case 'conversation': {
      const conversationId = str(o.conversationId);
      return conversationId ? { kind: 'conversation', conversationId } : null;
    }
    default:
      return null;
  }
}

/** a tabela do toque: alvo → tela (evento/lugar: mapa focando o lugar; sem lugar válido, só o mapa) */
export function routeForTarget(target: NotificationTarget | null | undefined): TargetRoute | null {
  if (!target) return null;
  switch (target.kind) {
    case 'map':
      return { screen: 'Map' };
    case 'event':
    case 'place': {
      const id = poiIdOf(target.poiId);
      return id != null ? { screen: 'Map', focusPoiId: id } : { screen: 'Map' };
    }
    case 'premium':
      return { screen: 'Paywall' };
    case 'support':
      return { screen: 'SupportChat' };
    case 'conversation':
      return { screen: 'Chat', conversationId: target.conversationId };
    case 'likes':
      return { screen: 'Likes' };
    default:
      return null;
  }
}

/** linha da central: o alvo dela; resposta do suporte sem alvo ainda abre o chat do suporte; senão, nada a abrir */
export function routeForNotification(n: Pick<AppNotification, 'type' | 'target'>): TargetRoute | null {
  return routeForTarget(n.target) ?? (n.type === 'support_reply' ? { screen: 'SupportChat' } : null);
}

/** o que dá pra ler de um toque/entrega do expo-notifications sem depender dos tipos nativos */
export interface PushNotificationLike {
  request?: {
    identifier?: string;
    content?: { title?: string | null; body?: string | null; data?: unknown };
    trigger?: unknown;
  };
}

/**
 * Dados do push (PushData do contrato). No Android o toque numa notificação que o FCM mostrou sozinho (app fechado)
 * traz os dados em content.data ou só em trigger.remoteMessage.data, conforme o caminho: os dois valem.
 */
export function pushDataOf(notification: PushNotificationLike | null | undefined): PushData | null {
  const req = notification?.request;
  const content = asObj(req?.content?.data);
  const remote = asObj(asObj(asObj(req?.trigger)?.remoteMessage)?.data);
  // 'body' em JSON: formato do serviço da Expo (não usamos, mas um push de teste pelo painel da Expo cai aqui)
  for (const d of [content, remote, asObj(parseJson(content?.body))]) {
    // push nosso: tem notificationId (pode vir '' na campanha só de push, sem item na central) ou alvo
    if (!d || (!('notificationId' in d) && d.target == null)) continue;
    const target = typeof d.target === 'string' ? d.target : d.target != null ? JSON.stringify(d.target) : undefined;
    return { notificationId: str(d.notificationId) ?? '', type: str(d.type) ?? '', ...(target ? { target } : {}) };
  }
  return null;
}

/**
 * Toque no push: o alvo; resposta do suporte sem alvo abre o suporte; sem alvo, a central de avisos (onde o aviso
 * está). Campanha só de push (notificationId '') sem alvo não tem item na central: abre o mapa.
 */
export function routeForPush(data: PushData | null): TargetRoute {
  const route = routeForNotification({ type: data?.type ?? '', target: parseTarget(data?.target) });
  if (route) return route;
  return data?.notificationId ? { screen: 'Notifications' } : { screen: 'Map' };
}

const TYPE_EMOJI: Record<string, string> = {
  event: '⚡',
  support_reply: '💬',
  premium_granted: '💎',
  place_approved: '📍',
  campaign: '📣',
};

/** texto do aviso rápido (uma linha): emoji do tipo + título */
export function noticeTextOf(n: Pick<AppNotification, 'type' | 'title'>): string {
  // título que já começa com emoji (a equipe escreve "⚡ Festa perto de você") não ganha outro na frente
  if (LEADING_PICTO.test(n.title)) return n.title;
  const emoji = TYPE_EMOJI[n.type] ?? '🔔';
  return `${emoji} ${n.title}`;
}

const LEADING_PICTO = /^\p{Extended_Pictographic}/u;

/**
 * Aviso rápido dentro do app? Não na central (a lista já atualiza na hora), não pra resposta do suporte com o chat do
 * suporte aberto, e não pra advertência da moderação (o App já abre o alerta dela pelo 'account_notice').
 */
export function shouldShowNotice(n: Pick<AppNotification, 'type' | 'target'>, routeName: string | undefined): boolean {
  if (n.type === 'moderation_warning') return false;
  if (routeName === 'Notifications') return false;
  if (routeName === 'SupportChat' && (n.type === 'support_reply' || n.target?.kind === 'support')) return false;
  return true;
}
