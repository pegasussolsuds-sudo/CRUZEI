// Quem pode ABRIR conversa com quem: a mesma visibilidade do cartão público (GET /users/:id, PublicUsersController).
// Regras PURAS aqui; o InboxService busca as linhas e decide. Negado = 404 idêntico em todos os casos (não confirma
// que um id existe, nem que a pessoa bloqueou, pausou, está anônima ou foi banida).
// Conversa que JÁ existe não passa por aqui: o chat nunca é bloqueado (só Block, conta apagada ou fora de 'active').
// Quem ENVIA também é conferido (senderDenied), com a linha fresca do banco: o guard do JWT lê um cache de estado.
import type { SendIntent } from './routing';

/** campos do alvo que decidem se o cartão aparece */
export interface CardTarget {
  deletedAt: Date | null;
  isPaused: boolean;
  pausedUntil: Date | null;
  accountStatus: string;
  reviewHoldAt: Date | null;
  visibilityMode: string;
}

/** select do Prisma com exatamente esses campos */
export const CARD_TARGET_SELECT = {
  deletedAt: true,
  isPaused: true,
  pausedUntil: true,
  accountStatus: true,
  reviewHoldAt: true,
  visibilityMode: true,
} as const;

/** pausa vencida (pausedUntil no passado) não conta — igual ao cartão */
export function isPausedNow(
  u: Pick<CardTarget, 'isPaused' | 'pausedUntil'>,
  now: Date = new Date(),
): boolean {
  return Boolean(u.isPaused && (!u.pausedUntil || u.pausedUntil > now));
}

/**
 * O cartão público dessa pessoa aparece pra quem consulta? (o Block, nos dois sentidos, é conferido à parte)
 * Some: inexistente, apagada, pausada, fora de accountStatus 'active' (suspensa/banida), em análise (reviewHold) e anônima.
 */
export function cardVisible(u: CardTarget | null | undefined, now: Date = new Date()): boolean {
  if (!u) return false;
  if (u.deletedAt) return false;
  if (isPausedNow(u, now)) return false;
  if (u.accountStatus !== 'active') return false;
  if (u.reviewHoldAt) return false;
  if (u.visibilityMode === 'anonymous') return false;
  return true;
}

/** a outra ponta de uma conversa que já existe continua recebendo? (só conta apagada ou fora de 'active' corta) */
export function peerReachable(
  u: Pick<CardTarget, 'deletedAt' | 'accountStatus'> | null | undefined,
): boolean {
  return Boolean(u && !u.deletedAt && u.accountStatus === 'active');
}

/** campos de quem ENVIA que decidem se a mensagem passa */
export interface SenderAccount {
  deletedAt: Date | null;
  accountStatus: string;
  reviewHoldAt: Date | null;
}

/**
 * Quem envia pode mandar esta mensagem? null = pode.
 * - 'account': conta inexistente, apagada ou fora de 'active' → nada passa, nem resposta
 * - 'hold': em análise (reviewHoldAt, ex.: denúncia de child_safety) → REGRA: responde e continua conversas aceitas,
 *   mas não abre conversa nova ('start') nem insiste numa solicitação que abriu e ainda não teve resposta
 *   ('request'). Assim ninguém NOVO recebe contato de quem está em análise, e quem já conversava não fica sem resposta.
 */
export function senderDenied(
  u: SenderAccount | null | undefined,
  intent: SendIntent,
): 'account' | 'hold' | null {
  if (!u || u.deletedAt || u.accountStatus !== 'active') return 'account';
  if (u.reviewHoldAt && intent !== 'reply') return 'hold';
  return null;
}
