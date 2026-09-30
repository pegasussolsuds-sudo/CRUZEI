// Auth
import type { Gender, LookingFor, Orientation, ShowMe, VisibilityMode } from '../user';

export interface RequestCodeRequest {
  phone: string;
}

export interface RequestCodeResponse {
  sent: boolean;
  expiresIn: number; // seconds
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
 */
export interface LoginResponse {
  user: AuthUser;
  token: string | null;
  refreshToken: string | null;
  claim?: AccountClaim;
  released?: PhoneReleaseReason;
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
