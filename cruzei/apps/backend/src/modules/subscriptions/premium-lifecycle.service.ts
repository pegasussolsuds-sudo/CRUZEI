import type { AccountChangedPayload } from '@cruzei/shared-types';
import { Injectable, Logger } from '@nestjs/common';

import { ANON_FREE_HOURS } from '../../common/premium';
import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { RedisService } from '../../redis/redis.service';
import { isPausedNow } from '../inbox/visibility';
import { NotifyService } from '../notifications/notify.service';
import { UsersService } from '../users/users.service';

// Ciclo de vida do plano (decisão 8 do dono): rebaixa quem venceu e devolve ao visível quem passou da janela do
// invisível grátis. Roda pela tarefa (PremiumTask, a cada minuto, no worker de cron) e também sob demanda (GET
// /premium/status). Tudo com UPDATE…RETURNING: dois processos ao mesmo tempo não pegam (nem avisam) a mesma pessoa.
// users.* são TIMESTAMP em UTC: SQL compara com (now() AT TIME ZONE 'UTC').

/** pessoas por execução (pico de vencimentos no mesmo minuto termina na execução seguinte) */
export const LIFECYCLE_BATCH = 500;

/** linha rebaixada agora */
export interface DowngradedRow {
  id: string;
  /** estava invisível: ganhou a janela grátis de 24 h */
  anonymous: boolean;
  /** número liberado (conta antiga de número reciclado): não recebe aviso */
  released: boolean;
}

/** linha que saiu do invisível grátis agora */
export interface ExpiredAnonRow {
  id: string;
  /** número liberado (conta antiga de número reciclado): não recebe aviso */
  released: boolean;
  /** pausa do perfil: valendo = continua fora do mapa, sem o aviso "voltou pro mapa" */
  isPaused: boolean;
  pausedUntil: Date | null;
}

export const PREMIUM_EXPIRED_TEXT = {
  title: 'Seu Premium acabou',
  visible: 'Sua conta voltou pro plano grátis. Dá pra assinar de novo quando quiser.',
  anonymous:
    'Você segue invisível por mais 24 h, agora sem curtir nem conversar (como no grátis). Depois volta a aparecer no mapa.',
} as const;

export const ANONYMOUS_EXPIRED_TEXT = {
  title: 'Você está visível de novo',
  body: 'Suas 24 h no modo invisível acabaram e seu perfil voltou pro mapa. Quer sumir de novo? É só ligar o invisível.',
} as const;

/**
 * Premium acabou (tarefa ou painel) com a pessoa invisível: ganha a janela grátis a partir de agora — ninguém aparece
 * no mapa de surpresa. Serve dentro de transação. Devolve o prazo novo, ou null se a pessoa não estava invisível.
 */
export async function openAnonWindowOnDowngrade(
  db: Pick<PrismaService, '$queryRaw'>,
  userId: string,
): Promise<Date | null> {
  const rows = await db.$queryRaw<{ anonymous_until: Date }[]>`
    UPDATE users SET anonymous_until = (now() AT TIME ZONE 'UTC') + make_interval(hours => ${ANON_FREE_HOURS}::int)
     WHERE id = ${userId}::uuid AND visibility_mode = 'anonymous'
    RETURNING anonymous_until`;
  return rows[0]?.anonymous_until ?? null;
}

@Injectable()
export class PremiumLifecycleService {
  private readonly log = new Logger(PremiumLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly gateway: ChatGateway,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Assinaturas vencidas → free no banco (lote com SKIP LOCKED). Quem estava invisível ganha a janela grátis de 24 h.
   * premium_expires_at fica como histórico. Devolve as linhas rebaixadas (já avisadas).
   */
  async downgradeExpired(limit = LIFECYCLE_BATCH): Promise<DowngradedRow[]> {
    const rows = await this.prisma.$queryRaw<DowngradedRow[]>`
      WITH due AS (
        SELECT id FROM users
         WHERE premium_tier <> 'free' AND premium_expires_at IS NOT NULL
           AND premium_expires_at <= (now() AT TIME ZONE 'UTC')
         ORDER BY premium_expires_at
         LIMIT ${limit}::int
         FOR UPDATE SKIP LOCKED)
      UPDATE users u
         SET premium_tier = 'free',
             anonymous_until = CASE WHEN u.visibility_mode = 'anonymous'
                                    THEN (now() AT TIME ZONE 'UTC') + make_interval(hours => ${ANON_FREE_HOURS}::int)
                                    ELSE NULL END,
             updated_at = (now() AT TIME ZONE 'UTC')
        FROM due
       WHERE u.id = due.id
      RETURNING u.id::text AS id, (u.visibility_mode = 'anonymous') AS anonymous, (u.phone_released_at IS NOT NULL) AS released`;
    await this.afterDowngrade(rows);
    return rows;
  }

  /** uma pessoa só (GET /premium/status antes da tarefa passar): mesma rotina; false = não estava vencida */
  async downgradeOne(userId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<DowngradedRow[]>`
      UPDATE users u
         SET premium_tier = 'free',
             anonymous_until = CASE WHEN u.visibility_mode = 'anonymous'
                                    THEN (now() AT TIME ZONE 'UTC') + make_interval(hours => ${ANON_FREE_HOURS}::int)
                                    ELSE NULL END,
             updated_at = (now() AT TIME ZONE 'UTC')
       WHERE u.id = ${userId}::uuid
         AND u.premium_tier <> 'free' AND u.premium_expires_at IS NOT NULL
         AND u.premium_expires_at <= (now() AT TIME ZONE 'UTC')
      RETURNING u.id::text AS id, (u.visibility_mode = 'anonymous') AS anonymous, (u.phone_released_at IS NOT NULL) AS released`;
    await this.afterDowngrade(rows);
    return rows.length > 0;
  }

  /**
   * Depois do rebaixamento: avatar só com itens free, invisível sai das salas de conversa (agora está travado), /me e
   * candidato em cache caem, o app aberto busca o /me ('account:changed' premium_expired) e o aviso vai pra central +
   * push ('premium_expired', texto conforme estava invisível ou não).
   */
  private async afterDowngrade(rows: DowngradedRow[]): Promise<void> {
    if (!rows.length) return;
    for (const r of rows) {
      try {
        await this.users.downgradeAvatarToFree(r.id);
        if (r.anonymous) await this.gateway.leaveAllConversations(r.id).catch(() => undefined);
        await this.redis.invalidateProfile(r.id);
        const payload: AccountChangedPayload = { reason: 'premium_expired' };
        this.gateway.emitToUser(r.id, 'account:changed', payload);
      } catch (e) {
        this.log.warn(`pós-rebaixamento de ${r.id} falhou: ${(e as Error).message}`);
      }
    }
    const notifiable = rows.filter((r) => !r.released);
    const anon = notifiable.filter((r) => r.anonymous).map((r) => r.id);
    const visible = notifiable.filter((r) => !r.anonymous).map((r) => r.id);
    try {
      if (visible.length) {
        await this.notify.notify(visible, {
          type: 'premium_expired',
          title: PREMIUM_EXPIRED_TEXT.title,
          body: PREMIUM_EXPIRED_TEXT.visible,
          target: { kind: 'premium' },
        });
      }
      if (anon.length) {
        await this.notify.notify(anon, {
          type: 'premium_expired',
          title: PREMIUM_EXPIRED_TEXT.title,
          body: PREMIUM_EXPIRED_TEXT.anonymous,
          target: { kind: 'premium' },
        });
      }
    } catch (e) {
      this.log.warn(`aviso de Premium vencido falhou: ${(e as Error).message}`);
    }
    this.log.log(
      `Premium vencido: ${rows.length} de volta ao grátis (${anon.length} invisíveis com 24 h)`,
    );
  }

  /**
   * Invisível grátis sem janela gravada (caminho antigo, seed, escrita direta) ganha as 24 h a partir de agora, sem
   * aviso. Pelo tier GRAVADO: o rebaixamento, que roda antes, já normalizou quem venceu.
   */
  async openMissingWindows(limit = LIFECYCLE_BATCH): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE users SET anonymous_until = (now() AT TIME ZONE 'UTC') + make_interval(hours => ${ANON_FREE_HOURS}::int)
       WHERE id IN (SELECT id FROM users
                     WHERE visibility_mode = 'anonymous' AND premium_tier = 'free' AND anonymous_until IS NULL
                       AND deleted_at IS NULL
                     LIMIT ${limit}::int
                     FOR UPDATE SKIP LOCKED)`;
  }

  /**
   * Janela do invisível grátis acabou → visível de novo (volta pro mapa), app aberto busca o /me ('account:changed'
   * visibility) e aviso 'anonymous_expired' na central + push. Pelo tier GRAVADO ('free'): Premium vencido ainda não
   * rebaixado espera o rebaixamento (que roda antes e dá as 24 h).
   * Perfil PAUSADO (pausa valendo) também volta a 'visible', mas segue fora do mapa: sem o aviso "voltou pro mapa".
   * O 'account:changed' vai igual (silencioso): o /me muda e as conversas destravam (inbox/visibility.messagingLocked).
   */
  async expireFreeAnonymous(limit = LIFECYCLE_BATCH): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<ExpiredAnonRow[]>`
      WITH due AS (
        SELECT id FROM users
         WHERE visibility_mode = 'anonymous' AND premium_tier = 'free'
           AND anonymous_until <= (now() AT TIME ZONE 'UTC')
           AND deleted_at IS NULL
         ORDER BY anonymous_until
         LIMIT ${limit}::int
         FOR UPDATE SKIP LOCKED)
      UPDATE users u
         SET visibility_mode = 'visible', anonymous_until = NULL, updated_at = (now() AT TIME ZONE 'UTC')
        FROM due
       WHERE u.id = due.id
      RETURNING u.id::text AS id, (u.phone_released_at IS NOT NULL) AS released,
                u.is_paused AS "isPaused", u.paused_until AS "pausedUntil"`;
    if (!rows.length) return [];
    for (const r of rows) {
      try {
        await this.redis.invalidateProfile(r.id);
        const payload: AccountChangedPayload = { reason: 'visibility' };
        this.gateway.emitToUser(r.id, 'account:changed', payload);
      } catch (e) {
        this.log.warn(`fim do invisível de ${r.id}: ${(e as Error).message}`);
      }
    }
    // número liberado e perfil pausado (continua fora do mapa) não recebem o "voltou pro mapa"
    const now = new Date();
    const notifiable = rows.filter((r) => !r.released && !isPausedNow(r, now)).map((r) => r.id);
    if (notifiable.length) {
      await this.notify
        .notify(notifiable, {
          type: 'anonymous_expired',
          title: ANONYMOUS_EXPIRED_TEXT.title,
          body: ANONYMOUS_EXPIRED_TEXT.body,
          target: { kind: 'map' },
        })
        .catch((e: Error) => this.log.warn(`aviso de fim do invisível falhou: ${e.message}`));
    }
    this.log.log(`Invisível grátis vencido: ${rows.length} de volta ao visível`);
    return rows.map((r) => r.id);
  }
}
