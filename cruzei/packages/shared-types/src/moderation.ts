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

/** de onde a denúncia saiu (a moderação usa pra achar a conversa ou a foto) */
export type ReportSource = 'profile' | 'chat' | 'inbox' | 'requests' | 'map' | 'likes';
/** origens aceitas no POST /reports e /users/:id/report */
export const REPORT_SOURCES: readonly ReportSource[] = ['profile', 'chat', 'inbox', 'requests', 'map', 'likes'];

/** type (e não interface): vai direto pro Json do Prisma, que exige índice implícito */
export type ReportContext = {
  source: ReportSource;
  /** conversa denunciada (a moderação lê as últimas mensagens dela) */
  conversationId?: string;
  messageId?: string;
  photoId?: string;
};

export interface ReportPayload {
  userId: string;
  reason: ReportReason;
  description?: string;
  /** bloqueia a pessoa junto (padrão no app: sim) */
  block?: boolean;
  context?: ReportContext;
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

// ---- fila de moderação ----

/** situação da denúncia: pending/reviewing esperam decisão; resolved = teve ação (aviso, suspensão…); dismissed = dispensada */
export type ReportStatus = 'pending' | 'reviewing' | 'resolved' | 'dismissed';

export interface ModerationReport {
  id: string;
  /** a ficha traz o histórico (até 50): pendentes e já decididas */
  status: ReportStatus;
  reason: ReportReason;
  description: string | null;
  reporterId: string | null;
  context: ReportPayload['context'] | null;
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
  user: ModerationUserSummary & { bio: string | null; phoneMasked: string | null };
  photos: { id: string; url: string; status: PhotoStatus; isMain: boolean; rejectReason: string | null }[];
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

export type LegalSlug = 'termos' | 'privacidade' | 'seguranca-infantil';

/** versão vigente dos Termos + Política (o aceite grava esta string; mudou → o app pede novo aceite). 1.1: mensagem sem match (Principal/Solicitações), fim das 48 h */
export const LEGAL_VERSION = '1.1';
export const LEGAL_EFFECTIVE_DATE = '2026-09-29';

export interface LegalDocMeta {
  slug: LegalSlug;
  title: string;
}

export interface LegalDoc extends LegalDocMeta {
  version: string;
  effectiveDate: string;
  markdown: string;
}
