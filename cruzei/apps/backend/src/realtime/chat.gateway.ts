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
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { processesSharingResources } from '../config/runtime';
import type { JwtPayload } from '../modules/auth/auth.service';
import { AccountStateService } from '../modules/account/account-state.service';

// Gateway único de tempo real: chat, match e presença.
// Cada usuário entra na room "user:<id>"; cada chat aberto entra em "match:<id>".
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
      const fromHeader = (client.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
      const raw = fromAuth || fromHeader;
      if (!raw) return next(new Error('unauthorized'));
      let payload: JwtPayload;
      try {
        payload = this.jwt.verify(raw, { secret: this.cfg.get<string>('jwt.secret') }) as JwtPayload;
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
    client.join(`user:${userId}`);
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

  @SubscribeMessage('join_match')
  async joinMatch(@ConnectedSocket() client: Socket, @MessageBody() body: { matchId: string }) {
    const userId = client.data.userId as string;
    if (!body?.matchId || !(await this.isParticipant(body.matchId, userId))) {
      client.emit('error', { code: 4003, message: 'Sem acesso a este match' });
      return;
    }
    client.join(`match:${body.matchId}`);
  }

  @SubscribeMessage('leave_match')
  leaveMatch(@ConnectedSocket() client: Socket, @MessageBody() body: { matchId: string }) {
    if (body?.matchId) client.leave(`match:${body.matchId}`);
  }

  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { matchId: string; isTyping: boolean }) {
    // só quem entrou na sala (join_match confere a participação) avisa que está digitando
    if (!body?.matchId || !client.rooms.has(`match:${body.matchId}`)) return;
    client.to(`match:${body.matchId}`).emit('typing_indicator', {
      matchId: body.matchId,
      userId: client.data.userId,
      isTyping: Boolean(body.isTyping),
    });
  }

  @SubscribeMessage('heartbeat')
  heartbeat() {
    return { ok: true, at: Date.now() };
  }

  // ---- Emissores usados pelos services ----

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: string, payload: unknown) {
    userIds.forEach((id) => this.emitToUser(id, event, payload));
  }

  emitToMatch(matchId: string, event: string, payload: unknown) {
    this.server?.to(`match:${matchId}`).emit(event, payload);
  }

  /** match fechado (bloqueio, desfeito, banimento): tira os sockets da sala e avisa os dois lados */
  closeMatch(matchId: string, userIds: string[]) {
    this.server?.in(`match:${matchId}`).socketsLeave(`match:${matchId}`);
    this.emitToUsers(userIds, 'match_closed', { matchId });
  }

  /** conta banida/suspensa: derruba as conexões em todos os processos (o adaptador Redis repassa) */
  disconnectUser(userId: string, reason: unknown) {
    const room = this.server?.in(`user:${userId}`);
    if (!room) return;
    this.server.to(`user:${userId}`).emit('account_blocked', reason);
    setTimeout(() => room.disconnectSockets(true), 300);
  }

  private async isParticipant(matchId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { userAId: true, userBId: true, status: true },
    });
    // bloqueado/desfeito não volta pra sala (nem pro "digitando")
    return Boolean(m && (m.userAId === userId || m.userBId === userId) && (m.status === 'active' || m.status === 'expired'));
  }
}
