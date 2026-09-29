// Notificações: central de avisos no app (tabela notifications), push (FCM direto, token do aparelho em
// device_tokens) e os destinos de toque (deep link). Mesmo contrato pro backend, o app e o painel admin.

/** para onde o toque na notificação leva (app) — sempre um destino conhecido, nunca URL livre */
export type NotificationTarget =
  | { kind: 'map' }
  | { kind: 'event'; eventId: string; poiId?: string | null }
  | { kind: 'place'; poiId: string }
  | { kind: 'premium' }
  | { kind: 'support' }
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'likes' };

/** tipos gravados em notifications.type */
export type NotificationType =
  | 'campaign' // mandada pelo painel (aviso geral, novidade)
  | 'event' // evento publicado/perto
  | 'support_reply' // o suporte respondeu
  | 'premium_granted' // Premium dado ou tirado manualmente
  | 'moderation_warning' // aviso da moderação (já existia)
  | 'place_approved'; // lugar sugerido entrou no mapa

/** item da central de avisos (GET /v1/notifications) */
export interface AppNotification {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  target: NotificationTarget | null;
  readAt: string | null;
  sentAt: string;
}

/** POST /v1/me/devices — registra o token de push deste aparelho (FCM no Android) */
export interface RegisterDevicePayload {
  token: string;
  platform: 'android' | 'ios';
  appVersion?: string;
}

/** evento de socket 'notification:new' (app aberto: aviso na hora, sem esperar o push) */
export interface NotificationNewPayload {
  notification: AppNotification;
}

/** GET /v1/notifications/unread-count → avisos da central ainda não lidos (badge) */
export interface NotificationUnreadCount {
  count: number;
}

export const NOTIFICATION_EVENTS = {
  /** NotificationNewPayload → sala user:<id> */
  new: 'notification:new',
} as const;

/**
 * canal Android do push (android.notification.channel_id): 'support' pra resposta do suporte, 'default' pro resto.
 * O app cria os dois canais.
 */
export const PUSH_CHANNELS = { support: 'support', default: 'default' } as const;

/** dados que vão no push (FCM data): o app monta o destino a partir deles */
export interface PushData {
  /** id do item na central de avisos; '' quando o aviso foi só por push (campanha sem central) */
  notificationId: string;
  type: string;
  /** NotificationTarget serializado em JSON */
  target?: string;
}

/**
 * GET /v1/notifications/settings e PATCH /v1/notifications/settings {settings: Partial<NotificationSettings>}.
 * Desligado = a pessoa fica fora do público das campanhas daquele tipo (push E central). Padrão: tudo ligado.
 * Resposta do suporte, Premium e lugar aprovado não passam por aqui (são sobre a conta dela).
 */
export interface NotificationSettings {
  /** avisos gerais e novidades do Metch */
  campaigns: boolean;
  /** avisos de evento */
  events: boolean;
}
