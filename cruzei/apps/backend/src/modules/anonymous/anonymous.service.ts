import { Injectable, NotFoundException } from '@nestjs/common';

import { isPremiumActive, visibleAnonymousUntil } from '../../common/premium';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';

// POST /anonymous/enable|disable: a MESMA regra do PATCH /me/settings (UsersService.setVisibility) — prazo do
// invisível grátis no banco, Premium vigente sem prazo. O app usa o PATCH; esta rota fica pelo contrato antigo.
@Injectable()
export class AnonymousService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async enable(userId: string) {
    const r = await this.users.setVisibility(userId, 'anonymous');
    // expiresAt: nome antigo da resposta (null = sem prazo, Premium vigente)
    return {
      visibilityMode: r.visibilityMode,
      anonymousUntil: r.anonymousUntil,
      expiresAt: r.anonymousUntil,
    };
  }

  async disable(userId: string) {
    const r = await this.users.setVisibility(userId, 'visible');
    return { visibilityMode: r.visibilityMode, anonymousUntil: null };
  }

  /** limites pelo plano EFETIVO (assinatura vencida conta como grátis) */
  async getLimits(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        premiumTier: true,
        premiumExpiresAt: true,
        visibilityMode: true,
        anonymousUntil: true,
      },
    });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    return {
      unlimited: isPremiumActive(u),
      isActive: u.visibilityMode === 'anonymous',
      anonymousUntil: visibleAnonymousUntil(u)?.toISOString() ?? null,
    };
  }
}
