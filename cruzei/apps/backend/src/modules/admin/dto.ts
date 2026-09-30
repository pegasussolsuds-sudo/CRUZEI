import type {
  AnnouncePayload,
  CampaignAudience,
  CampaignChannels,
  CreateCampaignPayload,
  EventCategory,
  GrantPremiumPayload,
  NotificationTarget,
  PremiumTier,
  ReleasePhonePayload,
  ResolvePoiReportsPayload,
  UpsertEventPayload,
  UpsertPoiPayload,
  UserRole,
} from '@cruzei/shared-types';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

// Corpos das rotas do painel. O pipe global é whitelist + forbidNonWhitelisted: campo desconhecido = 400.
// Objetos com várias formas (público, canais, destino) passam como objeto e são validados no service
// (audience.ts / notification-target.ts), que devolve só os campos do contrato.

const EVENT_CATEGORIES = ['event', 'show', 'party', 'festival', 'sports', 'other'];

export class GrantPremiumDto implements GrantPremiumPayload {
  @IsIn(['free', 'premium', 'premium_plus']) tier!: PremiumTier;
  /** null = sem vencimento */
  @ValidateIf((o: GrantPremiumDto) => o.days !== null && o.tier !== 'free')
  @IsInt()
  @Min(1)
  @Max(3650)
  days!: number | null;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  @IsOptional() @IsBoolean() notify?: boolean;
}

export class SetRoleDto {
  @IsIn(['user', 'moderator', 'admin']) role!: UserRole;
}

/** "Liberar número" (só admin): o motivo vai pra auditoria */
export class ReleasePhoneDto implements ReleasePhonePayload {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class RejectCandidateDto {
  @IsString() @MinLength(1) @MaxLength(255) reason!: string;
}

export class ResolveReportsDto implements ResolvePoiReportsPayload {
  @IsIn(['hide', 'dismiss']) action!: 'hide' | 'dismiss';
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class CreatePoiDto implements UpsertPoiPayload {
  @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @IsString() @MaxLength(20) category!: string;
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsBoolean() isPartner?: boolean;
  @IsOptional() @IsString() @MaxLength(500) partnerOffer?: string | null;
}

export class PatchPoiDto implements Partial<UpsertPoiPayload> {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(20) category?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsBoolean() isPartner?: boolean;
  @IsOptional() @IsString() @MaxLength(500) partnerOffer?: string | null;
}

export class CreateEventDto implements UpsertEventPayload {
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsIn(EVENT_CATEGORIES) category!: EventCategory;
  @IsISO8601() startsAt!: string;
  @IsISO8601() endsAt!: string;
  @IsOptional() @IsString() @MaxLength(255) venueName?: string | null;
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(500) coverUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(20) poiId?: string | null;
}

export class PatchEventDto implements Partial<UpsertEventPayload> {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsIn(EVENT_CATEGORIES) category?: EventCategory;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsString() @MaxLength(255) venueName?: string | null;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(500) coverUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(20) poiId?: string | null;
}

export class CampaignPreviewDto {
  @IsObject() audience!: CampaignAudience;
  @IsOptional() @IsUUID() eventId?: string | null;
}

export class CreateCampaignDto implements CreateCampaignPayload {
  @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @IsString() @MinLength(1) @MaxLength(240) body!: string;
  @IsOptional() @IsObject() target?: NotificationTarget | null;
  @IsObject() audience!: CampaignAudience;
  @IsObject() channels!: CampaignChannels;
  @IsOptional() @IsISO8601() scheduledAt?: string | null;
  @IsOptional() @IsInt() @Min(0) confirmCount?: number;
}

export class AnnounceDto implements AnnouncePayload {
  @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @IsString() @MinLength(1) @MaxLength(240) body!: string;
  @IsObject() audience!: CampaignAudience;
  @IsObject() channels!: CampaignChannels;
  @IsOptional() @IsISO8601() scheduledAt?: string | null;
  @IsOptional() @IsInt() @Min(0) confirmCount?: number;
}
