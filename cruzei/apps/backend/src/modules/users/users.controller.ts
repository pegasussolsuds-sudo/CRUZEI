import {
  GENDERS,
  ORIENTATIONS,
  PROFILE_LIMITS,
  SHOW_ME,
  type Gender,
  type Orientation,
  type ShowMe,
} from '@cruzei/shared-types';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { UsersService } from './users.service';

class UpdateMeDto {
  /** 2 a 50 letras depois de tirar os espaços (senão 400 name_invalid); passa pelo filtro de abuso */
  @IsOptional() @IsString() @MaxLength(PROFILE_LIMITS.nameMax) name?: string;
  /** vazio apaga; passa pelo filtro de abuso */
  @IsOptional() @IsString() @MaxLength(PROFILE_LIMITS.bioMax) bio?: string;
  /** Mulher / Homem / Outro ("Outro" só aparece pra quem escolheu "Todos") */
  @IsOptional() @IsIn([...GENDERS]) gender?: Gender;
  @IsOptional()
  @IsEnum(['relationship', 'casual', 'friendship', 'network', 'unspecified'])
  lookingFor?: string;
  /** null apaga (revoga o consentimento e desliga exibir/ordem) */
  @IsOptional() @IsEnum([...ORIENTATIONS]) orientation?: Orientation | null;
  /** @ do Instagram (público): aceita @, link colado e maiúsculas — o service normaliza e valida; '' ou null apaga */
  @IsOptional() @IsString() @MaxLength(100) instagram?: string | null;
  /** NOMES do catálogo (GET /interests); nome desconhecido é ignorado */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROFILE_LIMITS.interestsMax)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  interests?: string[];
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
  /**
   * faixa de idade que EU vejo (não recíproca): 18 <= ageMin, ageMin + 4 <= ageMax <= 99 (o topo "80+" grava 99). Sem
   * @Min/@Max de propósito: fora da regra o service responde 400 age_range_invalid (o código que o app entende). Até 5
   * mudanças por dia (429 age_range_limit)
   */
  @IsOptional() @IsInt() ageMin?: number;
  @IsOptional() @IsInt() ageMax?: number;
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

/**
 * Foto do perfil: `key` devolvida pelo POST /uploads/photo, ou a `url` que ele devolveu (APK antigo). Exige uma das
 * duas; o servidor confere a posse do upload. thumbnailUrl só é aceito por compatibilidade (ignorado: a miniatura sai
 * do próprio upload).
 */
export class PhotoDto {
  @ValidateIf((o: PhotoDto) => o.key !== undefined || o.url === undefined)
  @IsString()
  @MaxLength(200)
  @Matches(/^(?!.*\/\/)[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{1,5}$/)
  key?: string;
  @ValidateIf((o: PhotoDto) => o.key === undefined)
  @IsString()
  @MaxLength(500)
  url?: string;
  @IsOptional() @IsString() @MaxLength(500) thumbnailUrl?: string;
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
  addPhoto(@CurrentUser() user: AuthenticatedUser, @Body() dto: PhotoDto) {
    // só upload do PRÓPRIO usuário (media_objects): URL de fora viraria pixel de rastreio / oráculo de quem está perto,
    // e anexar o arquivo de outra conta deixaria apagá-lo
    return this.svc.addPhoto(user.id, { key: dto.key, url: dto.url }, dto.isMain);
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

// Catálogo de interesses (InterestItem[]): público porque o cadastro pede antes de a conta existir (sem dado pessoal;
// o limite global de requisições vale aqui também)
@Controller('interests')
export class InterestsController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  list() {
    return this.svc.listInterests();
  }
}
