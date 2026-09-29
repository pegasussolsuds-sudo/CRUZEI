import { INBOX_LIMITS } from '@cruzei/shared-types';
import type {
  ChatMessage,
  ChatMessageWithClientId,
  ConversationDetail,
  ConversationRef,
  ConversationSummary,
  CreateConversationResponse,
  InboxCounts,
  InboxFolder,
  InboxListResponse,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { RedisService } from '../../redis/redis.service';
import { blockedBody } from '../account/account-state.service';

import {
  emitEvent,
  flushInboxEvents,
  leaveEvent,
  type InboxEvent,
  type InboxGatewayPort,
} from './inbox.events';
import {
  decodeCursor,
  encodeCursor,
  factsFromRow,
  MUTUAL_LIKE_TEXT,
  routeOf,
  toChatMessage,
  toSummary,
  type MessageRow,
} from './inbox.mapper';
import {
  inboxCounts,
  insertMessage,
  lockPair as lockPairTx,
  markMessagesRead,
  messagesPage,
  pairOf,
  summaryRows,
  unreadAfter,
} from './inbox.queries';
import {
  canRequesterSend,
  folderFor,
  marksReadAllowed,
  planReevaluation,
  ROUTING,
  sendIntent,
  type ConversationFacts,
  type MemberRole,
} from './routing';
import { CARD_TARGET_SELECT, cardVisible, peerReachable, senderDenied } from './visibility';

// Conversas: Principal + Solicitações (Instagram + reciprocidade do Tinder). O chat NUNCA é bloqueado: as duas pessoas
// conversam desde a 1ª mensagem; muda só ONDE a conversa aparece (regras puras em routing.ts, pasta gravada em
// conversations.promoted_at). Cada escrita roda numa transação com a trava do par (pg_advisory_xact_lock) e devolve a
// lista de eventos; o envio pro socket acontece DEPOIS do commit (rollback = nenhum evento).

type Tx = Prisma.TransactionClient;

/** conversa + as duas linhas de membro (lidas dentro da trava quando a decisão depende delas) */
interface ConvCtx {
  id: string;
  userLowId: string;
  userHighId: string;
  promotedAt: Date | null;
  members: { userId: string; role: MemberRole; unreadCount: number; archivedAt: Date | null }[];
}

interface NewMessage {
  body: string | null;
  messageType: 'text' | 'photo_temp' | 'audio' | 'gif';
  mediaUrl: string | null;
  mediaExpiresAt?: Date | null;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
const LIST_DEFAULT = 30;
const LIST_MAX = 50;

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  body: true,
  mediaUrl: true,
  messageType: true,
  systemKind: true,
  readAt: true,
  createdAt: true,
  clientId: true,
} as const;

/** conta de quem age: estado (senderDenied) + o que o erro igual ao do JwtAuthGuard precisa */
const ACCOUNT_SELECT = {
  id: true,
  deletedAt: true,
  accountStatus: true,
  reviewHoldAt: true,
  suspendedUntil: true,
  moderationReason: true,
} as const;
type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

// 404 idêntico pra inexistente, bloqueado (qualquer sentido), sem acesso, anônimo, pausado, banido, em análise, apagado
const conversationNotFound = () => new NotFoundException('Conversa não encontrada');
const userNotFound = () => new NotFoundException('Usuário não encontrado');

/** clientId reusado pelo MESMO remetente em OUTRA conversa (cliente com defeito): não devolve mensagem de outro par */
const clientIdConflict = () =>
  new ConflictException({
    error: 'client_id_conflict',
    message: 'Esse clientId já foi usado em outra conversa',
  });

/**
 * Conta de quem envia fora do ar (lida FRESCA do banco): o MESMO erro do JwtAuthGuard, que lê um cache de estado
 * (15 s local, 10 min no Redis) — o app já sabe mostrar banido/suspenso (403) e sair da conta (401).
 */
function senderAccountError(u: AccountRow | null | undefined): HttpException {
  if (!u || u.deletedAt) {
    return new UnauthorizedException({ error: 'account_gone', message: 'Conta não encontrada' });
  }
  return new ForbiddenException(
    blockedBody({
      status: u.accountStatus,
      until: u.suspendedUntil?.getTime() ?? null,
      reason: u.moderationReason,
    }),
  );
}

/** clientId do app (o DTO já limita a 64); vazio = sem idempotência */
const normClientId = (c: string | undefined | null): string | undefined =>
  c ? c.slice(0, 64) : undefined;

/** 429 no formato do resto da API ({error, message}) + retryAfter em segundos (null = não é questão de tempo) */
function tooMany(error: string, message: string, retryAfter: number | null): HttpException {
  return new HttpException({ error, message, retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
}

function cleanBody(body: string | undefined | null): string {
  const text = (body ?? '').trim();
  if (!text) throw new BadRequestException('Mensagem vazia');
  if (text.length > INBOX_LIMITS.messageBodyMax) {
    throw new BadRequestException(`Mensagem muito longa (máx ${INBOX_LIMITS.messageBodyMax})`);
  }
  return text;
}

const otherOf = (c: Pick<ConvCtx, 'userLowId' | 'userHighId'>, me: string) =>
  c.userLowId === me ? c.userHighId : c.userLowId;

@Injectable()
export class InboxService {
  private readonly gw: InboxGatewayPort;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    gateway: ChatGateway,
  ) {
    this.gw = gateway;
  }

  // =============================================================================================
  // Envio
  // =============================================================================================

  /**
   * POST /conversations: abre a conversa do par (ou reusa a que existe) e grava a 1ª mensagem, na mesma transação.
   * Pode abrir quem vê o cartão público da pessoa (visibility.ts) e tem a conta apta (ativa, fora de análise);
   * conversa que já existe segue as regras do envio.
   * Reenvio com um clientId já gravado por mim (por esta rota OU pela de mensagens) devolve a mesma mensagem.
   */
  async createConversation(
    me: string,
    toUserId: string,
    body: string,
    clientIdRaw?: string,
  ): Promise<CreateConversationResponse> {
    const text = cleanBody(body);
    if (toUserId === me) throw userNotFound();
    const clientId = normClientId(clientIdRaw);
    const [low, high] = pairOf(me, toUserId);

    // reenvio de algo que já foi gravado: antes de limites e regras (não gasta cota nem cai no teto de 3)
    if (clientId) {
      const prev = await this.findByClientId(this.prisma, me, clientId);
      if (prev) return this.replayCreate(this.prisma, me, toUserId, prev);
    }

    const existing = await this.prisma.conversation.findUnique({
      where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
      select: { id: true },
    });
    if (!existing) await this.assertCanStart(me, toUserId);
    await this.checkSendRate(me, toUserId);

    // teto de conversas NOVAS por dia (reusar a do par não conta)
    let countedNew = false;
    if (!existing) {
      const n = await this.redis.incrRate(me, 'conv:new', 86_400);
      countedNew = true;
      if (n > INBOX_LIMITS.newConversationsPerDay) {
        const retryAfter = await this.ttlOf(`rate:${me}:conv:new`, 86_400);
        await this.refund(me, 'conv:new');
        throw tooMany(
          'daily_limit',
          `Você já abriu ${INBOX_LIMITS.newConversationsPerDay} conversas novas hoje. Tenta de novo amanhã.`,
          retryAfter,
        );
      }
    }

    try {
      const out = await this.prisma.$transaction(async (tx) => {
        await lockPairTx(tx, me, toUserId);
        if (clientId) {
          // o mesmo clientId estava em voo (a trava do par esperou ele terminar): devolve o que ele gravou
          const prev = await this.findByClientId(tx, me, clientId);
          if (prev) {
            const result = await this.replayCreate(tx, me, toUserId, prev);
            return { created: false, replayed: true, events: [] as InboxEvent[], result };
          }
        }
        // uma conversa por par: dois POST simultâneos (ou os dois lados ao mesmo tempo) caem na mesma linha
        const inserted = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO conversations (user_low_id, user_high_id)
          VALUES (${low}::uuid, ${high}::uuid)
          ON CONFLICT (user_low_id, user_high_id) DO NOTHING
          RETURNING id::text AS id`;
        const created = inserted.length === 1;
        const conversationId = created
          ? inserted[0].id
          : (
              await tx.conversation.findUniqueOrThrow({
                where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
                select: { id: true },
              })
            ).id;
        if (created) {
          await tx.conversationMember.createMany({
            data: [
              { conversationId, userId: me, role: 'REQUESTER' },
              { conversationId, userId: toUserId, role: 'RECIPIENT' },
            ],
            skipDuplicates: true,
          });
        }
        const conv = await this.loadConv(tx, conversationId, true);
        if (!conv || !conv.members.some((m) => m.userId === me)) throw userNotFound();

        const sent = await this.appendMessage(
          tx,
          conv,
          me,
          { body: text, messageType: 'text', mediaUrl: null },
          { clientId, notFound: userNotFound, opening: created },
        );
        const events: InboxEvent[] = [];
        if (created) {
          // um emit por lado: pasta, peer e não lidas mudam por lado
          for (const m of conv.members) {
            const s = await this.summaryFor(tx, conversationId, m.userId);
            if (s) events.push(emitEvent(m.userId, 'conversation:new', { conversation: s }));
          }
        }
        events.push(...sent.events);
        const conversation = await this.summaryFor(tx, conversationId, me);
        if (!conversation) throw userNotFound();
        return {
          created,
          replayed: false,
          events,
          result: { conversation, message: sent.message },
        };
      }, TX_OPTIONS);

      if (countedNew && !out.created) await this.refund(me, 'conv:new'); // a outra requisição criou primeiro
      if (out.replayed) await this.refundSendRate(me, toUserId);
      this.flush(out.events);
      return out.result;
    } catch (e) {
      if (countedNew) await this.refund(me, 'conv:new');
      throw e;
    }
  }

  /** POST /conversations/:id/messages */
  async sendMessage(
    me: string,
    conversationId: string,
    body: string,
    clientId?: string,
  ): Promise<ChatMessageWithClientId> {
    const text = cleanBody(body);
    return this.send(
      me,
      conversationId,
      { body: text, messageType: 'text', mediaUrl: null },
      clientId,
    );
  }

  /** POST /conversations/:id/media: mídia ainda não passa pela moderação de fotos → desligada até ter */
  async sendMedia(
    me: string,
    conversationId: string,
    type: 'photo_temp' | 'audio' | 'gif',
    mediaUrl: string,
    clientId?: string,
  ): Promise<ChatMessageWithClientId> {
    if (process.env.CHAT_MEDIA_ENABLED !== 'true') {
      throw new ForbiddenException({
        error: 'media_disabled',
        message: 'Envio de mídia no chat ainda não está disponível',
      });
    }
    const mediaExpiresAt = type === 'photo_temp' ? new Date(Date.now() + 10_000) : null;
    return this.send(
      me,
      conversationId,
      { body: null, messageType: type, mediaUrl, mediaExpiresAt },
      clientId,
    );
  }

  private async send(
    me: string,
    conversationId: string,
    input: NewMessage,
    clientIdRaw?: string,
  ): Promise<ChatMessageWithClientId> {
    const clientId = normClientId(clientIdRaw);
    const pre = await this.loadConv(this.prisma, conversationId);
    if (!pre || !pre.members.some((m) => m.userId === me)) throw conversationNotFound();
    const peerId = otherOf(pre, me);

    // reenvio (timeout/queda depois do commit, ou a 1ª mensagem que saiu pelo POST /conversations): a mesma mensagem
    if (clientId) {
      const prev = await this.findByClientId(this.prisma, me, clientId);
      if (prev) return this.replayInConversation(this.prisma, me, peerId, conversationId, prev);
    }

    await this.checkSendRate(me, peerId);
    const out = await this.prisma.$transaction(async (tx) => {
      await lockPairTx(tx, me, peerId);
      const conv = await this.loadConv(tx, conversationId, true); // de novo, dentro da trava (promoção/unread frescos)
      if (!conv) throw conversationNotFound();
      if (clientId) {
        // o mesmo clientId estava em voo (a trava do par esperou ele terminar): devolve o que ele gravou
        const prev = await this.findByClientId(tx, me, clientId);
        if (prev) {
          return {
            replay: await this.replayInConversation(tx, me, peerId, conversationId, prev),
          };
        }
      }
      return this.appendMessage(tx, conv, me, input, { clientId });
    }, TX_OPTIONS);
    if ('replay' in out) {
      await this.refundSendRate(me, peerId);
      return out.replay;
    }
    this.flush(out.events);
    return out.message;
  }

  /**
   * Grava UMA mensagem de gente e reavalia a pasta na mesma transação (chamar com a trava do par).
   * - quem envia: conta apagada/fora de 'active' → o erro do JwtAuthGuard; em análise → só responde (senderDenied)
   * - Block (qualquer sentido) ou a outra ponta apagada/fora de 'active' → 404
   * - REQUESTER sem resposta: no máximo INBOX_LIMITS.requesterMessagesBeforeReply → 429 awaiting_reply
   * - soma 1 nas não lidas do outro; quem estava arquivado volta a ver a conversa
   * - promoção idempotente (applyPromotion): bounce ou curtida mútua que ainda não tinha virado principal
   * - clientId gravado na mensagem (UNIQUE por remetente): é ele que faz o reenvio devolver a mesma mensagem
   */
  private async appendMessage(
    tx: Tx,
    conv: ConvCtx,
    senderId: string,
    input: NewMessage,
    opts: {
      clientId?: string;
      notFound?: () => NotFoundException;
      /** a transação acabou de criar a conversa (abrir conversa nova) */
      opening?: boolean;
    } = {},
  ): Promise<{ message: ChatMessageWithClientId; events: InboxEvent[] }> {
    const notFound = opts.notFound ?? conversationNotFound;
    const me = conv.members.find((m) => m.userId === senderId);
    const peer = conv.members.find((m) => m.userId !== senderId);
    if (!me || !peer) throw notFound();
    const sender = await this.assertPairOpen(tx, senderId, peer.userId, notFound);

    const { facts } = await this.loadFacts(tx, conv);
    if (senderDenied(sender, sendIntent(me.role, facts, opts.opening === true)) === 'hold') {
      // em análise, sem revelar a análise: abrir conversa nova dá o 404 de alvo indisponível; insistir numa
      // solicitação sem resposta dá o 429 de quem já esgotou as mensagens antes da resposta
      if (opts.opening) throw notFound();
      throw tooMany('awaiting_reply', 'Agora é esperar a resposta.', null);
    }
    if (me.role === 'REQUESTER' && !canRequesterSend(facts)) {
      throw tooMany(
        'awaiting_reply',
        `Você já mandou ${ROUTING.REQUESTER_MAX_BEFORE_REPLY} mensagens. Agora é esperar a resposta.`,
        null,
      );
    }

    const now = new Date();
    const row = await insertMessage(tx, {
      conversationId: conv.id,
      senderId,
      body: input.body,
      messageType: input.messageType,
      mediaUrl: input.mediaUrl,
      mediaExpiresAt: input.mediaExpiresAt ?? null,
      createdAt: now,
      clientId: opts.clientId ?? null,
    });
    // só colide com o mesmo clientId gravado AGORA por mim noutra conversa (a do par já foi conferida na trava)
    if (!row) throw clientIdConflict();
    await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now } });
    const peerRow = await tx.conversationMember.update({
      where: { conversationId_userId: { conversationId: conv.id, userId: peer.userId } },
      data: { unreadCount: { increment: 1 }, archivedAt: null },
      select: { unreadCount: true },
    });
    if (me.archivedAt) {
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: conv.id, userId: senderId } },
        data: { archivedAt: null },
      });
    }

    // clientId só volta pra quem enviou (reconciliação da mensagem otimista no app)
    const mine = toChatMessage(row, senderId);
    const events: InboxEvent[] = [
      emitEvent(senderId, 'message:new', {
        conversationId: conv.id,
        message: mine,
        unreadCount: me.unreadCount,
      }),
      emitEvent(peer.userId, 'message:new', {
        conversationId: conv.id,
        message: toChatMessage(row),
        unreadCount: peerRow.unreadCount,
      }),
    ];

    const iAmA = me.role === 'REQUESTER';
    const after: ConversationFacts = {
      ...facts,
      messageCount: facts.messageCount + 1,
      messagesFromA: facts.messagesFromA + (iAmA ? 1 : 0),
      messagesFromB: facts.messagesFromB + (iAmA ? 0 : 1),
    };
    events.push(...(await this.applyPromotion(tx, conv, after, senderId, now)));

    // arquivada (por mim ou pelo outro) volta a aparecer com a mensagem nova
    for (const m of [me, peer]) {
      if (!m.archivedAt) continue;
      const s = await this.summaryFor(tx, conv.id, m.userId);
      if (s) events.push(emitEvent(m.userId, 'conversation:new', { conversation: s }));
    }
    return { message: mine, events };
  }

  // =============================================================================================
  // Promoção (principal)
  // =============================================================================================

  /**
   * Aplica o plano de routing.planReevaluation. Idempotente: `updateMany where promotedAt null` só muda uma vez; só
   * com count === 1 grava a mensagem de sistema e agenda 'conversation:promoted' (reavaliar de novo = nenhum efeito).
   */
  private async applyPromotion(
    tx: Tx,
    conv: ConvCtx,
    facts: ConversationFacts,
    actorId: string,
    after: Date,
  ): Promise<InboxEvent[]> {
    const plan = planReevaluation(facts);
    if (!plan.promote) return [];
    // depois da mensagem que disparou (a de sistema aparece depois dela na conversa)
    const at = new Date(Math.max(Date.now(), after.getTime() + 1));
    const { count } = await tx.conversation.updateMany({
      where: { id: conv.id, promotedAt: null },
      data: { promotedAt: at, promotedReason: plan.promote },
    });
    if (count !== 1) return [];

    const ids = conv.members.map((m) => m.userId);
    const events: InboxEvent[] = [
      emitEvent(ids, 'conversation:promoted', {
        conversationId: conv.id,
        reason: plan.promote,
        promotedAt: at.toISOString(),
      }),
    ];
    if (plan.systemMessage) {
      // remetente da mensagem de sistema = quem disparou (a curtida que fechou o par); não soma não lidas
      const sys = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: actorId,
          messageType: 'system',
          systemKind: plan.systemMessage,
          body: MUTUAL_LIKE_TEXT,
          createdAt: at,
        },
        select: MESSAGE_SELECT,
      });
      await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: at } });
      const members = await tx.conversationMember.findMany({
        where: { conversationId: conv.id },
        select: { userId: true, unreadCount: true },
      });
      const message = toChatMessage(sys);
      for (const m of members) {
        events.push(
          emitEvent(m.userId, 'message:new', {
            conversationId: conv.id,
            message,
            unreadCount: m.unreadCount,
          }),
        );
      }
    }
    return events;
  }

  /**
   * Curtida mútua acabou de acontecer (chamado pelo LikesService DENTRO da transação da curtida, já com a trava do par):
   * promove a conversa do par (se existir e ainda não estiver na principal) + mensagem de sistema. Não cria conversa.
   */
  async onMutualLike(
    tx: Tx,
    likerId: string,
    likedId: string,
  ): Promise<{ promotedConversationIds: string[]; events: InboxEvent[] }> {
    const [low, high] = pairOf(likerId, likedId);
    const found = await tx.conversation.findUnique({
      where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
      select: { id: true },
    });
    const conv = found ? await this.loadConv(tx, found.id, true) : null;
    if (!conv || conv.promotedAt) return { promotedConversationIds: [], events: [] };
    const { facts } = await this.loadFacts(tx, conv);
    const events = await this.applyPromotion(tx, conv, facts, likerId, new Date());
    return { promotedConversationIds: events.length ? [conv.id] : [], events };
  }

  /** reavalia a pasta de uma conversa (operação/testes); idempotente — rodar de novo não gera efeito */
  async reevaluate(conversationId: string, actorId?: string): Promise<{ promoted: boolean }> {
    const pre = await this.loadConv(this.prisma, conversationId);
    if (!pre) throw conversationNotFound();
    const events = await this.prisma.$transaction(async (tx) => {
      await lockPairTx(tx, pre.userLowId, pre.userHighId);
      const conv = await this.loadConv(tx, conversationId, true);
      if (!conv) throw conversationNotFound();
      const { facts, lastLikerId } = await this.loadFacts(tx, conv);
      const actor = actorId ?? lastLikerId ?? conv.members[0]?.userId ?? conv.userLowId;
      return this.applyPromotion(tx, conv, facts, actor, new Date());
    }, TX_OPTIONS);
    this.flush(events);
    return {
      promoted: events.some((e) => e.kind === 'emit' && e.event === 'conversation:promoted'),
    };
  }

  /** POST /inbox/requests/:id/promote: "Mover para principal". Só o RECIPIENT; idempotente (200 mesmo já promovida) */
  async promoteManual(me: string, conversationId: string): Promise<ConversationSummary> {
    const pre = await this.loadConv(this.prisma, conversationId);
    if (!pre || !pre.members.some((m) => m.userId === me)) throw conversationNotFound();
    const peerId = otherOf(pre, me);

    const out = await this.prisma.$transaction(async (tx) => {
      await lockPairTx(tx, me, peerId);
      const conv = await this.loadConv(tx, conversationId, true);
      const mine = conv?.members.find((m) => m.userId === me);
      if (!conv || !mine) throw conversationNotFound();
      await this.assertPairOpen(tx, me, peerId);
      if (mine.role !== 'RECIPIENT') {
        throw new ForbiddenException({
          error: 'not_recipient',
          message: 'Só quem recebeu a solicitação pode mover pra principal',
        });
      }
      const events: InboxEvent[] = [];
      if (!conv.promotedAt) {
        const at = new Date();
        const { count } = await tx.conversation.updateMany({
          where: { id: conv.id, promotedAt: null },
          data: { promotedAt: at, promotedReason: 'manual' },
        });
        if (count === 1) {
          events.push(
            emitEvent(
              conv.members.map((m) => m.userId),
              'conversation:promoted',
              {
                conversationId: conv.id,
                reason: 'manual',
                promotedAt: at.toISOString(),
              },
            ),
          );
        }
      }
      const summary = await this.summaryFor(tx, conv.id, me);
      if (!summary) throw conversationNotFound();
      return { summary, events };
    }, TX_OPTIONS);
    this.flush(out.events);
    return out.summary;
  }

  // =============================================================================================
  // Leitura
  // =============================================================================================

  /** GET /inbox (principal) e GET /inbox/requests (solicitações recebidas), por cursor (last_message_at desc) */
  async list(
    me: string,
    folder: InboxFolder,
    cursorRaw?: string,
    limitRaw?: number,
  ): Promise<InboxListResponse> {
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    if (cursorRaw && !cursor) throw new BadRequestException('Cursor inválido');
    const limit = Math.min(Math.max(Math.trunc(limitRaw || LIST_DEFAULT), 1), LIST_MAX);
    const rows = await summaryRows(this.prisma, { viewerId: me, folder, cursor, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodeCursor({ at: last.sort_key, id: last.id }) : null;
    const now = new Date();
    return {
      items: page.map((r) => toSummary(r, now)),
      nextCursor,
      counts: await inboxCounts(this.prisma, me),
    };
  }

  /** GET /inbox/counts: badges da aba Mensagens */
  counts(me: string): Promise<InboxCounts> {
    return inboxCounts(this.prisma, me);
  }

  /** GET /conversations/:id (inclusive arquivada por mim; bloqueio/conta fora = 404) */
  async getConversation(me: string, conversationId: string): Promise<ConversationDetail> {
    const [row] = await summaryRows(this.prisma, {
      viewerId: me,
      conversationId,
      includeArchived: true,
    });
    if (!row) throw conversationNotFound();
    const summary = toSummary(row);
    const facts = factsFromRow(row);
    let requestMessagesLeft = summary.awaitingReply
      ? Math.max(0, INBOX_LIMITS.requesterMessagesBeforeReply - facts.messagesFromA)
      : null;
    if (requestMessagesLeft) {
      // em análise não insiste na solicitação que abriu (senderDenied): o app já mostra "esperando resposta"
      const u = await this.prisma.user.findUnique({
        where: { id: me },
        select: { reviewHoldAt: true },
      });
      if (u?.reviewHoldAt) requestMessagesLeft = 0;
    }
    return {
      ...summary,
      createdAt: row.created_at.toISOString(),
      archivedAt: row.archived_at?.toISOString() ?? null,
      requestMessagesLeft,
    };
  }

  /** GET /conversations/with/:userId: a conversa do par pro cartão e pro mapa (arquivada por mim = null, como no /nearby) */
  async lookupWith(me: string, userId: string): Promise<ConversationRef | null> {
    if (userId === me) return null;
    const [low, high] = pairOf(me, userId);
    const conv = await this.prisma.conversation.findUnique({
      where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
      select: { id: true },
    });
    if (!conv) return null;
    const [row] = await summaryRows(this.prisma, { viewerId: me, conversationId: conv.id });
    return row ? { id: row.id, folder: folderFor(row.my_role, routeOf(row.promoted_at)) } : null;
  }

  /**
   * GET /conversations/:id/messages?limit≤100&before (id de mensagem ou instante ISO), em ordem crescente.
   * As MINHAS mensagens trazem o clientId: o app casa o balão que falhou com a mensagem que já foi gravada.
   */
  async listMessages(
    me: string,
    conversationId: string,
    limitRaw?: number,
    before?: string,
  ): Promise<ChatMessage[]> {
    const conv = await this.loadConv(this.prisma, conversationId);
    if (!conv || !conv.members.some((m) => m.userId === me)) throw conversationNotFound();
    await this.assertPairOpen(this.prisma, me, otherOf(conv, me), conversationNotFound);
    const limit = Math.min(Math.max(Math.trunc(limitRaw || 50), 1), INBOX_LIMITS.historyPageMax);
    let beforeId: string | undefined;
    let beforeAt: Date | undefined;
    if (before) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before))
        beforeId = before;
      else {
        beforeAt = new Date(before);
        if (Number.isNaN(beforeAt.getTime())) throw new BadRequestException('before inválido');
      }
    }
    const rows = await messagesPage(this.prisma, conversationId, { limit, beforeId, beforeAt });
    return rows.map((m) => toChatMessage(m, me));
  }

  // =============================================================================================
  // Lida, silenciar, arquivar
  // =============================================================================================

  /**
   * POST /conversations/:id/read. Zera (ou recalcula até upToMessageId) as MINHAS não lidas e, se permitido, grava
   * readAt nas mensagens do outro e avisa os dois ('message:read'). Quem RECEBEU a solicitação não dispara "lida"
   * antes de aceitar (mover ou responder): o badge dele zera, mas o outro lado não fica sabendo.
   */
  async markRead(
    me: string,
    conversationId: string,
    upToMessageId?: string,
  ): Promise<{ unreadCount: number; readAt: string | null }> {
    const pre = await this.loadConv(this.prisma, conversationId);
    if (!pre || !pre.members.some((m) => m.userId === me)) throw conversationNotFound();
    const peerId = otherOf(pre, me);

    const out = await this.prisma.$transaction(async (tx) => {
      // mesma trava do envio: a recontagem não perde uma mensagem que chega no meio
      await lockPairTx(tx, me, peerId);
      const conv = await this.loadConv(tx, conversationId, true);
      const mine = conv?.members.find((m) => m.userId === me);
      if (!conv || !mine) throw conversationNotFound();
      await this.assertPairOpen(tx, me, peerId, conversationNotFound);
      if (upToMessageId) {
        const ok = await tx.message.findFirst({
          where: { id: upToMessageId, conversationId },
          select: { id: true },
        });
        if (!ok) throw new NotFoundException('Mensagem não encontrada');
      }
      const upTo = upToMessageId ?? null;
      const allowed = marksReadAllowed(mine.role, routeOf(conv.promotedAt));
      const readAt = new Date();
      const changed = allowed
        ? await markMessagesRead(tx, conversationId, peerId, readAt, upTo)
        : 0;
      const unreadCount = await unreadAfter(tx, conversationId, peerId, upTo);
      if (unreadCount !== mine.unreadCount) {
        await tx.conversationMember.update({
          where: { conversationId_userId: { conversationId, userId: me } },
          data: { unreadCount },
        });
      }
      const events: InboxEvent[] = [];
      if (changed > 0 || unreadCount !== mine.unreadCount) {
        const payload = {
          conversationId,
          readerId: me,
          upToMessageId: upTo,
          readAt: readAt.toISOString(),
        };
        // permitido: os dois (recibo pro outro + badge dos meus outros aparelhos); senão só os meus aparelhos
        events.push(emitEvent(allowed ? [me, peerId] : [me], 'message:read', payload));
      }
      return { events, unreadCount, readAt: allowed ? readAt.toISOString() : null };
    }, TX_OPTIONS);
    this.flush(out.events);
    return { unreadCount: out.unreadCount, readAt: out.readAt };
  }

  /** PATCH /conversations/:id {isMuted?, archived?} ("Arquivar conversa" substitui o "desfazer match") */
  async updateConversation(
    me: string,
    conversationId: string,
    dto: { isMuted?: boolean; archived?: boolean },
  ): Promise<ConversationDetail> {
    const current = await this.getConversation(me, conversationId); // 404 uniforme (inclusive bloqueio)
    const wasArchived = current.archivedAt != null;
    const data: Prisma.ConversationMemberUpdateInput = {};
    if (dto.isMuted !== undefined) data.isMuted = dto.isMuted;
    if (dto.archived === true && !wasArchived) data.archivedAt = new Date();
    if (dto.archived === false && wasArchived) data.archivedAt = null;
    if (Object.keys(data).length > 0) {
      await this.prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId: me } },
        data,
      });
    }
    const detail = await this.getConversation(me, conversationId);
    const events: InboxEvent[] = [];
    if (dto.archived === true && !wasArchived) {
      // some da lista nos meus outros aparelhos e o "digitando" deste chat para
      events.push(
        emitEvent(me, 'conversation:removed', { conversationId }),
        leaveEvent(conversationId, [me]),
      );
    } else if (dto.archived === false && wasArchived) {
      const summary = await this.summaryFor(this.prisma, conversationId, me);
      if (summary) events.push(emitEvent(me, 'conversation:new', { conversation: summary }));
    }
    this.flush(events);
    return detail;
  }

  // =============================================================================================
  // Infra compartilhada
  // =============================================================================================

  /** trava do par para quem compõe a própria transação (LikesService) */
  lockPair(tx: Tx, a: string, b: string): Promise<void> {
    return lockPairTx(tx, a, b);
  }

  /** envia os eventos de uma transação JÁ confirmada */
  flush(events: readonly InboxEvent[]): void {
    flushInboxEvents(this.gw, events);
  }

  private async summaryFor(
    db: Tx,
    conversationId: string,
    viewerId: string,
  ): Promise<ConversationSummary | null> {
    const [row] = await summaryRows(db, { viewerId, conversationId, includeArchived: true });
    return row ? toSummary(row) : null;
  }

  /**
   * Conversa + membros. forUpdate (dentro da transação): trava a LINHA da conversa antes de qualquer decisão — o
   * BlocksService trava a mesma linha (FOR UPDATE), então bloqueio e mensagem nunca se cruzam: ou o bloqueio espera o
   * envio terminar (e zera/arquiva depois), ou o envio espera o bloqueio e enxerga o Block (404).
   */
  private async loadConv(
    db: Tx,
    conversationId: string,
    forUpdate = false,
  ): Promise<ConvCtx | null> {
    if (forUpdate) {
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
      if (locked.length === 0) return null;
    }
    const c = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        userLowId: true,
        userHighId: true,
        promotedAt: true,
        members: { select: { userId: true, role: true, unreadCount: true, archivedAt: true } },
      },
    });
    return c
      ? { ...c, members: c.members.map((m) => ({ ...m, role: m.role as MemberRole })) }
      : null;
  }

  /**
   * Fatos do par pra routing.ts (A = REQUESTER, B = RECIPIENT; só mensagens de gente). Conversa já promovida não
   * precisa contar nada: a promoção é permanente e o plano é NOOP.
   */
  private async loadFacts(
    tx: Tx,
    conv: ConvCtx,
  ): Promise<{ facts: ConversationFacts; lastLikerId: string | null }> {
    const zero = {
      likeAB: false,
      likeBA: false,
      messageCount: 0,
      messagesFromA: 0,
      messagesFromB: 0,
    };
    if (conv.promotedAt)
      return { facts: { ...zero, promotedAt: conv.promotedAt }, lastLikerId: null };
    const a = conv.members.find((m) => m.role === 'REQUESTER')?.userId ?? conv.userLowId;
    const b = conv.members.find((m) => m.role === 'RECIPIENT')?.userId ?? otherOf(conv, a);
    const likes = await tx.like.findMany({
      where: {
        OR: [
          { likerId: a, likedId: b },
          { likerId: b, likedId: a },
        ],
      },
      select: { likerId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const counts = await tx.message.groupBy({
      by: ['senderId'],
      where: { conversationId: conv.id, systemKind: null },
      _count: { _all: true },
    });
    const fromA = counts.find((c) => c.senderId === a)?._count._all ?? 0;
    const fromB = counts.find((c) => c.senderId === b)?._count._all ?? 0;
    return {
      facts: {
        likeAB: likes.some((l) => l.likerId === a),
        likeBA: likes.some((l) => l.likerId === b),
        messageCount: fromA + fromB,
        messagesFromA: fromA,
        messagesFromB: fromB,
        promotedAt: null,
      },
      lastLikerId: likes[0]?.likerId ?? null,
    };
  }

  /**
   * abrir conversa NOVA: a mesma visibilidade do cartão público + Block em qualquer sentido → 404 idêntico.
   * Quem abre também: conta fora do ar → erro do guard; em análise → o mesmo 404 (não revela a análise). Conferência
   * antecipada (não gasta a cota diária); a definitiva é a do appendMessage, dentro da trava do par.
   */
  private async assertCanStart(me: string, targetId: string): Promise<void> {
    const sender = await this.prisma.user.findUnique({ where: { id: me }, select: ACCOUNT_SELECT });
    const denied = senderDenied(sender, 'start');
    if (denied === 'account') throw senderAccountError(sender);
    if (denied === 'hold') throw userNotFound();
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: me, blockedId: targetId },
          { blockerId: targetId, blockedId: me },
        ],
      },
      select: { id: true },
    });
    if (blocked) throw userNotFound();
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: CARD_TARGET_SELECT,
    });
    if (!cardVisible(target)) throw userNotFound();
  }

  /**
   * Conversa que já existe, com as linhas FRESCAS (dentro da trava do par quando há transação):
   * - quem age (me) com conta apagada/fora de 'active' → o erro do JwtAuthGuard. O guard lê um cache, e um envio pode
   *   ter esperado a trava do par enquanto o ban era gravado: sem isto, o banido desarquivava as conversas que a
   *   moderação acabou de arquivar e mandava message:new às vítimas
   * - Block (qualquer sentido) ou a outra ponta apagada/fora de 'active' → notFound
   * Devolve a conta de quem age (a regra de quem está em análise depende do que a mensagem faz: senderDenied).
   */
  private async assertPairOpen(
    db: Tx,
    me: string,
    peerId: string,
    notFound = conversationNotFound,
  ): Promise<AccountRow> {
    const users = await db.user.findMany({
      where: { id: { in: [me, peerId] } },
      select: ACCOUNT_SELECT,
    });
    const sender = users.find((u) => u.id === me);
    if (!sender || senderDenied(sender, 'reply')) throw senderAccountError(sender);
    const blocked = await db.block.findFirst({
      where: {
        OR: [
          { blockerId: me, blockedId: peerId },
          { blockerId: peerId, blockedId: me },
        ],
      },
      select: { id: true },
    });
    if (blocked) throw notFound();
    if (!peerReachable(users.find((u) => u.id === peerId))) throw notFound();
    return sender;
  }

  /** por remetente (30/min, todas as conversas) e por par (15/min) — além do @Throttle da rota */
  private async checkSendRate(me: string, peerId: string): Promise<void> {
    const perSender = await this.redis.incrRate(me, 'msg', 60);
    if (perSender > INBOX_LIMITS.perSenderPerMinute) {
      throw tooMany(
        'rate_limited',
        'Calma aí: muitas mensagens em pouco tempo.',
        await this.ttlOf(`rate:${me}:msg`, 60),
      );
    }
    const perPair = await this.redis.incrRate(me, `msg:to:${peerId}`, 60);
    if (perPair > INBOX_LIMITS.perPairPerMinute) {
      throw tooMany(
        'rate_limited',
        'Calma aí: muitas mensagens seguidas pra essa pessoa.',
        await this.ttlOf(`rate:${me}:msg:to:${peerId}`, 60),
      );
    }
  }

  private async ttlOf(key: string, fallback: number): Promise<number> {
    const t = await this.redis.client.ttl(key);
    return t > 0 ? t : fallback;
  }

  private async refund(me: string, action: string): Promise<void> {
    await this.redis.client.decr(`rate:${me}:${action}`).catch(() => undefined);
  }

  /** o reenvio que chegou depois da 1ª tentativa em voo gastou cota à toa: devolve (por remetente e por par) */
  private async refundSendRate(me: string, peerId: string): Promise<void> {
    await this.refund(me, 'msg');
    await this.refund(me, `msg:to:${peerId}`);
  }

  // ---- idempotência do reenvio ----
  // O app reusa o clientId quando o POST falha ou estoura o tempo. A chave é UMA por remetente, gravada na própria
  // mensagem (UNIQUE(sender_id, client_id)), e vale nas duas rotas: a 1ª mensagem que saiu pelo POST /conversations e
  // é reenviada pelo POST /conversations/:id/messages (o app descobriu a conversa pelo socket) não duplica. Sem prazo;
  // se a 1ª tentativa falhou (rollback), nada foi gravado e o reenvio grava normalmente.

  private findByClientId(db: Tx, senderId: string, clientId: string) {
    return db.message.findUnique({
      where: { senderId_clientId: { senderId, clientId } },
      select: MESSAGE_SELECT,
    });
  }

  /**
   * Reenvio pelo POST /conversations/:id/messages: a mensagem já gravada só vale se for DESTA conversa; o par tem que
   * continuar aberto (bloqueio/conta fora = 404, como qualquer envio). Nada é gravado nem emitido de novo.
   */
  private async replayInConversation(
    db: Tx,
    me: string,
    peerId: string,
    conversationId: string,
    prev: MessageRow,
  ): Promise<ChatMessageWithClientId> {
    if (prev.conversationId !== conversationId) throw clientIdConflict();
    await this.assertPairOpen(db, me, peerId, conversationNotFound);
    return toChatMessage(prev, me);
  }

  /**
   * Reenvio pelo POST /conversations: a mensagem já gravada tem que ser do MESMO par (me, toUserId). Resumo
   * indisponível (bloqueio, conta da outra ponta fora) = 404, nunca um 409 preso até a chave vencer.
   */
  private async replayCreate(
    db: Tx,
    me: string,
    toUserId: string,
    prev: MessageRow,
  ): Promise<CreateConversationResponse> {
    const [low, high] = pairOf(me, toUserId);
    const conv = await db.conversation.findUnique({
      where: { id: prev.conversationId },
      select: { userLowId: true, userHighId: true },
    });
    if (!conv) throw userNotFound();
    if (conv.userLowId !== low || conv.userHighId !== high) throw clientIdConflict();
    await this.assertPairOpen(db, me, toUserId, userNotFound);
    const conversation = await this.summaryFor(db, prev.conversationId, me);
    if (!conversation) throw userNotFound();
    return { conversation, message: toChatMessage(prev, me) };
  }
}
