import { ORIENTATIONS, SHOW_ME, type Orientation, type ShowMe } from '@cruzei/shared-types';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import type { Request } from 'express';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { assertPhotoHost } from '../../common/photo-host';

import { UsersService } from './users.service';

class UpdateMeDto {
  @IsOptional() @IsString() @MaxLength(50) name?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @IsOptional()
  @IsEnum(['relationship', 'casual', 'friendship', 'network', 'unspecified'])
  lookingFor?: string;
  /** null apaga (revoga o consentimento e desliga exibir/ordem) */
  @IsOptional() @IsEnum([...ORIENTATIONS]) orientation?: Orientation | null;
  /** @ do Instagram (público): aceita @, link colado e maiúsculas — o service normaliza e valida; '' ou null apaga */
  @IsOptional() @IsString() @MaxLength(100) instagram?: string | null;
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
  /** descoberta por proximidade (recíproca): everyone | compatible | nobody */
  @IsOptional() @IsEnum(['everyone', 'compatible', 'nobody']) discoveryMode?:
    | 'everyone'
    | 'compatible'
    | 'nobody';
  /** exibir a orientação no cartão público (exige orientação: senão 400 orientation_required) */
  @IsOptional() @IsBoolean() showOrientation?: boolean;
  /** ver primeiro quem EXIBE a mesma orientação (só ordena; exige orientação) */
  @IsOptional() @IsBoolean() sameOrientationFirst?: boolean;
  /** "Mostrar: Mulheres / Homens / Todos" (recíproco) */
  @IsOptional() @IsEnum([...SHOW_ME]) showMe?: ShowMe;
}

class PrivateAreaDto {
  @IsString() @MaxLength(40) label!: string;
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsOptional() @IsNumber() radiusM?: number;
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

class TermsDto {
  @IsString() @MaxLength(20) version!: string;
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

  // retomar perfil pausado (DELETE /me/pause; PATCH /me/unpause é alias)
  @Delete('pause')
  resume(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.resume(user.id);
  }

  @Patch('unpause')
  unpause(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.resume(user.id);
  }

  // ---- áreas privadas (casa, trabalho…): dentro delas ninguém me descobre. Só o dono lê/escreve; a coordenada nunca sai. ----
  @Get('private-areas')
  privateAreas(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listPrivateAreas(user.id);
  }

  @Post('private-areas')
  addPrivateArea(@CurrentUser() user: AuthenticatedUser, @Body() dto: PrivateAreaDto) {
    return this.svc.addPrivateArea(user.id, dto);
  }

  @Delete('private-areas/:id')
  removePrivateArea(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.removePrivateArea(user.id, id);
  }

  // aceite dos Termos de Uso + Política de privacidade (versão nova ou conta criada antes do aceite existir)
  @Post('terms')
  acceptTerms(@CurrentUser() user: AuthenticatedUser, @Body() dto: TermsDto) {
    return this.svc.acceptTerms(user.id, dto.version);
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
