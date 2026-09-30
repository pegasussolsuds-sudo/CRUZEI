import type { AvatarConfig } from './avatar';
import type { LikeStatus } from './conversation';
import type { PremiumTier } from './user';
// Curtidas (o chat é por conversa: ver conversation.ts)

/** POST /likes e /likes/super */
export interface LikeResult {
  likeId: string;
  /** status do par depois desta curtida (derivado das duas linhas de Like) */
  likeStatus: LikeStatus;
  isMutual: boolean;
  /** conversas do par promovidas agora para a principal (no máximo uma; vazio se não havia conversa ou já estava promovida) */
  promotedConversationIds: string[];
  /** curtidas (de qualquer tipo) que ainda cabem no limite anti-abuso do dia */
  remainingToday: number;
  /** super curtidas que restam hoje (dia de São Paulo) depois desta; ausente = servidor antigo */
  superLikesRemainingToday?: number;
}

// ---------- super curtida: limite por dia ----------

/**
 * Super curtidas por dia, pelo plano EFETIVO (assinatura vencida = free). O dia vira à meia-noite de
 * SUPER_LIKE_TIMEZONE. Desfazer a curtida NÃO devolve o uso (tabela super_like_uses). Super curtida repetida pra quem
 * eu já curti não gasta. Acabou: 403 super_like_limit (SuperLikeLimitError) → no grátis o app convida pro Premium.
 */
export const SUPER_LIKE_DAILY: Record<PremiumTier, number> = { free: 1, premium: 7, premium_plus: 7 };
export const SUPER_LIKE_TIMEZONE = 'America/Sao_Paulo';

/** GET /v1/likes/super/quota → quantas super curtidas restam hoje (também em /me: stats.superLikesRemainingToday) */
export interface SuperLikeQuota {
  /** plano efetivo */
  tier: PremiumTier;
  limit: number;
  used: number;
  remaining: number;
  /** próxima meia-noite de São Paulo (ISO) */
  resetsAt: string;
}

/** corpo do 403 super_like_limit (POST /likes com isSuper e POST /likes/super) */
export interface SuperLikeLimitError {
  error: 'super_like_limit';
  message: string;
  limit: number;
  /** próxima meia-noite de São Paulo (ISO) */
  resetsAt: string;
  /** true no grátis: o app mostra o convite pro Premium (7 por dia) */
  canUpgrade: boolean;
}

// ---------- "Passar" (deck de curtidas) ----------

/**
 * Quem eu passei não volta no DECK (GET /v1/location/nearby?deck=1) por DISCOVERY_PASS_DAYS (env; padrão
 * DISCOVERY_PASS_DAYS_DEFAULT). Continua podendo aparecer no MAPA (o mapa é presença, não o deck). Passar pelo mapa ou
 * pelo cartão também conta. Passar não grava mais no audit_log (tabela passes, com limpeza depois do prazo).
 *
 * POST /v1/passes {userId} (PassRequest) → 204. Idempotente: passar de novo renova o prazo. Passar alguém que me deu
 * super curtida responde a super curtida (ela sai do topo do deck).
 * DELETE /v1/passes/:userId → 204: "Voltar" desfaz ESSE passar — grátis, o app oferece só pro último cartão passado no
 * deck (o botão some depois de usar ou de outra ação). Por id: um passar feito no mapa no meio do caminho não é
 * desfeito por engano; e só se for o MEU passar mais recente e de até 10 min — senão 409 pass_undo_unavailable (o
 * passar fica). Sem passar gravado: 204 (idempotente).
 */
export const DISCOVERY_PASS_DAYS_DEFAULT = 30;

export interface PassRequest {
  userId: string;
}

/**
 * Comemoração do match pra QUEM RECEBE (quem curtiu primeiro; quem completou já vê o modal pela resposta do POST).
 * Chega ao vivo pelo socket 'match:new' e fica pendente (match_celebrations) até o app mostrar:
 * GET /v1/likes/matches/pending → MatchCelebration[] (até 5, últimos 14 dias; sem bloqueados, descurtidos, contas fora
 * do ar ou em análise; [] pra quem está invisível sem Premium) · POST /v1/likes/matches/:userId/seen → 204 (idempotente).
 */
export interface MatchCelebration {
  /** quem completou o match */
  peer: { id: string; name: string; avatar: AvatarConfig; mainPhotoUrl: string | null };
  /** conversa do par, se já existe */
  conversationId: string | null;
  matchedAt: string;
}

export const MATCH_EVENTS = {
  /** MatchCelebration → sala user:<quem recebeu> */
  new: 'match:new',
} as const;
