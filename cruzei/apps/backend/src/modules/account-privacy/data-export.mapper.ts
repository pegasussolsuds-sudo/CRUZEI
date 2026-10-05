// Cópia dos dados (LGPD art. 18 II e V, art. 19): monta o DataExportV1 a partir das linhas já lidas. PURO: só escolhe
// campos permitidos (nunca password_hash, sessions_valid_after, token de push, nota interna, quem moderou, denúncia
// contra a pessoa nem mensagem da outra ponta), mesmo que a linha traga mais.
import type {
  DataExportConversation,
  DataExportLocation,
  DataExportV1,
} from '@cruzei/shared-types';

type D = Date | null | undefined;
type Num = number | string | { toString(): string } | null | undefined;

const iso = (d: D): string | null => (d ? d.toISOString() : null);
const isoReq = (d: Date): string => d.toISOString();
/** coluna DATE → 'AAAA-MM-DD' */
const day = (d: Date): string => d.toISOString().slice(0, 10);
const num = (v: Num): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(typeof v === 'object' ? v.toString() : v);
  return Number.isFinite(n) ? n : null;
};

export const EXPORT_ABOUT =
  'Cópia dos seus dados no Metch (LGPD, art. 18 e 19). Tem dados sensíveis: orientação (se você informou), o centro ' +
  'EXATO das suas áreas privadas, as células da residência aprendida, seu histórico de localização e os IPs dos seus ' +
  'acessos. Guarde com cuidado e não compartilhe. Datas em UTC (ISO 8601).';

export const EXPORT_NOT_INCLUDED = [
  'Denúncias feitas contra você: protegem quem denunciou (a decisão da moderação aparece em "moderation").',
  'Mensagens das outras pessoas: vão só as suas.',
  'Quem curtiu e quem visitou você: recurso do Premium; vão só as contagens.',
  'Notas internas da equipe e quem tomou cada decisão de moderação.',
  'Registros internos de segurança da moderação: revisões automáticas, alertas antifraude e o que estiver ligado a ' +
    'denúncia em análise. Em "moderation" vão as decisões sobre a conta (advertência, suspensão, banimento, ' +
    'reabilitação, fotos aprovadas/recusadas e número liberado).',
  'Dados antifraude (âncoras do GPS, contadores de tentativas e de limite).',
  'Sinal de multidão dos lugares: anônimo e agregado, não dá pra separar uma pessoa.',
  'Acenos: duram 24 h e não ficam guardados.',
  'Tokens de push e de sessão (credenciais técnicas).',
];

/**
 * Decisões de moderação que a pessoa vê na cópia (lista BRANCA; 'suspend:<dias>' entra pelo prefixo). Fica de fora o
 * que é registro interno de segurança: 'auto_hold' (retenção silenciosa: denúncia de abuso infantil, número de conta
 * banida), 'auto_flag_gps' (antifraude), 'dismiss' (revelaria denúncia contra ela), 'photo_review' etc.
 */
export const EXPORT_MODERATION_ACTIONS = [
  'warn',
  'suspend',
  'ban',
  'unban',
  'reinstate',
  'photo_approve',
  'photo_reject',
  'phone_released',
] as const;

export function exportableModerationAction(action: string): boolean {
  return (
    (EXPORT_MODERATION_ACTIONS as readonly string[]).includes(action) ||
    action.startsWith('suspend:')
  );
}

/** linha de users com o que pode sair (o select do serviço já não traz senha nem corte de sessão) */
export interface ExportUserRow {
  id: string;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  role: string;
  accountStatus: string;
  suspendedUntil: D;
  moderationReason: string | null;
  termsVersion: string | null;
  termsAcceptedAt: D;
  orientationConsentedAt: D;
  name: string;
  birthDate: Date;
  gender: string;
  orientation: string | null;
  showOrientation: boolean;
  sameOrientationFirst: boolean;
  bio: string | null;
  instagramHandle: string | null;
  lookingFor: string;
  avatarConfig: unknown;
  isVerified: boolean;
  profileCompleteness: number;
  showMe: string;
  ageMin: number;
  ageMax: number;
  visibilityMode: string;
  anonymousUntil: D;
  showDistance: boolean;
  showAge: boolean;
  showPhotoOnMap: boolean;
  discoveryMode: string;
  isPaused: boolean;
  pausedUntil: D;
  premiumTier: string;
  premiumExpiresAt: D;
  trialUsedAt: D;
}

export interface ExportRows {
  user: ExportUserRow;
  interests: string[];
  seals: {
    sealType: string;
    progress: number;
    target: number;
    isCompleted: boolean;
    earnedAt: D;
  }[];
  notificationPrefs: Record<string, unknown> | null;
  photos: {
    url: string;
    thumbnailUrl: string | null;
    orderIndex: number;
    isMain: boolean;
    status: string;
    rejectReason: string | null;
    createdAt: Date;
  }[];
  privateAreas: {
    label: string;
    radiusM: number;
    latitude: Num;
    longitude: Num;
    createdAt: Date;
  }[];
  presence: { lat: Num; lng: Num; updatedAt: number | null } | null;
  history: {
    latitude: Num;
    longitude: Num;
    accuracyMeters: number | null;
    city: string | null;
    state: string | null;
    recordedAt: Date;
  }[];
  checkins: { poiId: bigint | number | string; checkinAt: Date; durationMinutes: number | null }[];
  learnedHomeCells: { cell: string; nights: number }[];
  placeVotes: { candidateId: bigint | number | string; kind: string; votedOn: Date }[];
  placeReports: { poiId: bigint | number | string; reason: string | null; reportedOn: Date }[];
  likesSent: { likedId: string; isSuper: boolean; createdAt: Date }[];
  likesReceivedCount: number;
  passes: { targetId: string; createdAt: Date }[];
  visitsMade: { visitedId: string; visitedAt: Date; wasAnonymous: boolean }[];
  visitsReceivedCount: number;
  blocks: { blockedId: string; reason: string | null; createdAt: Date }[];
  conversations: {
    id: string;
    createdAt: Date;
    promotedAt: D;
    userLowId: string;
    userHighId: string;
    me: { role: string; archivedAt: D; isMuted: boolean } | null;
  }[];
  /** SÓ as mensagens da pessoa (o serviço filtra por sender_id; o mapper confere de novo) */
  myMessages: {
    id: string;
    conversationId: string;
    senderId: string;
    messageType: string;
    systemKind: string | null;
    body: string | null;
    mediaUrl: string | null;
    lat: Num;
    lng: Num;
    createdAt: Date;
    readAt: D;
  }[];
  reportsMade: {
    reporterId: string | null;
    reportedId: string;
    reason: string;
    description: string | null;
    status: string;
    createdAt: Date;
  }[];
  /** só as da própria pessoa (target); reportId pra tirar o que está ligado a denúncia em análise */
  moderationActions: { action: string; createdAt: Date; reportId?: string | null }[];
  /** denúncias em análise citadas em moderationActions.reportId (essas ações não saem) */
  openReportIds?: string[];
  notifications: { type: string; title: string; body: string | null; sentAt: Date; readAt: D }[];
  devices: { platform: string; appVersion: string | null; createdAt: Date; lastUsedAt: Date }[];
  subscriptions: {
    tier: string;
    platform: string;
    productId: string | null;
    startsAt: Date;
    expiresAt: Date;
    cancelledAt: D;
    trialEndsAt: D;
  }[];
  boosts: { startedAt: Date; expiresAt: Date; amountCents: number; platform: string }[];
  superLikeUses: { day: Date; used: number }[];
  support: {
    id: string;
    status: string;
    urgent: boolean;
    createdAt: Date;
    messages: { author: string; body: string; internal: boolean; createdAt: Date }[];
  }[];
  analytics: { name: string; step: string | null; createdAt: Date }[];
  accessLogs: {
    event: string;
    ip: string | null;
    port: number | null;
    userAgent: string | null;
    createdAt: Date;
  }[];
  deletionRequests: { requestedAt: Date; scheduledFor: Date; status: string; cancelledAt: D }[];
}

/** pasta na inbox da pessoa (= routing.folderFor): principal = promovida ou fui eu que puxei conversa */
export function folderOf(promotedAt: D, myRole: string | null | undefined): 'inbox' | 'requests' {
  return promotedAt || myRole === 'REQUESTER' ? 'inbox' : 'requests';
}

/** autor da mensagem do suporte do ponto de vista da pessoa */
export function supportAuthor(author: string): 'me' | 'team' | 'system' {
  if (author === 'user') return 'me';
  if (author === 'staff') return 'team';
  return 'system';
}

/** lista branca (segunda trava além do filtro do serviço) e nada ligado a denúncia em análise */
export function visibleModerationActions<T extends { action: string; reportId?: string | null }>(
  actions: T[],
  openReportIds: Iterable<string>,
): T[] {
  const open = new Set([...openReportIds].map((id) => id.toLowerCase()));
  return actions.filter(
    (a) =>
      exportableModerationAction(a.action) && !(a.reportId && open.has(a.reportId.toLowerCase())),
  );
}

/** preferências de aviso: só os booleanos (sem user_id nem updated_at) */
function prefsOf(p: Record<string, unknown> | null): Record<string, boolean> | null {
  if (!p) return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === 'boolean') out[k] = v;
  return out;
}

function locationOf(rows: ExportRows): DataExportLocation {
  const p = rows.presence;
  const lat = num(p?.lat);
  const lng = num(p?.lng);
  return {
    currentPresence:
      p && lat !== null && lng !== null
        ? { lat, lng, updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null }
        : null,
    history: rows.history.map((h) => ({
      lat: num(h.latitude) ?? 0,
      lng: num(h.longitude) ?? 0,
      accuracyM: h.accuracyMeters,
      city: h.city,
      state: h.state,
      recordedAt: isoReq(h.recordedAt),
    })),
    checkins: rows.checkins.map((c) => ({
      poiId: String(c.poiId),
      checkinAt: isoReq(c.checkinAt),
      durationMinutes: c.durationMinutes,
    })),
    learnedHomeCells: rows.learnedHomeCells.map((c) => ({ cell: c.cell, nights: c.nights })),
    placeVotes: rows.placeVotes.map((v) => ({
      candidateId: String(v.candidateId),
      kind: v.kind,
      votedOn: day(v.votedOn),
    })),
    placeReports: rows.placeReports.map((r) => ({
      poiId: String(r.poiId),
      reason: r.reason,
      createdAt: day(r.reportedOn),
    })),
  };
}

function conversationsOf(rows: ExportRows): DataExportConversation[] {
  const me = rows.user.id;
  const byConv = new Map<string, ExportRows['myMessages']>();
  for (const m of rows.myMessages) {
    // mensagem de outra pessoa ou de sistema nunca sai (segunda trava além do filtro do serviço)
    if (m.senderId !== me || m.systemKind) continue;
    const list = byConv.get(m.conversationId) ?? [];
    list.push(m);
    byConv.set(m.conversationId, list);
  }
  return rows.conversations.map((c) => ({
    id: c.id,
    createdAt: isoReq(c.createdAt),
    folder: folderOf(c.promotedAt, c.me?.role),
    archived: !!c.me?.archivedAt,
    muted: !!c.me?.isMuted,
    peerId: c.userLowId === me ? c.userHighId : c.userLowId,
    myMessages: (byConv.get(c.id) ?? [])
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((m) => ({
        id: m.id,
        type: m.messageType,
        body: m.body,
        mediaUrl: m.mediaUrl,
        lat: num(m.lat),
        lng: num(m.lng),
        createdAt: isoReq(m.createdAt),
        readAt: iso(m.readAt),
      })),
  }));
}

export function buildDataExport(
  rows: ExportRows,
  generatedAt: Date,
  toPhotoUrl: (stored: string) => string = (s) => s,
): DataExportV1 {
  const u = rows.user;
  return {
    format: 'metch-data-export',
    version: 1,
    generatedAt: generatedAt.toISOString(),
    about: EXPORT_ABOUT,
    account: {
      id: u.id,
      phone: u.phone,
      email: u.email,
      createdAt: isoReq(u.createdAt),
      lastActiveAt: isoReq(u.lastActiveAt),
      role: u.role,
      status: u.accountStatus,
      suspendedUntil: iso(u.suspendedUntil),
      moderationReason: u.moderationReason,
      termsVersion: u.termsVersion,
      termsAcceptedAt: iso(u.termsAcceptedAt),
      orientationConsentedAt: iso(u.orientationConsentedAt),
    },
    profile: {
      name: u.name,
      birthDate: day(u.birthDate),
      gender: u.gender,
      orientation: u.orientation,
      showOrientation: u.showOrientation,
      sameOrientationFirst: u.sameOrientationFirst,
      bio: u.bio,
      instagram: u.instagramHandle,
      lookingFor: u.lookingFor,
      avatarConfig: u.avatarConfig ?? null,
      interests: [...rows.interests].sort(),
      seals: rows.seals.map((s) => ({
        type: s.sealType,
        progress: s.progress,
        target: s.target,
        isCompleted: s.isCompleted,
        earnedAt: iso(s.earnedAt),
      })),
      isVerified: u.isVerified,
      profileCompleteness: u.profileCompleteness,
    },
    settings: {
      showMe: u.showMe,
      ageMin: u.ageMin,
      ageMax: u.ageMax,
      visibilityMode: u.visibilityMode,
      anonymousUntil: iso(u.anonymousUntil),
      showDistance: u.showDistance,
      showAge: u.showAge,
      showPhotoOnMap: u.showPhotoOnMap,
      discoveryMode: u.discoveryMode,
      isPaused: u.isPaused,
      pausedUntil: iso(u.pausedUntil),
      premiumTier: u.premiumTier,
      premiumExpiresAt: iso(u.premiumExpiresAt),
      trialUsedAt: iso(u.trialUsedAt),
      notificationPrefs: prefsOf(rows.notificationPrefs),
    },
    photos: rows.photos.map((p) => ({
      url: toPhotoUrl(p.url),
      thumbnailUrl: p.thumbnailUrl ? toPhotoUrl(p.thumbnailUrl) : null,
      orderIndex: p.orderIndex,
      isMain: p.isMain,
      status: p.status,
      rejectReason: p.rejectReason,
      createdAt: isoReq(p.createdAt),
    })),
    privateAreas: rows.privateAreas.map((a) => ({
      label: a.label,
      radiusM: a.radiusM,
      lat: num(a.latitude) ?? 0,
      lng: num(a.longitude) ?? 0,
      createdAt: isoReq(a.createdAt),
    })),
    location: locationOf(rows),
    likes: {
      sent: rows.likesSent.map((l) => ({
        userId: l.likedId,
        isSuper: l.isSuper,
        createdAt: isoReq(l.createdAt),
      })),
      receivedCount: rows.likesReceivedCount,
    },
    passes: rows.passes.map((p) => ({ userId: p.targetId, createdAt: isoReq(p.createdAt) })),
    visits: {
      made: rows.visitsMade.map((v) => ({
        userId: v.visitedId,
        visitedAt: isoReq(v.visitedAt),
        wasAnonymous: v.wasAnonymous,
      })),
      receivedCount: rows.visitsReceivedCount,
    },
    blocks: rows.blocks.map((b) => ({
      userId: b.blockedId,
      reason: b.reason,
      createdAt: isoReq(b.createdAt),
    })),
    conversations: conversationsOf(rows),
    // só as FEITAS pela pessoa (segunda trava além do filtro do serviço)
    reportsMade: rows.reportsMade
      .filter((r) => r.reporterId === u.id)
      .map((r) => ({
        reportedId: r.reportedId,
        reason: r.reason,
        description: r.description,
        status: r.status,
        createdAt: isoReq(r.createdAt),
      })),
    moderation: {
      status: u.accountStatus,
      actions: visibleModerationActions(rows.moderationActions, rows.openReportIds ?? []).map(
        (a) => ({ type: a.action, createdAt: isoReq(a.createdAt) }),
      ),
    },
    notifications: rows.notifications.map((n) => ({
      type: n.type,
      title: n.title,
      body: n.body,
      sentAt: isoReq(n.sentAt),
      readAt: iso(n.readAt),
    })),
    devices: rows.devices.map((d) => ({
      platform: d.platform,
      appVersion: d.appVersion,
      createdAt: isoReq(d.createdAt),
      lastUsedAt: isoReq(d.lastUsedAt),
    })),
    purchases: {
      subscriptions: rows.subscriptions.map((s) => ({
        tier: s.tier,
        platform: s.platform,
        productId: s.productId,
        startsAt: isoReq(s.startsAt),
        expiresAt: isoReq(s.expiresAt),
        cancelledAt: iso(s.cancelledAt),
        trialEndsAt: iso(s.trialEndsAt),
      })),
      boosts: rows.boosts.map((b) => ({
        startedAt: isoReq(b.startedAt),
        expiresAt: isoReq(b.expiresAt),
        amountCents: b.amountCents,
        platform: b.platform,
      })),
      superLikeUses: rows.superLikeUses.map((s) => ({ day: day(s.day), used: s.used })),
    },
    support: rows.support.map((t) => ({
      id: t.id,
      status: t.status,
      urgent: t.urgent,
      createdAt: isoReq(t.createdAt),
      messages: t.messages
        .filter((m) => !m.internal)
        .map((m) => ({
          author: supportAuthor(m.author),
          body: m.body,
          createdAt: isoReq(m.createdAt),
        })),
    })),
    analytics: rows.analytics.map((a) => ({
      name: a.name,
      step: a.step,
      createdAt: isoReq(a.createdAt),
    })),
    accessLogs: rows.accessLogs.map((a) => ({
      event: a.event,
      ip: a.ip,
      port: a.port,
      userAgent: a.userAgent,
      createdAt: isoReq(a.createdAt),
    })),
    deletionRequests: rows.deletionRequests.map((d) => ({
      requestedAt: isoReq(d.requestedAt),
      scheduledFor: isoReq(d.scheduledFor),
      status: d.status,
      cancelledAt: iso(d.cancelledAt),
    })),
    notIncluded: [...EXPORT_NOT_INCLUDED],
  };
}

/** nome do arquivo: metch-meus-dados-AAAA-MM-DD.json (dia de São Paulo) */
export function exportFileName(prefix: string, now: Date): string {
  const d = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return `${prefix}${d}.json`;
}
