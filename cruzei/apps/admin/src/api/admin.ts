// Todas as rotas que o painel chama, num lugar só. Tipos do @cruzei/shared-types; o pouco que o contrato
// ainda não descreve está marcado com "FORA DO CONTRATO".
import type {
  AdminActive,
  AdminFunnel,
  AdminRetention,
  AdminAuditList,
  AdminCampaign,
  AdminCampaignList,
  AdminEvent,
  AdminEventList,
  AdminMe,
  AdminPlaceCandidate,
  AdminPlaceCandidateList,
  AdminPoi,
  AdminPoiList,
  AdminPoiReportList,
  AdminStaffList,
  AdminStats,
  AdminUserDetail,
  AdminUserList,
  AdminUserRow,
  AnnouncePayload,
  AuthResponse,
  LoginResponse,
  ReleasePhonePayload,
  CampaignPreview,
  CampaignPreviewPayload,
  CandidateStatus,
  CreateCampaignPayload,
  EventStatus,
  GrantPremiumPayload,
  ModerationActionPayload,
  ModerationQueue,
  PremiumTier,
  RejectCandidatePayload,
  RequestCodeResponse,
  ResolvePoiReportsPayload,
  SetRolePayload,
  StaffSupportSendPayload,
  SupportAssignPayload,
  SupportMessage,
  SupportStatusPayload,
  SupportThreadDetail,
  SupportThreadList,
  SupportThreadStatus,
  SupportThreadSummary,
  UpsertEventPayload,
  UpsertPoiPayload,
  UserRole,
  AccountStatus,
} from '@cruzei/shared-types';
import { request } from './http';

// ─── FORA DO CONTRATO (o backend responde assim, mas o shared-types não descreve) ───

/** em dev o /auth/request-code devolve o código junto (sms.service.ts); RequestCodeResponse não tem o campo */
export type RequestCodeResult = RequestCodeResponse & { devCode?: string };

/**
 * /auth/login: conta ativa → tokens; número sem conta → user.id null e tokens null; conta parada há 90+ dias
 * (número reciclado) → `claim`, sem tokens (a confirmação é só pelo app)
 */
export type LoginResult = Omit<LoginResponse, 'user'> & { user: Omit<AuthResponse['user'], 'id'> & { id: string | null } };

/** corpo do POST /v1/admin/photos/:id (PhotoDecisionDto em moderation/admin.controller.ts) */
export interface PhotoDecisionPayload {
  decision: 'approve' | 'reject';
  reason?: string;
}

// ─── parâmetros de lista ───

export interface UserListParams {
  q?: string;
  status?: AccountStatus | '';
  tier?: PremiumTier | '';
  role?: UserRole | '';
  /** 'pending': só quem tem denúncia esperando decisão */
  reports?: 'pending' | '';
  cursor?: string | null;
  limit?: number;
}

export interface EventListParams {
  status?: EventStatus;
  when?: 'upcoming' | 'live' | 'past';
  cursor?: string | null;
}

export interface AuditParams {
  actorId?: string;
  targetId?: string;
  action?: string;
  cursor?: string | null;
}

export interface SupportListParams {
  /** sem status = os não resolvidos (open + pending) */
  status?: SupportThreadStatus | 'all';
  /** só os atribuídos a mim */
  mine?: boolean;
  /** 'oldest': quem espera há mais tempo primeiro (padrão: última mensagem mais recente) */
  order?: 'oldest';
  /** só os urgentes (botão de emergência); sem isso os urgentes valendo já vêm no topo */
  urgent?: boolean;
  cursor?: string | null;
  limit?: number;
}

const enc = encodeURIComponent;

export const authApi = {
  requestCode: (phone: string) => request<RequestCodeResult>('/auth/request-code', { method: 'POST', body: { phone }, auth: false }),
  login: (phone: string, code: string) => request<LoginResult>('/auth/login', { method: 'POST', body: { phone, code }, auth: false }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};

export const adminApi = {
  me: () => request<AdminMe>('/admin/me'),
  /** a equipe (admin/moderador ativos), pro "Passar pra…" do suporte */
  staff: () => request<AdminStaffList>('/admin/staff'),
  stats: () => request<AdminStats>('/admin/stats'),

  // métricas (só admin): funil do cadastro, retenção por semana de cadastro, ativos
  metricsFunnel: (days: number) => request<AdminFunnel>('/admin/metrics/funnel', { query: { days } }),
  metricsRetention: (weeks: number) => request<AdminRetention>('/admin/metrics/retention', { query: { weeks } }),
  metricsActive: (days: number) => request<AdminActive>('/admin/metrics/active', { query: { days } }),

  // usuários
  users: (p: UserListParams, signal?: AbortSignal) =>
    request<AdminUserList>('/admin/users', {
      query: { q: p.q, status: p.status, tier: p.tier, role: p.role, reports: p.reports, cursor: p.cursor, limit: p.limit },
      signal,
    }),
  user: (id: string) => request<AdminUserDetail>(`/admin/users/${enc(id)}`),
  userAction: (id: string, body: ModerationActionPayload) => request<unknown>(`/admin/users/${enc(id)}/action`, { method: 'POST', body }),
  grantPremium: (id: string, body: GrantPremiumPayload) => request<AdminUserRow>(`/admin/users/${enc(id)}/premium`, { method: 'POST', body }),
  setRole: (id: string, body: SetRolePayload) => request<AdminUserRow>(`/admin/users/${enc(id)}/role`, { method: 'POST', body }),
  /** número reciclado, caso de suporte (só admin): tira o telefone da conta, pausa e derruba as sessões */
  releasePhone: (id: string, body: ReleasePhonePayload) =>
    request<AdminUserRow>(`/admin/users/${enc(id)}/release-phone`, { method: 'POST', body }),

  // moderação (rotas que já existiam)
  queue: () => request<ModerationQueue>('/admin/queue'),
  photoDecision: (photoId: string, body: PhotoDecisionPayload) => request<unknown>(`/admin/photos/${enc(photoId)}`, { method: 'POST', body }),

  // lugares
  candidates: (status: CandidateStatus, cursor?: string | null) =>
    request<AdminPlaceCandidateList>('/admin/places/candidates', { query: { status, cursor } }),
  approveCandidate: (id: string) => request<AdminPlaceCandidate>(`/admin/places/candidates/${enc(id)}/approve`, { method: 'POST' }),
  rejectCandidate: (id: string, body: RejectCandidatePayload) =>
    request<AdminPlaceCandidate>(`/admin/places/candidates/${enc(id)}/reject`, { method: 'POST', body }),
  poiReports: () => request<AdminPoiReportList>('/admin/places/reports'),
  resolvePoiReports: (poiId: string, body: ResolvePoiReportsPayload) =>
    request<{ ok: true }>(`/admin/places/reports/${enc(poiId)}/resolve`, { method: 'POST', body }),
  /** hidden: '1' só ocultos, '0' só visíveis, vazio = todos */
  pois: (q: string, cursor?: string | null, hidden?: '0' | '1' | '') =>
    request<AdminPoiList>('/admin/places/pois', { query: { q, cursor, hidden } }),
  createPoi: (body: UpsertPoiPayload) => request<AdminPoi>('/admin/places/pois', { method: 'POST', body }),
  updatePoi: (id: string, body: UpsertPoiPayload) => request<AdminPoi>(`/admin/places/pois/${enc(id)}`, { method: 'PATCH', body }),
  setPoiHidden: (id: string, hidden: boolean) => request<AdminPoi>(`/admin/places/pois/${enc(id)}/${hidden ? 'hide' : 'unhide'}`, { method: 'POST' }),

  // eventos
  events: (p: EventListParams) => request<AdminEventList>('/admin/events', { query: { status: p.status, when: p.when, cursor: p.cursor } }),
  event: (id: string) => request<AdminEvent>(`/admin/events/${enc(id)}`),
  createEvent: (body: UpsertEventPayload) => request<AdminEvent>('/admin/events', { method: 'POST', body }),
  updateEvent: (id: string, body: UpsertEventPayload) => request<AdminEvent>(`/admin/events/${enc(id)}`, { method: 'PATCH', body }),
  publishEvent: (id: string) => request<AdminEvent>(`/admin/events/${enc(id)}/publish`, { method: 'POST' }),
  cancelEvent: (id: string) => request<AdminEvent>(`/admin/events/${enc(id)}/cancel`, { method: 'POST' }),
  deleteEvent: (id: string) => request<void>(`/admin/events/${enc(id)}`, { method: 'DELETE' }),
  announceEvent: (id: string, body: AnnouncePayload) => request<AdminCampaign>(`/admin/events/${enc(id)}/announce`, { method: 'POST', body }),

  // campanhas
  campaigns: (cursor?: string | null) => request<AdminCampaignList>('/admin/campaigns', { query: { cursor } }),
  previewCampaign: (body: CampaignPreviewPayload, signal?: AbortSignal) =>
    request<CampaignPreview>('/admin/campaigns/preview', { method: 'POST', body, signal }),
  createCampaign: (body: CreateCampaignPayload) => request<AdminCampaign>('/admin/campaigns', { method: 'POST', body }),
  cancelCampaign: (id: string) => request<AdminCampaign>(`/admin/campaigns/${enc(id)}/cancel`, { method: 'POST' }),

  // auditoria
  audit: (p: AuditParams) =>
    request<AdminAuditList>('/admin/audit', { query: { actorId: p.actorId, targetId: p.targetId, action: p.action, cursor: p.cursor } }),

  // suporte
  supportThreads: (p: SupportListParams) =>
    request<SupportThreadList>('/admin/support/threads', {
      query: { status: p.status, mine: p.mine ? '1' : undefined, order: p.order, urgent: p.urgent ? '1' : undefined, cursor: p.cursor, limit: p.limit },
    }),
  supportThread: (id: string) => request<SupportThreadDetail>(`/admin/support/threads/${enc(id)}`),
  supportSend: (id: string, body: StaffSupportSendPayload) =>
    request<SupportMessage>(`/admin/support/threads/${enc(id)}/messages`, { method: 'POST', body }),
  supportAssign: (id: string, body: SupportAssignPayload) =>
    request<SupportThreadSummary>(`/admin/support/threads/${enc(id)}/assign`, { method: 'POST', body }),
  supportStatus: (id: string, body: SupportStatusPayload) =>
    request<SupportThreadSummary>(`/admin/support/threads/${enc(id)}/status`, { method: 'POST', body }),
  supportRead: (id: string) => request<SupportThreadSummary>(`/admin/support/threads/${enc(id)}/read`, { method: 'POST' }),
};
