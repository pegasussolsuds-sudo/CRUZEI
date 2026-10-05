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
 * Leva 04/10/2026:
 * - 400 text_blocked {field, reason}: filtro de abuso recusou nome/bio/@ (PATCH /me, POST /auth/register) ou a
 *   mensagem (POST /conversations, POST /conversations/:id/messages) — TextBlockedError
 * - 403 super_like_limit {limit, resetsAt, canUpgrade}: acabaram as super curtidas do dia — SuperLikeLimitError (like.ts)
 * - 400 age_range_invalid: ageMin/ageMax fora de AGE_MIN <= ageMin, ageMin + AGE_RANGE_MIN_GAP <= ageMax <= AGE_MAX
 *   (PATCH /me/settings)
 * - 429 age_range_limit {limit, resetsAt}: já mudou a faixa de idade AGE_RANGE_DAILY_CHANGES vezes hoje (PATCH /me/settings)
 * - 409 pass_undo_unavailable: "Voltar" (DELETE /passes/:userId) de um passar que não é o meu último ou tem mais de
 *   10 min — o passar fica; o app tira o botão e mostra a mensagem
 * Leva 05/10/2026 (conta e privacidade, privacy.ts; SMS, auth.types.ts):
 * - 400 confirm_required: POST /me/deletion sem o `confirm` exato (ACCOUNT_DELETION_CONFIRM)
 * - 409 staff_account: conta da equipe (admin/moderador) não se exclui pelo app — tirar o papel no painel antes
 * - 429 export_limit {retryAfter}: passou das cópias dos dados do dia (GET /me/export)
 * - 409 account_deletion_pending {challengeId, requestedAt, scheduledFor, expiresIn}: login de conta com exclusão
 *   pedida no prazo (AccountDeletionPendingError) → o app oferece cancelar
 * - 401 deletion_challenge_expired: POST /auth/deletion/cancel com desafio vencido ou já usado → volta pro login
 * - SMS (SmsErrorCode): phone_invalid, phone_not_mobile, phone_unreachable (400), sms_cooldown, sms_rate_limited
 *   {scope}, sms_locked (429 com retryAfter), sms_unavailable (503), code_invalid {attemptsLeft}, code_expired (401)
 * - Fotos (POST /uploads/photo, POST /me/photos): photo_invalid (400, não é imagem aceita pelo conteúdo),
 *   photo_unsupported (400, ex.: HEIC), photo_too_big (413), photo_processing_unavailable / photo_busy (503),
 *   upload_not_found (400, upload de outra conta, vencido ou já usado) — o `message` já vem pronto pra tela
 */
export type ApiErrorCode =
  | 'session_revoked'
  | 'claim_mismatch'
  | 'claim_expired'
  | 'orientation_required'
  | 'instagram_invalid'
  /** nome com menos de 2 letras depois de tirar os espaços (cadastro e PATCH /me) */
  | 'name_invalid'
  | 'boost_hidden'
  | 'payment_unavailable'
  | 'receipt_invalid'
  | 'text_blocked'
  | 'super_like_limit'
  | 'age_range_invalid'
  | 'age_range_limit'
  | 'pass_undo_unavailable'
  | 'confirm_required'
  | 'staff_account'
  | 'export_limit'
  | 'account_deletion_pending'
  | 'deletion_challenge_expired'
  | 'phone_invalid'
  | 'phone_not_mobile'
  | 'phone_unreachable'
  | 'sms_cooldown'
  | 'sms_rate_limited'
  | 'sms_locked'
  | 'sms_unavailable'
  | 'code_invalid'
  | 'code_expired'
  | 'photo_invalid'
  | 'photo_unsupported'
  | 'photo_too_big'
  | 'photo_processing_unavailable'
  | 'photo_busy'
  | 'upload_not_found';

// ---------- filtro de abuso (pt-BR) ----------

/** campo que o filtro de abuso olha */
export const TEXT_FIELDS = ['message', 'name', 'bio', 'instagram'] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/**
 * por que o texto foi recusado:
 * - hate: discurso de ódio / injúria racial ou LGBTfóbica · threat: ameaça · minor: sexual envolvendo menor
 *   (os três BLOQUEIAM mensagem: "Essa mensagem fere as regras do Metch")
 * - profanity: palavrão/ofensa (só em nome, bio e @; em mensagem entre adultos é permitido)
 * - sexual: conteúdo sexual explícito (só em nome, bio e @)
 * - scam: golpe (Pix, pagamento, "me manda dinheiro", link encurtado). Em MENSAGEM não bloqueia: passa e gera denúncia
 *   automática (reason 'scam', context.source 'auto_filter'). Em nome/bio/@ recusa.
 */
export const TEXT_BLOCK_REASONS = ['hate', 'threat', 'minor', 'profanity', 'sexual', 'scam'] as const;
export type TextBlockReason = (typeof TEXT_BLOCK_REASONS)[number];

/** corpo do 400 text_blocked; `message` é amigável e diz o que ajustar (o app mostra como veio) */
export interface TextBlockedError {
  error: 'text_blocked';
  message: string;
  field: TextField;
  reason: TextBlockReason;
}

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
