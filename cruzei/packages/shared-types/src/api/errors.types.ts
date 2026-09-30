// API error envelope padrão

export interface ApiError {
  error: string;
  message: string;
  retryAfter?: number;
}

/**
 * Códigos de `error` novos desta leva (o corpo é ApiError + os campos indicados):
 * - 401 session_revoked: sessão revogada (número liberado da conta) → deslogar
 * - 401 claim_mismatch {attemptsLeft} · 401 claim_expired: confirmação "Essa conta é sua?" (auth.types.ts)
 * - 400 orientation_required: ligar showOrientation/sameOrientationFirst sem ter orientação
 * - 400 instagram_invalid: @ fora da regra do Instagram (a-z 0-9 . _, até 30, sem ponto no início/fim nem '..')
 * - 409 boost_hidden: comprar Boost estando invisível, pausada ou com descoberta 'nobody' (ninguém veria)
 * - 402 payment_unavailable: produção sem validação de loja (Boost) — nada cobrado nem ativado
 * - 402 receipt_invalid: recibo recusado (fora de produção, só 'dev' vale)
 */
export type ApiErrorCode =
  | 'session_revoked'
  | 'claim_mismatch'
  | 'claim_expired'
  | 'orientation_required'
  | 'instagram_invalid'
  | 'boost_hidden'
  | 'payment_unavailable'
  | 'receipt_invalid';

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMIT: 429,
  SERVER_ERROR: 500,
} as const;
