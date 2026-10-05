// Auth
import type { AccountDeletionRestored } from '../privacy';
import type { Gender, LookingFor, Orientation, ShowMe, VisibilityMode } from '../user';

export interface RequestCodeRequest {
  phone: string;
}

/** POST /v1/auth/request-code. Erros: SmsErrorCode (errors.types.ts) */
export interface RequestCodeResponse {
  sent: boolean;
  /** validade do código, em segundos */
  expiresIn: number;
  /** segundos até poder pedir outro código (servidor novo sempre manda; ausente = 30) */
  resendIn?: number;
  /** SÓ em desenvolvimento (NODE_ENV=development + DEV_SHORTCUTS=true, driver 'log'); nunca em produção */
  devCode?: string;
}

// ---- SMS: erros do request-code e do login (corpo = ApiError + os campos abaixo) ----

/**
 * - 400 phone_invalid: número fora do formato (DDD + celular)
 * - 400 phone_not_mobile: parece fixo (o código vai por SMS)
 * - 400 phone_unreachable: o provedor recusou o número
 * - 429 sms_cooldown {retryAfter}: pediu outro código cedo demais (o anterior ainda vale → o app vai pra tela do código)
 * - 429 sms_rate_limited {retryAfter, scope}: passou do teto por número (5/h, 10/dia) ou por conexão (20/h, 60/dia)
 * - 429 sms_locked {retryAfter}: 5 códigos errados → espera de 15 min e pede um código novo
 * - 503 sms_unavailable: provedor fora ou teto global da hora (timeout do provedor ainda conta na cota)
 * - 401 code_invalid {attemptsLeft}: código errado
 * - 401 code_expired: código venceu ou já foi usado → pedir outro
 */
export const SMS_ERROR_CODES = [
  'phone_invalid',
  'phone_not_mobile',
  'phone_unreachable',
  'sms_cooldown',
  'sms_rate_limited',
  'sms_locked',
  'sms_unavailable',
  'code_invalid',
  'code_expired',
] as const;
export type SmsErrorCode = (typeof SMS_ERROR_CODES)[number];

/** de onde veio o teto do 429 sms_rate_limited */
export type SmsRateLimitScope = 'phone' | 'ip';

/** 429 com espera: `retryAfter` em segundos (também no header Retry-After); `message` já diz a espera legível */
export interface SmsRetryError {
  error: 'sms_cooldown' | 'sms_rate_limited' | 'sms_locked';
  message: string;
  retryAfter: number;
  /** só no sms_rate_limited */
  scope?: SmsRateLimitScope;
}

/** 401 do login: código errado, ainda há tentativas antes da espera de 15 min */
export interface CodeInvalidError {
  error: 'code_invalid';
  message: string;
  attemptsLeft: number;
}

export interface LoginRequest {
  phone: string;
  code: string;
}

export interface AuthUser {
  id: string;
  name: string;
  phone: string | null;
  isNew: boolean;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  refreshToken: string;
}

// ---- número reciclado: conta parada (>= AUTH_DORMANT_DAYS sem uso, padrão 90) não entra direto pelo SMS ----

/** por que o número saiu da conta antiga (phone_releases.reason) */
export const PHONE_RELEASE_REASONS = ['not_mine', 'birthdate_mismatch', 'account_deleted', 'admin'] as const;
export type PhoneReleaseReason = (typeof PHONE_RELEASE_REASONS)[number];

/**
 * "Essa conta é sua?": vem no login quando a conta do número está parada. Nada de foto nem bio: só a inicial de cada
 * nome. O app pede a data de nascimento (POST /auth/claim/confirm) ou "Não é minha" (/auth/claim/release).
 */
export interface AccountClaim {
  /** desafio no servidor (10 min) */
  challengeId: string;
  /** inicial + 3 bolinhas por nome, sem revelar o tamanho: 'A••• P•••' */
  maskedName: string;
  /** sempre null (o servidor não manda mais o mês de criação); fica no tipo pro app antigo */
  createdMonth: string | null;
  /** tentativas de data que ainda restam (por CONTA, sem prazo: os erros somam até acertar ou o número sair) */
  attemptsLeft: number;
  /** segundos até o desafio vencer */
  expiresIn: number;
}

/**
 * POST /v1/auth/login (e resposta de /auth/claim/confirm e /auth/claim/release).
 * - conta ativa: token + refreshToken, user.isNew false
 * - número sem conta (ou liberado agora): token null, user.isNew true → o app segue pro cadastro (Register)
 * - conta parada: token null, user.isNew false e `claim` → tela "Essa conta é sua?"
 * `released` vem quando o número acabou de ser liberado da conta antiga (o app avisa e segue pro cadastro).
 * - exclusão pedida dentro do prazo: 409 account_deletion_pending (AccountDeletionPendingError, privacy.ts) → o app
 *   oferece cancelar (POST /v1/auth/deletion/cancel), que devolve este LoginResponse com tokens e `restored`
 */
export interface LoginResponse {
  user: AuthUser;
  token: string | null;
  refreshToken: string | null;
  claim?: AccountClaim;
  released?: PhoneReleaseReason;
  /** a exclusão da conta acabou de ser cancelada ("Que bom te ver de volta!") */
  restored?: AccountDeletionRestored;
}

/** POST /v1/auth/claim/confirm → LoginResponse (acertou: tokens; esgotou as tentativas: isNew + released) */
export interface ClaimConfirmRequest {
  challengeId: string;
  /** 'AAAA-MM-DD' */
  birthDate: string;
}

/** POST /v1/auth/claim/release ("Não é minha") → LoginResponse com user.isNew true e released 'not_mine' */
export interface ClaimReleaseRequest {
  challengeId: string;
}

/** 401 do /auth/claim/confirm: data não bateu (ainda há tentativas) */
export interface ClaimMismatchError {
  error: 'claim_mismatch';
  message: string;
  attemptsLeft: number;
}

/** 401 do /auth/claim/*: desafio vencido ou já usado → o app volta pro Login */
export interface ClaimExpiredError {
  error: 'claim_expired';
  message: string;
}

/** 401 no refresh, no Bearer e no socket: a sessão foi revogada (ex.: o número saiu da conta) → deslogar */
export interface SessionRevokedError {
  error: 'session_revoked';
  message: string;
}

/**
 * POST /v1/auth/register (depois do SMS verificado). Orientação é opcional; showOrientation/sameOrientationFirst só
 * valem com orientation. showMe padrão 'everyone'. visibilityMode: o app manda sempre; 'anonymous' nasce com a janela
 * grátis de 24 h e ausente (app antigo) também. Se o número veio de conta banida/suspensa, a conta nova nasce em revisão
 * da moderação.
 * Nome, bio e Instagram passam pelo filtro de abuso: 400 text_blocked (TextBlockedError, com `field`) → o app volta
 * pra etapa do campo e mostra o `message`. App antigo ainda manda gender 'non_binary': o servidor grava 'other'.
 */
export interface RegisterRequest {
  phone: string;
  name: string;
  /** 'AAAA-MM-DD' */
  birthDate: string;
  gender: Gender;
  /** etapa opcional: até PROFILE_LIMITS.bioMax, com filtro de abuso; vazio/ausente = sem bio */
  bio?: string;
  /** etapa opcional: @ do Instagram (aceita @, link e maiúsculas; o servidor normaliza e valida — 400 instagram_invalid) */
  instagram?: string;
  /** NOMES do catálogo GET /v1/interests (até PROFILE_LIMITS.interestsMax; nome desconhecido é ignorado) */
  interests?: string[];
  /**
   * id anônimo desta instalação (o mesmo do POST /v1/analytics/events): o servidor liga os eventos do cadastro a
   * esta conta e grava 'signup_done'. Ausente (app antigo) = nada de métrica
   */
  installId?: string;
  lookingFor?: LookingFor;
  /** versão dos Termos aceita (LEGAL_VERSION) */
  termsVersion: string;
  orientation?: Orientation;
  showOrientation?: boolean;
  sameOrientationFirst?: boolean;
  showMe?: ShowMe;
  visibilityMode?: VisibilityMode;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  token: string;
  refreshToken: string;
}
