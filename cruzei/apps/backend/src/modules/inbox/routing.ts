// Regras PURAS do roteamento de conversas (sem banco, sem Nest): o InboxService e os testes usam as mesmas funções.
//
// Ideia (Instagram + reciprocidade do Tinder): o chat NUNCA é bloqueado, as duas pessoas conversam desde a primeira
// mensagem; muda só ONDE a conversa aparece. Não existe estado "match": a pasta sai dos fatos do par.
//   PRINCIPAL  se (a) curtida mútua, (b) houve bounce (>= 2 mensagens COM mensagem dos dois lados) ou (c) promotedAt setado
//   SOLICITAÇÃO nos outros casos — e só para quem RECEBEU; quem mandou a 1ª mensagem vê na principal, "aguardando resposta".
// A promoção é gravada (promotedAt) e é permanente: descurtir depois não devolve a conversa para as solicitações.

// Tipos do contrato (@cruzei/shared-types/conversation.ts), reexportados para o service e os testes importarem daqui.
import type {
  InboxFolder,
  LikeStatus,
  MemberRole,
  PromoteReason,
  RouteFolder,
  SystemMessageKind,
} from '@cruzei/shared-types';

export type { InboxFolder, LikeStatus, MemberRole, PromoteReason, RouteFolder };
/** tipo da mensagem de sistema (messages.system_kind; UNIQUE por conversa) */
export type SystemKind = SystemMessageKind;
/** por que a conversa está na principal: 'promoted' = já gravado (promotedAt), vale sem olhar o resto */
export type RouteReason = 'mutual' | 'bounce' | 'promoted' | null;

/**
 * Fatos do par que decidem a pasta. A = REQUESTER (quem abriu a conversa), B = RECIPIENT.
 * As mensagens contam só as de gente (mensagem de sistema fica de fora).
 */
export interface ConversationFacts {
  /** existe Like de A para B */
  likeAB: boolean;
  /** existe Like de B para A */
  likeBA: boolean;
  /** total de mensagens de gente na conversa (= messagesFromA + messagesFromB) */
  messageCount: number;
  messagesFromA: number;
  messagesFromB: number;
  /** conversations.promoted_at: preenchido = principal para sempre */
  promotedAt: Date | null;
}

export interface RouteResult {
  folder: RouteFolder;
  reason: RouteReason;
}

/** o que a transação de reavaliação deve gravar; os dois null = NOOP */
export interface ReevaluationPlan {
  readonly promote: null | 'mutual' | 'bounce';
  readonly systemMessage: SystemKind | null;
}

export interface RoutingCfg {
  /** bounce exige mensagem dos DOIS lados (decisão do dono; sem isso quem pede se promove sozinho) */
  BOUNCE_REQUIRES_BOTH_SIDES: boolean;
  /** mensagens de gente para contar como bounce */
  BOUNCE_MIN_MESSAGES: number;
  /** quantas mensagens o REQUESTER manda até a primeira resposta do outro lado */
  REQUESTER_MAX_BEFORE_REPLY: number;
}

export const ROUTING: Readonly<RoutingCfg> = {
  BOUNCE_REQUIRES_BOTH_SIDES: true,
  BOUNCE_MIN_MESSAGES: 2,
  REQUESTER_MAX_BEFORE_REPLY: 3,
};

export const NOOP: ReevaluationPlan = Object.freeze({ promote: null, systemMessage: null });

const isMutual = (f: ConversationFacts): boolean => f.likeAB && f.likeBA;

/** houve bounce: >= 2 mensagens e (pelo padrão) pelo menos uma de cada lado */
export function hasBounce(f: ConversationFacts, cfg: Readonly<RoutingCfg> = ROUTING): boolean {
  if (f.messageCount < cfg.BOUNCE_MIN_MESSAGES) return false;
  return !cfg.BOUNCE_REQUIRES_BOTH_SIDES || (f.messagesFromA > 0 && f.messagesFromB > 0);
}

/** pasta lógica da conversa. promotedAt vence tudo (promoção permanente); depois curtida mútua; depois bounce */
export function route(f: ConversationFacts, cfg: Readonly<RoutingCfg> = ROUTING): RouteResult {
  if (f.promotedAt) return { folder: 'principal', reason: 'promoted' };
  if (isMutual(f)) return { folder: 'principal', reason: 'mutual' };
  if (hasBounce(f, cfg)) return { folder: 'principal', reason: 'bounce' };
  return { folder: 'request', reason: null };
}

/**
 * O que gravar depois de um fato novo (mensagem, curtida), na MESMA transação.
 * - já promovida → NOOP (a promoção é permanente e a mensagem de sistema só nasce junto com ela)
 * - curtida mútua → promove + mensagem de sistema "Vocês se curtiram…" (vence o bounce quando os dois valem)
 * - bounce → promove sem mensagem de sistema
 * Idempotente: depois de aplicar o plano (promotedAt preenchido), reavaliar dá NOOP.
 */
export function planReevaluation(
  f: ConversationFacts,
  cfg: Readonly<RoutingCfg> = ROUTING,
): ReevaluationPlan {
  if (f.promotedAt) return NOOP;
  if (isMutual(f)) return { promote: 'mutual', systemMessage: 'mutual_like' };
  if (hasBounce(f, cfg)) return { promote: 'bounce', systemMessage: null };
  return NOOP;
}

/** os fatos depois de gravar o plano (espelha o `updateMany where promotedAt null` do service) */
export function applyPlan(
  f: ConversationFacts,
  plan: ReevaluationPlan,
  at: Date,
): ConversationFacts {
  if (!plan.promote || f.promotedAt) return f;
  return { ...f, promotedAt: at };
}

/** onde a conversa aparece para quem tem esse papel: solicitações é só de quem RECEBEU */
export function folderFor(
  role: MemberRole,
  r: RouteFolder | Pick<RouteResult, 'folder'>,
): InboxFolder {
  const folder = typeof r === 'string' ? r : r.folder;
  if (folder === 'principal') return 'inbox';
  return role === 'REQUESTER' ? 'inbox' : 'requests';
}

/** selo "aguardando resposta": só para o REQUESTER, enquanto a conversa é solicitação e o outro lado não respondeu */
export function awaitingReply(
  role: MemberRole,
  f: ConversationFacts,
  cfg: Readonly<RoutingCfg> = ROUTING,
): boolean {
  if (role !== 'REQUESTER') return false;
  return route(f, cfg).folder === 'request' && f.messagesFromA > 0 && f.messagesFromB === 0;
}

/** status da curtida do meu ponto de vista (linhas eu→par e par→eu da tabela likes) */
export function likeStatus(meToPeer: boolean, peerToMe: boolean): LikeStatus {
  if (meToPeer && peerToMe) return 'MUTUAL';
  if (meToPeer) return 'SENT';
  if (peerToMe) return 'RECEIVED';
  return 'NONE';
}

/**
 * O REQUESTER pode mandar MAIS uma mensagem? Até a primeira resposta do outro lado ele manda no máximo
 * REQUESTER_MAX_BEFORE_REPLY; depois da resposta, ou com a conversa na principal (curtida mútua, promoção), não há teto
 * aqui (sobram só os rate limits do service). Só vale para o REQUESTER: quem recebeu sempre pode responder.
 */
export function canRequesterSend(
  f: ConversationFacts,
  requesterMessagesSoFar: number = f.messagesFromA,
  cfg: Readonly<RoutingCfg> = ROUTING,
): boolean {
  if (f.messagesFromB > 0) return true;
  if (route(f, cfg).folder === 'principal') return true;
  return requesterMessagesSoFar < cfg.REQUESTER_MAX_BEFORE_REPLY;
}

/** pode gravar readAt e avisar o outro lado? Quem RECEBEU a solicitação só dispara "lida" depois de aceitar (promover ou responder) */
export function marksReadAllowed(
  role: MemberRole,
  r: RouteFolder | Pick<RouteResult, 'folder'>,
): boolean {
  const folder = typeof r === 'string' ? r : r.folder;
  return !(role === 'RECIPIENT' && folder === 'request');
}

/**
 * O que uma mensagem de gente faz, do ponto de vista de quem envia (decide a regra de quem está em análise):
 * - 'start': abre conversa nova (a transação acabou de criar a conversa do par);
 * - 'request': insiste numa solicitação que EU abri e que ainda não teve resposta nem foi promovida;
 * - 'reply': qualquer outra (responder quem me pediu, conversa já na principal).
 */
export type SendIntent = 'start' | 'request' | 'reply';

export function sendIntent(
  role: MemberRole,
  f: ConversationFacts,
  opening: boolean,
  cfg: Readonly<RoutingCfg> = ROUTING,
): SendIntent {
  if (opening) return 'start';
  if (role === 'REQUESTER' && f.messagesFromB === 0 && route(f, cfg).folder === 'request')
    return 'request';
  return 'reply';
}
