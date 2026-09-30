// Painel admin (web, apps/admin): contrato das rotas /v1/admin/*. Quem entra: role 'admin' ou 'moderator'.
// Permissões (o servidor confere SEMPRE; o painel só esconde botões):
// - admin: tudo
// - moderator: painel, usuários (ver + moderar contas 'user'), lugares, eventos (sem push), suporte
// - só admin: Premium manual, papéis, campanhas de push/notificação, push de evento, auditoria
import type { PhoneReleaseReason } from './api/auth.types';
import type { AccountStatus, ModerationUserDetail, UserRole } from './moderation';
import type { NotificationTarget } from './notifications';
import type { PremiumTier } from './user';

export type StaffRole = Extract<UserRole, 'admin' | 'moderator'>;

/** GET /v1/admin/staff — a equipe (admin/moderador, conta ativa), pra "Passar pra…" no suporte. Ordem: nome */
export interface AdminStaffMember {
  id: string;
  name: string;
  role: StaffRole;
}

export interface AdminStaffList {
  items: AdminStaffMember[];
}

/** GET /v1/admin/me — quem está logado no painel (403 se não for equipe) */
export interface AdminMe {
  id: string;
  name: string;
  role: StaffRole;
  /** o que o painel mostra/libera pra esse papel */
  permissions: AdminPermission[];
}

export type AdminPermission =
  | 'dashboard'
  | 'users.read'
  | 'users.moderate'
  | 'users.premium'
  | 'users.role'
  | 'places'
  | 'events'
  | 'events.push'
  | 'campaigns'
  | 'support'
  | 'audit';

// ─────────────────────────── painel (dashboard) ───────────────────────────

export interface DailyPoint {
  /** AAAA-MM-DD (fuso de São Paulo) */
  day: string;
  n: number;
}

/** GET /v1/admin/stats */
export interface AdminStats {
  generatedAt: string;
  users: {
    total: number;
    new24h: number;
    new7d: number;
    active24h: number;
    active7d: number;
    premium: number;
    premiumPlus: number;
    suspended: number;
    banned: number;
    anonymousNow: number;
  };
  moderation: { reportsPending: number; photosPending: number; reviewHold: number };
  places: { candidatesPending: number; poiReportsPending: number; eventsLive: number; eventsUpcoming: number };
  support: { open: number; unassigned: number; waitingStaff: number; avgFirstResponseMin7d: number | null };
  activity: { messages24h: number; likes24h: number; mutualLikes24h: number; conversationsNew24h: number };
  push: { devices: number; campaignsSent7d: number };
  /** últimos 30 dias */
  series: { signups: DailyPoint[]; activeUsers: DailyPoint[]; messages: DailyPoint[]; likes: DailyPoint[] };
}

// ─────────────────────────── usuários ───────────────────────────

/**
 * GET /v1/admin/users?q=&status=&tier=&role=&reports=pending&cursor=&limit= (q: nome, telefone ou id;
 * reports=pending: só quem tem denúncia esperando decisão)
 */
export interface AdminUserRow {
  id: string;
  name: string;
  /** telefone completo só pra admin; moderador vê mascarado (+55 34 9****-1234) */
  phone: string | null;
  age: number | null;
  avatarUrl: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  suspendedUntil: string | null;
  premiumTier: PremiumTier;
  premiumExpiresAt: string | null;
  visibilityMode: 'visible' | 'anonymous';
  reportsPending: number;
  createdAt: string;
  lastActiveAt: string | null;
  /** quando o número saiu desta conta (número reciclado); null/ausente = nunca. Badge "Número liberado em dd/mm" */
  phoneReleasedAt?: string | null;
  /** fim da janela do invisível grátis (só quando invisível sem Premium) */
  anonymousUntil?: string | null;
  /** quando usou o teste grátis do Premium */
  trialUsedAt?: string | null;
}

/** uma liberação do número desta conta (histórico, mais recente primeiro) */
export interface AdminPhoneRelease {
  /** inteiro pra admin; mascarado pra moderador */
  phone: string | null;
  reason: PhoneReleaseReason;
  /** situação da conta antiga na hora da liberação */
  accountStatus: AccountStatus;
  releasedAt: string;
  /** conta criada depois com o número (link só pra admin) */
  newUserId: string | null;
  /** admin que liberou pelo painel (reason 'admin') */
  releasedBy: { id: string; name: string } | null;
  /** true = ESTA conta é a nova: o número veio de outra conta (ausente/false = o número saiu desta conta) */
  incoming?: boolean;
  /** conta que perdeu o número (só nas linhas `incoming`, link só pra admin) */
  oldUserId?: string | null;
}

/**
 * POST /v1/admin/users/:id/release-phone (só admin; caso de suporte) → AdminUserRow. Mesma liberação do app:
 * telefone sai da conta (histórico em phone_releases, reason 'admin'), conta pausada sem prazo e sessões revogadas.
 */
export interface ReleasePhonePayload {
  reason: string;
}

export interface AdminUserList {
  items: AdminUserRow[];
  nextCursor: string | null;
  total: number;
}

export interface AdminSubscriptionRow {
  id: string;
  tier: PremiumTier;
  platform: string; // 'android' | 'ios' | 'web' | 'manual'
  startsAt: string;
  expiresAt: string;
  cancelledAt: string | null;
  /** motivo, só nas manuais */
  note: string | null;
  grantedBy: { id: string; name: string } | null;
}

/**
 * GET /v1/admin/users/:id — a ficha de moderação que já existia + o resto. Compatibilidade: a resposta também traz,
 * no nível de cima, os campos de ModerationUserDetail (user, photos, reports, actions, conversations) que a tela de
 * moderação do celular lê nessa mesma rota. O painel usa `moderation`.
 */
export interface AdminUserDetail extends AdminUserRow {
  moderation: ModerationUserDetail;
  bio: string | null;
  /** @ do Instagram (público); a orientação NÃO vem pro painel (minimização de dado sensível) */
  instagram?: string | null;
  /** histórico de liberação do número desta conta (vazio = nunca) */
  phoneReleases?: AdminPhoneRelease[];
  city: string | null;
  subscriptions: AdminSubscriptionRow[];
  devices: { platform: string; appVersion: string | null; lastUsedAt: string }[];
  counts: { likesSent: number; likesReceived: number; mutualLikes: number; conversations: number; messagesSent: number; blocksReceived: number };
  supportThreads: { id: string; status: 'open' | 'pending' | 'resolved'; createdAt: string }[];
}

/**
 * POST /v1/admin/users/:id/premium (só admin) → AdminUserRow atualizado. tier 'free' = tira o Premium agora (cancela
 * a manual vigente). Sem vencimento (days null): users.premium_expires_at fica null e a linha em subscriptions vence
 * em 2099-12-31 (a coluna é obrigatória) — mostre "sem vencimento" quando o ano for 2099.
 */
export interface GrantPremiumPayload {
  tier: PremiumTier;
  /** dias a partir de agora; null = sem vencimento (ignorado quando tier = 'free') */
  days: number | null;
  reason: string;
  /** avisar a pessoa (notificação + push) */
  notify?: boolean;
}

/** POST /v1/admin/users/:id/role (só admin; não muda o próprio papel; sempre sobra 1 admin) → AdminUserRow */
export interface SetRolePayload {
  role: UserRole;
}

// ─────────────────────────── lugares ───────────────────────────

export type CandidateStatus = 'pending' | 'promoted' | 'rejected' | 'expired';

/** GET /v1/admin/places/candidates?status=pending&cursor= — sugestões "Pôr no Metch" da galera */
export interface AdminPlaceCandidate {
  id: string;
  status: CandidateStatus;
  name: string;
  category: string | null;
  lat: number;
  lng: number;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  /** votos: pedidos "põe no Metch", confirmações no local e negações */
  votes: { requests: number; onsite: number; deny: number };
  /** o que o robô da galera decidiria hoje */
  crowdHint: string | null;
  firstSeenOn: string;
  lastEvidenceOn: string | null;
  poiId: string | null;
}

export interface AdminPlaceCandidateList {
  items: AdminPlaceCandidate[];
  nextCursor: string | null;
}

// POST /v1/admin/places/candidates/:id/approve (sem corpo) → AdminPlaceCandidate (status 'promoted', poiId).
// Idempotente; quem pediu/confirmou recebe o aviso 'place_approved'. Candidato da época do Mapbox ('mbx:') → 422.

/** POST /v1/admin/places/candidates/:id/reject → AdminPlaceCandidate (lápide de 90 dias: o robô não reabre) */
export interface RejectCandidatePayload {
  reason: string;
}

/**
 * GET /v1/admin/places/reports — denúncias ainda sem desfecho, agrupadas por POI (mais denunciado primeiro).
 * reason: not_public | residence | closed | wrong_place | offensive. createdAt é só o DIA (a denúncia guarda o dia).
 */
export interface AdminPoiReportGroup {
  poi: AdminPoi;
  reports: { id: string; reason: string; createdAt: string; reporterId: string | null }[];
}

export interface AdminPoiReportList {
  items: AdminPoiReportGroup[];
}

/**
 * POST /v1/admin/places/reports/:poiId/resolve → { ok: true }. 'hide' oculta o lugar e fecha as denúncias;
 * 'dismiss' descarta (param de contar pra retirada automática). Denunciar de novo reabre.
 */
export interface ResolvePoiReportsPayload {
  action: 'hide' | 'dismiss';
  note?: string;
}

export interface AdminPoi {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  source: string;
  hiddenAt: string | null;
  isPartner: boolean;
  eventId: string | null;
}

/** GET /v1/admin/places/pois?q=&cursor= */
export interface AdminPoiList {
  items: AdminPoi[];
  nextCursor: string | null;
}

/**
 * POST /v1/admin/places/pois (lugar novo feito pela equipe, source 'admin') e PATCH /v1/admin/places/pois/:id → AdminPoi.
 * category: bar | restaurant | cafe | park | shopping | gym | show | event | beach | museum | other.
 * Ocultar/desocultar: POST /v1/admin/places/pois/:id/hide · /unhide → AdminPoi. POI de evento segue o evento
 * (desocultar um de evento cancelado/terminado → 409).
 */
export interface UpsertPoiPayload {
  name: string;
  category: string;
  lat: number;
  lng: number;
  address?: string | null;
  city?: string | null;
  isPartner?: boolean;
  partnerOffer?: string | null;
}

// ─────────────────────────── eventos ───────────────────────────

export type EventStatus = 'draft' | 'published' | 'cancelled';
export type EventCategory = 'event' | 'show' | 'party' | 'festival' | 'sports' | 'other';

/** evento publicado aparece no mapa como lugar de evento (POI) até terminar; cancelado some na hora */
export interface AdminEvent {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  coverUrl: string | null;
  /** lugar existente onde acontece (opcional) */
  poiId: string | null;
  /** POI de evento no mapa (criado ao publicar) */
  mapPoiId: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  publishedAt: string | null;
  cancelledAt: string | null;
  /** campanhas de aviso ligadas a este evento */
  announcements: { campaignId: string; status: CampaignStatus; sentAt: string | null; targetCount: number }[];
}

/** GET /v1/admin/events?status=&when=upcoming|live|past&cursor= */
export interface AdminEventList {
  items: AdminEvent[];
  nextCursor: string | null;
}

/** POST /v1/admin/events e PATCH /v1/admin/events/:id */
export interface UpsertEventPayload {
  title: string;
  description?: string | null;
  category: EventCategory;
  startsAt: string;
  endsAt: string;
  venueName?: string | null;
  lat: number;
  lng: number;
  address?: string | null;
  city?: string | null;
  coverUrl?: string | null;
  poiId?: string | null;
}

// Ações: POST /v1/admin/events/:id/publish · /cancel → AdminEvent · DELETE /v1/admin/events/:id (só rascunho) → 204
// Publicar evento que já terminou → 409. PATCH de evento publicado atualiza o POI do mapa na hora.
// Aviso: POST /v1/admin/events/:id/announce (só admin) com AnnouncePayload → AdminCampaign ligada ao evento
// (mesmas regras do POST /campaigns, inclusive confirmCount; destino do toque = o evento)

export interface AnnouncePayload {
  title: string;
  body: string;
  audience: CampaignAudience;
  channels: CampaignChannels;
  /** null = agora */
  scheduledAt?: string | null;
  confirmCount?: number;
}

// ─────────────────────────── campanhas (push + central de avisos) ───────────────────────────

export type CampaignAudience =
  | { kind: 'all' }
  | { kind: 'premium' } // premium + premium_plus vigentes
  | { kind: 'free' }
  | { kind: 'city'; city: string }
  | { kind: 'radius'; lat: number; lng: number; radiusM: number } // última posição conhecida
  | { kind: 'user'; userId: string };

export interface CampaignChannels {
  /** push no celular (FCM) */
  push: boolean;
  /** central de avisos dentro do app (+ aviso ao vivo se o app estiver aberto) */
  inbox: boolean;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';

export interface AdminCampaign {
  id: string;
  title: string;
  body: string;
  target: NotificationTarget | null;
  audience: CampaignAudience;
  channels: CampaignChannels;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  eventId: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  stats: { targetCount: number; notified: number; pushSent: number; pushFailed: number; opened: number };
}

/** GET /v1/admin/campaigns?cursor= */
export interface AdminCampaignList {
  items: AdminCampaign[];
  nextCursor: string | null;
  /** push ligado no servidor (credenciais do Firebase presentes) */
  pushEnabled: boolean;
}

/** POST /v1/admin/campaigns (status 'scheduled' se scheduledAt no futuro; senão envia já) */
export interface CreateCampaignPayload {
  title: string;
  body: string;
  target?: NotificationTarget | null;
  audience: CampaignAudience;
  channels: CampaignChannels;
  scheduledAt?: string | null;
  /** público 'all' ou > 1000 pessoas: o painel pede pra digitar o número e manda aqui (confirmação) */
  confirmCount?: number;
}

/**
 * POST /v1/admin/campaigns/preview com { audience, eventId? } → quantas pessoas recebem (antes de enviar).
 * Público: contas ativas (sem apagadas/suspensas/banidas) que não desligaram o tipo de aviso (NotificationSettings:
 * campanha comum → campaigns; ligada a evento → events). 'city'/'radius' usam a última posição conhecida (histórico
 * de posições, poucos dias); 'city' aceita "Uberlândia" ou "Uberlândia/MG".
 */
export interface CampaignPreviewPayload {
  audience: CampaignAudience;
  eventId?: string | null;
}

export interface CampaignPreview {
  targetCount: number;
  withPushDevice: number;
}

/** 409 do POST /campaigns (e /events/:id/announce) quando falta ou não bate a confirmação do número */
export interface CampaignConfirmError {
  error: 'confirm_required';
  message: string;
  targetCount: number;
}

// Ações: POST /v1/admin/campaigns/:id/cancel (só agendada) → AdminCampaign

// ─────────────────────────── auditoria ───────────────────────────

/** GET /v1/admin/audit?actorId=&targetId=&action=&cursor= (só admin) */
export interface AdminAuditEntry {
  id: string;
  at: string;
  actor: { id: string; name: string; role: UserRole } | null;
  action: string;
  target: { kind: 'user' | 'event' | 'campaign' | 'poi' | 'candidate' | 'support'; id: string; label: string | null } | null;
  detail: string | null;
}

export interface AdminAuditList {
  items: AdminAuditEntry[];
  nextCursor: string | null;
}
