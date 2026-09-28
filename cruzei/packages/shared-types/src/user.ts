// User — perfil principal
import type { AvatarConfig } from './avatar';
import type { PhotoStatus, UserRole } from './moderation';

export type Gender = 'female' | 'male' | 'non_binary' | 'other';
export type Orientation = 'heterosexual' | 'homosexual' | 'bisexual' | 'pansexual' | 'other';
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
}

export interface UserStats {
  likesReceived: number;
  matches: number;
  superLikesToday: number;
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
