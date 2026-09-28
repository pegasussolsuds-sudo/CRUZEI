import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@cruzei/shared-types';

export interface AuthenticatedUser {
  id: string;
  phone?: string;
  role?: UserRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
