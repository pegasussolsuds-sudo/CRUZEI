// Conta e privacidade (LGPD art. 18/19, Marco Civil art. 7º X): excluir conta pelo app com prazo de arrependimento,
// baixar uma cópia dos dados (JSON) e apagar o histórico de localização.
// Datas sempre ISO 8601 (UTC). Todas as rotas /v1/me/* exigem sessão.

// ---------- excluir conta ----------

/** prazo padrão pra voltar atrás (ACCOUNT_DELETION_GRACE_DAYS no servidor; a resposta traz o valor em vigor) */
export const ACCOUNT_DELETION_GRACE_DAYS_DEFAULT = 30;

/** o que a pessoa digita pra confirmar (o servidor compara exatamente; senão 400 confirm_required) */
export const ACCOUNT_DELETION_CONFIRM = 'EXCLUIR';

/** motivo opcional (chips na tela de exclusão) — mesma lista do CHECK ddr_reason_chk */
export const DELETION_REASONS = ['met_someone', 'not_useful', 'privacy', 'safety', 'taking_break', 'other'] as const;
export type DeletionReason = (typeof DELETION_REASONS)[number];

export const DELETION_REASON_LABELS: Record<DeletionReason, string> = {
  met_someone: 'Conheci alguém',
  not_useful: 'Não tá rolando pra mim',
  privacy: 'Privacidade',
  safety: 'Segurança',
  taking_break: 'Quero dar um tempo',
  other: 'Outro motivo',
};

/**
 * GET /v1/me/deletion — o que a tela mostra antes de confirmar.
 * `activeSubscription`: excluir NÃO cancela a assinatura na loja (a tela mostra o aviso e o link da loja).
 * `staff`: conta da equipe não se exclui pelo app (POST devolve 409 staff_account).
 */
export interface AccountDeletionPreview {
  graceDays: number;
  /** quando a limpeza definitiva aconteceria se pedisse agora */
  wouldCompleteAt: string;
  activeSubscription: { platform: string; expiresAt: string } | null;
  staff: boolean;
}

/**
 * POST /v1/me/deletion — pede a exclusão. Na hora: conta some (mapa, deck, inbox, conversas do outro lado), sessões
 * revogadas, push para. Idempotente: pedido pendente devolve o mesmo. Erros: 400 confirm_required, 409 staff_account.
 * O app faz logout local depois do 202.
 */
export interface AccountDeletionRequest {
  confirm: typeof ACCOUNT_DELETION_CONFIRM;
  reason?: DeletionReason;
}

/** 202 do POST /v1/me/deletion */
export interface AccountDeletionResponse {
  requestedAt: string;
  /** fim do prazo: depois disso a limpeza é definitiva */
  scheduledFor: string;
  graceDays: number;
}

/**
 * 409 account_deletion_pending no POST /v1/auth/login: o SMS foi confirmado, mas a conta tem exclusão pedida dentro do
 * prazo. Nenhuma sessão é aberta; o app oferece cancelar a exclusão (POST /v1/auth/deletion/cancel com o challengeId)
 * ou voltar. App antigo mostra o `message`.
 */
export interface AccountDeletionPendingError {
  error: 'account_deletion_pending';
  message: string;
  /** desafio no servidor (uso único; vale `expiresIn` segundos) */
  challengeId: string;
  requestedAt: string;
  scheduledFor: string;
  expiresIn: number;
}

/**
 * POST /v1/auth/deletion/cancel (sem sessão) → LoginResponse com tokens e `restored`. Desafio vencido ou já usado:
 * 401 deletion_challenge_expired (o app volta pro login). Conta banida/suspensa: 403 de sempre (AccountBlockedError).
 */
export interface AccountDeletionCancelRequest {
  challengeId: string;
}

/** vem no LoginResponse quando a exclusão acabou de ser cancelada ("Que bom te ver de volta!") */
export interface AccountDeletionRestored {
  requestedAt: string;
  scheduledFor: string;
}

// ---------- apagar histórico de localização ----------

/**
 * DELETE /v1/me/location-history?learnedHome=true|false (limite diário no servidor → 429 too_many_requests).
 * Apaga: histórico de posições, check-ins, votos "estou aqui", a posição dos Boosts vencidos, a posição atual no mapa
 * (volta na próxima atualização do app) e as âncoras do anti-GPS-falso (ficam só com alerta de GPS falso ativo); com
 * learnedHome, também a residência aprendida. Fica: o sinal de multidão (anônimo, sem id).
 */
export interface LocationHistoryForgetResponse {
  positions: number;
  checkins: number;
  placeVotes: number;
  /** residência aprendida apagada */
  learnedHome: boolean;
}

// ---------- baixar meus dados ----------

/** cópias dos dados por pessoa por dia (DATA_EXPORT_DAILY_LIMIT no servidor); passou → 429 export_limit */
export const DATA_EXPORT_DAILY_LIMIT_DEFAULT = 3;

/** nome sugerido do arquivo: metch-meus-dados-AAAA-MM-DD.json */
export const DATA_EXPORT_FILE_PREFIX = 'metch-meus-dados-';

export interface DataExportAccount {
  id: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
  lastActiveAt: string;
  role: string;
  status: string;
  suspendedUntil: string | null;
  moderationReason: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  orientationConsentedAt: string | null;
}

export interface DataExportProfile {
  name: string;
  birthDate: string;
  gender: string;
  orientation: string | null;
  showOrientation: boolean;
  sameOrientationFirst: boolean;
  bio: string | null;
  instagram: string | null;
  lookingFor: string;
  avatarConfig: unknown;
  interests: string[];
  seals: { type: string; progress: number; target: number; isCompleted: boolean; earnedAt: string | null }[];
  isVerified: boolean;
  profileCompleteness: number;
}

export interface DataExportSettings {
  showMe: string;
  ageMin: number;
  ageMax: number;
  visibilityMode: string;
  anonymousUntil: string | null;
  showDistance: boolean;
  showAge: boolean;
  showPhotoOnMap: boolean;
  discoveryMode: string;
  isPaused: boolean;
  pausedUntil: string | null;
  premiumTier: string;
  premiumExpiresAt: string | null;
  trialUsedAt: string | null;
  notificationPrefs: Record<string, boolean> | null;
}

export interface DataExportPhoto {
  url: string;
  thumbnailUrl: string | null;
  orderIndex: number;
  isMain: boolean;
  status: string;
  rejectReason: string | null;
  createdAt: string;
}

/** centro EXATO da área privada: só aparece aqui (a tela avisa pra guardar o arquivo com cuidado) */
export interface DataExportPrivateArea {
  label: string;
  radiusM: number;
  lat: number;
  lng: number;
  createdAt: string;
}

export interface DataExportLocation {
  /** posição atual guardada pro mapa (até 2 h); null = nenhuma */
  currentPresence: { lat: number; lng: number; updatedAt: string | null } | null;
  /** histórico grosseiro (retenção curta) */
  history: { lat: number; lng: number; accuracyM: number | null; city: string | null; state: string | null; recordedAt: string }[];
  checkins: { poiId: string; checkinAt: string; durationMinutes: number | null }[];
  /** células (geohash) da residência aprendida, com as noites contadas */
  learnedHomeCells: { cell: string; nights: number }[];
  placeVotes: { candidateId: string; kind: string; votedOn: string }[];
  placeReports: { poiId: string; reason: string | null; createdAt: string }[];
}

export interface DataExportConversation {
  id: string;
  createdAt: string;
  /** pasta na inbox da pessoa: principal ou solicitações */
  folder: string;
  archived: boolean;
  muted: boolean;
  peerId: string;
  /** só as mensagens DA PESSOA (as da outra ponta não saem) */
  myMessages: {
    id: string;
    type: string;
    body: string | null;
    mediaUrl: string | null;
    lat: number | null;
    lng: number | null;
    createdAt: string;
    readAt: string | null;
  }[];
}

export interface DataExportV1 {
  format: 'metch-data-export';
  version: 1;
  generatedAt: string;
  /** explicação curta do arquivo em pt-BR */
  about: string;
  account: DataExportAccount;
  profile: DataExportProfile;
  settings: DataExportSettings;
  photos: DataExportPhoto[];
  privateAreas: DataExportPrivateArea[];
  location: DataExportLocation;
  /** quem curtiu você é recurso Premium: vai só a contagem */
  likes: { sent: { userId: string; isSuper: boolean; createdAt: string }[]; receivedCount: number };
  passes: { userId: string; createdAt: string }[];
  visits: { made: { userId: string; visitedAt: string; wasAnonymous: boolean }[]; receivedCount: number };
  blocks: { userId: string; reason: string | null; createdAt: string }[];
  conversations: DataExportConversation[];
  /** denúncias FEITAS pela pessoa (as contra ela não saem: protege quem denunciou) */
  reportsMade: { reportedId: string; reason: string; description: string | null; status: string; createdAt: string }[];
  /** situação e decisões sobre a conta (sem nota interna nem quem decidiu) */
  moderation: { status: string; actions: { type: string; createdAt: string }[] };
  notifications: { type: string; title: string; body: string | null; sentAt: string; readAt: string | null }[];
  /** aparelhos com push (sem o token) */
  devices: { platform: string; appVersion: string | null; createdAt: string; lastUsedAt: string }[];
  purchases: {
    subscriptions: { tier: string; platform: string; productId: string | null; startsAt: string; expiresAt: string; cancelledAt: string | null; trialEndsAt: string | null }[];
    boosts: { startedAt: string; expiresAt: string; amountCents: number; platform: string }[];
    superLikeUses: { day: string; used: number }[];
  };
  /** atendimentos (sem notas internas; autor 'me' | 'team' | 'system') */
  support: { id: string; status: string; urgent: boolean; createdAt: string; messages: { author: string; body: string; createdAt: string }[] }[];
  analytics: { name: string; step: string | null; createdAt: string }[];
  /** registros de acesso (Marco Civil art. 15: guardados 6 meses) */
  accessLogs: { event: string; ip: string | null; port: number | null; userAgent: string | null; createdAt: string }[];
  /** pedidos de exclusão da conta */
  deletionRequests: { requestedAt: string; scheduledFor: string; status: string; cancelledAt: string | null }[];
  /** o que NÃO vem no arquivo e por quê (pt-BR) */
  notIncluded: string[];
}
