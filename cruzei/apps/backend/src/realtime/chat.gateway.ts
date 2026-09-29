import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, Socket } from 'socket.io';

import { processesSharingResources } from '../config/runtime';
import { PrismaService } from '../database/prisma.service';
import { AccountStateService } from '../modules/account/account-state.service';
import type { JwtPayload } from '../modules/auth/auth.service';
import { RedisService } from '../redis/redis.service';

import { canJoinConversation, isUuid } from './conversation-access';

/** sala de cada pessoa: todo evento que precisa chegar (conversa, mensagem, curtida) sai por aqui */
const userRoom = (userId: string) => `user:${userId}`;
/** sala da conversa aberta: SÓ o "digitando" (o resto vai pelas salas user:<id>) */
const convRoom = (conversationId: string) => `conv:${conversationId}`;
/** salas user:<id> sem repetição e sem id vazio */
const userRooms = (userIds: string[]) => [
  ...new Set((userIds ?? []).filter((id) => typeof id === 'string' && id.length > 0).map(userRoom)),
];

// join_conversation vai no banco a cada pedido: teto por socket (4029 = SocketErrorCode.RATE_LIMIT)
const JOIN_WINDOW_MS = 60_000;
const JOIN_MAX_PER_WINDOW = 30;

/** ack do join_conversation (4003 = sem acesso, 4029 = pedidos demais) */
export type JoinConversationAck = { ok: true } | { ok: false; code: 4003 | 4029 };

// Gateway único de tempo real: conversas, curtidas, acenos e moderação.
// Cada socket entra na room "user:<id>"; o chat aberto entra em "conv:<id>" (só pro "digitando").
// Nada de broadcast global: todo emit tem sala de destino.
@WebSocketGateway({ cors: { origin: '*' }, transports: ['websocket', 'polling'] })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly online = new Map<string, number>(); // userId -> conexões ativas

  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountStateService,
  ) {}

  // JWT validado no handshake (middleware): token vencido/ausente vira connect_error 'unauthorized' e o socket
  // nunca chega a entrar em rooms. O app renova o token e chama socket.connect() de novo (socket.ts).
  afterInit(server: Server) {
    // em cluster cada worker tem os SEUS sockets: sem o adaptador, uma mensagem enviada pelo worker 2 não chega em
    // quem está conectado no worker 1. O adaptador Redis repassa os emits de room entre os processos.
    if (processesSharingResources() > 1) {
      server.adapter(createAdapter(this.redis.client.duplicate(), this.redis.client.duplicate()));
      this.logger.log('tempo real com adaptador Redis (cluster)');
    }
    server.use((client, next) => {
      const fromAuth = client.handshake.auth?.token as string | undefined;
      const fromHeader = (client.handshake.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
      );
      const raw = fromAuth || fromHeader;
      if (!raw) return next(new Error('unauthorized'));
      let payload: JwtPayload;
      try {
        payload = this.jwt.verify(raw, {
          secret: this.cfg.get<string>('jwt.secret'),
        }) as JwtPayload;
      } catch {
        return next(new Error('unauthorized'));
      }
      // conta banida/suspensa/excluída não conecta: o erro leva o código (account_banned…) e o motivo pro app
      this.accounts
        .blockedReason(payload.sub)
        .then((blocked) => {
          if (!blocked) {
            client.data.userId = payload.sub;
            return next();
          }
          const err = new Error(blocked.error) as Error & { data?: unknown };
          err.data = blocked;
          next(err);
        })
        .catch(() => next(new Error('unavailable')));
    });
  }

  handleConnection(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      client.disconnect(true); // não deveria acontecer: o middleware já barrou
      return;
    }
    client.join(userRoom(userId));
    this.online.set(userId, (this.online.get(userId) ?? 0) + 1);
    this.logger.debug(`socket conectado user=${userId} id=${client.id}`);
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const n = (this.online.get(userId) ?? 1) - 1;
    if (n <= 0) this.online.delete(userId);
    else this.online.set(userId, n);
    this.logger.debug(`socket desconectado user=${userId} id=${client.id}`);
  }

  isOnline(userId: string): boolean {
    return this.online.has(userId);
  }

  /**
   * Chat aberto: entra na sala conv:<id> pro "digitando". Exige membro com a conversa não arquivada pra ele e
   * sem Block em nenhum sentido. Responde no ack ({ok}) e, na recusa, também com 'error' {code}.
   */
  @SubscribeMessage('join_conversation')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string },
  ): Promise<JoinConversationAck> {
    const userId = client.data.userId as string;
    const conversationId = body?.conversationId;
    // já está na sala: conferido na entrada (bloqueio/arquivamento tiram da sala via removeFromConversation)
    if (isUuid(conversationId) && client.rooms.has(convRoom(conversationId))) return { ok: true };
    if (!this.allowJoin(client)) {
      client.emit('error', { code: 4029, message: 'Muitos pedidos, tente de novo em instantes' });
      return { ok: false, code: 4029 };
    }
    let ok = false;
    try {
      ok = await canJoinConversation(this.prisma, conversationId, userId);
    } catch (e) {
      this.logger.warn(`join_conversation falhou user=${userId}: ${(e as Error).message}`);
    }
    if (!ok) {
      client.emit('error', { code: 4003, message: 'Sem acesso a esta conversa' });
      return { ok: false, code: 4003 };
    }
    client.join(convRoom(conversationId as string));
    return { ok: true };
  }

  @SubscribeMessage('leave_conversation')
  leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string },
  ) {
    if (isUuid(body?.conversationId)) client.leave(convRoom(body.conversationId));
  }

  @SubscribeMessage('typing')
  typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string; isTyping: boolean },
  ) {
    const userId = client.data.userId as string;
    const conversationId = body?.conversationId;
    // só quem entrou na sala (join_conversation confere membro, arquivo e bloqueio) avisa que está digitando
    if (!isUuid(conversationId) || !client.rooms.has(convRoom(conversationId))) return;
    // except user:<eu>: os outros aparelhos de quem digita não recebem o próprio "digitando"
    client
      .to(convRoom(conversationId))
      .except(userRoom(userId))
      .emit('typing_indicator', { conversationId, userId, isTyping: Boolean(body.isTyping) });
  }

  @SubscribeMessage('heartbeat')
  heartbeat() {
    return { ok: true, at: Date.now() };
  }

  // ---- Emissores usados pelos services (chamar DEPOIS do commit da transação) ----

  emitToUser(userId: string, event: string, payload: unknown) {
    if (!userId) return;
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  /**
   * Mesmo payload pra várias pessoas (ex.: o par): UM emit com todas as salas user:<id> — com o adaptador
   * Redis é um publish só, e cada aparelho recebe uma vez. Lista vazia não emite nada (server.to([])
   * viraria broadcast pra todo mundo). Payload diferente por lado → um emitToUser por pessoa.
   */
  emitToUsers(userIds: string[], event: string, payload: unknown) {
    const rooms = userRooms(userIds);
    if (!rooms.length) return;
    this.server?.to(rooms).emit(event, payload);
  }

  /**
   * Tira da sala conv:<id> todos os sockets dessas pessoas, em todos os processos (bloqueio, arquivamento,
   * banimento): o "digitando" para na hora. Não avisa ninguém — quem chama emite 'conversation:removed'.
   */
  removeFromConversation(conversationId: string, userIds: string[]) {
    const rooms = userRooms(userIds);
    if (!conversationId || !rooms.length) return;
    this.server?.in(rooms).socketsLeave(convRoom(conversationId));
  }

  /** conta banida/suspensa: derruba as conexões em todos os processos (o adaptador Redis repassa) */
  disconnectUser(userId: string, reason: unknown) {
    const room = this.server?.in(userRoom(userId));
    if (!room) return;
    this.server.to(userRoom(userId)).emit('account_blocked', reason);
    setTimeout(() => room.disconnectSockets(true), 300);
  }

  /** janela fixa por socket (guardada no próprio socket: some junto com ele) */
  private allowJoin(client: Socket): boolean {
    const now = Date.now();
    const w = client.data.joinWindow as { start: number; count: number } | undefined;
    if (!w || now - w.start >= JOIN_WINDOW_MS) {
      client.data.joinWindow = { start: now, count: 1 };
      return true;
    }
    w.count += 1;
    return w.count <= JOIN_MAX_PER_WINDOW;
  }
}
