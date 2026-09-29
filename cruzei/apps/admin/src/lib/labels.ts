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
  ReportReason,
  ReportSource,
  SupportThreadStatus,
  UserRole,
} from '@cruzei/shared-types';

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

export function moderationActionLabel(action: string): string {
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
