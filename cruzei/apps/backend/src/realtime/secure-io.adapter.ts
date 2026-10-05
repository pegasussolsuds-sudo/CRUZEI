import type { IncomingMessage } from 'node:http';

import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

import { originAllowed } from '../config/security';

export type SecureIoOptions = {
  production: boolean;
  /** origens de navegador aceitas (já normalizadas) */
  origins: readonly string[];
  /** teto de uma mensagem recebida; os eventos do app são pequenos (join, typing, heartbeat) */
  maxHttpBufferSize: number;
};

/** 64 KB: o padrão do socket.io é 1 MB */
export const SOCKET_MAX_BUFFER = 64 * 1024;

/**
 * Adapter do socket.io com as regras de origem (as opções dos @WebSocketGateway não decidem CORS).
 * Produção: CORS por lista e Origin conferido no handshake (sem Origin, na lista ou mesmo host da requisição — o
 * WebSocket do RN manda Origin igual à URL do servidor). Dev/test: '*' e sem conferência, como antes (o proxy do
 * Vite troca o Host, e conferir quebraria o suporte ao vivo do painel).
 */
export class SecureIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly opts: SecureIoOptions,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const allowed = new Set(this.opts.origins);
    const secured: Partial<ServerOptions> = this.opts.production
      ? {
          cors: { origin: [...allowed], credentials: false },
          allowRequest: (
            req: IncomingMessage,
            cb: (err: string | null | undefined, ok: boolean) => void,
          ) =>
            cb(
              null,
              originAllowed(req.headers.origin, allowed, [
                req.headers.host,
                req.headers['x-forwarded-host'],
              ]),
            ),
        }
      : { cors: { origin: '*' } };
    return super.createIOServer(port, {
      ...(options ?? {}),
      maxHttpBufferSize: this.opts.maxHttpBufferSize,
      ...secured,
    } as ServerOptions);
  }
}
