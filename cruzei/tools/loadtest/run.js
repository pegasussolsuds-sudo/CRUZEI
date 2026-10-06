#!/usr/bin/env node
// Carga: N contas do seed (+5534911…) "abrem o app" ao mesmo tempo — socket.io aberto como o app e comportamento de
// gente: andam um pouco e mandam a posição, olham quem está perto, abrem perfis, acenam, curtem, super curtem e
// conversam em pares. Mede latência p50/p95/p99 por rota, códigos HTTP, eventos de socket/s e reconexões; painel a
// cada 10 s e relatório JSON + MD em tools/loadtest/out/ no fim.
//
// Login: o token é assinado aqui mesmo com o @nestjs/jwt e o JWT_SECRET carregado pelo código de config do backend
// (mesmo payload do AuthService.issueTokens); nenhum token é impresso. Ver README.
//
//   node tools/loadtest/run.js --n 1000 --duration 600 --ramp 120 --lat -18.924 --lng -48.271
const crypto = require('node:crypto');
const fs = require('node:fs');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { io } = require('socket.io-client');
const L = require('./lib');

const a = L.parseArgs({
  n: 1000, duration: 600, ramp: 60, lat: -18.924, lng: -48.271, radius: 300,
  api: 'http://127.0.0.1:3000/v1', ws: 'http://127.0.0.1:3000',
  // intervalo MÉDIO por pessoa (s); cada espera sorteia entre 0,5× e 1,5× (rate-loc 10 = a cada 5–15 s)
  'rate-loc': 10, 'rate-nearby': 45, 'rate-profile': 40, 'rate-social': 60, 'rate-chat': 40,
  // fração das pessoas que faz cada coisa (quem abre perfil ou interage também consulta o nearby)
  'share-nearby': 0.6, 'share-profile': 0.4, 'share-social': 0.3, 'share-chat': 0.2,
  timeout: 20, panel: 10,
});
a.ramp = Math.min(a.ramp, a.duration / 2);
const CENTER = { lat: a.lat, lng: a.lng };
const PHRASES = ['Oi! Tudo bem?', 'Tô aqui perto, bora um café?', 'Que lugar é esse aí?', 'Haha verdade', 'Curti teu avatar!', 'Vai ficar até que horas?', 'Bora sim', 'Aqui tá lotado hoje', 'Tô chegando', 'Massa!'];

// ---------------- métricas ----------------
const all = new Map(); // rota → { lat: number[], codes: {código: n} } (teste inteiro)
let win = new Map(); // idem, janela do painel
const samples = {}; // "rota código" → até 3 corpos de erro
const sock = { connected: 0, connects: 0, reconnects: 0, disconnects: {}, errors: {}, events: {}, total: 0, win: 0 };
const hb = { all: [], win: [] }; // ida e volta do 'heartbeat' (ack do socket)
const near = { all: [], win: [] }; // pessoas devolvidas por /location/nearby
const timeline = [];
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
let inflight = 0;
let clientErrors = 0;
let active = 0;
let stopping = false;

const bump = (o, k) => (o[k] = (o[k] ?? 0) + 1);
const pickFrom = (list) => (list.length ? list[Math.floor(Math.random() * list.length)] : undefined);

function record(route, ms, code) {
  for (const m of [all, win]) {
    let r = m.get(route);
    if (!r) m.set(route, (r = { lat: [], codes: {} }));
    r.lat.push(ms);
    bump(r.codes, code);
  }
}

function sample(route, code, text) {
  const k = `${route} ${code}`;
  const list = (samples[k] ??= []);
  if (list.length < 3) list.push(String(text).slice(0, 200));
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
const r1 = (x) => Math.round(x * 10) / 10;

function summarize(r, seconds) {
  const s = Float64Array.from(r.lat).sort();
  let ok = 0, c4 = 0, c5 = 0, net = 0;
  for (const [k, v] of Object.entries(r.codes)) {
    const x = Number(k);
    if (x >= 200 && x < 400) ok += v;
    else if (x >= 400 && x < 500) c4 += v;
    else if (x >= 500) c5 += v;
    else net += v; // 'rede' / 'timeout'
  }
  return {
    n: s.length, rps: r1(s.length / seconds), p50: r1(pct(s, 50)), p95: r1(pct(s, 95)), p99: r1(pct(s, 99)),
    max: r1(s[s.length - 1] ?? 0), ok, c4, c5, net, errRate: r1(((s.length - ok) / (s.length || 1)) * 100), codes: r.codes,
  };
}

function quick(list) {
  const s = Float64Array.from(list).sort();
  return { n: s.length, p50: r1(pct(s, 50)), p95: r1(pct(s, 95)), p99: r1(pct(s, 99)), avg: r1(s.reduce((x, y) => x + y, 0) / (s.length || 1)), min: s[0] ?? 0, max: s[s.length - 1] ?? 0 };
}

// ---------------- HTTP ----------------
async function call(vu, method, route, path, body) {
  const t0 = performance.now();
  let code = 'rede';
  let data = null;
  inflight++;
  try {
    const res = await fetch(a.api + path, {
      method,
      headers: { authorization: `Bearer ${vu.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(a.timeout * 1000),
    });
    code = res.status;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (code >= 400) sample(route, code, text);
  } catch (e) {
    code = e.name === 'TimeoutError' ? 'timeout' : 'rede';
    sample(route, code, e.cause?.code ?? e.message);
  } finally {
    inflight--;
  }
  record(route, performance.now() - t0, code);
  return { code, data };
}

// ---------------- pessoa virtual ----------------
class VU {
  constructor(user, token, pos) {
    this.id = user.id;
    this.token = token;
    this.pos = pos;
    this.heading = Math.random() * 2 * Math.PI;
    this.near = [];
    this.liked = new Set();
    this.supers = 0;
    this.timers = new Set();
    this.partner = null;
    this.convId = null;
    this.unanswered = 0;
    const r = (k) => Math.random() < a[`share-${k}`];
    this.roles = { profile: r('profile'), social: r('social') };
    this.roles.nearby = r('nearby') || this.roles.profile || this.roles.social;
  }

  later(s, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!stopping) fn();
    }, s * 1000);
    this.timers.add(t);
  }

  every(meanS, fn, firstS = meanS * Math.random()) {
    const tick = async () => {
      try {
        await fn();
      } catch (e) {
        clientErrors++;
        sample('cliente', 'exceção', e.stack ?? e);
      }
      this.later(meanS * (0.5 + Math.random()), tick);
    };
    this.later(firstS, tick);
  }

  async start() {
    active++;
    const s = (this.socket = io(a.ws, {
      transports: ['websocket'],
      forceNew: true, // uma conexão por pessoa (sem multiplexar no mesmo Manager)
      auth: { token: this.token },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
    }));
    s.on('connect', () => {
      sock.connected++;
      sock.connects++;
    });
    s.on('disconnect', (reason) => {
      sock.connected--;
      bump(sock.disconnects, reason);
      if (reason === 'io server disconnect' && !stopping) s.connect(); // o app renova o token e reconecta
    });
    s.on('connect_error', (e) => bump(sock.errors, e.message));
    s.io.on('reconnect', () => sock.reconnects++);
    s.onAny((ev, payload) => {
      bump(sock.events, ev);
      sock.total++;
      sock.win++;
      if (ev === 'message:new') this.onMessage(payload);
    });

    // abrir o app: /me, primeira posição e o mapa
    await call(this, 'GET', 'GET /me', '/me');
    await this.sendLocation();
    this.every(a['rate-loc'], () => this.walk(), a['rate-loc'] * (0.5 + Math.random()));
    if (this.roles.nearby) this.every(a['rate-nearby'], () => this.nearby(), Math.random() * 3);
    if (this.roles.profile) this.every(a['rate-profile'], () => this.profile());
    if (this.roles.social) this.every(a['rate-social'], () => this.social());
    if (this.partner) this.every(a['rate-chat'], () => this.chat());
    this.every(30, () => this.heartbeat());
  }

  /** caminhada aleatória pequena (parado ou 2–15 m), sem sair do raio */
  walk() {
    const dn = (CENTER.lat - this.pos.lat) * 111_320;
    const de = (CENTER.lng - this.pos.lng) * 111_320 * Math.cos((CENTER.lat * Math.PI) / 180);
    if (L.distM(CENTER, this.pos) > a.radius * 0.95) this.heading = Math.atan2(de, dn);
    else this.heading += (Math.random() - 0.5) * 1.2;
    const d = Math.random() < 0.3 ? 0 : 2 + Math.random() * 13;
    this.pos = L.offset(this.pos.lat, this.pos.lng, d * Math.cos(this.heading), d * Math.sin(this.heading));
    return this.sendLocation();
  }

  sendLocation() {
    return call(this, 'POST', 'POST /location/update', '/location/update', {
      latitude: this.pos.lat,
      longitude: this.pos.lng,
      accuracyMeters: 8 + Math.round(Math.random() * 17),
    });
  }

  async nearby() {
    const { code, data } = await call(this, 'GET', 'GET /location/nearby', '/location/nearby?radius_meters=350');
    if (code === 200 && Array.isArray(data?.users)) {
      this.near = data.users.map((x) => x.id);
      near.all.push(this.near.length);
      near.win.push(this.near.length);
    }
  }

  async profile() {
    const id = pickFrom(this.near);
    if (id) await call(this, 'GET', 'GET /users/:id', `/users/${id}`);
  }

  /** aceno 45%, curtida 40%, super curtida 15% (até 5 por execução: a cota do dia é 7) */
  async social() {
    const r = Math.random();
    const fresh = pickFrom(this.near.filter((x) => !this.liked.has(x)));
    if (!fresh || r < 0.45) {
      const id = pickFrom(this.near);
      if (id) await call(this, 'POST', 'POST /waves', '/waves', { userId: id });
      return;
    }
    this.liked.add(fresh);
    if (r > 0.85 && this.supers < 5) {
      this.supers++;
      await call(this, 'POST', 'POST /likes/super', '/likes/super', { userId: fresh });
    } else await call(this, 'POST', 'POST /likes', '/likes', { userId: fresh });
  }

  /** conversa do par; no máximo 2 mensagens seguidas sem resposta (o servidor barra o REQUESTER na 4ª) */
  async chat() {
    if (this.unanswered >= 2) return;
    this.unanswered++;
    const body = pickFrom(PHRASES);
    const clientId = crypto.randomUUID();
    let res;
    if (!this.convId) {
      res = await call(this, 'POST', 'POST /conversations', '/conversations', { toUserId: this.partner.id, body, clientId });
      if (res.data?.conversation?.id) this.join(res.data.conversation.id);
    } else {
      this.socket.emit('typing', { conversationId: this.convId, isTyping: true });
      res = await call(this, 'POST', 'POST /conversations/:id/messages', `/conversations/${this.convId}/messages`, { body, clientId });
      this.socket.emit('typing', { conversationId: this.convId, isTyping: false });
    }
    if (typeof res.code !== 'number' || res.code >= 300) this.unanswered--;
  }

  join(conversationId) {
    this.convId = conversationId;
    this.socket.emit('join_conversation', { conversationId });
  }

  onMessage(p) {
    if (!this.partner || p?.message?.senderId !== this.partner.id) return;
    this.unanswered = 0;
    if (!this.convId && p.conversationId) this.join(p.conversationId);
    if (Math.random() < 0.6) this.later(2 + Math.random() * 6, () => this.chat().catch(() => clientErrors++));
  }

  heartbeat() {
    if (!this.socket.connected) return;
    const t0 = performance.now();
    this.socket.timeout(10_000).emit('heartbeat', {}, (err) => {
      if (err) return bump(sock.errors, 'heartbeat sem resposta em 10 s');
      const ms = performance.now() - t0;
      hb.all.push(ms);
      hb.win.push(ms);
    });
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
  }
}

// ---------------- painel e relatório ----------------
const T0 = Date.now();
let lastPanel = T0;
const pad = (x, n) => String(x).padStart(n);

function panel() {
  const now = Date.now();
  const secs = Math.max(1, (now - lastPanel) / 1000);
  lastPanel = now;
  const rows = [...win].map(([route, r]) => [route, summarize(r, secs)]).sort((x, y) => x[0].localeCompare(y[0]));
  const lag = { p99: r1(loop.percentile(99) / 1e6), max: r1(loop.max / 1e6) };
  loop.reset();
  const h = quick(hb.win);
  const nb = quick(near.win);
  const evps = r1(sock.win / secs);
  const t = Math.round((now - T0) / 1000);
  const lines = [
    `\n[${t}s] pessoas ${active}/${vus.length} | sockets ${sock.connected} conectados, ${sock.reconnects} reconexões, ${Object.values(sock.errors).reduce((x, y) => x + y, 0)} erros | eventos ${evps}/s | heartbeat p95 ${h.p95} ms | em voo ${inflight} | loop do cliente p99 ${lag.p99} ms`,
    `  nearby: ${nb.n ? `${nb.avg} pessoas em média (mín ${nb.min}, máx ${nb.max})` : '-'}${clientErrors ? ` | exceções no cliente ${clientErrors}` : ''}`,
    `  ${'rota'.padEnd(34)}${pad('req/s', 7)}${pad('p50', 8)}${pad('p95', 8)}${pad('p99', 8)}${pad('2xx/3xx', 9)}${pad('4xx', 6)}${pad('5xx', 6)}${pad('rede', 6)}`,
    ...rows.map(([route, s]) => `  ${route.padEnd(34)}${pad(s.rps, 7)}${pad(s.p50, 8)}${pad(s.p95, 8)}${pad(s.p99, 8)}${pad(s.ok, 9)}${pad(s.c4, 6)}${pad(s.c5, 6)}${pad(s.net, 6)}`),
  ];
  console.log(lines.join('\n'));
  timeline.push({
    t, active, sockets: sock.connected, reconnects: sock.reconnects, eventsPerS: evps, inflight, heartbeat: h, loop: lag,
    nearby: nb, routes: Object.fromEntries(rows.map(([k, s]) => [k, { rps: s.rps, p50: s.p50, p95: s.p95, p99: s.p99, ok: s.ok, c4: s.c4, c5: s.c5, net: s.net }])),
  });
  win = new Map();
  sock.win = 0;
  hb.win = [];
  near.win = [];
}

function writeReport(reason) {
  const secs = (Date.now() - T0) / 1000;
  const routes = Object.fromEntries([...all].sort((x, y) => x[0].localeCompare(y[0])).map(([k, r]) => [k, summarize(r, secs)]));
  const me = routes['GET /me'] ?? { ok: 0, n: 0 };
  const report = {
    reason, startedAt: new Date(T0).toISOString(), endedAt: new Date().toISOString(), seconds: Math.round(secs), config: a,
    logins: { ok: me.ok, total: me.n }, routes,
    sockets: { ...sock, win: undefined, heartbeat: quick(hb.all) }, nearby: quick(near.all),
    clientErrors, loopP99MaxMs: Math.max(0, ...timeline.map((x) => x.loop.p99)), samples, timeline,
  };
  const base = `run-${L.stamp()}`;
  fs.writeFileSync(L.outFile(`${base}.json`), JSON.stringify(report, null, 2));
  const md = [
    `# Teste de carga — ${report.startedAt}`,
    '',
    `- ${a.n} pessoas, ${report.seconds} s (subida ${a.ramp} s), centro ${a.lat}, ${a.lng}, raio ${a.radius} m — fim: ${reason}`,
    `- logins (GET /me 2xx): ${me.ok}/${me.n}`,
    `- sockets: ${sock.connects} conexões, ${sock.connected} abertos no fim, ${sock.reconnects} reconexões; erros ${JSON.stringify(sock.errors)}; quedas ${JSON.stringify(sock.disconnects)}`,
    `- eventos de socket recebidos: ${sock.total} (${r1(sock.total / secs)}/s) ${JSON.stringify(sock.events)}; heartbeat p50/p95/p99 ${report.sockets.heartbeat.p50}/${report.sockets.heartbeat.p95}/${report.sockets.heartbeat.p99} ms`,
    `- nearby: ${report.nearby.avg} pessoas por resposta em média (mín ${report.nearby.min}, máx ${report.nearby.max})`,
    `- exceções no cliente: ${clientErrors}; pior p99 do loop do cliente: ${report.loopP99MaxMs} ms (alto = o gerador virou gargalo)`,
    '',
    '| rota | req | req/s | p50 ms | p95 ms | p99 ms | máx ms | erro % | códigos |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---|',
    ...Object.entries(routes).map(([k, s]) => `| ${k} | ${s.n} | ${s.rps} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.max} | ${s.errRate} | ${Object.entries(s.codes).map(([c, v]) => `${c}: ${v}`).join(', ')} |`),
    '',
    ...(Object.keys(samples).length ? ['## Amostras de erro', '', ...Object.entries(samples).map(([k, v]) => `- **${k}**: ${v.map((x) => '`' + x.replace(/`/g, "'") + '`').join(' · ')}`)] : []),
    '',
  ].join('\n');
  fs.writeFileSync(L.outFile(`${base}.md`), md);
  console.log(`\n${md}\nrelatório: ${L.outFile(`${base}.json`)} e .md`);
}

let vus = [];
let panelTimer;

async function finish(reason) {
  if (stopping) return;
  stopping = true;
  clearInterval(panelTimer);
  for (const v of vus) v.stop();
  for (let i = 0; i < 50 && inflight > 0; i++) await new Promise((r) => setTimeout(r, 100));
  panel();
  writeReport(reason);
  for (const v of vus) v.socket?.close();
  process.exit(0);
}

// ---------------- main ----------------
async function main() {
  const dist = L.loadBackend();
  const { JwtService } = require('@nestjs/jwt');
  const secret = dist('config/configuration').configuration().jwt.secret;
  if (!secret) throw new Error('JWT_SECRET ausente no ambiente do backend');
  const jwt = new JwtService({ secret });

  const health = await fetch(`${a.api}/health`, { signal: AbortSignal.timeout(5_000) }).catch((e) => ({ status: e.message }));
  if (health.status !== 200) throw new Error(`backend fora do ar em ${a.api} (${health.status})`);

  const { prisma, redis } = L.prismaAndRedis();
  const users = await L.testUsers(prisma, a.n);
  const locs = await redis.pipeline(users.map((x) => ['hmget', `user:loc:${x.id}`, 'lat', 'lng'])).exec();
  await prisma.$disconnect();
  redis.disconnect();
  if (users.length < a.n) throw new Error(`só ${users.length} contas +5534911 — rode: node tools/loadtest/seed.js --n ${a.n}`);

  // mesmo payload do AuthService.issueTokens (access), com validade pro teste inteiro (o do app vale 15 min)
  const ttl = Math.ceil(a.duration + 900);
  vus = users.map((x, i) => {
    const [lat, lng] = locs[i][1] ?? [];
    const pos = lat ? { lat: Number(lat), lng: Number(lng) } : L.pointInDisk(a.lat, a.lng, a.radius, Math.random);
    return new VU(x, jwt.sign({ sub: x.id, phone: x.phone, typ: 'access' }, { expiresIn: ttl }), pos);
  });
  // pares de conversa fixos (as mesmas conversas a cada execução: não gasta o teto de conversas novas do dia)
  const pairs = Math.floor((a.n * a['share-chat']) / 2);
  const stride = pairs ? Math.max(1, Math.floor(a.n / 2 / pairs)) : 0;
  for (let k = 0; k < pairs; k++) {
    const [x, y] = [vus[2 * k * stride], vus[2 * k * stride + 1]];
    x.partner = y;
    y.partner = x;
  }

  const probe = await fetch(`${a.api}/me`, { headers: { authorization: `Bearer ${vus[0].token}` } });
  if (probe.status === 401) throw new Error('401 no /me: o servidor está com outro JWT_SECRET (subiu com variável na linha de comando?)');

  const roles = (k) => vus.filter((v) => v.roles[k]).length;
  console.log(
    `${a.n} pessoas em ${a.ramp} s de subida, ${a.duration} s no total | nearby ${roles('nearby')}, perfis ${roles('profile')}, ` +
      `acenos/curtidas ${roles('social')}, conversas ${pairs * 2} (${pairs} pares) | posição a cada ${a['rate-loc'] / 2}–${a['rate-loc'] * 1.5} s`,
  );
  process.on('SIGINT', () => finish('interrompido (Ctrl+C)'));
  panelTimer = setInterval(panel, a.panel * 1000);
  setTimeout(() => finish('duração atingida'), a.duration * 1000);
  vus.forEach((v, i) => setTimeout(() => !stopping && v.start().catch((e) => sample('cliente', 'start', e.message)), (i / a.n) * a.ramp * 1000));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
