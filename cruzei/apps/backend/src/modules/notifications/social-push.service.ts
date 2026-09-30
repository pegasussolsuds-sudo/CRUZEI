import { PUSH_CHANNELS, type NotificationTarget, type SocialPushType } from '@cruzei/shared-types';
import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Queue } from 'bull';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { MessagePushTarget } from '../inbox/inbox.events';
import { toSummary } from '../inbox/inbox.mapper';
import { summaryRows } from '../inbox/inbox.queries';
import { MESSAGING_GATE_SELECT, messagingLocked } from '../inbox/visibility';

import { pushDataOf } from './notification-target';
import { PushService, type PushVisibility } from './push.service';
import {
  LIKES_FLUSH_JOB,
  LIKES_FLUSH_MARGIN_MS,
  SOCIAL_PUSH_QUEUE,
  likesFlushJobId,
  type LikesFlushJob,
} from './social-push.queue';
import {
  likePushText,
  matchPushText,
  messagePreviewOf,
  messagePushText,
  type PushText,
} from './social-push.texts';

/** limites anti-spam do push social (decisão do dono, 03/10/2026) */
export const SOCIAL_PUSH = {
  /** mensagem: no máx. 1 push por conversa nesse intervalo */
  messageGapS: 60,
  /** curtida: no máx. 1 push nesse intervalo (as do período entram somadas no próximo); super curtida fura */
  likeGapS: 15 * 60,
  /** a mesma pessoa curtindo de novo (descurtiu e curtiu) não avisa outra vez nesse prazo */
  likePairDedupeS: 7 * 86_400,
  /** o mesmo match (descurtiu e curtiu de novo) não avisa outra vez nesse prazo */
  matchDedupeS: 7 * 86_400,
  /** teto por pessoa, por hora, de push de mensagem + curtida (match fica fora) */
  hourlyCap: 30,
  /** validade no FCM (aparelho desligado por mais que isso não recebe o aviso velho) */
  ttlS: { message: 86_400, like: 12 * 3_600, match: 3 * 86_400 },
} as const;

/** contador das curtidas juntadas e espera de 15 min (o valor da espera é o fim dela, em ms) */
const likesCountKey = (to: string) => `push:likes:n:${to}`;
const likesGateKey = (to: string) => `push:likes:gate:${to}`;

/** aviso de curtida: abre Curtidas; um só na bandeja (e um só guardado no FCM com o aparelho fora) */
const LIKE_SEND = {
  type: 'like',
  target: { kind: 'likes' },
  channelId: PUSH_CHANNELS.social,
  tag: 'likes',
  collapseKey: 'likes',
  ttlSeconds: SOCIAL_PUSH.ttlS.like,
} as const satisfies Omit<SendOptions, 'visibility'>;

interface SendOptions {
  type: SocialPushType;
  target: NotificationTarget;
  channelId: string;
  tag: string;
  collapseKey?: string;
  ttlSeconds: number;
  /** tela bloqueada: 'secret' = nem aparece; 'private' = depende do ajuste da pessoa (ver PushPayload) */
  visibility?: PushVisibility;
}

interface PairRow {
  name: string;
  deleted_at: Date | null;
  account_status: string;
  review_hold_at: Date | null;
  a_likes_b: boolean;
  b_likes_a: boolean;
  blocked: boolean;
}

/**
 * Push SOCIAL: mensagem nova, curtida e match. Só push — não passa pelo NotifyService (nada na central de avisos,
 * nada de 'notification:new'); o app em primeiro plano engole esses pushes (o socket já atualiza as listas).
 * Roda DEPOIS do commit, sem derrubar quem chamou (os métodos públicos nunca rejeitam). Push desligado (sem FCM)
 * sai na hora, sem ir ao banco. Regras:
 * - conta de destino apagada, fora de 'active' ou invisível sem Premium (messagingLocked) não recebe
 * - preferência desligada (messages/likes/matches) não recebe; messagePreview decide se o texto aparece
 * - Block em qualquer sentido, conversa muda, solicitação de quem está em análise: sem push (a mesma leitura da inbox)
 * - curtida nunca nomeia quem não pode ser nomeado (quem chama manda reveal); curtida de quem está em análise não avisa
 * - mensagem nunca aparece na tela bloqueada (visibility secret): o nome e a prévia só aparecem ao desbloquear
 * - curtidas barradas pela espera de 15 min saem somadas no FIM da espera (job do Bull, um por destinatário e janela)
 */
@Injectable()
export class SocialPushService {
  private readonly log = new Logger(SocialPushService.name);
  /** envios em voo (os testes esperam com drain) */
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly push: PushService,
    // envio agendado das curtidas (opcional: os db-specs montam sem — aí a soma sai só na próxima curtida)
    @Optional()
    @InjectQueue(SOCIAL_PUSH_QUEUE)
    private readonly queue?: Queue<LikesFlushJob> | null,
  ) {}

  /** mensagens novas (alvos de inbox.events.messagePushTargets, já sem quem está retido) */
  messages(targets: readonly MessagePushTarget[]): Promise<void> {
    if (!this.push.enabled || targets.length === 0) return Promise.resolve();
    return this.track(async () => {
      for (const t of targets) await this.message(t);
    }, 'mensagem');
  }

  /** curtida que NÃO fechou o par. reveal = quem recebe pode saber quem curtiu (Premium+, curtidor visível) */
  like(i: { to: string; likerId: string; isSuper: boolean; reveal: boolean }): Promise<void> {
    if (!this.push.enabled) return Promise.resolve();
    return this.track(() => this.likeNow(i), 'curtida');
  }

  /** match fechado agora: avisa quem curtiu primeiro (to); peerId = quem completou */
  match(i: { to: string; peerId: string }): Promise<void> {
    if (!this.push.enabled) return Promise.resolve();
    return this.track(() => this.matchNow(i), 'match');
  }

  /**
   * Fim da espera de 15 min (job do Bull): manda as curtidas que ficaram barradas, somadas ("Você tem N curtidas
   * novas"), com as mesmas checagens do envio na hora. Dois processos com o mesmo job (retentativa, job travado) não
   * mandam em dobro: quem manda precisa tomar a espera nova (SET NX) antes do getdel do contador.
   */
  async flushLikes(job: LikesFlushJob): Promise<void> {
    if (!this.push.enabled) return;
    const gateKey = likesGateKey(job.to);
    if (!(await this.gateUntil(gateKey, Date.now() + SOCIAL_PUSH.likeGapS * 1000))) {
      // a espera desta janela ainda está de pé (relógio adiantado): o Bull tenta de novo em alguns segundos
      if ((await this.redis.client.get(gateKey)) === String(job.dueAt)) {
        throw new Error('espera das curtidas ainda não venceu');
      }
      // outra curtida passou (e já mandou a soma) ou outro envio tomou a vez: quem ficou barrado agendou a janela nova
      return;
    }
    const n = Number(await this.redis.client.getdel(likesCountKey(job.to))) || 0;
    // curtidas gravadas desde o início da espera (as de antes já foram no aviso que abriu a espera): base pra
    // descontar bloqueio, descurtida, match e conta fora
    const since = job.dueAt - SOCIAL_PUSH.likeGapS * 1000;
    const outcome = n > 0 ? await this.sendLikesSummary(job.to, n, since) : 'empty';
    // nada pra avisar: libera a espera (a próxima curtida avisa na hora)
    if (outcome === 'empty') await this.redis.client.del(gateKey);
  }

  /** espera os envios em voo (testes) */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  // ---------------------------------------------------------------------------------------------

  private track(fn: () => Promise<void>, what: string): Promise<void> {
    const p = fn().catch((e: unknown) => {
      this.log.warn(`push de ${what} falhou: ${(e as Error)?.message ?? e}`);
    });
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
    return p;
  }

  private async message(t: MessagePushTarget): Promise<void> {
    // portão por conversa: corta a rajada antes de ir ao banco
    if (!(await this.gate(`push:msg:${t.to}:${t.conversationId}`, SOCIAL_PUSH.messageGapS))) return;
    const who = await this.recipient(t.to);
    if (!who?.prefs.messages) return;
    // a mesma leitura da lista: Block, conta fora, solicitação de quem está em análise → nenhuma linha
    const [row] = await summaryRows(this.prisma, {
      viewerId: t.to,
      conversationId: t.conversationId,
      includeArchived: true,
    });
    if (!row || row.is_muted || row.peer_id !== t.senderId) return;
    if (!(await this.underHourlyCap(t.to))) return;
    const s = toSummary(row);
    await this.send(
      t.to,
      messagePushText({
        peerName: s.peer.name,
        folder: s.folder,
        preview: messagePreviewOf(t.messageType, t.body),
        showPreview: who.prefs.messagePreview,
        unread: s.unreadCount,
      }),
      {
        type: 'message',
        target: { kind: 'conversation', conversationId: t.conversationId },
        channelId: PUSH_CHANNELS.messages,
        // uma notificação por conversa na bandeja (sem collapseKey: o FCM só guarda 4 grupos por aparelho)
        tag: `conv:${t.conversationId}`,
        ttlSeconds: SOCIAL_PUSH.ttlS.message,
        // nem aparece na tela bloqueada (com ou sem prévia: o nome já diz muito); aparece ao desbloquear.
        // 'private' não bastava: só esconde se a pessoa mudou o ajuste do Android
        visibility: 'secret',
      },
    );
  }

  private async likeNow(i: {
    to: string;
    likerId: string;
    isSuper: boolean;
    reveal: boolean;
  }): Promise<void> {
    const who = await this.recipient(i.to);
    if (!who?.prefs.likes) return;
    const pair = await this.pair(i.likerId, i.to);
    if (!pair || pair.blocked || !pair.a_likes_b) return;
    // curtidor em análise (ou conta fora): a curtida fica guardada, sem aviso; análise sem punição = segue a vida
    if (pair.review_hold_at || pair.deleted_at || pair.account_status !== 'active') return;
    // descurtir e curtir de novo não vira spam
    if (!(await this.gate(`push:like:${i.likerId}:${i.to}`, SOCIAL_PUSH.likePairDedupeS))) return;
    let count = 1;
    if (!i.isSuper) {
      // junta as curtidas do período: sai na hora se a espera de 15 min estiver livre; senão, no fim dela (agendado)
      const key = likesCountKey(i.to);
      const n = await this.redis.client.incr(key);
      if (n === 1) await this.redis.client.expire(key, 86_400);
      const gateKey = likesGateKey(i.to);
      if (!(await this.gateUntil(gateKey, Date.now() + SOCIAL_PUSH.likeGapS * 1000))) {
        await this.scheduleLikesFlush(i.to);
        return;
      }
      count = Math.max(1, Number(await this.redis.client.getdel(key)) || 1);
    }
    if (!(await this.underHourlyCap(i.to))) return;
    const likerName = i.reveal ? pair.name : null;
    await this.send(i.to, likePushText({ likerName, count, isSuper: i.isSuper }), {
      ...LIKE_SEND,
      // com nome: o Android esconde o conteúdo na tela bloqueada se a pessoa pediu pra esconder conteúdo sensível
      ...(likerName != null ? { visibility: 'private' as const } : {}),
    });
  }

  /**
   * Curtida barrada pela espera: agenda UM envio pro fim dela. jobId = destinatário + fim da espera (o valor gravado
   * na chave), então todas as curtidas barradas pela mesma espera, em qualquer processo, caem no mesmo job.
   */
  private async scheduleLikesFlush(to: string): Promise<void> {
    if (!this.queue) return;
    const gateKey = likesGateKey(to);
    const raw = await this.redis.client.get(gateKey);
    let dueAt = Number(raw);
    if (!Number.isFinite(dueAt) || dueAt < 1e12) {
      // espera de antes do agendamento (valor '1') ou que venceu agorinha: arredonda pro minuto (poucos jobs, sem rajada)
      const left = raw == null ? 0 : Math.max(0, await this.redis.client.pttl(gateKey));
      dueAt = Math.ceil((Date.now() + left) / 60_000) * 60_000;
    }
    await this.queue.add(
      LIKES_FLUSH_JOB,
      { to, dueAt },
      {
        jobId: likesFlushJobId(to, dueAt),
        delay: Math.max(0, dueAt - Date.now()) + LIKES_FLUSH_MARGIN_MS,
        attempts: 3,
        backoff: { type: 'fixed', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /**
   * Push somado do fim da espera. Mesmas checagens do envio na hora: preferência, conta de quem recebe (inclui
   * invisível sem Premium), bloqueio/descurtida/conta fora de quem curtiu (recontado no banco) e teto por hora.
   * 'empty' = nada válido pra avisar.
   */
  private async sendLikesSummary(
    to: string,
    pending: number,
    sinceMs: number,
  ): Promise<'sent' | 'skipped' | 'empty'> {
    const who = await this.recipient(to);
    if (!who?.prefs.likes) return 'skipped';
    const count = Math.min(pending, await this.validLikesSince(to, sinceMs));
    if (count <= 0) return 'empty';
    if (!(await this.underHourlyCap(to))) return 'skipped';
    // somado nunca leva nome (junta gente que pode e que não pode ser nomeada)
    await this.send(to, likePushText({ likerName: null, count, isSuper: false }), LIKE_SEND);
    return 'sent';
  }

  /** curtidas comuns recebidas desde sinceMs que ainda valem: sem Block, sem match, quem curtiu ativo e fora de análise */
  private async validLikesSince(to: string, sinceMs: number): Promise<number> {
    // vai a IDADE, não o instante: o banco desconta do relógio dele (diferença de relógio entre máquinas não pesa)
    const ageMs = Math.max(0, Date.now() - sinceMs);
    const [row] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM likes l
        JOIN users u ON u.id = l.liker_id
       WHERE l.liked_id = ${to}::uuid
         AND l.created_at >= (now() AT TIME ZONE 'UTC') - ${ageMs}::double precision * interval '1 millisecond'
         AND NOT l.is_super
         AND u.deleted_at IS NULL AND u.account_status = 'active' AND u.review_hold_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM likes r WHERE r.liker_id = ${to}::uuid AND r.liked_id = l.liker_id)
         AND NOT EXISTS (SELECT 1 FROM blocks x
                          WHERE (x.blocker_id = l.liker_id AND x.blocked_id = ${to}::uuid)
                             OR (x.blocker_id = ${to}::uuid AND x.blocked_id = l.liker_id))`;
    return Number(row?.n ?? 0);
  }

  private async matchNow(i: { to: string; peerId: string }): Promise<void> {
    const who = await this.recipient(i.to);
    if (!who?.prefs.matches) return;
    const pair = await this.pair(i.peerId, i.to);
    if (
      !pair ||
      pair.blocked ||
      !pair.a_likes_b ||
      !pair.b_likes_a ||
      pair.deleted_at ||
      pair.account_status !== 'active' ||
      pair.review_hold_at
    )
      return;
    if (!(await this.gate(`push:match:${i.to}:${i.peerId}`, SOCIAL_PUSH.matchDedupeS))) return;
    await this.send(i.to, matchPushText(pair.name), {
      type: 'match',
      target: { kind: 'match', userId: i.peerId },
      channelId: PUSH_CHANNELS.social,
      tag: `match:${i.peerId}`,
      ttlSeconds: SOCIAL_PUSH.ttlS.match,
      // o nome some da tela bloqueada só se a pessoa pediu pra esconder conteúdo sensível (a Política diz isso)
      visibility: 'private',
    });
  }

  /** quem recebe: conta ativa, fora do invisível sem Premium, e as preferências (sem linha = tudo ligado) */
  private async recipient(userId: string) {
    const [u, p] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { deletedAt: true, accountStatus: true, ...MESSAGING_GATE_SELECT },
      }),
      this.prisma.notificationPref.findUnique({
        where: { userId },
        select: { messages: true, likes: true, matches: true, messagePreview: true },
      }),
    ]);
    if (!u || u.deletedAt || u.accountStatus !== 'active' || messagingLocked(u)) return null;
    return {
      prefs: {
        messages: p?.messages ?? true,
        likes: p?.likes ?? true,
        matches: p?.matches ?? true,
        messagePreview: p?.messagePreview ?? true,
      },
    };
  }

  /** a (quem curtiu/completou) × b (quem recebe): conta de a, curtidas nos dois sentidos e Block */
  private async pair(a: string, b: string): Promise<PairRow | null> {
    const [row] = await this.prisma.$queryRaw<PairRow[]>`
      SELECT u.name, u.deleted_at, u.account_status::text AS account_status, u.review_hold_at,
             EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = ${a}::uuid AND l.liked_id = ${b}::uuid) AS a_likes_b,
             EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = ${b}::uuid AND l.liked_id = ${a}::uuid) AS b_likes_a,
             EXISTS (SELECT 1 FROM blocks x
                      WHERE (x.blocker_id = ${a}::uuid AND x.blocked_id = ${b}::uuid)
                         OR (x.blocker_id = ${b}::uuid AND x.blocked_id = ${a}::uuid)) AS blocked
        FROM users u WHERE u.id = ${a}::uuid`;
    return row ?? null;
  }

  /** SET NX EX: true = passou (primeiro no intervalo) */
  private async gate(key: string, seconds: number): Promise<boolean> {
    return (await this.redis.client.set(key, '1', 'EX', seconds, 'NX')) === 'OK';
  }

  /** o mesmo portão, guardando o fim da espera (ms) como valor — o agendamento usa no jobId */
  private async gateUntil(key: string, until: number): Promise<boolean> {
    const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return (await this.redis.client.set(key, String(until), 'EX', seconds, 'NX')) === 'OK';
  }

  private async underHourlyCap(userId: string): Promise<boolean> {
    return (await this.redis.incrRate(userId, 'push:social', 3_600)) <= SOCIAL_PUSH.hourlyCap;
  }

  private async send(userId: string, text: PushText, o: SendOptions): Promise<void> {
    await this.push.sendToUsers([
      {
        userId,
        payload: {
          title: text.title,
          body: text.body,
          data: pushDataOf(null, o.type, o.target),
          channelId: o.channelId,
          tag: o.tag,
          ...(o.collapseKey ? { collapseKey: o.collapseKey } : {}),
          ttlSeconds: o.ttlSeconds,
          ...(o.visibility ? { visibility: o.visibility } : {}),
        },
      },
    ]);
  }
}
