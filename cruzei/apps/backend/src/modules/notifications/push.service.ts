import * as fs from 'node:fs';

import type { PushData } from '@cruzei/shared-types';
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

import { pushDataRecord } from './notification-target';

export interface PushPayload {
  title: string;
  body: string;
  data: PushData;
  /** canal Android (PUSH_CHANNELS): 'support', 'messages', 'social' ou 'default' */
  channelId: string;
  /** mesma tag substitui a notificação na bandeja (ex.: conv:<id> = uma por conversa) */
  tag?: string;
  /** aparelho offline recebe só a última do mesmo grupo (o FCM guarda no máx. 4 grupos por aparelho) */
  collapseKey?: string;
  /** validade no FCM: passou disso com o aparelho fora, não entrega mais */
  ttlSeconds?: number;
  /**
   * tela bloqueada (Android, só com bloqueio de tela):
   * - 'secret': o aviso nem aparece na tela bloqueada; aparece ao desbloquear (mensagem)
   * - 'private': aparece; o conteúdo só some se a pessoa escolheu esconder conteúdo sensível nos ajustes (NÃO é o
   *   padrão do Android — não serve pra garantir nada)
   * - sem valor: padrão do sistema
   */
  visibility?: PushVisibility;
}

export type PushVisibility = 'private' | 'secret';

/** um push por aparelho; o resultado sai na MESMA ordem */
export interface PushMessage {
  token: string;
  payload: PushPayload;
}

/** ok; invalid = token morto (app desinstalado, token trocado) → apagar; error = falha temporária (fica) */
export type PushOutcome = 'ok' | 'invalid' | 'error';

/** quem entrega de verdade (FCM em produção; falso nos testes) */
export interface PushTransport {
  sendEach(messages: PushMessage[]): Promise<PushOutcome[]>;
}

export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT');

export interface PushResult {
  sent: number;
  failed: number;
  /** tokens apagados por estarem mortos */
  removed: number;
}

/** o FCM aceita até 500 mensagens por chamada */
const FCM_BATCH = 500;
/** só esses códigos dizem que o TOKEN morreu; qualquer outro erro (payload, credencial, cota) não apaga nada */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Push direto no FCM HTTP v1 (firebase-admin) com a conta de serviço de FCM_SERVICE_ACCOUNT_FILE (JSON fora do repo).
 * Sem a variável (ou com o arquivo ilegível) o push fica DESLIGADO — loga uma vez; central de avisos e socket seguem.
 * O firebase-admin só é carregado quando há credencial (é pesado e não precisa subir em dev).
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger(PushService.name);
  private transport: PushTransport | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(PUSH_TRANSPORT) injected?: PushTransport | null,
  ) {
    if (injected) this.transport = injected;
  }

  onModuleInit(): void {
    if (this.transport) return;
    this.transport = this.fcmFromEnv();
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  private fcmFromEnv(): PushTransport | null {
    const file = process.env.FCM_SERVICE_ACCOUNT_FILE?.trim();
    if (!file) {
      this.log.log(
        'push desligado: FCM_SERVICE_ACCOUNT_FILE não definido (central de avisos e socket seguem)',
      );
      return null;
    }
    try {
      // nunca logar o conteúdo nem o erro cru do parse (pode trazer pedaço da chave)
      const account = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      const { initializeApp, cert, getApps, getMessaging } = loadFirebase();
      const name = 'metch-push';
      const app =
        getApps().find((a) => a.name === name) ??
        initializeApp({ credential: cert(account as never) }, name);
      this.log.log('push ligado (FCM HTTP v1)');
      return new FcmTransport(getMessaging(app));
    } catch {
      this.log.warn(
        'push desligado: não deu pra ler a conta de serviço de FCM_SERVICE_ACCOUNT_FILE',
      );
      return null;
    }
  }

  /**
   * Manda um push por aparelho de cada pessoa (payload próprio de cada uma: o notificationId muda). Tokens mortos
   * são apagados na hora. Push desligado → nada acontece (sent 0).
   */
  async sendToUsers(items: { userId: string; payload: PushPayload }[]): Promise<PushResult> {
    const out: PushResult = { sent: 0, failed: 0, removed: 0 };
    if (!this.transport || items.length === 0) return out;
    const byUser = new Map(items.map((i) => [i.userId, i.payload]));
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: [...byUser.keys()] } },
      select: { token: true, userId: true },
    });
    if (devices.length === 0) return out;
    const messages: PushMessage[] = devices.map((d) => ({
      token: d.token,
      payload: byUser.get(d.userId)!,
    }));
    const dead: string[] = [];
    for (let i = 0; i < messages.length; i += FCM_BATCH) {
      const part = messages.slice(i, i + FCM_BATCH);
      let res: PushOutcome[];
      try {
        res = await this.transport.sendEach(part);
      } catch (e) {
        // FCM fora do ar / credencial recusada: conta como falha, não derruba quem chamou
        this.log.warn(`push falhou num lote de ${part.length}: ${(e as Error).message}`);
        out.failed += part.length;
        continue;
      }
      res.forEach((r, k) => {
        if (r === 'ok') out.sent++;
        else {
          out.failed++;
          if (r === 'invalid') dead.push(part[k].token);
        }
      });
    }
    if (dead.length) {
      const r = await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
      out.removed = r.count;
    }
    return out;
  }
}

/** firebase-admin só é carregado com credencial (é pesado e não precisa subir sem push) */
function loadFirebase() {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const app = require('firebase-admin/app') as typeof import('firebase-admin/app');
  const messaging =
    require('firebase-admin/messaging') as typeof import('firebase-admin/messaging');
  /* eslint-enable @typescript-eslint/no-var-requires */
  return { ...app, ...messaging };
}

/**
 * Mensagem do FCM HTTP v1 (pura, testada em push.service.spec.ts): Android com prioridade alta (entrega com o app
 * fechado/Doze), notification + data; tag, collapseKey, ttl e visibility só quando o payload pede.
 */
export function fcmMessageOf(m: PushMessage): import('firebase-admin/messaging').TokenMessage {
  const p = m.payload;
  return {
    token: m.token,
    notification: { title: p.title, body: p.body },
    data: pushDataRecord(p.data),
    android: {
      priority: 'high',
      ...(p.collapseKey ? { collapseKey: p.collapseKey } : {}),
      ...(p.ttlSeconds != null && p.ttlSeconds > 0 ? { ttl: p.ttlSeconds * 1000 } : {}),
      notification: {
        sound: 'default',
        channelId: p.channelId,
        ...(p.tag ? { tag: p.tag } : {}),
        ...(p.visibility ? { visibility: p.visibility } : {}),
      },
    },
    apns: { payload: { aps: { sound: 'default' } } },
  };
}

class FcmTransport implements PushTransport {
  constructor(private readonly messaging: import('firebase-admin/messaging').Messaging) {}

  async sendEach(messages: PushMessage[]): Promise<PushOutcome[]> {
    const res = await this.messaging.sendEach(messages.map(fcmMessageOf));
    return res.responses.map((r) =>
      r.success ? 'ok' : DEAD_TOKEN_CODES.has(r.error?.code ?? '') ? 'invalid' : 'error',
    );
  }
}
