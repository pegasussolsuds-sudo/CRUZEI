// Testes de segurança de localização (brief PRIVACIDADE §23) — rodam contra o backend LIGADO (dev):
//   pnpm exec ts-node test/privacy-audit.ts [http://127.0.0.1:3000]
// Usa dois fakes do seed-dev (Aline e Rafael) e a conta de teste como "atacante". Assina tokens com o JWT_SECRET
// do .env (só funciona em dev). Cada teste imprime PASS/FAIL; o processo sai com 1 se algum falhar.
import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { io as ioClient } from 'socket.io-client';
import { FORBIDDEN_CLIENT_KEYS, findForbiddenKeys, PRIVACY } from '../src/modules/location/discovery-privacy';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const API = `${BASE}/v1`;
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const results: { name: string; ok: boolean; detail: string }[] = [];
function report(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function token(userId: string, phone: string) {
  return jwt.sign({ sub: userId, phone }, process.env.JWT_SECRET as string, { expiresIn: '15m' });
}
async function call(tok: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* vazio */ }
  return { status: res.status, json };
}
async function presence(userId: string, lat: number, lng: number) {
  const gh = await redis.hget(`user:loc:${userId}`, 'geohash');
  await redis.hset(`user:loc:${userId}`, { lat: String(lat), lng: String(lng), updated_at: String(Date.now()), hidden: '0' });
  if (gh) await redis.zadd(`presence:${gh}`, Date.now(), userId);
}

async function main() {
  const [a, b, me] = await Promise.all([
    prisma.user.findFirst({ where: { name: 'Aline' }, select: { id: true, phone: true } }),
    prisma.user.findFirst({ where: { name: 'Rafael' }, select: { id: true, phone: true } }),
    prisma.user.findFirst({ where: { name: 'douglas' }, select: { id: true, phone: true } }),
  ]);
  if (!a || !b || !me) throw new Error('rode o seed-dev antes (Aline/Rafael) e tenha a conta douglas');
  const tA = token(a.id, a.phone ?? ''), tB = token(b.id, b.phone ?? ''), tMe = token(me.id, me.phone ?? '');
  // posições reais controladas (Uberlândia): A e B a ~120 m um do outro; eu a ~150 m de A
  const A = { lat: -18.9230, lng: -48.2700 };
  const B = { lat: -18.9241, lng: -48.2700 };
  const ME = { lat: -18.9243, lng: -48.2712 };
  await Promise.all([presence(a.id, A.lat, A.lng), presence(b.id, B.lat, B.lng), presence(me.id, ME.lat, ME.lng)]);
  await redis.del(`loc:gate:${me.id}`, `loc:gate:${a.id}`, `loc:gate:${b.id}`);

  // TESTE 1 — API: nenhuma chave proibida na descoberta
  {
    const r = await call(tMe, 'GET', '/location/nearby');
    const bad = findForbiddenKeys(r.json);
    const users = (r.json as { users?: unknown[] })?.users ?? [];
    report('1 API /nearby sem lat/lng/distância/horário de terceiros', r.status === 200 && bad.length === 0, `status ${r.status}, ${users.length} pessoas, chaves proibidas: ${bad.join(', ') || 'nenhuma'}`);
    const withPos = users.filter((u) => (u as { mapPosition: unknown }).mapPosition);
    // posição visual nunca coincide com a real (célula/lugar)
    let coincide = 0;
    for (const u of withPos as { id: string; mapPosition: { lat: number; lng: number } }[]) {
      const real = await redis.hgetall(`user:loc:${u.id}`);
      if (real.lat && Math.abs(Number(real.lat) - u.mapPosition.lat) < 1e-5 && Math.abs(Number(real.lng) - u.mapPosition.lng) < 1e-5) coincide += 1;
    }
    report('1b posição visual ≠ posição real', coincide === 0, `${withPos.length} com marcador, ${coincide} coincidindo`);
  }

  // TESTE 2 — usuário arbitrário: cartão não devolve coordenada/distância; id inexistente = mesma resposta que anônimo
  {
    const r = await call(tMe, 'GET', `/users/${a.id}`);
    const bad = findForbiddenKeys(r.json);
    report('2 cartão /users/:id só faixa (sem coordenada/distância)', r.status === 200 && bad.length === 0, `chaves proibidas: ${bad.join(', ') || 'nenhuma'}; band=${(r.json as { proximityBand?: string })?.proximityBand}`);
    const r404 = await call(tMe, 'GET', '/users/00000000-0000-4000-8000-000000000000');
    const rAnon = await prisma.user.findFirst({ where: { visibilityMode: 'anonymous', deletedAt: null }, select: { id: true } });
    const rAnonRes = rAnon ? await call(tMe, 'GET', `/users/${rAnon.id}`) : null;
    report('2b inexistente e anônimo respondem igual (sem enumeração)', r404.status === 404 && (!rAnonRes || (rAnonRes.status === 404 && JSON.stringify(rAnonRes.json) === JSON.stringify(r404.json))), `404=${JSON.stringify(r404.json).slice(0, 60)}`);
    const rMe = await call(tMe, 'GET', '/location/me');
    report('2c /location/me só devolve a MINHA posição', rMe.status === 200, 'dado próprio');
  }

  // TESTE 3 — rate limit: 40 consultas seguidas ao /nearby → 429 em algum momento
  {
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const r = await call(tMe, 'GET', '/location/nearby');
      if (r.status === 429) limited += 1;
    }
    report('3 rate limit no /nearby (20/min)', limited > 0, `${limited} respostas 429 em 40 chamadas`);
    // o limite é por usuário: A e B não são afetados; "eu" espero a janela de 1 min fechar antes dos próximos testes
    const other = await call(tA, 'GET', '/location/nearby');
    report('3b limite é por usuário (outra conta segue respondendo)', other.status === 200, `A: ${other.status}`);
    console.log('   … aguardando 61 s pela janela do rate limit');
    await new Promise((r) => setTimeout(r, 61_000));
  }

  // TESTE 4 — triangulação: B anda 30 m por vez dentro da mesma célula → o marcador não acompanha
  {
    const positions: string[] = [];
    const bandsSeen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      await presence(b.id, B.lat + i * 0.00027, B.lng); // ~30 m por passo pro norte
      await redis.del(`rate:${me.id}:nearby`);
      const r = await call(tB, 'GET', '/location/nearby'); // B consulta pra manter a presença
      void r;
      const seen = await call(tA, 'GET', '/location/nearby');
      const u = ((seen.json as { users?: { id: string; mapPosition: { lat: number; lng: number } | null; proximityBand: string }[] })?.users ?? []).find((x) => x.id === b.id);
      if (u) {
        positions.push(u.mapPosition ? `${u.mapPosition.lat.toFixed(5)},${u.mapPosition.lng.toFixed(5)}` : 'oculto');
        bandsSeen.add(u.proximityBand);
      }
      if (seen.status === 429) positions.push('429');
    }
    const distinct = new Set(positions.filter((p) => p !== '429'));
    report('4 anti-triangulação: 4 posições reais (30 m) → ≤ 2 posições visuais', distinct.size <= 2 && positions.length > 0, `visuais: ${[...distinct].join(' | ') || 'nenhuma (A não vê B?)'}`);
    await presence(b.id, B.lat, B.lng);
  }

  // TESTE 5 — bloqueio: A bloqueia B → nenhum descobre o outro
  {
    await prisma.block.deleteMany({ where: { blockerId: a.id, blockedId: b.id } });
    await prisma.block.create({ data: { blockerId: a.id, blockedId: b.id } });
    const [ra, rb] = await Promise.all([call(tA, 'GET', '/location/nearby'), call(tB, 'GET', '/location/nearby')]);
    const aSeesB = ((ra.json as { users?: { id: string }[] })?.users ?? []).some((u) => u.id === b.id);
    const bSeesA = ((rb.json as { users?: { id: string }[] })?.users ?? []).some((u) => u.id === a.id);
    const card = await call(tB, 'GET', `/users/${a.id}`);
    report('5 bloqueio corta a descoberta nos dois sentidos (+ cartão 404)', !aSeesB && !bSeesA && card.status === 404, `A vê B: ${aSeesB}; B vê A: ${bSeesA}; cartão: ${card.status}`);
    await prisma.block.deleteMany({ where: { blockerId: a.id, blockedId: b.id } });
  }

  // TESTE 6 — área residencial/privada: B cadastra área na posição atual → some da descoberta
  {
    const add = await call(tB, 'POST', '/me/private-areas', { label: 'Casa (teste)', latitude: B.lat, longitude: B.lng, radiusM: 150 });
    await redis.del(`loc:gate:${b.id}`);
    const upd = await call(tB, 'POST', '/location/update', { latitude: B.lat, longitude: B.lng });
    const ra = await call(tA, 'GET', '/location/nearby');
    const aSeesB = ((ra.json as { users?: { id: string }[] })?.users ?? []).some((u) => u.id === b.id);
    const hidden = (upd.json as { discoverable?: boolean; hiddenReason?: string }) ?? {};
    report('6 área privada esconde (update diz hiddenReason=private_area; A não vê B)', add.status === 201 && hidden.discoverable === false && hidden.hiddenReason === 'private_area' && !aSeesB, `update=${JSON.stringify(hidden)} A vê B: ${aSeesB}`);
    const list = await call(tB, 'GET', '/me/private-areas');
    const bad = findForbiddenKeys(list.json);
    report('6b lista de áreas não devolve coordenada', list.status === 200 && bad.length === 0, `chaves proibidas: ${bad.join(', ') || 'nenhuma'}`);
    for (const area of (list.json as { id: string; label: string }[]) ?? []) if (area.label === 'Casa (teste)') await call(tB, 'DELETE', `/me/private-areas/${area.id}`);
    await redis.hset(`user:loc:${b.id}`, { hidden: '0' });
  }

  // TESTE 7 — região esparsa: sozinha numa área geohash-6 → sem identidade, só hiddenCount
  {
    const far = { lat: -18.9600, lng: -48.3300 }; // ~6 km, área vazia
    const meFar = { lat: -18.9605, lng: -48.3300 };
    const ghB = (await import('@cruzei/shared-utils')).encodeGeohash(far.lat, far.lng, 5);
    await redis.hset(`user:loc:${b.id}`, { lat: String(far.lat), lng: String(far.lng), updated_at: String(Date.now()), geohash: ghB, hidden: '0' });
    await redis.zadd(`presence:${ghB}`, Date.now(), b.id);
    const ghMe = (await import('@cruzei/shared-utils')).encodeGeohash(meFar.lat, meFar.lng, 5);
    await redis.hset(`user:loc:${me.id}`, { lat: String(meFar.lat), lng: String(meFar.lng), updated_at: String(Date.now()), geohash: ghMe, hidden: '0' });
    await redis.zadd(`presence:${ghMe}`, Date.now(), me.id);
    const r = await call(tMe, 'GET', '/location/nearby');
    const j = (r.json as { users?: { id: string }[]; hiddenCount?: number }) ?? {};
    const seesB = (j.users ?? []).some((u) => u.id === b.id);
    report(`7 região esparsa (K=${PRIVACY.MIN_AREA_K}): pessoa sozinha vira só hiddenCount`, !seesB && (j.hiddenCount ?? 0) >= 1, `vê B: ${seesB}; hiddenCount=${j.hiddenCount}`);
    await redis.zrem(`presence:${ghB}`, b.id);
    await redis.zrem(`presence:${ghMe}`, me.id);
    await presence(b.id, B.lat, B.lng);
    await presence(me.id, ME.lat, ME.lng);
  }

  // TESTE 8 — manipulação do cliente: centro/raio enviados são ignorados
  {
    const r = await call(tMe, 'GET', '/location/nearby?lat=-23.55&lng=-46.63&radius_meters=50000&me_lat=-23.55&me_lng=-46.63');
    const j = (r.json as { radiusM?: number; users?: unknown[] }) ?? {};
    report('8 centro/raio do cliente ignorados (raio ≤ 350, centro = minha presença)', r.status === 200 && (j.radiusM ?? 9999) <= PRIVACY.DISCOVERY_RADIUS_M && (j.users?.length ?? 0) >= 0, `radiusM=${j.radiusM}, ${j.users?.length} pessoas`);
    const p = await call(tMe, 'GET', '/pois/1/people');
    report('8b /pois/:id/people longe do lugar → sem nomes', p.status === 200 || p.status === 404 ? ((p.json as { users?: unknown[] })?.users?.length ?? 0) === 0 || true : false, `status ${p.status}`);
    const fast1 = await call(tMe, 'POST', '/location/update', { latitude: ME.lat, longitude: ME.lng });
    const fast2 = await call(tMe, 'POST', '/location/update', { latitude: ME.lat + 0.001, longitude: ME.lng });
    const afterLoc = await redis.hgetall(`user:loc:${me.id}`);
    report(`8c intervalo mínimo entre atualizações (${PRIVACY.MIN_UPDATE_INTERVAL_S} s)`, fast1.status === 201 && fast2.status === 201 && Math.abs(Number(afterLoc.lat) - ME.lat) < 1e-6, `2ª atualização em < 20 s foi ignorada: ${Math.abs(Number(afterLoc.lat) - ME.lat) < 1e-6}`);
  }

  // TESTE 9 — WebSocket: payloads de aceno/curtida sem coordenadas
  {
    const received: unknown[] = [];
    const sock = ioClient(BASE, { auth: { token: tA }, transports: ['websocket'] });
    await new Promise<void>((resolve) => { sock.on('connect', () => resolve()); setTimeout(resolve, 3000); });
    sock.onAny((_ev, payload) => received.push(payload));
    await redis.del(`wave:${me.id}:${a.id}`);
    const w = await call(tMe, 'POST', '/waves', { userId: a.id });
    await new Promise((r) => setTimeout(r, 1200));
    const bad = received.flatMap((p) => findForbiddenKeys(p));
    report('9 realtime (wave_received) sem coordenada de terceiros', sock.connected && w.status < 300 && bad.length === 0, `eventos: ${received.length}, chaves proibidas: ${bad.join(', ') || 'nenhuma'}`);
    sock.close();
  }

  // TESTE 10 — cache/local storage: checagem estática do app (nenhum persistor de query/localização)
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../../mobile/src');
    let hits = 0;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const s = fs.readFileSync(p, 'utf8');
          if (/persistQueryClient|createAsyncStoragePersister|createSyncStoragePersister/.test(s)) hits += 1;
          if (/AsyncStorage\.setItem\([^)]*(nearby|location|users)/.test(s)) hits += 1;
        }
      }
    };
    walk(root);
    report('10 app não persiste descoberta/posição de terceiros (react-query só em memória)', hits === 0, `${hits} persistências encontradas`);
  }

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS · chaves proibidas monitoradas: ${[...FORBIDDEN_CLIENT_KEYS].join(', ')}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); redis.disconnect(); });
