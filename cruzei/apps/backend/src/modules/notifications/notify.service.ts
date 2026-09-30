import {
  NOTIFICATION_EVENTS,
  PUSH_CHANNELS,
  type NotificationNewPayload,
  type NotificationTarget,
  type NotificationType,
} from '@cruzei/shared-types';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';

import { pushDataOf, toAppNotification } from './notification-target';
import { PushService } from './push.service';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string | null;
  target: NotificationTarget | null;
  /** campanha do painel que gerou (estatística de entregues/abertas) */
  campaignId?: string | null;
}

export interface NotifyChannels {
  /** push no celular (FCM) */
  push: boolean;
  /** central de avisos + aviso ao vivo pelo socket */
  inbox: boolean;
}

export interface NotifyResult {
  /** itens gravados na central */
  notified: number;
  pushSent: number;
  pushFailed: number;
}

/** lote de gravação/envio: campanha pra milhares vira INSERTs de 1000 linhas (nunca uma por pessoa) */
const CHUNK = 1_000;

/**
 * O ÚNICO caminho de aviso pra pessoa (campanha, suporte, Premium, lugar aprovado): grava na central
 * (notifications, destino em data.target), avisa ao vivo pelo socket ('notification:new') e manda o push.
 * Conta apagada não recebe nada; quem chama decide o público (preferências, status da conta).
 * Push social (mensagem nova, curtida, match) NÃO passa por aqui: não entra na central (SocialPushService).
 */
@Injectable()
export class NotifyService {
  private readonly log = new Logger(NotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ChatGateway,
    private readonly push: PushService,
  ) {}

  get pushEnabled(): boolean {
    return this.push.enabled;
  }

  async notify(
    userIds: string | string[],
    n: NotifyInput,
    channels: NotifyChannels = { push: true, inbox: true },
  ): Promise<NotifyResult> {
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [userIds])].filter(Boolean);
    const out: NotifyResult = { notified: 0, pushSent: 0, pushFailed: 0 };
    for (let i = 0; i < ids.length; i += CHUNK) {
      const r = await this.notifyChunk(ids.slice(i, i + CHUNK), n, channels);
      out.notified += r.notified;
      out.pushSent += r.pushSent;
      out.pushFailed += r.pushFailed;
    }
    return out;
  }

  private async notifyChunk(
    ids: string[],
    n: NotifyInput,
    ch: NotifyChannels,
  ): Promise<NotifyResult> {
    const out: NotifyResult = { notified: 0, pushSent: 0, pushFailed: 0 };
    const title = n.title.slice(0, 255);
    // quem recebe: só contas que existem e não foram apagadas (um id sumido não derruba o lote inteiro pela FK)
    let recipients: { id: string | null; user_id: string; sent_at: Date }[] = [];
    if (ch.inbox) {
      const data = JSON.stringify(n.target ? { target: n.target } : {});
      recipients = await this.prisma.$queryRaw<{ id: string; user_id: string; sent_at: Date }[]>`
        INSERT INTO notifications (id, user_id, type, title, body, data, campaign_id, delivery_status, sent_at)
        SELECT gen_random_uuid(), u.id, ${n.type}, ${title}, ${n.body}, ${data}::jsonb, ${n.campaignId ?? null}::uuid, 'sent', now()
          FROM users u WHERE u.id = ANY(${ids}::uuid[]) AND u.deleted_at IS NULL
        RETURNING id, user_id, sent_at`;
      out.notified = recipients.length;
      for (const r of recipients) {
        const payload: NotificationNewPayload = {
          notification: toAppNotification({
            id: r.id!,
            type: n.type,
            title,
            body: n.body,
            data: n.target ? { target: n.target } : null,
            readAt: null,
            sentAt: r.sent_at,
          }),
        };
        this.gateway.emitToUser(r.user_id, NOTIFICATION_EVENTS.new, payload);
      }
    } else if (ch.push) {
      const alive = await this.prisma.$queryRaw<{ user_id: string }[]>`
        SELECT u.id AS user_id FROM users u WHERE u.id = ANY(${ids}::uuid[]) AND u.deleted_at IS NULL`;
      recipients = alive.map((a) => ({ id: null, user_id: a.user_id, sent_at: new Date() }));
    }
    if (ch.push && recipients.length) {
      try {
        const r = await this.push.sendToUsers(
          recipients.map((x) => ({
            userId: x.user_id,
            payload: {
              title,
              body: n.body ?? '',
              data: pushDataOf(x.id, n.type, n.target),
              // o app cria os dois canais; resposta do suporte tem som/importância próprios
              channelId: n.type === 'support_reply' ? PUSH_CHANNELS.support : PUSH_CHANNELS.default,
            },
          })),
        );
        out.pushSent = r.sent;
        out.pushFailed = r.failed;
      } catch (e) {
        // o aviso já está na central: falha do push não desfaz nada
        this.log.warn(`push de '${n.type}' falhou: ${(e as Error).message}`);
      }
    }
    return out;
  }
}
