import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { LocationService } from './location.service';

class UpdateLocationDto {
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsOptional() @IsNumber() accuracyMeters?: number;
  @IsOptional() @IsNumber() poiId?: number;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('location')
export class LocationController {
  constructor(private readonly svc: LocationService) {}

  @Post('update')
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateLocationDto) {
    return this.svc.update(user.id, dto);
  }

  @Get('nearby')
  nearby(
    @CurrentUser() user: AuthenticatedUser,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radius_meters') radius = '5000',
  ) {
    return this.svc.getNearby(Number(lat), Number(lng), Number(radius), user.id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getMe(user.id);
  }
}
