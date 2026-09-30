// Suporte ao vivo: um atendimento aberto por pessoa (status open/pending), mensagens em tempo real pelo socket.
// Lado do app: /v1/support/*. Lado da equipe (admin/moderador): /v1/admin/support/*.

export type SupportThreadStatus = 'open' | 'pending' | 'resolved';
export type SupportAuthor = 'user' | 'staff' | 'system';

export interface SupportMessage {
  id: string;
  threadId: string;
  author: SupportAuthor;
  /** quem escreveu: a pessoa (author 'user') ou o atendente; null em 'system' */
  senderId: string | null;
  /** nome de exibição do atendente ("Equipe Metch" pro app; nome real só no painel) */
  senderName: string | null;
  body: string;
  /** nota interna: só a equipe vê (nunca vai pro app) */
  internal: boolean;
  createdAt: string;
  /** só nas minhas mensagens (reconciliação do envio otimista) */
  clientId?: string;
}

/** atendimento visto pelo APP */
export interface SupportThreadForUser {
  id: string;
  status: SupportThreadStatus;
  createdAt: string;
  lastMessageAt: string;
  /** mensagens da equipe ainda não lidas pela pessoa */
  unread: number;
  rating: number | null;
  /** aberto (ou marcado) pelo botão de emergência; ausente = false */
  urgent?: boolean;
}

/** GET /v1/support/thread → atendimento atual (ou o último resolvido) + mensagens sem as internas */
export interface SupportThreadResponse {
  thread: SupportThreadForUser | null;
  messages: SupportMessage[];
}

/** POST /v1/support/messages (10 por minuto; mesmo clientId = devolve a mesma mensagem, sem duplicar) */
export interface SupportSendPayload {
  body: string;
  clientId?: string;
}

/**
 * resposta do POST /v1/support/messages. `welcome`: mensagem de sistema com o prazo de resposta, só quando esta
 * mensagem abriu um atendimento novo (também chega pelo socket). Mensagem da equipe pro app: senderId null e
 * senderName "Equipe Metch" (o app nunca vê quem atendeu).
 */
export interface SupportSendResult {
  thread: SupportThreadForUser;
  message: SupportMessage;
  welcome: SupportMessage | null;
}

/** POST /v1/support/thread/rate — nota do atendimento atual ou do último encerrado */
export interface SupportRatePayload {
  /** 1 a 5 */
  rating: number;
}

// POST /v1/support/read (sem corpo) → zera as não lidas da pessoa. 204.

/** linha da fila no painel */
export interface SupportThreadSummary {
  id: string;
  status: SupportThreadStatus;
  user: { id: string; name: string; avatarUrl: string | null; premiumTier: 'free' | 'premium' | 'premium_plus'; accountStatus: 'active' | 'suspended' | 'banned' };
  assignedTo: { id: string; name: string } | null;
  lastMessage: { body: string; author: SupportAuthor; createdAt: string } | null;
  /** mensagens da pessoa ainda não lidas pela equipe */
  staffUnread: number;
  createdAt: string;
  lastMessageAt: string;
  /** minutos até a 1ª resposta da equipe (null = ainda sem resposta) */
  firstResponseMinutes: number | null;
  /**
   * desde quando a pessoa espera a equipe (ISO): a 1ª mensagem dela depois da última resposta pública. null = não
   * está esperando (atendimento pendente/resolvido, ou reaberto sem mensagem nova)
   */
  waitingSince: string | null;
  /**
   * URGENTE (botão de emergência): enquanto não resolvido vai pro TOPO da fila em qualquer ordem, com selo vermelho.
   * Fica marcado depois de resolvido (histórico). Ausente = false (servidor antigo)
   */
  urgent?: boolean;
  /** quando virou urgente (ISO); null quando não é */
  urgentAt?: string | null;
}

/** GET /v1/admin/support/threads/:id */
export interface SupportThreadDetail extends SupportThreadSummary {
  messages: SupportMessage[];
  /** contexto pra atender: denúncias contra a pessoa, conta, plano, aparelho */
  context: {
    createdAt: string;
    lastActiveAt: string | null;
    reportsAgainst: number;
    premiumExpiresAt: string | null;
    appVersion: string | null;
    pastThreads: number;
  };
}

/**
 * GET /v1/admin/support/threads?status=&mine=1&order=&urgent=1&cursor= — status: open | pending | resolved | all
 * (sem status = os não resolvidos, open + pending). Ordem: URGENTES não resolvidos sempre primeiro (urgentAt mais
 * antigo primeiro), depois última mensagem mais recente primeiro; order=oldest = quem espera há mais tempo primeiro
 * (waitingSince, ou a última mensagem de quem não está esperando). urgent=1: só os urgentes.
 */
export interface SupportThreadList {
  items: SupportThreadSummary[];
  nextCursor: string | null;
  /** quantos atendimentos batem o filtro (sem paginação). status=open: o mesmo número do Painel (support.waitingStaff) */
  total: number;
}

/**
 * POST /v1/admin/support/threads/:id/messages → SupportMessage. Resposta pública (internal false): a pessoa recebe
 * aviso + push, o atendimento vai pra 'pending' (esperando a pessoa) e, sem responsável, fica com quem respondeu.
 * Atendimento encerrado só aceita nota interna (409 thread_resolved: reabra com /status).
 */
export interface StaffSupportSendPayload {
  body: string;
  internal?: boolean;
  clientId?: string;
}

/** POST /v1/admin/support/threads/:id/assign — só admin/moderador; null = sem responsável */
export interface SupportAssignPayload {
  userId: string | null;
}

/**
 * POST /v1/admin/support/threads/:id/status. Reabrir (resolved → open/pending) dá 409 thread_conflict se a pessoa
 * já abriu outro atendimento. Encerrar manda uma mensagem de sistema pra pessoa.
 */
export interface SupportStatusPayload {
  status: SupportThreadStatus;
}

// POST /v1/admin/support/threads/:id/read (sem corpo) → zera as não lidas da equipe. Devolve SupportThreadSummary.
// Respostas de assign/status/read: SupportThreadSummary atualizado (também vai pro socket como 'support:thread').

// ---- socket ----
/** 'support:message' → user:<id> (sem internas) e sala staff:support (todas) */
export interface SupportMessageEvent {
  threadId: string;
  message: SupportMessage;
}
/** 'support:thread' → sala staff:support (fila mudou: nova, status, atribuição, não lidas) */
export interface SupportThreadEvent {
  thread: SupportThreadSummary;
}
/**
 * 'support:typing' → quem está do outro lado ({threadId, author, isTyping}); app emite 'support:typing' {isTyping},
 * o painel emite 'support:typing' {threadId, isTyping} (não emitir enquanto escreve nota interna)
 */
export interface SupportTypingEvent {
  threadId: string;
  author: 'user' | 'staff';
  isTyping: boolean;
}

/**
 * 'support:urgent' → sala staff:support: botão de emergência apertado agora (o painel toca alerta e destaca). No máximo
 * 1 por atendimento a cada 10 min (apertar de novo só atualiza a fila). O 'support:thread' de sempre também sai.
 */
export interface SupportUrgentEvent {
  thread: SupportThreadSummary;
}

export const SUPPORT_EVENTS = {
  message: 'support:message',
  thread: 'support:thread',
  typing: 'support:typing',
  urgent: 'support:urgent',
} as const;

export const SUPPORT_LIMITS = {
  bodyMax: 2000,
  /** mensagens da pessoa por minuto */
  userPerMinute: 10,
} as const;
