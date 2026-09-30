// User — perfil principal
import type { AvatarConfig } from './avatar';
import type { ConversationRef, LikeStatus } from './conversation';
import type { LastSeen, ProximityBand } from './location';
import type { PhotoStatus, UserRole } from './moderation';

/**
 * Gênero: só Mulher, Homem e Outro (cadastro, editar perfil, painel). 'non_binary' saiu na migration
 * 20261004000000 (quem tinha virou 'other'). A ordem é a da lista no app.
 */
export const GENDERS = ['female', 'male', 'other'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = { female: 'Mulher', male: 'Homem', other: 'Outro' };

/**
 * Filtro de idade do "quem ver": faixa "de X a Y anos", só pro que EU vejo (NÃO recíproco) no mapa, na lista e no
 * deck. Sem limite = AGE_MIN–AGE_MAX. Quem esconde a idade (showAge=false) entra pelo BLOCO de AGE_BUCKET_YEARS anos
 * (18–22, 23–27…): passa se o bloco encosta na faixa — mexer na faixa nunca revela mais que o bloco. A idade exata
 * nunca sai do servidor. O slider vai de AGE_MIN a AGE_SLIDER_MAX: o topo ("80+") grava AGE_MAX.
 * Regra: AGE_MIN <= ageMin, ageMin + AGE_RANGE_MIN_GAP <= ageMax <= AGE_MAX (senão 400 age_range_invalid; CHECK
 * users_age_range_chk no banco) e no máximo AGE_RANGE_DAILY_CHANGES mudanças por dia (senão 429 age_range_limit).
 */
export const AGE_MIN = 18;
export const AGE_MAX = 99;
export const AGE_SLIDER_MAX = 80;
/** vão mínimo (anos) entre o "de" e o "até": 25 a 29 vale, 25 a 28 não */
export const AGE_RANGE_MIN_GAP = 4;
/** mudanças de faixa por pessoa por dia (dia de São Paulo); igual ao gravado não conta */
export const AGE_RANGE_DAILY_CHANGES = 5;
/** tamanho do bloco de idade de quem esconde a idade (a partir de AGE_MIN: 18–22, 23–27, 28–32…) */
export const AGE_BUCKET_YEARS = 5;

/**
 * Orientação sexual (opcional; dado sensível: só com consentimento, e a pessoa apaga quando quiser).
 * Exibir no perfil (showOrientation) e "mesma orientação primeiro" (sameOrientationFirst) são escolhas de cada um.
 * A ordem é a da lista no app.
 */
export const ORIENTATIONS = ['straight', 'gay', 'lesbian', 'asexual', 'bisexual', 'demisexual', 'pansexual', 'queer', 'curious'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const ORIENTATION_LABELS: Record<Orientation, string> = {
  straight: 'Hétero',
  gay: 'Gay',
  lesbian: 'Lésbica',
  asexual: 'Assexual',
  bisexual: 'Bissexual',
  demisexual: 'Demissexual',
  pansexual: 'Pansexual',
  queer: 'Queer',
  curious: 'Curiose',
};

/**
 * "Mostrar: Mulheres / Homens / Todos" — RECÍPROCO: só aparece quem também quer me ver. Gênero 'other' só
 * aparece pra quem escolheu 'everyone' (e a própria pessoa vê conforme a escolha dela). Vale no mapa, na lista e no
 * deck. Padrão: 'everyone'.
 */
export const SHOW_ME = ['women', 'men', 'everyone'] as const;
export type ShowMe = (typeof SHOW_ME)[number];
export const SHOW_ME_LABELS: Record<ShowMe, string> = { women: 'Mulheres', men: 'Homens', everyone: 'Todos' };

export type LookingFor = 'relationship' | 'casual' | 'friendship' | 'network' | 'unspecified';
export type PremiumTier = 'free' | 'premium' | 'premium_plus';
export type VisibilityMode = 'visible' | 'anonymous';
/** descoberta por proximidade (recíproca): todos · só interesses compatíveis · ninguém */
export type DiscoveryMode = 'everyone' | 'compatible' | 'nobody';

export interface UserPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  orderIndex: number;
  isMain: boolean;
  /** só no /me: pending = em análise (ninguém mais vê), rejected = recusada pela moderação */
  status?: PhotoStatus;
  rejectReason?: string | null;
}

export interface UserSeal {
  type: SealType;
  progress: number;
  target: number;
  isCompleted: boolean;
}

export interface UserSettings {
  visibilityMode: VisibilityMode;
  showDistance: boolean;
  showAge: boolean;
  /** foto real na bolha de identidade do mapa; OFF = só o avatar (o perfil continua com fotos) */
  showPhotoOnMap: boolean;
  discoveryMode: DiscoveryMode;
  isPaused: boolean;
  pausedUntil: string | null;
  // Campos novos (opcionais: o /me em cache de antes do deploy não tem; o app usa os padrões indicados)
  /** fim da janela do invisível grátis (24 h, pode religar quando quiser); null = visível ou Premium vigente (sem prazo) */
  anonymousUntil?: string | null;
  /** exibir a orientação no cartão público (padrão false; exige orientation) */
  showOrientation?: boolean;
  /** ver primeiro quem tem a mesma orientação (padrão false; exige orientation; só ordena, não filtra) */
  sameOrientationFirst?: boolean;
  /** quem eu quero ver (recíproco; padrão 'everyone') */
  showMe?: ShowMe;
  /** faixa de idade que EU vejo (não recíproca); padrão AGE_MIN. PATCH /me/settings {ageMin, ageMax} */
  ageMin?: number;
  /** padrão AGE_MAX (= sem limite; o slider mostra "80+") */
  ageMax?: number;
}

export interface UserStats {
  likesReceived: number;
  matches: number;
  /** super curtidas que usei hoje (dia de São Paulo) */
  superLikesToday: number;
  /** quantas ainda restam hoje (SUPER_LIKE_DAILY do plano efetivo − usadas); ausente = /me de antes do deploy */
  superLikesRemainingToday?: number;
  /** limite do dia pro meu plano efetivo (SUPER_LIKE_DAILY) */
  superLikeDailyLimit?: number;
}

export interface User {
  id: string;
  phone: string | null;
  email: string | null;
  name: string;
  birthDate: string; // ISO date
  age: number;
  gender: Gender;
  orientation: Orientation | null;
  lookingFor: LookingFor;
  bio: string | null;
  /** @ do Instagram sem o @, minúsculo (público: aparece no cartão pra todo mundo); null = não informou */
  instagram?: string | null;
  photos: UserPhoto[];
  interests: string[];
  seals: UserSeal[];
  premiumTier: PremiumTier;
  isVerified: boolean;
  profileCompleteness: number;
  /** avatar Cruzei; null enquanto o usuário não personalizou */
  avatar: AvatarConfig | null;
  settings: UserSettings;
  stats: UserStats;
  createdAt: string;
  lastActiveAt: string;
  role?: UserRole;
  /** versão dos Termos/Política que a pessoa aceitou × a vigente (diferente → pedir novo aceite) */
  legal?: { acceptedVersion: string | null; currentVersion: string };
}

export type SealType =
  | 'cafeteria'
  | 'praieiro'
  | 'roadie'
  | 'boemio'
  | 'natureza'
  | 'urbanista'
  | 'fitness'
  | 'cultural';

/**
 * GET /v1/users/:id — cartão público de outra pessoa (tela UserCard). Nunca telefone, e-mail, posição, distância em
 * metros nem horário exato: a última atividade vem só em FAIXA (lastSeen) e só pra quem tem direito.
 */
export interface PublicUserCard {
  id: string;
  name: string;
  /** null quando a pessoa desligou "mostrar idade" */
  age: number | null;
  bio: string | null;
  avatar: AvatarConfig;
  /** lugar onde está agora (só se ela mostra distância E está descoberta por quem consulta) */
  placeName: string | null;
  /** só fotos aprovadas */
  photos: Pick<UserPhoto, 'id' | 'url' | 'thumbnailUrl' | 'isMain'>[];
  interests: string[];
  seals: UserSeal[];
  lookingFor: LookingFor;
  isVerified: boolean;
  /** plano EFETIVO (assinatura vencida = 'free') */
  premiumTier: PremiumTier;
  /** faixa de proximidade (nunca metros); null fora da descoberta ou com "mostrar distância" desligado */
  proximityBand: ProximityBand | null;
  likedByMe: boolean;
  likedMe: boolean;
  likeStatus: LikeStatus;
  conversation: ConversationRef | null;
  /** só quando a pessoa EXIBE a orientação (showOrientation); senão null */
  orientation: Orientation | null;
  /** @ do Instagram sem o @ (público pra todo mundo que abre o cartão); o app abre instagramUrl(handle) */
  instagram: string | null;
  /** 'online' (< 15 min) / 'recent' (< 60 min) ou null (mais antigo, ou quem consulta não tem direito). Sem lastActiveAt */
  lastSeen: Exclude<LastSeen, 'earlier'> | null;
  /**
   * essa pessoa me deu uma SUPER curtida que eu ainda não respondi (nem curti nem passei). A super curtida revela quem
   * mandou pra todo mundo (selo "⭐ Te deu uma super curtida"; likeStatus vem RECEIVED mesmo sem Premium+). Curtida
   * normal continua escondida pra quem não é Premium+. Ausente = false.
   */
  superLikedMe?: boolean;
}

/** limites do perfil (o servidor aplica; o app usa pro contador e pra UX) */
export const PROFILE_LIMITS = {
  nameMax: 50,
  bioMax: 500,
  /** interesses por pessoa (GET /v1/interests → InterestItem[]) */
  interestsMax: 10,
} as const;

/** item de GET /v1/interests (catálogo; a pessoa manda os NOMES em PATCH /me e no cadastro) */
export interface InterestItem {
  id: number;
  name: string;
  icon: string | null;
  category: string | null;
}

/** motivo do socket 'account:changed' (sala user:<id>): o app busca o /me de novo e refaz o que depende do plano/visibilidade */
export type AccountChangedReason = 'premium' | 'premium_expired' | 'visibility';

/** payload do socket 'account:changed' */
export interface AccountChangedPayload {
  reason: AccountChangedReason;
}
