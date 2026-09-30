import type { AvatarConfig } from './avatar';
import type { LikeStatus } from './conversation';
// Curtidas (o chat é por conversa: ver conversation.ts)

/** POST /likes e /likes/super */
export interface LikeResult {
  likeId: string;
  /** status do par depois desta curtida (derivado das duas linhas de Like) */
  likeStatus: LikeStatus;
  isMutual: boolean;
  /** conversas do par promovidas agora para a principal (no máximo uma; vazio se não havia conversa ou já estava promovida) */
  promotedConversationIds: string[];
  remainingToday: number;
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
