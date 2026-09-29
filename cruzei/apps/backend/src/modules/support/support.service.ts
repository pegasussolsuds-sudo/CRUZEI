import {
  SUPPORT_EVENTS,
  SUPPORT_LIMITS,
  type PremiumTier,
  type SupportMessage,
  type SupportMessageEvent,
  type SupportSendResult,
  type SupportThreadDetail,
  type SupportThreadEvent,
  type SupportThreadList,
  type SupportThreadResponse,
  type SupportThreadStatus,
  type SupportThreadSummary,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { effectiveTier } from '../../common/premium';
import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { RedisService } from '../../redis/redis.service';
import { cursorTs, decodeCursor, encodeCursor, pageSize } from '../admin/cursor';
import { NotifyService } from '../notifications/notify.service';

import {
  CLOSING_TEXT,
  messageForStaff,
  messageForUser,
  messagesForUser,
  normClientId,
  threadForUser,
  welcomeText,
  type SupportMessageRow,
  type SupportThreadRow,
} from './support.mapper';

type Tx = Prisma.TransactionClient;

interface ThreadDb {
  id: string;
  user_id: string;
  status: string;
  assigned_to: string | null;
  created_at: Date;
  last_message_at: Date;
  user_unread: number;
  staff_unread: number;
  first_response_at: Date | null;
  rating: number | null;
}

const toThreadRow = (t: ThreadDb): SupportThreadRow => ({
  id: t.id,
  userId: t.user_id,
  status: t.status,
  createdAt: t.created_at,
  lastMessageAt: t.last_message_at,
  userUnread: t.user_unread,
  rating: t.rating,
});

const MSG_SELECT = {
  id: true,
  threadId: true,
  senderId: true,
  author: true,
  body: true,
  internal: true,
  clientId: true,
  createdAt: true,
} as const;

/** notificação da resposta: prévia curta do texto */
const preview = (body: string) => (body.length > 140 ? `${body.slice(0, 137)}…` : body);

/**
 * Suporte ao vivo. Um atendimento não resolvido por pessoa (índice único parcial); mensagens em tempo real pelo socket:
 * 'support:message' vai pra user:<id> SEM nota interna e pra sala staff:support com tudo; 'support:thread' avisa a
 * fila. Resposta pública da equipe vira aviso 'support_reply' + push. Eventos sempre DEPOIS do commit.
 */
@Injectable()
export class SupportService {
  private readonly log = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ChatGateway,
    private readonly notify: NotifyService,
  ) {}

  // =============================================================================================
  // lado do app
  // =============================================================================================

  /** atendimento atual (ou o último encerrado) + mensagens sem as internas */
  async threadForApp(userId: string): Promise<SupportThreadResponse> {
    const t = await this.currentOrLast(this.prisma, userId);
    if (!t) return { thread: null, messages: [] };
    const rows = await this.prisma.supportMessage.findMany({
      where: { threadId: t.id, internal: false },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 300,
      select: MSG_SELECT,
    });
    return {
      thread: threadForUser(toThreadRow(t)),
      messages: messagesForUser(rows.reverse(), userId),
    };
  }

  async sendFromUser(
    userId: string,
    rawBody: string,
    rawClientId?: string,
  ): Promise<SupportSendResult> {
    const body = this.cleanBody(rawBody);
    const clientId = normClientId(rawClientId);
    if (clientId) {
      const replay = await this.replayForUser(userId, clientId);
      if (replay) return replay;
    }
    // 10 por minuto (janela fixa no Redis, vale entre processos); o reenvio acima não gasta cota
    if ((await this.redis.incrRate(userId, 'support_msg', 60)) > SUPPORT_LIMITS.userPerMinute) {
      throw new HttpException(
        { error: 'rate_limited', message: 'Calma aí: espera um minutinho pra mandar mais' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const out = await this.prisma.$transaction(async (tx) => {
      let created = false;
      let t = await this.lockOpen(tx, userId);
      if (!t) {
        // o índice único parcial segura a corrida: duas primeiras mensagens ao mesmo tempo abrem UM atendimento
        const ins = await tx.$queryRaw<ThreadDb[]>`
          INSERT INTO support_threads (user_id, status) VALUES (${userId}::uuid, 'open')
          ON CONFLICT (user_id) WHERE status <> 'resolved' DO NOTHING
          RETURNING *`;
        if (ins[0]) {
          t = ins[0];
          created = true;
        } else t = await this.lockOpen(tx, userId);
      }
      if (!t) throw new ConflictException({ error: 'thread_busy', message: 'Tente de novo' });
      const msg = await this.insertMessage(tx, t.id, userId, 'user', body, false, clientId);
      if (!msg) return { replay: true as const };
      // boas-vindas com o prazo: só no atendimento novo, logo depois da mensagem da pessoa
      const welcome = created
        ? await this.insertMessage(tx, t.id, null, 'system', welcomeText(), false, null)
        : null;
      const [thread] = await tx.$queryRaw<ThreadDb[]>`
        UPDATE support_threads
           SET status = 'open', last_message_at = now(), updated_at = now(), staff_unread = staff_unread + 1,
               user_unread = user_unread + ${welcome ? 1 : 0}::int
         WHERE id = ${t.id}::uuid RETURNING *`;
      return { replay: false as const, thread, msg, welcome };
    });
    if (out.replay) {
      // o mesmo clientId chegou em paralelo: devolve o que o outro gravou
      const again = clientId ? await this.replayForUser(userId, clientId) : null;
      if (again) return again;
      throw new ConflictException({ error: 'duplicate', message: 'Mensagem repetida' });
    }
    const message = messageForUser(out.msg, userId)!;
    const welcome = out.welcome ? messageForUser(out.welcome, userId) : null;
    // depois do commit: a própria pessoa (outros aparelhos) e a equipe
    await this.emitMessage(out.thread.user_id, out.msg);
    if (out.welcome) await this.emitMessage(out.thread.user_id, out.welcome);
    await this.emitThread(out.thread.id);
    return { thread: threadForUser(toThreadRow(out.thread)), message, welcome };
  }

  async readByUser(userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE support_threads SET user_unread = 0 WHERE user_id = ${userId}::uuid AND user_unread > 0`;
  }

  /** nota (1 a 5) do atendimento atual ou do último encerrado */
  async rate(userId: string, rating: number): Promise<{ ok: true }> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException({ error: 'invalid_rating', message: 'Nota de 1 a 5' });
    }
    const t = await this.currentOrLast(this.prisma, userId);
    if (!t) throw new NotFoundException({ error: 'not_found', message: 'Nenhum atendimento' });
    await this.prisma.supportThread.update({ where: { id: t.id }, data: { rating } });
    await this.emitThread(t.id);
    return { ok: true };
  }

  private async replayForUser(userId: string, clientId: string): Promise<SupportSendResult | null> {
    const prev = await this.prisma.supportMessage.findFirst({
      where: { senderId: userId, clientId },
      select: MSG_SELECT,
    });
    if (!prev || prev.author !== 'user') return null;
    const t = await this.prisma.$queryRaw<
      ThreadDb[]
    >`SELECT * FROM support_threads WHERE id = ${prev.threadId}::uuid`;
    if (!t[0]) return null;
    return {
      thread: threadForUser(toThreadRow(t[0])),
      message: messageForUser(prev, userId)!,
      welcome: null,
    };
  }

  // =============================================================================================
  // lado da equipe
  // =============================================================================================

  async listThreads(
    staff: AuthenticatedUser,
    q: { status?: string; mine?: string; cursor?: string; limit?: unknown },
  ): Promise<SupportThreadList> {
    const limit = pageSize(q.limit, 30, 100);
    const where: Prisma.Sql[] = [];
    if (q.status === 'open' || q.status === 'pending' || q.status === 'resolved')
      where.push(Prisma.sql`t.status = ${q.status}`);
    else if (q.status !== 'all') where.push(Prisma.sql`t.status <> 'resolved'`);
    if (q.mine === '1' || q.mine === 'true')
      where.push(Prisma.sql`t.assigned_to = ${staff.id}::uuid`);
    const cur = decodeCursor(q.cursor, 2);
    if (cur)
      where.push(
        Prisma.sql`(t.last_message_at, t.id) < ((${cursorTs(cur[0])}::timestamp AT TIME ZONE 'UTC'), ${cur[1]}::uuid)`,
      );
    const rows = await this.summaryRows(where, limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.summaryOf(r)),
      nextCursor: rows.length > limit && last ? encodeCursor([last.cursor_at, last.id]) : null,
    };
  }

  async threadDetail(staff: AuthenticatedUser, id: string): Promise<SupportThreadDetail> {
    const s = await this.summary(id);
    const [rows, ctx] = await Promise.all([
      this.prisma.supportMessage.findMany({
        where: { threadId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1000,
        select: MSG_SELECT,
      }),
      this.prisma.$queryRaw<
        {
          created_at: Date;
          last_active_at: Date | null;
          reports: number;
          premium_expires_at: Date | null;
          app_version: string | null;
          past: number;
        }[]
      >`
        SELECT u.created_at, u.last_active_at, u.premium_expires_at,
               (SELECT count(*) FROM reports r WHERE r.reported_id = u.id)::int AS reports,
               (SELECT d.app_version FROM device_tokens d WHERE d.user_id = u.id ORDER BY d.last_used_at DESC LIMIT 1) AS app_version,
               (SELECT count(*) FROM support_threads o WHERE o.user_id = u.id AND o.id <> ${id}::uuid)::int AS past
          FROM users u WHERE u.id = ${s.user.id}::uuid`,
    ]);
    const names = await this.namesOf(rows.map((r) => r.senderId));
    const c = ctx[0];
    return {
      ...s,
      messages: rows.map((m) => messageForStaff(m, names, staff.id)),
      context: {
        // created_at/last_active_at são TIMESTAMP em UTC
        createdAt: c ? c.created_at.toISOString() : s.createdAt,
        lastActiveAt: c?.last_active_at?.toISOString() ?? null,
        reportsAgainst: c?.reports ?? 0,
        premiumExpiresAt:
          s.user.premiumTier === 'free' ? null : (c?.premium_expires_at?.toISOString() ?? null),
        appVersion: c?.app_version ?? null,
        pastThreads: c?.past ?? 0,
      },
    };
  }

  async sendFromStaff(
    staff: AuthenticatedUser,
    threadId: string,
    p: { body: string; internal?: boolean; clientId?: string },
  ): Promise<SupportMessage> {
    const body = this.cleanBody(p.body);
    const internal = p.internal === true;
    const clientId = normClientId(p.clientId);
    if (clientId) {
      const prev = await this.prisma.supportMessage.findFirst({
        where: { senderId: staff.id, clientId },
        select: MSG_SELECT,
      });
      if (prev) return messageForStaff(prev, await this.namesOf([prev.senderId]), staff.id);
    }
    const out = await this.prisma.$transaction(async (tx) => {
      const [t] = await tx.$queryRaw<
        ThreadDb[]
      >`SELECT * FROM support_threads WHERE id = ${threadId}::uuid FOR UPDATE`;
      if (!t)
        throw new NotFoundException({ error: 'not_found', message: 'Atendimento não encontrado' });
      if (!internal && t.status === 'resolved') {
        throw new ConflictException({
          error: 'thread_resolved',
          message: 'Atendimento encerrado: reabra pra responder (nota interna pode)',
        });
      }
      const msg = await this.insertMessage(tx, t.id, staff.id, 'staff', body, internal, clientId);
      if (!msg) return null;
      if (!internal) {
        // resposta pública: agora a vez é da pessoa; sem responsável, fica com quem respondeu
        await tx.$executeRaw`
          UPDATE support_threads
             SET user_unread = user_unread + 1, staff_unread = 0, last_message_at = now(), updated_at = now(),
                 first_response_at = COALESCE(first_response_at, now()),
                 status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
                 assigned_to = COALESCE(assigned_to, ${staff.id}::uuid)
           WHERE id = ${t.id}::uuid`;
      } else {
        await tx.$executeRaw`UPDATE support_threads SET updated_at = now() WHERE id = ${t.id}::uuid`;
      }
      return { msg, userId: t.user_id };
    });
    if (!out) {
      const prev = await this.prisma.supportMessage.findFirst({
        where: { senderId: staff.id, clientId },
        select: MSG_SELECT,
      });
      if (prev) return messageForStaff(prev, await this.namesOf([prev.senderId]), staff.id);
      throw new ConflictException({ error: 'duplicate', message: 'Mensagem repetida' });
    }
    await this.emitMessage(out.userId, out.msg);
    await this.emitThread(threadId);
    if (!internal) {
      await this.notify
        .notify(out.userId, {
          type: 'support_reply',
          title: 'A Equipe Metch respondeu',
          body: preview(body),
          target: { kind: 'support' },
        })
        .catch((e: Error) => this.log.warn(`aviso da resposta do suporte falhou: ${e.message}`));
    }
    return messageForStaff(out.msg, await this.namesOf([staff.id]), staff.id);
  }

  async assign(threadId: string, userId: string | null): Promise<SupportThreadSummary> {
    if (userId) {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, deletedAt: true },
      });
      if (!u || u.deletedAt || (u.role !== 'admin' && u.role !== 'moderator')) {
        throw new BadRequestException({
          error: 'not_staff',
          message: 'Só dá pra atribuir a alguém da equipe',
        });
      }
    }
    const r = await this.prisma.supportThread.updateMany({
      where: { id: threadId },
      data: { assignedTo: userId },
    });
    if (!r.count)
      throw new NotFoundException({ error: 'not_found', message: 'Atendimento não encontrado' });
    return this.emitThread(threadId);
  }

  async setStatus(threadId: string, status: SupportThreadStatus): Promise<SupportThreadSummary> {
    let closing: { msg: SupportMessageRow; userId: string } | null = null;
    try {
      closing = await this.prisma.$transaction(async (tx) => {
        const [t] = await tx.$queryRaw<
          ThreadDb[]
        >`SELECT * FROM support_threads WHERE id = ${threadId}::uuid FOR UPDATE`;
        if (!t)
          throw new NotFoundException({
            error: 'not_found',
            message: 'Atendimento não encontrado',
          });
        if (t.status === status) return null;
        if (status === 'resolved') {
          const msg = await this.insertMessage(tx, t.id, null, 'system', CLOSING_TEXT, false, null);
          await tx.$executeRaw`
            UPDATE support_threads SET status = 'resolved', resolved_at = now(), updated_at = now(), staff_unread = 0,
                   user_unread = user_unread + 1, last_message_at = now()
             WHERE id = ${t.id}::uuid`;
          return msg ? { msg, userId: t.user_id } : null;
        }
        // reabrir (resolved → open/pending) esbarra no índice único se a pessoa já abriu outro
        await tx.$executeRaw`
          UPDATE support_threads SET status = ${status}, resolved_at = NULL, updated_at = now() WHERE id = ${t.id}::uuid`;
        return null;
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          error: 'thread_conflict',
          message: 'A pessoa já tem outro atendimento aberto',
        });
      }
      throw e;
    }
    if (closing) await this.emitMessage(closing.userId, closing.msg);
    return this.emitThread(threadId);
  }

  async readByStaff(threadId: string): Promise<SupportThreadSummary> {
    const r = await this.prisma.supportThread.updateMany({
      where: { id: threadId },
      data: { staffUnread: 0 },
    });
    if (!r.count)
      throw new NotFoundException({ error: 'not_found', message: 'Atendimento não encontrado' });
    return this.emitThread(threadId);
  }

  // =============================================================================================
  // socket ("digitando")
  // =============================================================================================

  /** atendimento aberto da pessoa (pro "digitando" dela ir pra equipe) */
  async openThreadIdOf(userId: string): Promise<string | null> {
    const t = await this.prisma.supportThread.findFirst({
      where: { userId, status: { not: 'resolved' } },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  /** dono do atendimento (pro "digitando" da equipe ir pra pessoa) */
  async threadOwner(threadId: string): Promise<string | null> {
    const t = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
      select: { userId: true, status: true },
    });
    return t && t.status !== 'resolved' ? t.userId : null;
  }

  // =============================================================================================
  // internos
  // =============================================================================================

  private cleanBody(raw: string): string {
    const body = (raw ?? '').trim();
    if (!body)
      throw new BadRequestException({ error: 'empty_body', message: 'Escreve alguma coisa' });
    if (body.length > SUPPORT_LIMITS.bodyMax) {
      throw new BadRequestException({
        error: 'body_too_long',
        message: `Até ${SUPPORT_LIMITS.bodyMax} caracteres`,
      });
    }
    return body;
  }

  private async lockOpen(tx: Tx, userId: string): Promise<ThreadDb | null> {
    const [t] = await tx.$queryRaw<ThreadDb[]>`
      SELECT * FROM support_threads WHERE user_id = ${userId}::uuid AND status <> 'resolved' FOR UPDATE`;
    return t ?? null;
  }

  private async currentOrLast(db: Tx | PrismaService, userId: string): Promise<ThreadDb | null> {
    const [t] = await db.$queryRaw<ThreadDb[]>`
      SELECT * FROM support_threads WHERE user_id = ${userId}::uuid
       ORDER BY (status <> 'resolved') DESC, created_at DESC LIMIT 1`;
    return t ?? null;
  }

  /** grava a mensagem; mesmo (remetente, clientId) já gravado → null (reenvio) */
  private async insertMessage(
    tx: Tx,
    threadId: string,
    senderId: string | null,
    author: 'user' | 'staff' | 'system',
    body: string,
    internal: boolean,
    clientId: string | null,
  ): Promise<SupportMessageRow | null> {
    const rows = await tx.$queryRaw<
      {
        id: string;
        thread_id: string;
        sender_id: string | null;
        author: string;
        body: string;
        internal: boolean;
        client_id: string | null;
        created_at: Date;
      }[]
    >`
      INSERT INTO support_messages (thread_id, sender_id, author, body, internal, client_id)
      VALUES (${threadId}::uuid, ${senderId}::uuid, ${author}, ${body}, ${internal}, ${clientId})
      ON CONFLICT (sender_id, client_id) DO NOTHING
      RETURNING *`;
    const r = rows[0];
    return r
      ? {
          id: r.id,
          threadId: r.thread_id,
          senderId: r.sender_id,
          author: r.author,
          body: r.body,
          internal: r.internal,
          clientId: r.client_id,
          createdAt: r.created_at,
        }
      : null;
  }

  /** 'support:message': a pessoa recebe só o que não é interno; a equipe recebe tudo (na ordem em que foram gravadas) */
  private async emitMessage(ownerId: string, m: SupportMessageRow): Promise<void> {
    const forUser = messageForUser(m, ownerId);
    if (forUser) {
      const ev: SupportMessageEvent = { threadId: m.threadId, message: forUser };
      this.gateway.emitToUser(ownerId, SUPPORT_EVENTS.message, ev);
    }
    const ev: SupportMessageEvent = {
      threadId: m.threadId,
      message: messageForStaff(m, await this.namesOf([m.senderId])),
    };
    this.gateway.emitToStaff(SUPPORT_EVENTS.message, ev);
  }

  /** 'support:thread' pra fila da equipe; devolve o resumo atualizado */
  private async emitThread(threadId: string): Promise<SupportThreadSummary> {
    const s = await this.summary(threadId);
    const ev: SupportThreadEvent = { thread: s };
    this.gateway.emitToStaff(SUPPORT_EVENTS.thread, ev);
    return s;
  }

  private async summary(threadId: string): Promise<SupportThreadSummary> {
    const [r] = await this.summaryRows([Prisma.sql`t.id = ${threadId}::uuid`], 1);
    if (!r)
      throw new NotFoundException({ error: 'not_found', message: 'Atendimento não encontrado' });
    return this.summaryOf(r);
  }

  private summaryRows(where: Prisma.Sql[], limit: number) {
    const cond = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    return this.prisma.$queryRaw<SummaryDb[]>`
      SELECT t.id, t.status, t.created_at, t.last_message_at, t.staff_unread, t.first_response_at, t.assigned_to,
             to_char(t.last_message_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_at,
             u.id AS user_id, u.name AS user_name, u.premium_tier, u.premium_expires_at, u.account_status,
             (SELECT COALESCE(p.thumbnail_url, p.url) FROM photos p WHERE p.user_id = u.id
               ORDER BY p.is_main DESC, p.order_index ASC LIMIT 1) AS avatar_url,
             a.name AS assigned_name,
             lm.body AS lm_body, lm.author AS lm_author, lm.created_at AS lm_at
        FROM support_threads t
        JOIN users u ON u.id = t.user_id
        LEFT JOIN users a ON a.id = t.assigned_to
        LEFT JOIN LATERAL (
          SELECT m.body, m.author, m.created_at FROM support_messages m
           WHERE m.thread_id = t.id AND NOT m.internal
           -- prévia da fila: a última fala de gente (a de sistema, boas-vindas/encerramento, só se não houver nenhuma)
           ORDER BY (m.author = 'system'), m.created_at DESC LIMIT 1) lm ON true
        ${cond}
       ORDER BY t.last_message_at DESC, t.id DESC
       LIMIT ${limit}`;
  }

  private summaryOf(r: SummaryDb): SupportThreadSummary {
    return {
      id: r.id,
      status: r.status as SupportThreadStatus,
      user: {
        id: r.user_id,
        name: r.user_name,
        avatarUrl: r.avatar_url,
        premiumTier: effectiveTier(r.premium_tier, r.premium_expires_at),
        accountStatus: r.account_status,
      },
      assignedTo: r.assigned_to ? { id: r.assigned_to, name: r.assigned_name ?? '—' } : null,
      lastMessage: r.lm_body
        ? {
            body: r.lm_body,
            author: r.lm_author as SupportMessage['author'],
            createdAt: r.lm_at!.toISOString(),
          }
        : null,
      staffUnread: r.staff_unread,
      createdAt: r.created_at.toISOString(),
      lastMessageAt: r.last_message_at.toISOString(),
      firstResponseMinutes: r.first_response_at
        ? Math.max(0, Math.round((r.first_response_at.getTime() - r.created_at.getTime()) / 60_000))
        : null,
    };
  }

  private async namesOf(ids: (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((v): v is string => !!v))];
    if (!list.length) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: list } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((u) => [u.id, u.name]));
  }
}

interface SummaryDb {
  id: string;
  cursor_at: string;
  status: string;
  created_at: Date;
  last_message_at: Date;
  staff_unread: number;
  first_response_at: Date | null;
  assigned_to: string | null;
  user_id: string;
  user_name: string;
  premium_tier: PremiumTier;
  premium_expires_at: Date | null;
  account_status: 'active' | 'suspended' | 'banned';
  avatar_url: string | null;
  assigned_name: string | null;
  lm_body: string | null;
  lm_author: string | null;
  lm_at: Date | null;
}

/** 23505 = violação de índice único (Prisma embrulha em P2010/P2002 conforme o caminho) */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  return (
    err?.code === 'P2002' ||
    err?.meta?.code === '23505' ||
    /23505|unique constraint/i.test(err?.message ?? '')
  );
}
