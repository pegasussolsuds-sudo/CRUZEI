import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

class UpdateMeDto {
  @IsOptional() @IsString() @MaxLength(50) name?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @IsOptional() @IsEnum(['relationship', 'casual', 'friendship', 'network', 'unspecified']) lookingFor?: string;
  @IsOptional() @IsEnum(['heterosexual', 'homosexual', 'bisexual', 'pansexual', 'other']) orientation?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) interests?: string[];
}

class SettingsDto {
  @IsOptional() @IsEnum(['visible', 'anonymous']) visibilityMode?: 'visible' | 'anonymous';
  @IsOptional() @IsBoolean() showDistance?: boolean;
  @IsOptional() @IsBoolean() showAge?: boolean;
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
  addPhoto(@CurrentUser() user: AuthenticatedUser, @Body() dto: PhotoDto) {
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
