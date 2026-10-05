// Segurança e moderação: denúncia, bloqueio, estado da conta, fila dos moderadores e documentos legais.
import type { AvatarConfig } from './avatar';

/** motivos de denúncia de pessoa (a ordem é a da lista no app) */
export const REPORT_REASONS = [
  'harassment',
  'fake',
  'scam',
  'inappropriate',
  'threat',
  'underage',
  'child_safety',
  'spam',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * motivos que só o SERVIDOR grava (o app não escolhe; POST /reports recusa): 'emergency' = botão de emergência
 * (POST /v1/safety/emergency), prioridade máxima na fila. A denúncia automática do filtro de abuso usa 'scam'.
 */
export const SYSTEM_REPORT_REASONS = ['emergency'] as const;
export type SystemReportReason = (typeof SYSTEM_REPORT_REASONS)[number];
/** motivo como pode estar gravado (fila da moderação e painel) */
export type AnyReportReason = ReportReason | SystemReportReason;

/** de onde a denúncia saiu (a moderação usa pra achar a conversa ou a foto) */
export type ReportSource = 'profile' | 'chat' | 'inbox' | 'requests' | 'map' | 'likes';
/** origens aceitas no POST /reports e /users/:id/report */
export const REPORT_SOURCES: readonly ReportSource[] = ['profile', 'chat', 'inbox', 'requests', 'map', 'likes'];

/**
 * origens que só o servidor grava: 'emergency' (botão de emergência) e 'auto_filter' (filtro de abuso viu golpe numa
 * mensagem: reporterId null, reason 'scam', no máximo UMA pendente por pessoa+motivo — reports_auto_filter_pending_uq)
 */
export const SYSTEM_REPORT_SOURCES = ['emergency', 'auto_filter'] as const;
export type SystemReportSource = (typeof SYSTEM_REPORT_SOURCES)[number];
export type AnyReportSource = ReportSource | SystemReportSource;

/** type (e não interface): vai direto pro Json do Prisma, que exige índice implícito */
export type ReportContext = {
  /** o app só manda ReportSource; as de sistema vêm do servidor */
  source: AnyReportSource;
  /** conversa denunciada (a moderação lê as últimas mensagens dela) */
  conversationId?: string;
  messageId?: string;
  photoId?: string;
  /**
   * só 'auto_filter' (gravado pelo servidor): onde o golpe apareceu, uma entrada por conversa, até
   * REPORT_CONTEXT_OCCURRENCES_MAX (a 1ª = conversationId/messageId acima). A ficha da moderação abre cada conversa.
   */
  occurrences?: ReportOccurrence[];
};

/** conversa (e a 1ª mensagem que bateu nela) citada numa denúncia automática */
export type ReportOccurrence = { conversationId: string; messageId?: string };
export const REPORT_CONTEXT_OCCURRENCES_MAX = 10;

export interface ReportPayload {
  userId: string;
  reason: ReportReason;
  description?: string;
  /** bloqueia a pessoa junto (padrão no app: sim) */
  block?: boolean;
  /** do app: só as origens de REPORT_SOURCES (occurrences é só do servidor) */
  context?: Omit<ReportContext, 'source' | 'occurrences'> & { source: ReportSource };
}

/** corpo do POST /users/:id/report (o alvo vem na rota) */
export type UserReportPayload = Omit<ReportPayload, 'userId'>;

export interface ReportResult {
  id: string;
  /** já havia uma denúncia sua pendente contra essa pessoa: a nova foi somada a ela */
  merged: boolean;
  blocked: boolean;
}

export interface BlockedUser {
  id: string;
  reason: string | null;
  createdAt: string;
  /** bloqueio esconde perfil E foto: vem só nome + avatar (mainPhotoUrl sempre null) */
  user: { id: string; name: string; avatar: AvatarConfig; mainPhotoUrl: null };
}

export type UserRole = 'user' | 'moderator' | 'admin';
export type AccountStatus = 'active' | 'suspended' | 'banned';
export type PhotoStatus = 'pending' | 'approved' | 'rejected';

/** corpo do 403 quando a conta não pode usar o app (HTTP e connect_error do socket) */
export interface AccountBlockedError {
  error: 'account_banned' | 'account_suspended';
  message: string;
  reason: string | null;
  /** fim da suspensão (ISO); null = até a revisão */
  until: string | null;
}

export const ACCOUNT_BLOCKED_ERRORS = ['account_banned', 'account_suspended'] as const;

// ---- botão de emergência ----

/** perfil pausado por tantos dias ao apertar "🆘 Emergência" (a pessoa pode despausar antes: DELETE /v1/me/pause) */
export const EMERGENCY_PAUSE_DAYS = 7;
/** atalho "Ligar 190" da confirmação (Polícia Militar) */
export const EMERGENCY_PHONE = '190';
/** `error` do 429 do botão (3 por hora, 10 por dia): a equipe já foi avisada; o app oferece o suporte e o 190 */
export const EMERGENCY_THROTTLED_ERROR = 'emergency_throttled';

/**
 * POST /v1/safety/emergency — um botão só: no menu do chat e no cartão da pessoa (com a pessoa) e em Ajuda e segurança
 * (sem pessoa). O app mostra antes a confirmação com o que vai acontecer + "Ligar 190". Ao confirmar o servidor, numa
 * tacada: pausa o perfil por EMERGENCY_PAUSE_DAYS (some do mapa), bloqueia a pessoa (se houver), cria denúncia de
 * segurança contra ela (reason 'emergency', context.source 'emergency', prioridade máxima) e abre/usa o atendimento do
 * suporte com mensagem automática marcada URGENTE (topo da fila, selo vermelho, 'support:urgent' pra equipe).
 * NUNCA manda localização. Idempotente o bastante: repetir não duplica bloqueio nem atendimento. Limite por conta: 3 por
 * hora e 10 por dia (429 EMERGENCY_THROTTLED_ERROR, que lembra do 190).
 */
export interface EmergencyRequest {
  /**
   * a pessoa envolvida (chat/cartão); ausente = emergência sem pessoa (Ajuda e segurança). Só bloqueia/denuncia com
   * relação registrada (conversa, curtida em qualquer sentido, passe ou aceno recente); sem relação = sem pessoa
   */
  targetUserId?: string;
  /** a conversa (quando veio do chat): a moderação lê as últimas mensagens dela */
  conversationId?: string;
}

export interface EmergencyResult {
  /** fim da pausa (ISO) */
  pausedUntil: string;
  /** bloqueou a pessoa agora (ou já estava bloqueada); false sem pessoa (ou sem relação com ela) */
  blocked: boolean;
  /** denúncia criada/somada contra a pessoa; null sem pessoa, sem relação ou fora do limite de denúncias */
  reportId: string | null;
  /** atendimento URGENTE do suporte (o app abre a tela do suporte) */
  supportThreadId: string;
}

// ---- fila de moderação ----

/** situação da denúncia: pending/reviewing esperam decisão; resolved = teve ação (aviso, suspensão…); dismissed = dispensada */
export type ReportStatus = 'pending' | 'reviewing' | 'resolved' | 'dismissed';

export interface ModerationReport {
  id: string;
  /** a ficha traz o histórico (até 50): pendentes e já decididas */
  status: ReportStatus;
  /** inclui os de sistema ('emergency') */
  reason: AnyReportReason;
  description: string | null;
  reporterId: string | null;
  context: ReportContext | null;
  priority: number;
  createdAt: string;
}

export interface ModerationUserSummary {
  id: string;
  name: string;
  age: number;
  /** foto principal em QUALQUER estado (o moderador precisa ver até a recusada) */
  mainPhotoUrl: string | null;
  accountStatus: AccountStatus;
  suspendedUntil: string | null;
  reviewHoldAt: string | null;
  createdAt: string;
  /** conta da equipe só um admin modera (e ninguém modera a própria): o painel esconde as ações */
  role: UserRole;
}

export interface ModerationReportGroup {
  user: ModerationUserSummary;
  reports: ModerationReport[];
  priority: number;
  distinctReporters: number;
  firstAt: string;
}

export interface ModerationPhoto {
  id: string;
  url: string;
  userId: string;
  userName: string;
  /** rótulos da análise automática (ex.: "Suggestive 72%", "idade aparente 15–19") */
  labels: string[];
  createdAt: string;
}

export interface ModerationQueue {
  reports: ModerationReportGroup[];
  photos: ModerationPhoto[];
}

export interface ModerationMessage {
  id: string;
  senderId: string;
  content: string | null;
  messageType: string;
  createdAt: string;
}

export interface ModerationUserDetail {
  /** instagram: @ público da pessoa (sem o @), pra moderação checar spam/perfil falso; a orientação NÃO vem (minimização) */
  user: ModerationUserSummary & { bio: string | null; phoneMasked: string | null; instagram?: string | null };
  /**
   * retained: a pessoa apagou com denúncia de menor/abuso infantil aberta — a foto fica só aqui ("retida por
   * denúncia"), fora do perfil dela e do público, até a denúncia fechar; não aceita aprovar/recusar
   */
  photos: {
    id: string;
    url: string;
    status: PhotoStatus;
    isMain: boolean;
    rejectReason: string | null;
    retained?: boolean;
  }[];
  reports: ModerationReport[];
  actions: {
    action: string;
    note: string | null;
    moderatorId: string | null;
    /** nome de quem decidiu (null = automático ou conta apagada) */
    moderatorName?: string | null;
    createdAt: string;
  }[];
  /** conversas citadas nas denúncias (só essas): últimas mensagens de cada uma */
  conversations: { conversationId: string; otherUserId: string; messages: ModerationMessage[] }[];
}

export type ModerationDecision = 'dismiss' | 'warn' | 'suspend' | 'ban' | 'reinstate';

export interface ModerationActionPayload {
  action: ModerationDecision;
  /** suspensão: dias (1–365); ausente = até nova revisão */
  days?: number;
  /** motivo mostrado à pessoa (suspensão/banimento/advertência) */
  reason?: string;
  /** nota interna da moderação */
  note?: string;
}

// ---- documentos legais ----

/** 'excluir-conta': página pública de exclusão da conta (URL pedida pelo Google Play); não entra no aceite */
export type LegalSlug = 'termos' | 'privacidade' | 'seguranca-infantil' | 'excluir-conta';

/**
 * versão vigente dos Termos + Política (o aceite grava esta string; mudou → o app pede novo aceite).
 * 1.1: mensagem sem match (Principal/Solicitações), fim das 48 h.
 * 1.2: orientação (opcional; exibir e ordenar por escolha), "Mostrar" recíproco, Instagram público, última atividade
 * só em faixa, Boost até 5 km, push de mensagem/curtida/match, número reciclado e GPS falso.
 */
export const LEGAL_VERSION = '1.2';
export const LEGAL_EFFECTIVE_DATE = '2026-10-03';

export interface LegalDocMeta {
  slug: LegalSlug;
  title: string;
}

export interface LegalDoc extends LegalDocMeta {
  version: string;
  effectiveDate: string;
  markdown: string;
}
