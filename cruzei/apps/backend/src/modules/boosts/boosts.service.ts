import { BOOST_RADIUS_M } from '@cruzei/shared-types';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';

import { assertStoreReceipt } from '../../common/store-receipt';
import { PrismaService } from '../../database/prisma.service';

// mesmo valor exibido no app (BoostScreen): R$ 4,90 por hora
const PRICE_CENTS_PER_HOUR = 490;

/**
 * Boost: por X horas a pessoa aparece pra quem está até BOOST_RADIUS_M (5 km; além dos 350 m na faixa 'boost',
 * sempre com posição anonimizada) e primeiro no mapa, na lista e no deck de curtidas (LocationService.discoverNow).
 * Todas as outras regras de descoberta continuam valendo (bloqueio, pausa, invisível, "Mostrar", área privada/casa).
 * Não guarda posição: a descoberta usa a presença de sempre (a coordenada da compra, que antes ficava pra sempre na
 * tabela, não é mais gravada).
 */
@Injectable()
export class BoostsService {
  constructor(private readonly prisma: PrismaService) {}

  async purchase(
    userId: string,
    durationHours: number,
    platform: 'ios' | 'android',
    receipt: string,
  ) {
    if (durationHours < 1 || durationHours > 24) {
      throw new BadRequestException('durationHours deve ser 1..24');
    }
    // mesma regra da assinatura: sem validação de loja, produção recusa com 402 (antes o boost saía de graça)
    assertStoreReceipt(receipt, 'Boost');

    // ninguém veria: invisível, pausada ou com descoberta "Ninguém" não compra (a tela explica o que mudar)
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { visibilityMode: true, isPaused: true, pausedUntil: true, discoveryMode: true },
    });
    const paused = !!me?.isPaused && (!me.pausedUntil || me.pausedUntil > new Date());
    if (!me || me.visibilityMode === 'anonymous' || paused || me.discoveryMode === 'nobody') {
      throw new ConflictException({
        error: 'boost_hidden',
        message: 'Invisível, pausado ou com a descoberta desligada, ninguém te vê — nem com boost.',
      });
    }

    // bloqueia boost ativo
    const active = await this.prisma.boost.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
    });
    if (active) {
      throw new BadRequestException('Você já tem um boost ativo');
    }

    const expiresAt = new Date(Date.now() + durationHours * 3_600_000);
    const boost = await this.prisma.boost.create({
      data: {
        id: uuid(),
        userId,
        expiresAt,
        amountCents: durationHours * PRICE_CENTS_PER_HOUR,
        platform,
        visibilityRadiusMeters: BOOST_RADIUS_M,
      },
    });

    return {
      id: boost.id,
      expiresAt: expiresAt.toISOString(),
      visibilityRadiusMeters: BOOST_RADIUS_M,
    };
  }

  async getActive(userId: string) {
    const boost = await this.prisma.boost.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
    });
    if (!boost) return null;
    const minutesRemaining = Math.max(
      0,
      Math.ceil((boost.expiresAt.getTime() - Date.now()) / 60_000),
    );
    return {
      id: boost.id,
      startedAt: boost.startedAt.toISOString(),
      expiresAt: boost.expiresAt.toISOString(),
      minutesRemaining,
    };
  }
}
