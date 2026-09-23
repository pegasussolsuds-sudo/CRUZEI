import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../database/prisma.service';
import type { JwtPayload } from '../modules/auth/auth.service';

// Gateway único de tempo real: chat, match e presença.
// Cada usuário entra na room "user:<id>"; cada chat aberto entra em "match:<id>".
@WebSocketGateway({ cors: { origin: '*' }, transports: ['websocket', 'polling'] })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly online = new Map<string, number>(); // userId -> conexões ativas

  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(client: Socket) {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    const fromHeader = (client.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
    const raw = fromAuth ?? fromHeader;

    if (!raw) {
      client.emit('error', { code: 4001, message: 'Token ausente' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwt.verify(raw, { secret: this.cfg.get<string>('jwt.secret') }) as JwtPayload;
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
      this.online.set(payload.sub, (this.online.get(payload.sub) ?? 0) + 1);
      this.logger.debug(`socket conectado user=${payload.sub} id=${client.id}`);
    } catch {
      client.emit('error', { code: 4001, message: 'Token inválido' });
      client.disconnect(true);
    }
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
    if (!body?.matchId) return;
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

  private async isParticipant(matchId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { userAId: true, userBId: true },
    });
    return Boolean(m && (m.userAId === userId || m.userBId === userId));
  }
}
