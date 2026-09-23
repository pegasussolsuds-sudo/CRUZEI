import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AnonymousService } from './anonymous.service';

@UseGuards(JwtAuthGuard)
@Controller('anonymous')
export class AnonymousController {
  constructor(private readonly svc: AnonymousService) {}

  @Post('enable')
  enable(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.enable(user.id);
  }

  @Post('disable')
  @HttpCode(200)
  disable(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.disable(user.id);
  }
}
