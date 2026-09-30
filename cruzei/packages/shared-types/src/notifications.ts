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
  | { kind: 'likes' }
  /** comemoração do match com essa pessoa (só push social; o painel não usa em campanha) */
  | { kind: 'match'; userId: string };

/** tipos gravados em notifications.type */
export type NotificationType =
  | 'campaign' // mandada pelo painel (aviso geral, novidade)
  | 'event' // evento publicado/perto
  | 'support_reply' // o suporte respondeu
  | 'premium_granted' // Premium dado ou tirado manualmente
  | 'moderation_warning' // aviso da moderação (já existia)
  | 'place_approved' // lugar sugerido entrou no mapa
  | 'premium_expired' // a assinatura venceu (tarefa periódica rebaixou pra free)
  | 'anonymous_expired'; // a janela do invisível grátis acabou: voltou a aparecer no mapa

/**
 * Push SOCIAL (mensagem nova, curtida, match): só push — NÃO entra na central de avisos (notificationId '' no
 * PushData) e o app em primeiro plano não mostra (o socket já atualiza). Valor de PushData.type.
 */
export type SocialPushType = 'message' | 'like' | 'match';
export const SOCIAL_PUSH_TYPES: readonly SocialPushType[] = ['message', 'like', 'match'];

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
 * canal Android do push (android.notification.channel_id): 'support' pra resposta do suporte, 'messages' pra mensagem
 * nova, 'social' pra curtida e match, 'default' pro resto. O app cria os quatro (app antigo sem o canal cai no 'default').
 */
export const PUSH_CHANNELS = { support: 'support', default: 'default', messages: 'messages', social: 'social' } as const;

/** dados que vão no push (FCM data): o app monta o destino a partir deles */
export interface PushData {
  /** id do item na central de avisos; '' quando o aviso foi só por push (campanha sem central ou push social) */
  notificationId: string;
  /** NotificationType, ou SocialPushType ('message' | 'like' | 'match') no push social */
  type: string;
  /** NotificationTarget serializado em JSON */
  target?: string;
}

/**
 * GET /v1/notifications/settings e PATCH /v1/notifications/settings {settings: Partial<NotificationSettings>}.
 * campaigns/events desligado = a pessoa fica fora do público das campanhas daquele tipo (push E central).
 * messages/likes/matches desligado = sem push daquele tipo (o socket e as listas continuam iguais).
 * Padrão: tudo ligado (inclusive a prévia). Resposta do suporte, Premium e lugar aprovado não passam por aqui.
 */
export interface NotificationSettings {
  /** avisos gerais e novidades do Metch */
  campaigns: boolean;
  /** avisos de evento */
  events: boolean;
  /** push de mensagem nova (no máx. 1 por conversa a cada 60 s) */
  messages: boolean;
  /** push de curtida (no máx. 1 a cada 15 min, agregando; super curtida fura) */
  likes: boolean;
  /** push de match (sempre avisa, se ligado) */
  matches: boolean;
  /** mostrar o texto da mensagem no push (o push de mensagem nem aparece na tela bloqueada: visibility secret) */
  messagePreview: boolean;
}
