// Auditoria de segurança/moderação contra o backend LIGADO (dev, PHOTO_MODERATION=manual):
//   pnpm exec ts-node test/moderation-audit.ts [http://127.0.0.1:3000]
// Cria contas descartáveis (+55 34 98888-00xx), exercita cadastro com aceite, documentos legais, fotos em análise,
// denúncia (inclusive exploração infantil), fila da moderação, suspensão, banimento, bloqueio (some da inbox dos
// dois), mídia no chat e o que o cartão público revela (likeStatus + conversa do par).
// Imprime PASS/FAIL por teste, apaga as contas no fim e sai com 1 se algum falhar.
import 'dotenv/config';
import * as os from 'node:os';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { LEGAL_VERSION } from '@cruzei/shared-types';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const API = `${BASE}/v1`;
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
// +55 34 98888-00xx (celular BR: 13 dígitos com o 55) — faixa só deste teste: o seed-dev usa +55 34 90000-0xxx
const PHONE_PREFIX = '+55349888800';
const results: { name: string; ok: boolean }[] = [];

function report(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function token(userId: string, phone: string) {
  return jwt.sign({ sub: userId, phone }, process.env.JWT_SECRET as string, { expiresIn: '15m' });
}
async function call(tok: string | null, method: string, path: string, body?: unknown, base = API) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json: json as Record<string, unknown>, headers: res.headers };
}
/** outro IP de origem (o rate limit das rotas de login é 5/min por IP): o IP da rede local desta máquina */
function lanBase(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return BASE.replace('127.0.0.1', i.address);
  }
  return BASE;
}
function socketError(tok: string): Promise<string> {
  return new Promise((resolve) => {
    const s = ioClient(BASE, { transports: ['websocket'], auth: { token: tok }, reconnection: false, timeout: 5000 });
    const done = (v: string) => {
      s.close();
      resolve(v);
    };
    s.on('connect', () => done('connected'));
    s.on('connect_error', (e) => done(e.message));
    setTimeout(() => done('timeout'), 6000);
  });
}
/** socket conectado (null se não conectar em 5 s) */
function socketOf(tok: string): Promise<ClientSocket | null> {
  return new Promise((resolve) => {
    const s = ioClient(BASE, { transports: ['websocket'], auth: { token: tok }, reconnection: false, timeout: 5000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', () => resolve(null));
    setTimeout(() => resolve(s.connected ? s : null), 5000);
  });
}
/** primeiro payload do evento (null se não vier no prazo) */
function eventOnce<T>(s: ClientSocket | null, event: string, ms = 5000): Promise<T | null> {
  return new Promise((resolve) => {
    if (!s) return resolve(null);
    const t = setTimeout(() => resolve(null), ms);
    s.once(event, (d: T) => {
      clearTimeout(t);
      resolve(d);
    });
  });
}
/** ack do join_conversation ({ok} ou {ok:false, code}); null sem resposta */
async function joinConversation(s: ClientSocket | null, conversationId: string) {
  if (!s) return null;
  return (await s
    .timeout(3000)
    .emitWithAck('join_conversation', { conversationId })
    .catch(() => null)) as { ok: boolean; code?: number } | null;
}
type ConvList = { items?: { id: string; unreadCount: number }[] };

async function mkUser(n: number, name: string, extra: Record<string, unknown> = {}) {
  const phone = `${PHONE_PREFIX}${String(n).padStart(2, '0')}`;
  const u = await prisma.user.create({
    data: {
      phone,
      name,
      birthDate: new Date('1995-05-05'),
      gender: 'female',
      visibilityMode: 'visible',
      termsVersion: LEGAL_VERSION,
      termsAcceptedAt: new Date(),
      ...extra,
    } as never,
  });
  return { id: u.id, phone, tok: token(u.id, phone) };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { phone: { startsWith: PHONE_PREFIX } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await prisma.moderationAction.deleteMany({ where: { targetUserId: { in: ids } } });
  await prisma.accessLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await Promise.all(ids.flatMap((id) => [redis.del(`acct:v1:${id}`), redis.del(`profile:${id}`)]));
}

async function main() {
  await cleanup();

  // 1 — cadastro de verdade (SMS de dev): sem aceite não cria conta; com aceite grava versão e registro de acesso
  const phone = `${PHONE_PREFIX}99`;
  const rc = await call(null, 'POST', '/auth/request-code', { phone });
  const devCode = (rc.json as { devCode?: string }).devCode;
  const login = await call(null, 'POST', '/auth/login', { phone, code: devCode });
  const payload = { phone, name: 'Teste Aceite', birthDate: '1996-02-02', gender: 'female', lookingFor: 'relationship' };
  const noTerms = await call(null, 'POST', '/auth/register', payload);
  report('1 cadastro sem aceite dos Termos é recusado', noTerms.status === 400, `status ${noTerms.status}`);
  const reg = await call(null, 'POST', '/auth/register', { ...payload, termsVersion: LEGAL_VERSION });
  const regTok = (reg.json as { token?: string }).token ?? '';
  const me = await call(regTok, 'GET', '/me');
  const legal = (me.json as { legal?: { acceptedVersion: string; currentVersion: string } }).legal;
  report('1b cadastro com aceite grava a versão', reg.status === 201 && legal?.acceptedVersion === LEGAL_VERSION, `login ${login.status}, register ${reg.status}, legal=${JSON.stringify(legal)}`);
  const regId = (reg.json as { user?: { id: string } }).user?.id ?? '';
  await new Promise((r) => setTimeout(r, 300));
  const logs = await prisma.accessLog.findMany({ where: { userId: regId } });
  report('1c registro de acesso (Marco Civil) com IP e porta', logs.some((l) => l.event === 'register' && l.ip && l.port), `${logs.length} registros: ${logs.map((l) => `${l.event}@${l.ip}:${l.port}`).join(', ')}`);

  // 2 — documentos legais: API do app e página pública pras lojas
  const docs = await call(null, 'GET', '/legal-docs');
  const doc = await call(null, 'GET', '/legal-docs/privacidade');
  const page = await fetch(`${BASE}/legal/privacidade`);
  const html = await page.text();
  report(
    '2 documentos legais (3 no app + página pública)',
    docs.status === 200 && (docs.json as unknown as unknown[]).length === 3 && doc.status === 200 && page.status === 200 && (page.headers.get('content-type') ?? '').includes('text/html') && html.includes('<h1>'),
    `lista ${docs.status}, doc ${doc.status}, página ${page.status} ${page.headers.get('content-type')}`,
  );
  const missing = await fetch(`${BASE}/legal/nao-existe`);
  report('2b documento inexistente → 404', missing.status === 404, `status ${missing.status}`);

  // 3 — conta antiga sem aceite: /me pede aceite; versão errada é recusada; a certa grava
  const old = await mkUser(1, 'Conta Antiga', { termsVersion: null, termsAcceptedAt: null });
  const oldMe = await call(old.tok, 'GET', '/me');
  const wrong = await call(old.tok, 'POST', '/me/terms', { version: '0.9' });
  const right = await call(old.tok, 'POST', '/me/terms', { version: LEGAL_VERSION });
  report(
    '3 novo aceite pra conta antiga',
    (oldMe.json as { legal?: { acceptedVersion: string | null } }).legal?.acceptedVersion === null && wrong.status === 400 && right.status === 201,
    `me.legal=${JSON.stringify((oldMe.json as { legal?: unknown }).legal)}, versão errada ${wrong.status}, certa ${right.status}`,
  );

  // 4 — foto nova fica em análise: o dono vê "pending", os outros não veem
  const x = await mkUser(2, 'Xis');
  const y = await mkUser(3, 'Ypsilon');
  const z = await mkUser(4, 'Zeta');
  const mod = await mkUser(5, 'Moderadora', { role: 'moderator' });
  const add = await call(x.tok, 'POST', '/me/photos', { url: `${BASE}/uploads/teste-moderacao.jpg` });
  const photoId = (add.json as { id?: string }).id ?? '';
  const card1 = await call(y.tok, 'GET', `/users/${x.id}`);
  report(
    '4 foto nova em análise não aparece pra ninguém',
    (add.json as { status?: string }).status === 'pending' && ((card1.json as { photos?: unknown[] }).photos ?? []).length === 0,
    `status=${(add.json as { status?: string }).status}, fotos no cartão=${((card1.json as { photos?: unknown[] }).photos ?? []).length} (cartão ${card1.status})`,
  );

  // 5 — fila da moderação: só moderador acessa; aprovar publica a foto
  const denied = await call(y.tok, 'GET', '/admin/queue');
  const queue = await call(mod.tok, 'GET', '/admin/queue');
  const inQueue = ((queue.json as { photos?: { id: string }[] }).photos ?? []).some((p) => p.id === photoId);
  const approve = await call(mod.tok, 'POST', `/admin/photos/${photoId}`, { decision: 'approve' });
  const card2 = await call(y.tok, 'GET', `/users/${x.id}`);
  report(
    '5 fila só pra moderação e aprovação publica a foto',
    denied.status === 403 && queue.status === 200 && inQueue && approve.status === 201 && ((card2.json as { photos?: unknown[] }).photos ?? []).length === 1,
    `não-moderador ${denied.status}, fila ${queue.status} (na fila: ${inQueue}), aprovar ${approve.status}, fotos depois=${((card2.json as { photos?: unknown[] }).photos ?? []).length}`,
  );
  const add2 = await call(x.tok, 'POST', '/me/photos', { url: `${BASE}/uploads/teste-moderacao-2.jpg` });
  const reject = await call(mod.tok, 'POST', `/admin/photos/${(add2.json as { id?: string }).id}`, { decision: 'reject', reason: 'Nudez ou conteúdo sexual' });
  const xMe = await call(x.tok, 'GET', '/me');
  const rejected = ((xMe.json as { photos?: { status: string; rejectReason: string | null }[] }).photos ?? []).find((p) => p.status === 'rejected');
  report('5b foto recusada: o dono vê o motivo', reject.status === 201 && rejected?.rejectReason === 'Nudez ou conteúdo sexual', `recusar ${reject.status}, motivo=${rejected?.rejectReason}`);

  // 6 — denúncia: valida alvo, soma repetida, e exploração infantil tira da descoberta na hora.
  //     POST /users/:id/report (rota nova, alvo na rota) e POST /reports (alias) caem no mesmo serviço
  const convYX = await call(y.tok, 'POST', '/conversations', { toUserId: x.id, body: 'oi', clientId: 'teste-denuncia-0' });
  const convYXId = (convYX.json as { conversation?: { id: string } }).conversation?.id ?? '';
  const self = await call(y.tok, 'POST', `/users/${y.id}/report`, { reason: 'spam' });
  const ghost = await call(y.tok, 'POST', '/users/00000000-0000-4000-8000-000000000000/report', { reason: 'spam' });
  const badSource = await call(y.tok, 'POST', `/users/${x.id}/report`, { reason: 'spam', context: { source: 'feed' } });
  const r1 = await call(y.tok, 'POST', `/users/${x.id}/report`, { reason: 'harassment', description: 'me xingou', context: { source: 'chat', conversationId: convYXId } });
  const r2 = await call(y.tok, 'POST', '/reports', { userId: x.id, reason: 'threat', description: 'ameaçou' });
  report(
    '6 denúncia: própria conta 400, alvo inexistente 404, origem inválida 400, repetida soma (rota nova + alias)',
    convYX.status === 201 && self.status === 400 && ghost.status === 404 && badSource.status === 400 && r1.status === 201 && (r2.json as { merged?: boolean }).merged === true,
    `conversa ${convYX.status}, própria ${self.status}, inexistente ${ghost.status}, origem inválida ${badSource.status}, 1ª ${r1.status}, 2ª merged=${(r2.json as { merged?: boolean }).merged}`,
  );
  const r3 = await call(z.tok, 'POST', '/reports', { userId: x.id, reason: 'child_safety', block: true });
  const held = await prisma.user.findUnique({ where: { id: x.id }, select: { reviewHoldAt: true } });
  const card3 = await call(mod.tok, 'GET', `/users/${x.id}`);
  const q2 = await call(mod.tok, 'GET', '/admin/queue');
  const group = ((q2.json as { reports?: { user: { id: string }; priority: number; distinctReporters: number }[] }).reports ?? []).find((g) => g.user.id === x.id);
  report(
    '6b exploração infantil: sai da descoberta na hora e vai pro topo da fila',
    r3.status === 201 && (r3.json as { blocked?: boolean }).blocked === true && Boolean(held?.reviewHoldAt) && card3.status === 404 && group?.priority === 3 && group.distinctReporters === 2,
    `denúncia ${r3.status} (bloqueou: ${(r3.json as { blocked?: boolean }).blocked}), hold=${Boolean(held?.reviewHoldAt)}, cartão ${card3.status}, fila prioridade=${group?.priority} denunciantes=${group?.distinctReporters}`,
  );
  const detail = await call(mod.tok, 'GET', `/admin/users/${x.id}`);
  // a conversa citada na denúncia (context.conversationId) aparece pro moderador com as mensagens
  const reported = ((detail.json as { conversations?: { conversationId: string; otherUserId: string; messages: unknown[] }[] }).conversations ?? []).find(
    (c) => c.conversationId === convYXId,
  );
  report(
    '6c detalhe pra moderação (telefone mascarado, conversa denunciada)',
    detail.status === 200 && /•/.test(String((detail.json as { user?: { phoneMasked?: string } }).user?.phoneMasked)) && reported?.otherUserId === y.id && reported.messages.length >= 1,
    `phone=${(detail.json as { user?: { phoneMasked?: string } }).user?.phoneMasked}, conversa=${Boolean(reported)} (${reported?.messages.length ?? 0} msgs)`,
  );

  // 7 — dispensar: denúncias arquivadas e a pessoa volta pra descoberta
  const dismiss = await call(mod.tok, 'POST', `/admin/users/${x.id}/action`, { action: 'dismiss', note: 'teste' });
  const afterDismiss = await prisma.user.findUnique({ where: { id: x.id }, select: { reviewHoldAt: true } });
  const pending = await prisma.report.count({ where: { reportedId: x.id, status: 'pending' } });
  report('7 dispensar limpa a retenção e as denúncias pendentes', dismiss.status === 201 && !afterDismiss?.reviewHoldAt && pending === 0, `ação ${dismiss.status}, hold=${Boolean(afterDismiss?.reviewHoldAt)}, pendentes=${pending}`);

  // 8 — suspensão: token válido perde acesso na hora (HTTP e socket); reabilitar devolve
  const noReason = await call(mod.tok, 'POST', `/admin/users/${x.id}/action`, { action: 'suspend', days: 400 });
  const susp = await call(mod.tok, 'POST', `/admin/users/${x.id}/action`, { action: 'suspend', days: 7, reason: 'Assédio no chat' });
  const meSusp = await call(x.tok, 'GET', '/me');
  const sockSusp = await socketError(x.tok);
  report(
    '8 suspensão corta HTTP e socket com o motivo',
    noReason.status === 400 && susp.status === 201 && meSusp.status === 403 && meSusp.json.error === 'account_suspended' && meSusp.json.reason === 'Assédio no chat' && Boolean(meSusp.json.until) && sockSusp === 'account_suspended',
    `dias=400 → ${noReason.status}, /me ${meSusp.status} ${meSusp.json.error} until=${meSusp.json.until}, socket=${sockSusp}`,
  );
  const self2 = await call(mod.tok, 'POST', `/admin/users/${mod.id}/action`, { action: 'ban', reason: 'x' });
  const reinst = await call(mod.tok, 'POST', `/admin/users/${x.id}/action`, { action: 'reinstate' });
  const meBack = await call(x.tok, 'GET', '/me');
  report('8b reabilitar devolve o acesso; moderar a si mesmo é recusado', reinst.status === 201 && meBack.status === 200 && self2.status === 400, `reabilitar ${reinst.status}, /me ${meBack.status}, a si mesmo ${self2.status}`);

  // 9 — solicitação + bloqueio: some dos DOIS lados na hora (conversation:removed pros dois, sala do chat
  //     fechada), perfil e envio com 404, unread zerado, Like/Message intactos; desbloquear NÃO desarquiva
  const opened = await call(z.tok, 'POST', '/conversations', { toUserId: y.id, body: 'oi, tudo bem?', clientId: 'teste-bloqueio-0' });
  const conversationId = (opened.json as { conversation?: { id: string } }).conversation?.id ?? '';
  const yReqBefore = await call(y.tok, 'GET', '/inbox/requests');
  const inReqBefore = ((yReqBefore.json as ConvList).items ?? []).find((c) => c.id === conversationId);
  const [zSock, ySock] = await Promise.all([socketOf(z.tok), socketOf(y.tok)]);
  const joined = await joinConversation(zSock, conversationId);
  const removedEvents = Promise.all([zSock, ySock].map((s) => eventOnce<{ conversationId: string }>(s, 'conversation:removed')));
  const pairLikes = { OR: [{ likerId: y.id, likedId: z.id }, { likerId: z.id, likedId: y.id }] };
  const likesBefore = await prisma.like.count({ where: pairLikes });
  const msgsBefore = await prisma.message.count({ where: { conversationId } });
  const blk = await call(y.tok, 'POST', `/users/${z.id}/block`, { reason: 'teste' });
  const [zRemoved, yRemoved] = await removedEvents;
  const rejoin = await joinConversation(zSock, conversationId);
  zSock?.close();
  ySock?.close();
  const zConv = await call(z.tok, 'GET', `/conversations/${conversationId}`);
  const zMsg = await call(z.tok, 'POST', `/conversations/${conversationId}/messages`, { body: 'oi?', clientId: 'teste-bloqueio-1' });
  const zCard = await call(z.tok, 'GET', `/users/${y.id}`);
  const yCard = await call(y.tok, 'GET', `/users/${z.id}`);
  const lists = await Promise.all(
    ([[y.tok, '/inbox'], [y.tok, '/inbox/requests'], [z.tok, '/inbox'], [z.tok, '/inbox/requests']] as const).map(([t, p]) => call(t, 'GET', p)),
  );
  const listed = lists.some((l) => ((l.json as ConvList).items ?? []).some((c) => c.id === conversationId));
  const members = await prisma.conversationMember.findMany({ where: { conversationId }, select: { archivedAt: true, unreadCount: true } });
  const likesAfter = await prisma.like.count({ where: pairLikes });
  const msgsAfter = await prisma.message.count({ where: { conversationId } });
  report(
    '9 bloquear tira a conversa dos dois na hora (evento pros dois, sala fechada, 404, unread 0)',
    opened.status === 201 &&
      Boolean(conversationId) &&
      inReqBefore?.unreadCount === 1 &&
      joined?.ok === true &&
      blk.status < 300 &&
      zRemoved?.conversationId === conversationId &&
      yRemoved?.conversationId === conversationId &&
      rejoin?.ok === false &&
      rejoin.code === 4003 &&
      zConv.status === 404 &&
      zMsg.status === 404 &&
      zCard.status === 404 &&
      yCard.status === 404 &&
      lists.every((l) => l.status === 200) &&
      !listed &&
      members.length === 2 &&
      members.every((m) => m.archivedAt && m.unreadCount === 0) &&
      likesAfter === likesBefore &&
      msgsAfter === msgsBefore,
    `abrir ${opened.status}, nas solicitações de Y antes: unread=${inReqBefore?.unreadCount}, join=${JSON.stringify(joined)}, bloquear ${blk.status}, ` +
      `conversation:removed Z=${zRemoved?.conversationId === conversationId} Y=${yRemoved?.conversationId === conversationId}, rejoin=${JSON.stringify(rejoin)}, ` +
      `GET conversa ${zConv.status}, mensagem ${zMsg.status}, cartões ${zCard.status}/${yCard.status}, listas ${lists.map((l) => l.status).join('/')} (aparece: ${listed}), ` +
      `membros=${JSON.stringify(members.map((m) => ({ arq: Boolean(m.archivedAt), unread: m.unreadCount })))}, likes ${likesBefore}→${likesAfter}, msgs ${msgsBefore}→${msgsAfter}`,
  );
  // lista de bloqueados: nome + avatar, nunca a foto; bloquear de novo não cria outra linha
  const again = await call(y.tok, 'POST', `/users/${z.id}/block`, {});
  const blockedList = await call(y.tok, 'GET', '/blocks');
  const blockedRows = (blockedList.json as unknown as { user: { id: string; avatar?: unknown; mainPhotoUrl: string | null } }[]) ?? [];
  const zRow = Array.isArray(blockedRows) ? blockedRows.filter((b) => b.user.id === z.id) : [];
  report(
    '9c lista de bloqueados sem foto e bloqueio repetido idempotente',
    again.status === 201 && blockedList.status === 200 && zRow.length === 1 && zRow[0].user.mainPhotoUrl === null && Boolean(zRow[0].user.avatar),
    `de novo ${again.status}, lista ${blockedList.status}, linhas de Z=${zRow.length}, foto=${zRow[0]?.user.mainPhotoUrl}, avatar=${Boolean(zRow[0]?.user.avatar)}`,
  );
  await call(y.tok, 'DELETE', `/blocks/${z.id}`);
  const afterUnblock = await prisma.conversationMember.findMany({ where: { conversationId }, select: { archivedAt: true } });
  const yReqAfter = await call(y.tok, 'GET', '/inbox/requests');
  const backInList = ((yReqAfter.json as ConvList).items ?? []).some((c) => c.id === conversationId);
  report(
    '9b desbloquear não desarquiva (só volta com mensagem nova)',
    afterUnblock.length === 2 && afterUnblock.every((m) => m.archivedAt) && !backInList,
    `arquivada pros dois=${afterUnblock.every((m) => m.archivedAt)}, de volta nas solicitações=${backInList}`,
  );

  // 10 — mídia no chat desligada (não passa pela moderação de fotos)
  const w = await mkUser(6, 'Wanda');
  const convW = await call(y.tok, 'POST', '/conversations', { toUserId: w.id, body: 'oi', clientId: 'teste-midia-0' });
  const convWId = (convW.json as { conversation?: { id: string } }).conversation?.id ?? '';
  const media = await call(y.tok, 'POST', `/conversations/${convWId}/media`, { type: 'photo_temp', mediaUrl: `${BASE}/uploads/x.jpg`, clientId: 'm1' });
  report('10 mídia no chat desligada', convW.status === 201 && media.status === 403 && media.json.error === 'media_disabled', `conversa ${convW.status}, mídia ${media.status} ${media.json.error}`);

  // 11 — banimento: perde acesso, login e refresh recusados com o motivo; conversas arquivadas pros dois lados
  await call(x.tok, 'POST', '/likes', { userId: y.id });
  await call(y.tok, 'POST', '/likes', { userId: x.id });
  const convX = await call(x.tok, 'POST', '/conversations', { toUserId: y.id, body: 'oi', clientId: 'teste-ban-0' });
  const convXId = (convX.json as { conversation?: { id: string } }).conversation?.id ?? '';
  const yBanSock = await socketOf(y.tok);
  const yBanRemoved = eventOnce<{ conversationId: string }>(yBanSock, 'conversation:removed');
  const ban = await call(mod.tok, 'POST', `/admin/users/${x.id}/action`, { action: 'ban', reason: 'Exploração infantil confirmada' });
  const gotBanRemoved = (await yBanRemoved)?.conversationId === convXId;
  yBanSock?.close();
  const meBan = await call(x.tok, 'GET', '/me');
  const lan = `${lanBase()}/v1`;
  const rc2 = await call(null, 'POST', '/auth/request-code', { phone: x.phone }, lan);
  const loginBan = await call(null, 'POST', '/auth/login', { phone: x.phone, code: (rc2.json as { devCode?: string }).devCode }, lan);
  const refreshBan = await call(null, 'POST', '/auth/refresh', { refreshToken: jwt.sign({ sub: x.id, phone: x.phone }, process.env.JWT_SECRET as string, { expiresIn: '30d' }) });
  const xConvs = await prisma.conversationMember.findMany({ where: { conversation: { OR: [{ userLowId: x.id }, { userHighId: x.id }] } }, select: { archivedAt: true } });
  const openConvs = xConvs.filter((m) => !m.archivedAt).length;
  report(
    '11 banimento: /me, login e refresh recusados; conversas arquivadas (evento pro outro lado)',
    ban.status === 201 && meBan.status === 403 && meBan.json.error === 'account_banned' && loginBan.status === 403 && loginBan.json.error === 'account_banned' && refreshBan.status === 403 && convX.status === 201 && xConvs.length > 0 && openConvs === 0 && gotBanRemoved,
    `/me ${meBan.status} ${meBan.json.error}, login ${loginBan.status} ${loginBan.json.error}, refresh ${refreshBan.status}, conversa ${convX.status}, membros ativos=${openConvs}/${xConvs.length}, conversation:removed=${gotBanRemoved}`,
  );
  const cardBan = await call(y.tok, 'GET', `/users/${x.id}`);
  const likeBan = await call(z.tok, 'POST', '/likes', { userId: x.id });
  report('11b banida some do cartão e não recebe curtida', cardBan.status === 404 && likeBan.status === 404, `cartão ${cardBan.status}, curtida ${likeBan.status}`);
  const trail = await prisma.moderationAction.findMany({ where: { targetUserId: x.id }, select: { action: true } });
  report('11c trilha da moderação registrada', ['auto_hold', 'dismiss', 'suspend:7', 'reinstate', 'ban', 'photo_approve', 'photo_reject'].every((a) => trail.some((t) => t.action === a)), trail.map((t) => t.action).join(', '));

  // 12 — cartão público: "já te curtiu" (RECEIVED) só sai do servidor pra Premium+; a conversa do par vem com a
  //      pasta de quem vê (Y abriu a conversa do teste 10: principal pra Y, solicitação pra W); nada de "match"
  type Card = { likeStatus?: string; likedMe?: boolean; conversation?: { id: string; folder: string } | null; match?: unknown };
  await call(w.tok, 'POST', '/likes', { userId: y.id });
  const yFree = await call(y.tok, 'GET', `/users/${w.id}`);
  await prisma.user.update({ where: { id: y.id }, data: { premiumTier: 'premium_plus', premiumExpiresAt: new Date(Date.now() + 86_400_000) } });
  const yPlus = await call(y.tok, 'GET', `/users/${w.id}`);
  const wCard = await call(w.tok, 'GET', `/users/${y.id}`);
  const yf = yFree.json as Card;
  const yp = yPlus.json as Card;
  const wc = wCard.json as Card;
  report(
    '12 cartão: RECEIVED só pra Premium+, conversa com a pasta de quem vê, sem match',
    yf.likeStatus === 'NONE' && yf.likedMe === false && yp.likeStatus === 'RECEIVED' && yp.likedMe === true &&
      yp.conversation?.id === convWId && yp.conversation.folder === 'inbox' &&
      wc.likeStatus === 'SENT' && wc.conversation?.id === convWId && wc.conversation.folder === 'requests' &&
      !('match' in yf) && !('match' in wc),
    `Y grátis=${yf.likeStatus}/${yf.likedMe}, Y Premium+=${yp.likeStatus}/${yp.likedMe}, conversa Y=${yp.conversation?.folder}, W=${wc.likeStatus} conversa=${wc.conversation?.folder}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    results.push({ name: 'exceção', ok: false });
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error('limpeza falhou:', e.message));
    await prisma.$disconnect();
    redis.disconnect();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} PASS`);
    process.exit(failed ? 1 : 0);
  });
