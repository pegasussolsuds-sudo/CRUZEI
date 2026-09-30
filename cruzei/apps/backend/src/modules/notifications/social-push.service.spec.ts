import { Logger } from '@nestjs/common';

import type { PushPayload } from './push.service';
import { SocialPushProcessor } from './social-push.processor';
import {
  LIKES_FLUSH_JOB,
  LIKES_FLUSH_MARGIN_MS,
  likesFlushJobId,
  type LikesFlushJob,
} from './social-push.queue';
import { SOCIAL_PUSH, SocialPushService } from './social-push.service';

// SocialPushService sem banco nem Redis de verdade: agendamento do envio no fim da espera de 15 min (Bull), o envio
// somado com as mesmas checagens, curtidor em análise e a visibilidade na tela bloqueada. O caminho com banco de
// verdade fica no test/db/social-push.db-spec.ts.

jest.mock('../inbox/inbox.queries', () => ({ summaryRows: jest.fn() }));
jest.mock('../inbox/inbox.mapper', () => ({ toSummary: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { summaryRows } = require('../inbox/inbox.queries') as { summaryRows: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { toSummary } = require('../inbox/inbox.mapper') as { toSummary: jest.Mock };

const GAP_MS = SOCIAL_PUSH.likeGapS * 1000;

/** Redis em memória com o que o service usa (set NX EX, get, getdel, del, incr, expire, pttl, incrRate) */
class FakeRedis {
  readonly store = new Map<string, { v: string; exp: number | null }>();
  private read(k: string): string | null {
    const e = this.store.get(k);
    if (!e) return null;
    if (e.exp != null && e.exp <= Date.now()) {
      this.store.delete(k);
      return null;
    }
    return e.v;
  }
  private write(k: string, v: string, exp: number | null) {
    this.store.set(k, { v, exp });
  }
  readonly client = {
    get: async (k: string) => this.read(k),
    set: async (k: string, v: string | number, ...args: (string | number)[]) => {
      const ex = args.indexOf('EX');
      const ttl = ex >= 0 ? Number(args[ex + 1]) : null;
      if (args.includes('NX') && this.read(k) != null) return null;
      this.write(k, String(v), ttl ? Date.now() + ttl * 1000 : null);
      return 'OK';
    },
    del: async (...keys: string[]) => keys.filter((k) => this.store.delete(k)).length,
    getdel: async (k: string) => {
      const v = this.read(k);
      this.store.delete(k);
      return v;
    },
    incr: async (k: string) => {
      const n = Number(this.read(k) ?? 0) + 1;
      this.write(k, String(n), this.store.get(k)?.exp ?? null);
      return n;
    },
    expire: async (k: string, s: number) => {
      const v = this.read(k);
      if (v == null) return 0;
      this.write(k, v, Date.now() + s * 1000);
      return 1;
    },
    pttl: async (k: string) => {
      const e = this.store.get(k);
      if (!e || this.read(k) == null) return -2;
      return e.exp == null ? -1 : e.exp - Date.now();
    },
  };
  async incrRate(userId: string, action: string, ttlSeconds = 86_400) {
    const key = `rate:${userId}:${action}`;
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }
  preset(k: string, v: string, ttlS = 3_600) {
    this.write(k, v, Date.now() + ttlS * 1000);
  }
}

/** fila do Bull falsa: jobId repetido é ignorado (igual ao Bull, enquanto o job existe) */
class FakeQueue {
  readonly jobs = new Map<
    string,
    { name: string; data: LikesFlushJob; opts: Record<string, unknown> }
  >();
  readonly add = jest.fn(
    async (name: string, data: LikesFlushJob, opts: Record<string, unknown>) => {
      const id = String(opts.jobId);
      if (!this.jobs.has(id)) this.jobs.set(id, { name, data, opts });
      return { id };
    },
  );
}

interface Pair {
  name: string;
  deleted_at: Date | null;
  account_status: string;
  review_hold_at: Date | null;
  a_likes_b: boolean;
  b_likes_a: boolean;
  blocked: boolean;
}

function setup(o: { queue?: boolean } = {}) {
  const redis = new FakeRedis();
  const queue = o.queue === false ? undefined : new FakeQueue();
  const state = {
    recipient: {
      deletedAt: null as Date | null,
      accountStatus: 'active',
      visibilityMode: 'visible',
      premiumTier: 'free',
      premiumExpiresAt: null as Date | null,
    },
    prefs: null as null | Partial<
      Record<'messages' | 'likes' | 'matches' | 'messagePreview', boolean>
    >,
    pair: {
      name: 'Ana',
      deleted_at: null,
      account_status: 'active',
      review_hold_at: null,
      a_likes_b: true,
      b_likes_a: false,
      blocked: false,
    } as Pair,
    /** curtidas que ainda valem no fim da espera (a recontagem no banco) */
    valid: 99,
  };
  const queries: string[] = [];
  const prisma = {
    user: { findUnique: jest.fn(async () => state.recipient) },
    notificationPref: { findUnique: jest.fn(async () => state.prefs) },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const sql = strings.join('?');
      queries.push(sql);
      if (sql.includes('a_likes_b')) return [state.pair];
      if (sql.includes('count(*)')) return [{ n: state.valid }];
      throw new Error(`consulta inesperada: ${sql}`);
    }),
  };
  const sent: { userId: string; payload: PushPayload }[] = [];
  const push = {
    enabled: true,
    sendToUsers: jest.fn(async (items: { userId: string; payload: PushPayload }[]) => {
      sent.push(...items);
      return { sent: items.length, failed: 0, removed: 0 };
    }),
  };
  const svc = new SocialPushService(prisma as never, redis as never, push as never, queue as never);
  const titles = () => sent.map((s) => s.payload.title);
  /** curtida comum (cada liker uma vez: o dedupe de 7 dias do par barra a repetida) */
  const like = async (
    likerId: string,
    extra: Partial<{ isSuper: boolean; reveal: boolean }> = {},
  ) => {
    await svc.like({ to: 'bia', likerId, isSuper: false, reveal: false, ...extra });
    await svc.drain();
  };
  const gateValue = async () => redis.client.get('push:likes:gate:bia');
  /** o relógio anda até a hora do job (fim da espera + folga): a espera vence pelo TTL, como no Redis */
  const expireGate = () => {
    clock.now += GAP_MS + LIKES_FLUSH_MARGIN_MS;
  };
  return {
    svc,
    redis,
    queue,
    state,
    prisma,
    push,
    sent,
    titles,
    like,
    gateValue,
    expireGate,
    queries,
  };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

// relógio controlado (Date.now): o tempo só anda quando o teste manda
const clock = { now: 0 };
let nowSpy: jest.SpyInstance<number, []>;
beforeEach(() => {
  clock.now = Date.UTC(2026, 9, 1, 12, 0, 0, 123);
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock.now);
});
afterEach(() => nowSpy.mockRestore());

// =================================================================================================
describe('curtida barrada pela espera: agenda UM envio pro fim dela', () => {
  it('as barradas pela mesma espera caem no mesmo job (destinatário + fim da espera), com folga e sem sobrar', async () => {
    const t = setup();
    const before = Date.now();
    await t.like('ana');
    expect(t.titles()).toEqual(['Alguém curtiu você 💚']);
    expect(t.queue!.add).not.toHaveBeenCalled();

    const dueAt = Number(await t.gateValue());
    expect(dueAt).toBeGreaterThanOrEqual(before + GAP_MS);
    expect(dueAt).toBeLessThanOrEqual(Date.now() + GAP_MS);

    await t.like('cris');
    await t.like('dani');
    await t.like('eli');
    expect(t.titles()).toHaveLength(1);
    expect(t.queue!.add).toHaveBeenCalledTimes(3);
    // o mesmo jobId nas três: o Bull guarda um job só (vale entre processos: o jobId sai do valor no Redis)
    const ids = t.queue!.add.mock.calls.map((c) => c[2].jobId);
    expect(new Set(ids)).toEqual(new Set([likesFlushJobId('bia', dueAt)]));
    expect(t.queue!.jobs.size).toBe(1);

    const [job] = [...t.queue!.jobs.values()];
    expect(job.name).toBe(LIKES_FLUSH_JOB);
    expect(job.data).toEqual({ to: 'bia', dueAt });
    const delay = job.opts.delay as number;
    // roda depois do fim da espera (com a folga), nunca antes
    expect(delay).toBeGreaterThan(dueAt - Date.now());
    expect(delay).toBeLessThanOrEqual(dueAt - before + LIKES_FLUSH_MARGIN_MS);
    expect(job.opts).toEqual(
      expect.objectContaining({ removeOnComplete: true, removeOnFail: true, attempts: 3 }),
    );
    // o contador guarda as 3 barradas pro envio
    expect(await t.redis.client.get('push:likes:n:bia')).toBe('3');
  });

  it('espera nova = janela nova = job novo (as da janela anterior não se misturam)', async () => {
    const t = setup();
    await t.like('ana');
    await t.like('cris');
    const first = Number(await t.gateValue());
    t.expireGate();
    await t.like('dani'); // passou (espera livre) e abriu outra
    await t.like('eli');
    const second = Number(await t.gateValue());
    expect(second).not.toBe(first);
    expect([...t.queue!.jobs.keys()]).toEqual([
      likesFlushJobId('bia', first),
      likesFlushJobId('bia', second),
    ]);
  });

  it('super curtida fura a espera e não agenda nada', async () => {
    const t = setup();
    await t.like('ana');
    await t.like('cris', { isSuper: true });
    expect(t.titles()).toEqual(['Alguém curtiu você 💚', 'Alguém te mandou uma super curtida ⭐']);
    expect(t.queue!.add).not.toHaveBeenCalled();
  });

  it('espera antiga (valor "1", de antes do agendamento): fim arredondado pro minuto, sem job por curtida', async () => {
    const t = setup();
    t.redis.preset('push:likes:gate:bia', '1', 600);
    await t.like('cris');
    await t.like('dani');
    expect(t.queue!.jobs.size).toBe(1);
    const [job] = [...t.queue!.jobs.values()];
    expect(job.data.dueAt % 60_000).toBe(0);
    expect(job.data.dueAt).toBeGreaterThanOrEqual(Date.now() + 590_000);
  });

  it('sem fila (db-specs): não agenda; a soma sai na próxima curtida com a espera livre', async () => {
    const t = setup({ queue: false });
    await t.like('ana');
    await t.like('cris');
    await t.like('dani');
    t.expireGate();
    await t.like('eli');
    expect(t.titles()).toEqual(['Alguém curtiu você 💚', 'Você tem 3 curtidas novas 💚']);
  });
});

// =================================================================================================
describe('envio no fim da espera (flushLikes)', () => {
  /** curte 1 (passa) + n barradas e devolve o fim da espera */
  async function blocked(t: ReturnType<typeof setup>, n: number): Promise<number> {
    await t.like('ana');
    for (let i = 0; i < n; i++) await t.like(`p${i}`);
    return Number(await t.gateValue());
  }

  it('manda a soma ("Você tem N curtidas novas"), sem nome, zera o contador e abre a espera nova', async () => {
    const t = setup();
    const dueAt = await blocked(t, 3);
    t.expireGate();
    await t.svc.flushLikes({ to: 'bia', dueAt });
    expect(t.titles()).toEqual(['Alguém curtiu você 💚', 'Você tem 3 curtidas novas 💚']);
    expect(t.sent[1].payload).toEqual({
      title: 'Você tem 3 curtidas novas 💚',
      body: 'Abre o Metch pra ver.',
      channelId: 'social',
      tag: 'likes',
      collapseKey: 'likes',
      ttlSeconds: SOCIAL_PUSH.ttlS.like,
      data: { notificationId: '', type: 'like', target: JSON.stringify({ kind: 'likes' }) },
    });
    expect(await t.redis.client.get('push:likes:n:bia')).toBeNull();
    // espera nova de 15 min: a próxima curtida fica barrada e agenda a janela seguinte
    const next = Number(await t.gateValue());
    expect(next).toBeGreaterThan(dueAt);
    await t.like('zeca');
    expect(t.sent).toHaveLength(2);
    expect(t.queue!.jobs.has(likesFlushJobId('bia', next))).toBe(true);
  });

  it('uma barrada só: "Alguém curtiu você"', async () => {
    const t = setup();
    const dueAt = await blocked(t, 1);
    t.expireGate();
    await t.svc.flushLikes({ to: 'bia', dueAt });
    expect(t.titles()).toEqual(['Alguém curtiu você 💚', 'Alguém curtiu você 💚']);
  });

  it('dois processos com o mesmo job ao mesmo tempo (retentativa, job travado): um push só', async () => {
    const t = setup();
    const dueAt = await blocked(t, 2);
    t.expireGate();
    await Promise.all([
      t.svc.flushLikes({ to: 'bia', dueAt }),
      t.svc.flushLikes({ to: 'bia', dueAt }),
    ]);
    expect(t.titles()).toEqual(['Alguém curtiu você 💚', 'Você tem 2 curtidas novas 💚']);
  });

  it('a espera desta janela ainda de pé (relógio): lança pro Bull tentar de novo e não manda nada', async () => {
    const t = setup();
    const dueAt = await blocked(t, 2);
    await expect(t.svc.flushLikes({ to: 'bia', dueAt })).rejects.toThrow('ainda não venceu');
    expect(t.sent).toHaveLength(1);
    expect(await t.redis.client.get('push:likes:n:bia')).toBe('2');
  });

  it('outra curtida passou antes (já mandou a soma): o job não repete', async () => {
    const t = setup();
    const dueAt = await blocked(t, 2);
    t.expireGate();
    await t.like('zeca'); // espera livre: passa e leva as 3
    expect(t.titles()).toEqual(['Alguém curtiu você 💚', 'Você tem 3 curtidas novas 💚']);
    await t.svc.flushLikes({ to: 'bia', dueAt });
    expect(t.sent).toHaveLength(2);
  });

  it('bloqueio/descurtida desconta (recontagem no banco, a partir do início da espera)', async () => {
    const t = setup();
    const dueAt = await blocked(t, 3);
    t.expireGate();
    t.state.valid = 2;
    const before = Date.now();
    await t.svc.flushLikes({ to: 'bia', dueAt });
    expect(t.titles()[1]).toBe('Você tem 2 curtidas novas 💚');
    // a recontagem olha a idade desde o início da espera (dueAt - 15 min), no relógio do banco
    const call = t.prisma.$queryRaw.mock.calls.find((c) =>
      String(c[0].join('?')).includes('count(*)'),
    );
    const ageMs = call![2] as number;
    expect(ageMs).toBeGreaterThanOrEqual(before - (dueAt - GAP_MS));
    expect(ageMs).toBeLessThanOrEqual(Date.now() - (dueAt - GAP_MS));
    const sql = String(call![0].join('?'));
    expect(sql).toMatch(/blocks/);
    expect(sql).toMatch(/review_hold_at IS NULL/);
    expect(sql).toMatch(/NOT l\.is_super/);
  });

  it('nada válido (todos bloqueados/descurtiram) ou contador vazio: sem push e a espera é liberada', async () => {
    const t = setup();
    const dueAt = await blocked(t, 2);
    t.expireGate();
    t.state.valid = 0;
    await t.svc.flushLikes({ to: 'bia', dueAt });
    expect(t.sent).toHaveLength(1);
    expect(await t.gateValue()).toBeNull();

    // contador já levado por outra curtida: também libera (a próxima avisa na hora)
    const t2 = setup();
    await t2.like('ana');
    const due2 = Number(await t2.gateValue());
    t2.expireGate();
    await t2.svc.flushLikes({ to: 'bia', dueAt: due2 });
    expect(t2.sent).toHaveLength(1);
    expect(await t2.gateValue()).toBeNull();
  });

  it.each([
    [
      '"Curtidas" desligado',
      (t: ReturnType<typeof setup>) => void (t.state.prefs = { likes: false }),
    ],
    [
      'invisível sem Premium',
      (t: ReturnType<typeof setup>) => void (t.state.recipient.visibilityMode = 'anonymous'),
    ],
    [
      'conta fora do ar',
      (t: ReturnType<typeof setup>) => void (t.state.recipient.accountStatus = 'suspended'),
    ],
    [
      'conta apagada',
      (t: ReturnType<typeof setup>) => void (t.state.recipient.deletedAt = new Date()),
    ],
    [
      'teto de 30/h',
      (t: ReturnType<typeof setup>) =>
        t.redis.preset('rate:bia:push:social', String(SOCIAL_PUSH.hourlyCap)),
    ],
  ])('%s: sem push', async (_label, apply) => {
    const t = setup();
    const dueAt = await blocked(t, 2);
    t.expireGate();
    apply(t);
    await t.svc.flushLikes({ to: 'bia', dueAt });
    expect(t.sent).toHaveLength(1);
  });

  it('push desligado (sem FCM): não mexe em nada', async () => {
    const t = setup();
    const dueAt = await blocked(t, 2);
    t.expireGate();
    t.push.enabled = false;
    await t.svc.flushLikes({ to: 'bia', dueAt });
    expect(await t.redis.client.get('push:likes:n:bia')).toBe('2');
    expect(await t.gateValue()).toBeNull();
  });

  it('o processor do Bull chama o flushLikes com os dados do job', async () => {
    const flushLikes = jest.fn(async () => undefined);
    const p = new SocialPushProcessor({ flushLikes } as never);
    await p.flushLikes({ data: { to: 'bia', dueAt: 123 } } as never);
    expect(flushLikes).toHaveBeenCalledWith({ to: 'bia', dueAt: 123 });
  });
});

// =================================================================================================
describe('curtidor em análise, conta fora e nome', () => {
  it('curtidor em análise: sem push, sem contar pra soma e sem agendar (a curtida fica guardada)', async () => {
    const t = setup();
    t.state.pair.review_hold_at = new Date();
    await t.like('gabi', { reveal: true });
    await t.like('gabi2', { isSuper: true });
    expect(t.sent).toEqual([]);
    expect(await t.redis.client.get('push:likes:n:bia')).toBeNull();
    expect(t.queue!.add).not.toHaveBeenCalled();
  });

  it('curtidor com conta fora ou apagada: sem push', async () => {
    const t = setup();
    t.state.pair.account_status = 'suspended';
    await t.like('x');
    t.state.pair = { ...t.state.pair, account_status: 'active', deleted_at: new Date() };
    await t.like('y');
    expect(t.sent).toEqual([]);
  });

  it('com nome (Premium+): visibility private; sem nome: sem visibility', async () => {
    const t = setup();
    await t.like('ana', { reveal: true });
    expect(t.sent[0].payload).toEqual(
      expect.objectContaining({ title: 'Ana curtiu você 💚', visibility: 'private' }),
    );
    const t2 = setup();
    await t2.like('ana');
    expect(t2.sent[0].payload).not.toHaveProperty('visibility');
  });
});

// =================================================================================================
describe('mensagem: fora da tela bloqueada', () => {
  function withConversation(t: ReturnType<typeof setup>) {
    summaryRows.mockResolvedValue([{ is_muted: false, peer_id: 'ana' }]);
    toSummary.mockReturnValue({ peer: { name: 'Ana' }, folder: 'inbox', unreadCount: 1 });
    return t;
  }

  it.each([
    ['prévia ligada', true, 'oi, tudo bem?'],
    ['prévia desligada', false, 'Mandou uma mensagem'],
  ])(
    '%s: visibility secret (nem o nome aparece com a tela bloqueada)',
    async (_label, preview, body) => {
      const t = withConversation(setup());
      t.state.prefs = { messagePreview: preview };
      await t.svc.messages([
        {
          to: 'bia',
          senderId: 'ana',
          conversationId: 'c1',
          messageType: 'text',
          body: 'oi, tudo bem?',
        } as never,
      ]);
      expect(t.sent).toHaveLength(1);
      expect(t.sent[0].payload).toEqual(
        expect.objectContaining({
          title: 'Ana',
          body,
          channelId: 'messages',
          tag: 'conv:c1',
          visibility: 'secret',
        }),
      );
    },
  );
});
