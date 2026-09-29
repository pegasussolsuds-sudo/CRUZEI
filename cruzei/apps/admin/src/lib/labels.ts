// Textos pt-BR dos valores do contrato (um lugar só pra tela nenhuma inventar nome diferente)
import type {
  AccountStatus,
  AdminAuditEntry,
  AdminPermission,
  CampaignStatus,
  CandidateStatus,
  EventCategory,
  EventStatus,
  PhotoStatus,
  PremiumTier,
  AdminSubscriptionRow,
  ReportReason,
  ReportSource,
  ReportStatus,
  SupportThreadStatus,
  UserRole,
} from '@cruzei/shared-types';
import { formatDate, isNoExpiry } from './format';

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'Ativa',
  suspended: 'Suspensa',
  banned: 'Banida',
};

export const TIER_LABEL: Record<PremiumTier, string> = {
  free: 'Grátis',
  premium: 'Premium',
  premium_plus: 'Premium+',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  user: 'Pessoa',
  moderator: 'Moderação',
  admin: 'Admin',
};

export const PHOTO_STATUS_LABEL: Record<PhotoStatus, string> = {
  pending: 'Em análise',
  approved: 'Aprovada',
  rejected: 'Recusada',
};

/** mesmo texto da lista de denúncia do app (components/safety/reasons.ts), visto do lado da moderação */
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  harassment: 'Assédio ou ofensa',
  fake: 'Perfil falso',
  scam: 'Golpe ou pedido de dinheiro',
  inappropriate: 'Nudez ou conteúdo sexual',
  threat: 'Ameaça ou violência',
  underage: 'Parece ter menos de 18',
  child_safety: 'Exploração ou abuso infantil',
  spam: 'Spam ou propaganda',
  other: 'Outro motivo',
};

/** motivos que pedem pressa (a fila mostra em vermelho) */
export const URGENT_REASONS: ReadonlySet<ReportReason> = new Set<ReportReason>(['threat', 'child_safety', 'underage']);

export const REPORT_SOURCE_LABEL: Record<ReportSource, string> = {
  profile: 'perfil',
  chat: 'conversa',
  inbox: 'mensagens',
  requests: 'solicitações',
  map: 'mapa',
  likes: 'curtidas',
};

/** situação da denúncia (a ficha mostra o histórico: pendentes e decididas) */
export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Pendente',
  reviewing: 'Em análise',
  resolved: 'Teve ação',
  dismissed: 'Dispensada',
};

/** pendente/em análise ainda esperam decisão (a mesma conta do reportsPending do servidor inclui só 'pending') */
export function isOpenReport(status: ReportStatus): boolean {
  return status === 'pending' || status === 'reviewing';
}

export type SubscriptionState = 'active' | 'cancelled' | 'expired';

/** situação de uma assinatura do histórico: cancelada (com a data), vencida ou ativa */
export function subscriptionState(s: Pick<AdminSubscriptionRow, 'cancelledAt' | 'expiresAt'>, now: number = Date.now()): { state: SubscriptionState; label: string } {
  if (s.cancelledAt) return { state: 'cancelled', label: `cancelada em ${formatDate(s.cancelledAt)}` };
  if (!isNoExpiry(s.expiresAt) && Date.parse(s.expiresAt) <= now) return { state: 'expired', label: 'vencida' };
  return { state: 'active', label: 'ativa' };
}

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  pending: 'Aguardando',
  promoted: 'No mapa',
  rejected: 'Recusada',
  expired: 'Expirou',
};

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  cancelled: 'Cancelado',
};

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  event: 'Evento',
  show: 'Show',
  party: 'Festa',
  festival: 'Festival',
  sports: 'Esporte',
  other: 'Outro',
};

export const EVENT_CATEGORIES = Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[];

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  sending: 'Enviando',
  sent: 'Enviada',
  cancelled: 'Cancelada',
  failed: 'Falhou',
};

export const SUPPORT_STATUS_LABEL: Record<SupportThreadStatus, string> = {
  open: 'Aberto',
  pending: 'Pendente',
  resolved: 'Resolvido',
};

/**
 * Categorias de lugar (enum POICategory do banco). O contrato tipa AdminPoi.category como string solta,
 * então a lista mora aqui; categoria desconhecida aparece crua.
 */
export const POI_CATEGORY_LABEL: Record<string, string> = {
  bar: 'Bar',
  restaurant: 'Restaurante',
  cafe: 'Café',
  park: 'Parque',
  shopping: 'Shopping',
  gym: 'Academia',
  show: 'Casa de show',
  event: 'Evento',
  beach: 'Praia',
  museum: 'Museu',
  other: 'Outro',
};

export const POI_CATEGORIES = Object.keys(POI_CATEGORY_LABEL);

/** motivos de denúncia de lugar (poi_reports.reason) */
const POI_REPORT_REASON_LABEL: Record<string, string> = {
  not_public: 'Não é aberto ao público',
  residence: 'É uma residência',
  closed: 'Fechou',
  wrong_place: 'Está no lugar errado do mapa',
  offensive: 'Nome ou conteúdo ofensivo',
};

export function poiReportReasonLabel(reason: string): string {
  return POI_REPORT_REASON_LABEL[reason] ?? reason;
}

export function poiCategoryLabel(c: string | null | undefined): string {
  if (!c) return 'Sem categoria';
  return POI_CATEGORY_LABEL[c] ?? c;
}

/** histórico de moderação (moderation_actions.action é texto livre: o desconhecido aparece cru) */
const MODERATION_ACTION_LABEL: Record<string, string> = {
  warn: 'Aviso',
  suspend: 'Suspensão',
  ban: 'Banimento',
  reinstate: 'Reativação',
  dismiss: 'Denúncias dispensadas',
  photo_approve: 'Foto aprovada',
  photo_reject: 'Foto recusada',
  auto_hold: 'Segurada pra revisão (automático)',
  review_hold: 'Segurada pra revisão',
};

/** ações do painel gravadas na auditoria (admin.*) */
const ADMIN_ACTION_LABEL: Record<string, string> = {
  'admin.campaign.send': 'Campanha enviada',
  'admin.campaign.schedule': 'Campanha agendada',
  'admin.campaign.cancel': 'Campanha cancelada',
  'admin.event.create': 'Evento criado',
  'admin.event.update': 'Evento editado',
  'admin.event.publish': 'Evento publicado',
  'admin.event.cancel': 'Evento cancelado',
  'admin.event.delete': 'Rascunho de evento apagado',
  'admin.event.announce': 'Aviso de evento',
  'admin.place.approve': 'Sugestão aprovada',
  'admin.place.reject': 'Sugestão recusada',
  'admin.place.reports_dismiss': 'Denúncias de lugar descartadas',
  'admin.place.reports_hide': 'Lugar oculto por denúncia',
  'admin.poi.create': 'Lugar criado',
  'admin.poi.update': 'Lugar editado',
  'admin.poi.hide': 'Lugar oculto',
  'admin.poi.unhide': 'Lugar de volta ao mapa',
  'admin.user.premium_grant': 'Premium dado',
  'admin.user.premium_remove': 'Premium tirado',
  'admin.user.role': 'Papel alterado',
};

/** ação da auditoria em português: admin.* pela tabela, moderation.* pelo rótulo do histórico; desconhecida fica crua */
export function auditActionLabel(action: string): string {
  if (ADMIN_ACTION_LABEL[action]) return ADMIN_ACTION_LABEL[action];
  if (action.startsWith('moderation.')) return moderationActionLabel(action.slice('moderation.'.length));
  return action;
}

export function moderationActionLabel(action: string): string {
  // suspensão grava o prazo junto: "suspend:3" (dias) ou "suspend:revisao" (até alguém reativar)
  const m = /^suspend:(\d+|revisao)$/.exec(action);
  if (m) return m[1] === 'revisao' ? 'Suspensão até revisão' : `Suspensão por ${m[1]} ${m[1] === '1' ? 'dia' : 'dias'}`;
  return MODERATION_ACTION_LABEL[action] ?? action.replace(/_/g, ' ');
}

export const PLATFORM_LABEL: Record<string, string> = {
  android: 'Android',
  ios: 'iPhone',
  web: 'Web',
  manual: 'Manual (equipe)',
};

export function platformLabel(p: string): string {
  return PLATFORM_LABEL[p] ?? p;
}

export const AUDIT_TARGET_LABEL: Record<NonNullable<AdminAuditEntry['target']>['kind'], string> = {
  user: 'Pessoa',
  event: 'Evento',
  campaign: 'Campanha',
  poi: 'Lugar',
  candidate: 'Sugestão',
  support: 'Atendimento',
};

export const PERMISSION_LABEL: Record<AdminPermission, string> = {
  dashboard: 'Painel',
  'users.read': 'Ver usuários',
  'users.moderate': 'Moderar contas',
  'users.premium': 'Premium manual',
  'users.role': 'Mudar papéis',
  places: 'Lugares',
  events: 'Eventos',
  'events.push': 'Avisar sobre eventos',
  campaigns: 'Notificações',
  support: 'Suporte',
  audit: 'Auditoria',
};
