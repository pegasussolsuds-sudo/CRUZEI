import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { PrismaService } from '../database/prisma.service';
import { AccountStateService } from '../modules/account/account-state.service';
import { RedisService } from '../redis/redis.service';

import { ChatGateway, STAFF_SUPPORT_ROOM, TYPING_RECHECK_MS } from './chat.gateway';

// Gateway de verdade (Nest + socket.io numa porta aleatória) com clientes socket.io de verdade.
// O banco é trocado por uma tabela de quem pode entrar em qual conversa (com papel e promoção); o SQL de
// conversationAccess é testado contra o Postgres em test/db/conversation-access.db-spec.ts.

const SECRET = 'segredo-do-teste-do-gateway';
const A = '0a000000-0000-4000-8000-00000000000a';
const B = '0b000000-0000-4000-8000-00000000000b';
const C = '0c000000-0000-4000-8000-00000000000c';
const D = '0d000000-0000-4000-8000-00000000000d';
const BANNED = '0e000000-0000-4000-8000-00000000000e';
const STAFF = '0f000000-0000-4000-8000-00000000000f';
/** conta cujo número foi liberado: sessões anteriores ao corte caem */
const RELEASED = '01000000-0000-4000-8000-000000000001';
const CONV_AB = 'ca000000-0000-4000-8000-0000000000ab';
const CONV_AC = 'ca000000-0000-4000-8000-0000000000ac';

// membro ativo sem bloqueio → a linha que a consulta devolveria (papel + promoção).
// CONV_AB: A pediu, B recebeu, ainda nas solicitações. CONV_AC: A pediu, C recebeu, já promovida.
type Row = { role: 'REQUESTER' | 'RECIPIENT'; promoted_at: Date | null };
const allowed = new Map<string, Row>();
const resetAllowed = () => {
  allowed.clear();
  allowed.set(`${CONV_AB}:${A}`, { role: 'REQUESTER', promoted_at: null });
  allowed.set(`${CONV_AB}:${B}`, { role: 'RECIPIENT', promoted_at: null });
  allowed.set(`${CONV_AC}:${A}`, { role: 'REQUESTER', promoted_at: new Date(0) });
  allowed.set(`${CONV_AC}:${C}`, { role: 'RECIPIENT', promoted_at: new Date(0) });
};
/** promove a conversa "no banco" (as duas linhas) */
const promoteInDb = (conversationId: string) => {
  for (const [k, row] of allowed)
    if (k.startsWith(`${conversationId}:`)) row.promoted_at = new Date();
};
const prisma = {
  $queryRaw: jest.fn(async (_sql: TemplateStringsArray, conversationId: string, userId: string) => {
    const row = allowed.get(`${conversationId}:${userId}`);
    return row ? [{ ...row }] : [];
  }),
};
/** número liberado da conta: tokens emitidos antes deste corte (segundos) não abrem socket */
const REVOKED_BEFORE_S = 2_000_000_000;
const accounts = {
  blockedReason: jest.fn(async (userId: string, iat?: number) =>
    userId === BANNED
      ? { error: 'account_banned', message: 'Conta banida', reason: 'teste', until: null }
      : userId === RELEASED && typeof iat === 'number' && iat < REVOKED_BEFORE_S
        ? { error: 'session_revoked', message: 'Sua sessão foi encerrada. Entra de novo.' }
        : null,
  ),
  // papel do estado da conta: STAFF é moderador (entra na sala do suporte)
  get: jest.fn(async (userId: string) => ({
    status: 'active',
    until: null,
    reason: null,
    role: userId === STAFF ? 'moderator' : 'user',
  })),
};

const jwt = new JwtService();
const tokenFor = (userId: string) => jwt.sign({ sub: userId }, { secret: SECRET });

let app: INestApplication;
let gateway: ChatGateway;
let url = '';
const open: ClientSocket[] = [];

function client(auth: Record<string, unknown>): ClientSocket {
  const s = ioClient(url, { transports: ['websocket'], auth, reconnection: false, forceNew: true });
  open.push(s);
  return s;
}

function connect(userId: string): Promise<ClientSocket> {
  const s = client({ token: tokenFor(userId) });
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function connectError(auth: Record<string, unknown>): Promise<Error & { data?: unknown }> {
  const s = client(auth);
  return new Promise((resolve, reject) => {
    s.on('connect', () => reject(new Error('conectou e não devia')));
    s.on('connect_error', (e) => resolve(e as Error & { data?: unknown }));
  });
}

/** tudo que o cliente recebe (menos a marca de sincronização) */
function record(s: ClientSocket): Array<[string, unknown]> {
  const got: Array<[string, unknown]> = [];
  s.onAny((event: string, payload: unknown) => {
    if (event !== '__flush') got.push([event, payload]);
  });
  return got;
}

/**
 * Sincroniza sem sleep: manda uma marca pra sala própria de cada socket e espera ela chegar. A ordem por
 * conexão é garantida, então o que não chegou antes da marca não foi enviado pra esse socket.
 */
let flushSeq = 0;
async function flush(...clients: ClientSocket[]) {
  const mark = `f${++flushSeq}`;
  const arrived = clients.map(
    (c) =>
      new Promise<void>((resolve) => {
        const h = (v: string) => {
          if (v !== mark) return;
          c.off('__flush', h);
          resolve();
        };
        c.on('__flush', h);
      }),
  );
  for (const c of clients) gateway.server.to(c.id as string).emit('__flush', mark);
  await Promise.all(arrived);
}

/** o servidor já processou tudo que esse socket mandou antes (os handlers rodam em ordem) */
const processed = (s: ClientSocket) => s.emitWithAck('heartbeat');

const join = (s: ClientSocket, conversationId: unknown) =>
  s.emitWithAck('join_conversation', { conversationId });

const inRoom = async (room: string) =>
  (await gateway.server.in(room).fetchSockets()).map((s) => s.data.userId as string).sort();

beforeAll(async () => {
  const mod = await Test.createTestingModule({
    providers: [
      ChatGateway,
      { provide: JwtService, useValue: jwt },
      {
        provide: ConfigService,
        useValue: { get: (k: string) => (k === 'jwt.secret' ? SECRET : undefined) },
      },
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: {} },
      { provide: AccountStateService, useValue: accounts },
    ],
  }).compile();
  app = mod.createNestApplication({ logger: false });
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  gateway = app.get(ChatGateway);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  resetAllowed();
  prisma.$queryRaw.mockClear();
});

afterEach(() => {
  open.splice(0).forEach((s) => s.close());
  jest.restoreAllMocks();
});

describe('ChatGateway — autenticação (mantida)', () => {
  it('sem token, token inválido e conta bloqueada não conectam; token bom entra em user:<id>', async () => {
    expect((await connectError({})).message).toBe('unauthorized');
    expect((await connectError({ token: 'lixo' })).message).toBe('unauthorized');
    const other = jwt.sign({ sub: A }, { secret: 'outro-segredo' });
    expect((await connectError({ token: other })).message).toBe('unauthorized');
    const banned = await connectError({ token: tokenFor(BANNED) });
    expect(banned.message).toBe('account_banned');
    expect(banned.data).toMatchObject({ error: 'account_banned' });

    await connect(A);
    expect(await inRoom(`user:${A}`)).toEqual([A]);
    expect(gateway.isOnline(A)).toBe(true);
  });

  it('refresh token (mesmo segredo, 30 dias) não abre socket; access com tipo abre', async () => {
    const refresh = jwt.sign({ sub: B, typ: 'refresh' }, { secret: SECRET });
    expect((await connectError({ token: refresh })).message).toBe('unauthorized');
    const access = client({ token: jwt.sign({ sub: B, typ: 'access' }, { secret: SECRET }) });
    await new Promise<void>((resolve, reject) => {
      access.on('connect', () => resolve());
      access.on('connect_error', reject);
    });
    expect(await inRoom(`user:${B}`)).toEqual([B]);
  });

  it('token emitido antes do corte de sessão (número liberado) não conecta: session_revoked com o iat do token', async () => {
    accounts.blockedReason.mockClear();
    const old = jwt.sign({ sub: RELEASED, typ: 'access' }, { secret: SECRET });
    const revoked = await connectError({ token: old });
    expect(revoked.message).toBe('session_revoked');
    expect(revoked.data).toMatchObject({ error: 'session_revoked' });
    // o middleware passa o iat do token pro estado da conta
    expect(accounts.blockedReason).toHaveBeenCalledWith(RELEASED, expect.any(Number));
    // emitido depois do corte: entra
    const fresh = client({
      token: jwt.sign(
        { sub: RELEASED, typ: 'access', iat: REVOKED_BEFORE_S + 1 },
        { secret: SECRET },
      ),
    });
    await new Promise<void>((resolve, reject) => {
      fresh.on('connect', () => resolve());
      fresh.on('connect_error', reject);
    });
    expect(await inRoom(`user:${RELEASED}`)).toEqual([RELEASED]);
  });
});

describe('ChatGateway — emissores (só o par, nada de broadcast global)', () => {
  it('emitToUsers: UM emit com as salas user:<id> do par; cada aparelho recebe uma vez; terceiro não', async () => {
    const [a1, a2, b, c] = await Promise.all([connect(A), connect(A), connect(B), connect(C)]);
    const got = [a1, a2, b, c].map(record);
    const broadcast = jest.spyOn(gateway.server.sockets.adapter, 'broadcast');

    const payload = {
      conversationId: CONV_AB,
      reason: 'mutual',
      promotedAt: new Date(0).toISOString(),
    };
    gateway.emitToUsers([A, B, A], 'conversation:promoted', payload);

    // um broadcast = um publish no adaptador Redis (cluster); salas sem repetição
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [packet, opts] = broadcast.mock.calls[0];
    expect(packet.data).toEqual(['conversation:promoted', payload]);
    expect([...opts.rooms].sort()).toEqual([`user:${A}`, `user:${B}`]);

    await flush(a1, a2, b, c);
    expect(got[0]).toEqual([['conversation:promoted', payload]]);
    expect(got[1]).toEqual([['conversation:promoted', payload]]);
    expect(got[2]).toEqual([['conversation:promoted', payload]]);
    expect(got[3]).toEqual([]);
  });

  it('emitToUsers com lista vazia (ou só ids vazios) não emite nada — server.to([]) seria pra todo mundo', async () => {
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    const got = [a, b].map(record);
    const broadcast = jest.spyOn(gateway.server.sockets.adapter, 'broadcast');

    gateway.emitToUsers([], 'message:new', { x: 1 });
    gateway.emitToUsers(['', undefined as unknown as string], 'message:new', { x: 2 });
    gateway.emitToUser('', 'message:new', { x: 3 });

    expect(broadcast).not.toHaveBeenCalled();
    await flush(a, b);
    expect(got).toEqual([[], []]);
  });

  it('emitToUser: payload por lado (message:new com o unread de cada um) e like_received/wave_received só pro alvo', async () => {
    const [a, b, c] = await Promise.all([connect(A), connect(B), connect(C)]);
    const got = [a, b, c].map(record);

    gateway.emitToUser(A, 'message:new', { conversationId: CONV_AB, unreadCount: 0 });
    gateway.emitToUser(B, 'message:new', { conversationId: CONV_AB, unreadCount: 1 });
    gateway.emitToUser(B, 'like_received', { fromUserId: A, isSuper: false });
    gateway.emitToUser(B, 'wave_received', { fromUserId: A, name: 'A', avatar: null, at: 'x' });

    await flush(a, b, c);
    expect(got[0]).toEqual([['message:new', { conversationId: CONV_AB, unreadCount: 0 }]]);
    expect(got[1].map(([ev]) => ev)).toEqual(['message:new', 'like_received', 'wave_received']);
    expect(got[1][0][1]).toEqual({ conversationId: CONV_AB, unreadCount: 1 });
    expect(got[2]).toEqual([]);
  });

  it('eventos de match saíram: sem emitToMatch/closeMatch e sem handler de join_match', async () => {
    expect('emitToMatch' in gateway).toBe(false);
    expect('closeMatch' in gateway).toBe(false);
    const a = await connect(A);
    await expect(a.timeout(300).emitWithAck('join_match', { matchId: CONV_AB })).rejects.toThrow();
    expect(await inRoom(`match:${CONV_AB}`)).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('ChatGateway — join_conversation / leave_conversation', () => {
  it('membro entra na sala conv:<id>; de novo não consulta o banco outra vez', async () => {
    const a = await connect(A);
    expect(await join(a, CONV_AB)).toEqual({ ok: true });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([CONV_AB, A]);
    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([A]);

    expect(await join(a, CONV_AB)).toEqual({ ok: true });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('quem não pode (não membro, arquivado, bloqueado) recebe 4003 no ack e no evento error; id inválido nem vai ao banco', async () => {
    const c = await connect(C);
    const got = record(c);

    expect(await join(c, CONV_AB)).toEqual({ ok: false, code: 4003 });
    expect(await join(c, 'nao-e-uuid')).toEqual({ ok: false, code: 4003 });
    expect(await join(c, { $ne: null })).toEqual({ ok: false, code: 4003 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // só o uuid válido chegou na consulta
    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([]);

    await flush(c);
    expect(got.filter(([ev]) => ev === 'error')).toHaveLength(3);
    expect(got[0]).toEqual(['error', { code: 4003, message: 'Sem acesso a esta conversa' }]);
  });

  it('erro no banco recusa (4003) em vez de derrubar o handler', async () => {
    const a = await connect(A);
    prisma.$queryRaw.mockRejectedValueOnce(new Error('banco fora'));
    expect(await join(a, CONV_AB)).toEqual({ ok: false, code: 4003 });
    expect(await join(a, CONV_AB)).toEqual({ ok: true });
  });

  it('teto de 30 join_conversation por minuto por socket (4029) sem ir ao banco', async () => {
    const d = await connect(D);
    for (let i = 0; i < 30; i++) {
      const id = `dd000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      expect(await join(d, id)).toEqual({ ok: false, code: 4003 });
    }
    expect(await join(d, CONV_AB)).toEqual({ ok: false, code: 4029 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(30);
    // o teto é do socket, não da pessoa: outra conexão entra normalmente
    const a = await connect(A);
    expect(await join(a, CONV_AB)).toEqual({ ok: true });
  });

  it('leave_conversation sai da sala', async () => {
    const a = await connect(A);
    await join(a, CONV_AB);
    a.emit('leave_conversation', { conversationId: CONV_AB });
    await processed(a);
    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([]);
  });
});

describe('ChatGateway — typing (sala conv:<id>)', () => {
  it('vai só pro outro membro na sala; não volta pros aparelhos de quem digita; fora da sala é ignorado', async () => {
    const [a1, a2, b, c] = await Promise.all([connect(A), connect(A), connect(B), connect(C)]);
    const got = [a1, a2, b, c].map(record);
    await Promise.all([join(a1, CONV_AB), join(a2, CONV_AB), join(b, CONV_AB), join(c, CONV_AC)]);

    a1.emit('typing', { conversationId: CONV_AB, isTyping: true });
    // C não está na sala do par: o "digitando" dele pra essa conversa é descartado
    c.emit('typing', { conversationId: CONV_AB, isTyping: true });
    // formato antigo (matchId) não faz nada
    a1.emit('typing', { matchId: CONV_AB, isTyping: true });
    // A não entrou na sala da conversa com C
    b.emit('typing', { conversationId: CONV_AC, isTyping: true });
    await Promise.all([processed(a1), processed(c), processed(b)]);
    await flush(a1, a2, b, c);

    expect(got[2]).toEqual([
      ['typing_indicator', { conversationId: CONV_AB, userId: A, isTyping: true }],
    ]);
    expect(got[0]).toEqual([]);
    expect(got[1]).toEqual([]);
    expect(got[3]).toEqual([]);
  });

  it('depois do leave_conversation o outro para de receber', async () => {
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    const got = record(b);
    await Promise.all([join(a, CONV_AB), join(b, CONV_AB)]);
    b.emit('leave_conversation', { conversationId: CONV_AB });
    await processed(b);
    a.emit('typing', { conversationId: CONV_AB, isTyping: true });
    await processed(a);
    await flush(b);
    expect(got).toEqual([]);
  });
});

describe('ChatGateway — typing de quem RECEBEU a solicitação (não revela que abriu)', () => {
  const typing = (s: ClientSocket, isTyping: boolean) =>
    s.emit('typing', { conversationId: CONV_AB, isTyping });

  it('solicitação: o "digitando" de quem recebeu não chega (true nem false); o de quem pediu chega', async () => {
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    const got = [a, b].map(record);
    await Promise.all([join(a, CONV_AB), join(b, CONV_AB)]);
    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([A, B]); // entra na sala: o bloqueio é só do "digitando"

    typing(b, true);
    typing(b, false);
    typing(a, true);
    await Promise.all([processed(a), processed(b)]);
    await flush(a, b);

    expect(got[0]).toEqual([]);
    expect(got[1]).toEqual([
      ['typing_indicator', { conversationId: CONV_AB, userId: A, isTyping: true }],
    ]);
    // dentro da janela nada de reconsulta: só os 2 joins foram ao banco
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('conversa já promovida: quem recebeu digita normal', async () => {
    promoteInDb(CONV_AB);
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    const got = record(a);
    await Promise.all([join(a, CONV_AB), join(b, CONV_AB)]);
    typing(b, true);
    await processed(b);
    await flush(a);
    expect(got).toEqual([
      ['typing_indicator', { conversationId: CONV_AB, userId: B, isTyping: true }],
    ]);
  });

  it('promovida com o chat aberto: o conversation:promoted libera na hora, sem ir ao banco', async () => {
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    const got = record(a);
    await Promise.all([join(a, CONV_AB), join(b, CONV_AB)]);
    typing(b, true);
    await processed(b);

    promoteInDb(CONV_AB);
    gateway.emitToUsers([A, B], 'conversation:promoted', {
      conversationId: CONV_AB,
      reason: 'bounce',
      promotedAt: new Date().toISOString(),
    });
    typing(b, true);
    await processed(b);
    await flush(a);

    expect(got.filter(([ev]) => ev === 'typing_indicator')).toEqual([
      ['typing_indicator', { conversationId: CONV_AB, userId: B, isTyping: true }],
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // só os joins
  });

  it('promoção vista por outro processo: depois da janela reconsulta UMA vez e o próximo "digitando" passa', async () => {
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    const got = record(a);
    await Promise.all([join(a, CONV_AB), join(b, CONV_AB)]);
    promoteInDb(CONV_AB); // sem o evento neste processo

    typing(b, true); // ainda na janela: mudo, sem consulta
    await processed(b);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);

    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + TYPING_RECHECK_MS + 1);
    typing(b, true); // janela vencida: descartado, dispara a reconsulta
    typing(b, true); // mesma janela: não consulta de novo
    await processed(b);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    typing(b, false); // já liberado
    await processed(b);
    await flush(a);

    expect(got).toEqual([
      ['typing_indicator', { conversationId: CONV_AB, userId: B, isTyping: false }],
    ]);
  });

  it('reconsulta sem acesso (arquivou, bloqueio): sai da sala e continua sem "digitando"', async () => {
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    const got = record(a);
    await Promise.all([join(a, CONV_AB), join(b, CONV_AB)]);
    allowed.delete(`${CONV_AB}:${B}`);

    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + TYPING_RECHECK_MS + 1);
    typing(b, true);
    await processed(b);
    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([A]);
    typing(b, true);
    await processed(b);
    await flush(a);
    expect(got).toEqual([]);
  });
});

describe('ChatGateway — removeFromConversation (bloqueio/arquivamento)', () => {
  it('tira da sala conv:<id> todos os aparelhos dos dois; o "digitando" para; outras salas ficam', async () => {
    const [a1, a2, b, c] = await Promise.all([connect(A), connect(A), connect(B), connect(C)]);
    const got = [a1, a2, b, c].map(record);
    await Promise.all([join(a1, CONV_AB), join(a2, CONV_AB), join(b, CONV_AB)]);
    await Promise.all([join(a1, CONV_AC), join(c, CONV_AC)]);
    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([A, A, B]);

    gateway.removeFromConversation(CONV_AB, [A, B]);

    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([]);
    expect(await inRoom(`conv:${CONV_AC}`)).toEqual([A, C]);
    expect(await inRoom(`user:${A}`)).toEqual([A, A]); // as salas pessoais não mudam

    a1.emit('typing', { conversationId: CONV_AB, isTyping: true });
    b.emit('typing', { conversationId: CONV_AB, isTyping: true });
    a1.emit('typing', { conversationId: CONV_AC, isTyping: false });
    await Promise.all([processed(a1), processed(b)]);
    await flush(a1, a2, b, c);
    expect(got[0]).toEqual([]);
    expect(got[1]).toEqual([]);
    expect(got[2]).toEqual([]);
    expect(got[3]).toEqual([
      ['typing_indicator', { conversationId: CONV_AC, userId: A, isTyping: false }],
    ]);

    // voltar pra sala passa pela consulta de novo (bloqueado → recusado)
    allowed.delete(`${CONV_AB}:${B}`);
    expect(await join(b, CONV_AB)).toEqual({ ok: false, code: 4003 });
  });

  it('só as pessoas passadas saem; lista vazia não faz nada', async () => {
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    await Promise.all([join(a, CONV_AB), join(b, CONV_AB)]);
    gateway.removeFromConversation(CONV_AB, []);
    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([A, B]);
    gateway.removeFromConversation(CONV_AB, [B]);
    expect(await inRoom(`conv:${CONV_AB}`)).toEqual([A]);
  });
});

describe('ChatGateway — disconnectUser (mantido)', () => {
  it('avisa account_blocked e derruba só as conexões daquela pessoa', async () => {
    const [a, b] = await Promise.all([connect(A), connect(B)]);
    const got = record(a);
    const aDown = new Promise<void>((resolve) => a.on('disconnect', () => resolve()));
    gateway.disconnectUser(A, { error: 'account_banned' });
    await aDown;
    expect(got).toEqual([['account_blocked', { error: 'account_banned' }]]);
    expect(b.connected).toBe(true);
  });
});

describe('ChatGateway — sala da equipe (suporte ao vivo)', () => {
  it('equipe entra em staff:support ao conectar; emitToStaff só chega nela', async () => {
    const [staff, a] = await Promise.all([connect(STAFF), connect(A)]);
    const got = [staff, a].map(record);
    expect(await inRoom(STAFF_SUPPORT_ROOM)).toEqual([STAFF]);

    gateway.emitToStaff('support:thread', { thread: { id: 't1' } });
    await flush(staff, a);
    expect(got[0]).toEqual([['support:thread', { thread: { id: 't1' } }]]);
    expect(got[1]).toEqual([]);
  });

  it('papel trocado no painel: setStaffMembership põe/tira os sockets já conectados', async () => {
    const [staff, a] = await Promise.all([connect(STAFF), connect(A)]);
    gateway.setStaffMembership(STAFF, false);
    gateway.setStaffMembership(A, true);
    await Promise.all([processed(staff), processed(a)]);
    expect(await inRoom(STAFF_SUPPORT_ROOM)).toEqual([A]);
  });

  it('sem conseguir ler o papel, conecta como pessoa comum (nunca como equipe)', async () => {
    accounts.get.mockRejectedValueOnce(new Error('redis fora'));
    await connect(STAFF);
    expect(await inRoom(`user:${STAFF}`)).toEqual([STAFF]);
    expect(await inRoom(STAFF_SUPPORT_ROOM)).toEqual([]);
  });
});
