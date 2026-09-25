import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

/** hosts que podem servir fotos: o próprio backend (host da requisição) + PHOTO_ALLOWED_HOSTS (R2/CDN em prod) */
function assertPhotoHost(url: string, req: Request): void {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    throw new BadRequestException('URL de foto inválida');
  }
  const allowed = new Set(
    [req.get('host') ?? '', ...(process.env.PHOTO_ALLOWED_HOSTS ?? '').split(',')].map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  // dev: o app fala com o backend por 127.0.0.1/localhost/IP da LAN (túnel USB ou Wi-Fi) — mesma porta, hosts equivalentes
  const port = (req.get('host') ?? '').split(':')[1];
  if (port) ['127.0.0.1', 'localhost'].forEach((h) => allowed.add(`${h}:${port}`));
  if (!allowed.has(host)) throw new BadRequestException('Foto precisa estar hospedada pelo Cruzei');
}

class UpdateMeDto {
  @IsOptional() @IsString() @MaxLength(50) name?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @IsOptional() @IsEnum(['relationship', 'casual', 'friendship', 'network', 'unspecified']) lookingFor?: string;
  @IsOptional() @IsEnum(['heterosexual', 'homosexual', 'bisexual', 'pansexual', 'other']) orientation?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) interests?: string[];
  // AvatarConfig (validada no service contra o catálogo + tier do usuário)
  @IsOptional() @IsObject() avatar?: Record<string, unknown>;
}

class SettingsDto {
  @IsOptional() @IsEnum(['visible', 'anonymous']) visibilityMode?: 'visible' | 'anonymous';
  @IsOptional() @IsBoolean() showDistance?: boolean;
  @IsOptional() @IsBoolean() showAge?: boolean;
  /** foto real na bolha de identidade do mapa (OFF = só o avatar aparece no mapa) */
  @IsOptional() @IsBoolean() showPhotoOnMap?: boolean;
}

class PauseDto {
  @IsNumber() durationHours!: number;
}

class PhotoDto {
  @IsUrl({ require_tld: false }) url!: string;
  @IsOptional() @IsUrl({ require_tld: false }) thumbnailUrl?: string;
  @IsOptional() @IsBoolean() isMain?: boolean;
}

class ReorderDto {
  @IsArray() photoIds!: string[];
}

@UseGuards(JwtAuthGuard)
@Controller('me')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.me(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.svc.update(user.id, dto);
  }

  @Patch('settings')
  settings(@CurrentUser() user: AuthenticatedUser, @Body() dto: SettingsDto) {
    return this.svc.updateSettings(user.id, dto);
  }

  @Patch('pause')
  pause(@CurrentUser() user: AuthenticatedUser, @Body() dto: PauseDto) {
    return this.svc.pause(user.id, dto.durationHours);
  }

  @Post('photos')
  addPhoto(@CurrentUser() user: AuthenticatedUser, @Body() dto: PhotoDto, @Req() req: Request) {
    // a bolha do mapa faz TODO viewer baixar essa URL: só fotos hospedadas por nós (backend em dev, R2/CDN em prod),
    // senão a URL vira pixel de rastreio / oráculo de quem está perto
    assertPhotoHost(dto.url, req);
    if (dto.thumbnailUrl) assertPhotoHost(dto.thumbnailUrl, req);
    return this.svc.addPhoto(user.id, dto.url, dto.thumbnailUrl, dto.isMain);
  }

  @Delete('photos/:id')
  delPhoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.deletePhoto(user.id, id);
  }

  @Put('photos/reorder')
  reorder(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderDto) {
    return this.svc.reorderPhotos(user.id, dto.photoIds);
  }

  @Put('photos/:id/main')
  setMain(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.setMain(user.id, id);
  }
}

// Catálogo de interesses (pra tela de edição de perfil)
@UseGuards(JwtAuthGuard)
@Controller('interests')
export class InterestsController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  list() {
    return this.svc.listInterests();
  }
}
