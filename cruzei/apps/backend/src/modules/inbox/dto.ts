// DTOs das rotas /conversations e /inbox (o ValidationPipe global usa whitelist + forbidNonWhitelisted).
import { INBOX_LIMITS } from '@cruzei/shared-types';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** POST /conversations — abre (ou reusa) a conversa do par com a 1ª mensagem */
export class CreateConversationDto {
  @IsUUID() toUserId!: string;
  @IsString() @MaxLength(INBOX_LIMITS.messageBodyMax) body!: string;
  /** reenvio com o mesmo clientId devolve a mesma mensagem (10 min) */
  @IsOptional() @IsString() @MaxLength(64) clientId?: string;
}

/** POST /conversations/:id/messages */
export class SendChatMessageDto {
  @IsString() @MaxLength(INBOX_LIMITS.messageBodyMax) body!: string;
  @IsOptional() @IsString() @MaxLength(64) clientId?: string;
}

/** POST /conversations/:id/media (desligado sem CHAT_MEDIA_ENABLED=true) */
export class SendChatMediaDto {
  @IsIn(['photo_temp', 'audio', 'gif']) type!: 'photo_temp' | 'audio' | 'gif';
  @IsString() @MaxLength(500) mediaUrl!: string;
  @IsOptional() @IsString() @MaxLength(64) clientId?: string;
}

/** POST /conversations/:id/read — sem upToMessageId marca até a última mensagem do outro */
export class MarkConversationReadDto {
  @IsOptional() @IsUUID() upToMessageId?: string;
}

/** PATCH /conversations/:id */
export class UpdateConversationDto {
  @IsOptional() @IsBoolean() isMuted?: boolean;
  @IsOptional() @IsBoolean() archived?: boolean;
}
