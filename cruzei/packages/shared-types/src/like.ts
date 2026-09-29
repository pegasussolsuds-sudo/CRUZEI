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
