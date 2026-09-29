import { INBOX_EVENTS } from '@cruzei/shared-types';
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
import { isRefreshPayload, type JwtPayload } from '../modules/auth/auth.service';
import { RedisService } from '../redis/redis.service';

import {
  conversationAccess,
  isUuid,
  typingMuted,
  type ConversationAccess,
} from './conversation-access';

/** sala de cada pessoa: todo evento que precisa chegar (conversa, mensagem, curtida) sai por aqui */
const userRoom = (userId: string) => `user:${userId}`;
/** sala da equipe (admin/moderador): fila e mensagens do suporte ao vivo */
export const STAFF_SUPPORT_ROOM = 'staff:support';
const isStaffRole = (role: unknown) => role === 'admin' || role === 'moderator';
/** sala da conversa aberta: SÓ o "digitando" (o resto vai pelas salas user:<id>) */
const convRoom = (conversationId: string) => `conv:${conversationId}`;
/** salas user:<id> sem repetição e sem id vazio */
const userRooms = (userIds: string[]) => [
  ...new Set((userIds ?? []).filter((id) => typeof id === 'string' && id.length > 0).map(userRoom)),
];

// join_conversation vai no banco a cada pedido: teto por socket (4029 = SocketErrorCode.RATE_LIMIT)
const JOIN_WINDOW_MS = 60_000;
const JOIN_MAX_PER_WINDOW = 30;

// "digitando" mudo (quem recebeu a solicitação): a promoção pode vir com o chat aberto, então reconsulta no máximo
// uma vez por janela. Neste processo o 'conversation:promoted' já libera na hora (unmuteTyping).
export const TYPING_RECHECK_MS = 3_000;

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
      // refresh token (30 dias, mesmo segredo) não abre socket: só o access
      if (isRefreshPayload(payload)) return next(new Error('unauthorized'));
      // conta banida/suspensa/excluída não conecta: o erro leva o código (account_banned…) e o motivo pro app
      this.accounts
        .blockedReason(payload.sub)
        .then(async (blocked) => {
          if (!blocked) {
            client.data.userId = payload.sub;
            // papel do estado da conta (cache de 15 s, já carregado pelo blockedReason): a equipe entra na sala do suporte
            client.data.role = await this.roleOf(payload.sub);
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
    if (isStaffRole(client.data.role)) client.join(STAFF_SUPPORT_ROOM);
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

  /** papel pra sala da equipe; sem conseguir ler o estado da conta, conecta como pessoa comum (nunca como equipe) */
  private async roleOf(userId: string): Promise<string> {
    try {
      return (await this.accounts.get(userId)).role;
    } catch {
      return 'user';
    }
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
    let access: ConversationAccess | null = null;
    try {
      access = await conversationAccess(this.prisma, conversationId, userId);
    } catch (e) {
      this.logger.warn(`join_conversation falhou user=${userId}: ${(e as Error).message}`);
    }
    if (!access) {
      client.emit('error', { code: 4003, message: 'Sem acesso a esta conversa' });
      return { ok: false, code: 4003 };
    }
    client.join(convRoom(conversationId as string));
    this.setTypingMute(client, conversationId as string, access);
    return { ok: true };
  }

  @SubscribeMessage('leave_conversation')
  leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId: string },
  ) {
    if (!isUuid(body?.conversationId)) return;
    client.leave(convRoom(body.conversationId));
    this.mutedTyping(client).delete(body.conversationId);
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
    // quem RECEBEU a solicitação não revela que abriu (true e false descartados: o outro lado nunca viu o true)
    if (this.typingMutedNow(client, conversationId)) return;
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
    if (event === INBOX_EVENTS.conversationPromoted) this.unmuteTyping([userId], payload);
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
    if (event === INBOX_EVENTS.conversationPromoted) this.unmuteTyping(userIds, payload);
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

  /**
   * Tira a pessoa de TODAS as salas conv:<id>, em todos os processos: ficou invisível sem Premium e para de ver o
   * "digitando" dos outros na hora (inbox/visibility.messagingLocked). Não avisa ninguém.
   */
  async leaveAllConversations(userId: string): Promise<void> {
    if (!this.server || !userId) return;
    const sockets = await this.server.in(userRoom(userId)).fetchSockets();
    for (const s of sockets) {
      for (const room of s.rooms) if (room.startsWith('conv:')) s.leave(room);
    }
  }

  /** fila do suporte: todos os sockets da equipe (admin/moderador), em todos os processos */
  emitToStaff(event: string, payload: unknown) {
    this.server?.to(STAFF_SUPPORT_ROOM).emit(event, payload);
  }

  /**
   * Papel mudou (painel): põe/tira os sockets JÁ conectados da pessoa da sala da equipe, em todos os processos — quem
   * perdeu o papel para de ver a fila do suporte na hora, sem esperar reconectar.
   */
  setStaffMembership(userId: string, isStaff: boolean) {
    if (!this.server || !userId) return;
    const sockets = this.server.in(userRoom(userId));
    if (isStaff) sockets.socketsJoin(STAFF_SUPPORT_ROOM);
    else sockets.socketsLeave(STAFF_SUPPORT_ROOM);
  }

  /** pra todo mundo conectado, em todos os processos (ex.: 'pois:changed' — o mapa busca os lugares de novo) */
  broadcast(event: string, payload: unknown) {
    this.server?.emit(event, payload);
  }

  /** conta banida/suspensa: derruba as conexões em todos os processos (o adaptador Redis repassa) */
  disconnectUser(userId: string, reason: unknown) {
    const room = this.server?.in(userRoom(userId));
    if (!room) return;
    this.server.to(userRoom(userId)).emit('account_blocked', reason);
    setTimeout(() => room.disconnectSockets(true), 300);
  }

  // ---- "digitando" mudo de quem recebeu a solicitação ----

  /** conversas em que o "digitando" deste socket está mudo → quando reconsultar (guardado no socket, some com ele) */
  private mutedTyping(client: Socket): Map<string, number> {
    const data = client.data as { mutedTyping?: Map<string, number> };
    return (data.mutedTyping ??= new Map());
  }

  private setTypingMute(client: Socket, conversationId: string, access: ConversationAccess) {
    const muted = this.mutedTyping(client);
    if (typingMuted(access)) muted.set(conversationId, Date.now() + TYPING_RECHECK_MS);
    else muted.delete(conversationId);
  }

  /**
   * Mudo agora? Vencida a janela, reconsulta em segundo plano (responder, mover pra principal ou a curtida mútua
   * promovem com o chat aberto): o evento atual é descartado e os próximos já seguem a resposta.
   */
  private typingMutedNow(client: Socket, conversationId: string): boolean {
    const muted = this.mutedTyping(client);
    const recheckAt = muted.get(conversationId);
    if (recheckAt === undefined) return false;
    if (Date.now() >= recheckAt) {
      muted.set(conversationId, Date.now() + TYPING_RECHECK_MS); // uma reconsulta por janela
      void this.refreshTypingMute(client, conversationId);
    }
    return true;
  }

  private async refreshTypingMute(client: Socket, conversationId: string): Promise<void> {
    try {
      const access = await conversationAccess(this.prisma, conversationId, client.data.userId);
      if (!client.rooms.has(convRoom(conversationId))) return; // saiu enquanto consultava
      if (!access) {
        // perdeu o acesso (arquivou, bloqueio): sai da sala como no join recusado
        client.leave(convRoom(conversationId));
        this.mutedTyping(client).delete(conversationId);
        return;
      }
      this.setTypingMute(client, conversationId, access);
    } catch (e) {
      // continua mudo; tenta de novo na próxima janela
      this.logger.warn(`typing: reconsulta falhou conv=${conversationId}: ${(e as Error).message}`);
    }
  }

  /**
   * 'conversation:promoted' saindo: libera o "digitando" dos sockets DESTE processo na hora (promoção é permanente).
   * Sockets de outros processos liberam na reconsulta (TYPING_RECHECK_MS).
   */
  private unmuteTyping(userIds: string[], payload: unknown) {
    const conversationId = (payload as { conversationId?: unknown } | null)?.conversationId;
    if (!isUuid(conversationId) || !this.server) return;
    for (const room of userRooms(userIds)) {
      for (const socketId of this.server.sockets.adapter.rooms.get(room) ?? []) {
        const s = this.server.sockets.sockets.get(socketId);
        if (s) this.mutedTyping(s).delete(conversationId);
      }
    }
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
