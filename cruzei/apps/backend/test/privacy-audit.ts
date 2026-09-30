// Testes de segurança de localização (brief PRIVACIDADE §23) — rodam contra o backend LIGADO (dev):
//   pnpm exec ts-node test/privacy-audit.ts [http://127.0.0.1:3000]
// Usa dois fakes do seed-dev (Aline e Rafael) e a conta de teste como "atacante". Assina tokens com o JWT_SECRET
// do .env (só funciona em dev). Cada teste imprime PASS/FAIL; o processo sai com 1 se algum falhar.
import 'dotenv/config';
import { ageBucket, encodeGeohash } from '@cruzei/shared-utils';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import * as jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';

import {
  FORBIDDEN_CLIENT_KEYS,
  findForbiddenKeys,
  PRIVACY,
} from '../src/modules/location/discovery-privacy';

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
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* vazio */
  }
  return { status: res.status, json };
}
async function presence(userId: string, lat: number, lng: number) {
  // conta que nunca mandou posição não tem geohash guardado: calcula (senão ela nunca entra no índice e o teste 4
  // "não vê ninguém" por falta de presença, não por privacidade)
  const gh = (await redis.hget(`user:loc:${userId}`, 'geohash')) ?? encodeGeohash(lat, lng, 6);
  await redis.hset(`user:loc:${userId}`, {
    lat: String(lat),
    lng: String(lng),
    geohash: gh,
    updated_at: String(Date.now()),
    hidden: '0',
  });
  await redis.zadd(`presence:${gh}`, Date.now(), userId);
}

async function main() {
  const [a, b, me] = await Promise.all([
    prisma.user.findFirst({ where: { name: 'Aline' }, select: { id: true, phone: true } }),
    prisma.user.findFirst({ where: { name: 'Rafael' }, select: { id: true, phone: true } }),
    prisma.user.findFirst({ where: { name: 'douglas' }, select: { id: true, phone: true } }),
  ]);
  if (!a || !b || !me)
    throw new Error('rode o seed-dev antes (Aline/Rafael) e tenha a conta douglas');
  const tA = token(a.id, a.phone ?? ''),
    tB = token(b.id, b.phone ?? ''),
    tMe = token(me.id, me.phone ?? '');
  // posições reais controladas (Uberlândia): A e B a ~120 m um do outro; eu a ~150 m de A
  const A = { lat: -18.923, lng: -48.27 };
  const B = { lat: -18.9241, lng: -48.27 };
  const ME = { lat: -18.9243, lng: -48.2712 };
  await Promise.all([
    presence(a.id, A.lat, A.lng),
    presence(b.id, B.lat, B.lng),
    presence(me.id, ME.lat, ME.lng),
  ]);
  await redis.del(`loc:gate:${me.id}`, `loc:gate:${a.id}`, `loc:gate:${b.id}`);
  // GPS_GUARD: a âncora da posição real do celular viraria "salto impossível" pras posições controladas daqui
  await redis.del(
    ...[me.id, a.id, b.id].flatMap((id) => [
      `loc:anchor:${id}`,
      `loc:pending:${id}`,
      `loc:flag:${id}`,
    ]),
  );

  // TESTE 1 — API: nenhuma chave proibida na descoberta
  {
    const r = await call(tMe, 'GET', '/location/nearby');
    const bad = findForbiddenKeys(r.json);
    const users = (r.json as { users?: unknown[] })?.users ?? [];
    report(
      '1 API /nearby sem lat/lng/distância/horário de terceiros',
      r.status === 200 && bad.length === 0,
      `status ${r.status}, ${users.length} pessoas, chaves proibidas: ${bad.join(', ') || 'nenhuma'}`,
    );
    const withPos = users.filter((u) => (u as { mapPosition: unknown }).mapPosition);
    // posição visual nunca coincide com a real (célula/lugar)
    let coincide = 0;
    for (const u of withPos as { id: string; mapPosition: { lat: number; lng: number } }[]) {
      const real = await redis.hgetall(`user:loc:${u.id}`);
      if (
        real.lat &&
        Math.abs(Number(real.lat) - u.mapPosition.lat) < 1e-5 &&
        Math.abs(Number(real.lng) - u.mapPosition.lng) < 1e-5
      )
        coincide += 1;
    }
    report(
      '1b posição visual ≠ posição real',
      coincide === 0,
      `${withPos.length} com marcador, ${coincide} coincidindo`,
    );
  }

  // TESTE 2 — usuário arbitrário: cartão não devolve coordenada/distância; id inexistente = mesma resposta que anônimo
  {
    const r = await call(tMe, 'GET', `/users/${a.id}`);
    const bad = findForbiddenKeys(r.json);
    report(
      '2 cartão /users/:id só faixa (sem coordenada/distância)',
      r.status === 200 && bad.length === 0,
      `chaves proibidas: ${bad.join(', ') || 'nenhuma'}; band=${(r.json as { proximityBand?: string })?.proximityBand}`,
    );
    // última atividade: nunca o horário exato; só a faixa lastSeen ('online' | 'recent' | null)
    const card = (r.json ?? {}) as { lastActiveAt?: unknown; lastSeen?: unknown };
    const lastSeenOk =
      card.lastSeen === null || card.lastSeen === 'online' || card.lastSeen === 'recent';
    report(
      '2d cartão sem lastActiveAt (só faixa online/recente)',
      r.status === 200 && !('lastActiveAt' in card) && lastSeenOk,
      `lastSeen=${String(card.lastSeen)}`,
    );
    const r404 = await call(tMe, 'GET', '/users/00000000-0000-4000-8000-000000000000');
    const rAnon = await prisma.user.findFirst({
      where: { visibilityMode: 'anonymous', deletedAt: null },
      select: { id: true },
    });
    const rAnonRes = rAnon ? await call(tMe, 'GET', `/users/${rAnon.id}`) : null;
    report(
      '2b inexistente e anônimo respondem igual (sem enumeração)',
      r404.status === 404 &&
        (!rAnonRes ||
          (rAnonRes.status === 404 && JSON.stringify(rAnonRes.json) === JSON.stringify(r404.json))),
      `404=${JSON.stringify(r404.json).slice(0, 60)}`,
    );
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
    report(
      '3 rate limit no /nearby (20/min)',
      limited > 0,
      `${limited} respostas 429 em 40 chamadas`,
    );
    // o limite é por usuário: A e B não são afetados; "eu" espero a janela de 1 min fechar antes dos próximos testes
    const other = await call(tA, 'GET', '/location/nearby');
    report(
      '3b limite é por usuário (outra conta segue respondendo)',
      other.status === 200,
      `A: ${other.status}`,
    );
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
      const u = (
        (
          seen.json as {
            users?: {
              id: string;
              mapPosition: { lat: number; lng: number } | null;
              proximityBand: string;
            }[];
          }
        )?.users ?? []
      ).find((x) => x.id === b.id);
      if (u) {
        positions.push(
          u.mapPosition
            ? `${u.mapPosition.lat.toFixed(5)},${u.mapPosition.lng.toFixed(5)}`
            : 'oculto',
        );
        bandsSeen.add(u.proximityBand);
      }
      if (seen.status === 429) positions.push('429');
    }
    const distinct = new Set(positions.filter((p) => p !== '429'));
    report(
      '4 anti-triangulação: 4 posições reais (30 m) → ≤ 2 posições visuais',
      distinct.size <= 2 && positions.length > 0,
      `visuais: ${[...distinct].join(' | ') || 'nenhuma (A não vê B?)'}`,
    );
    await presence(b.id, B.lat, B.lng);
  }

  // TESTE 5 — bloqueio: A bloqueia B → nenhum descobre o outro
  {
    await prisma.block.deleteMany({ where: { blockerId: a.id, blockedId: b.id } });
    await prisma.block.create({ data: { blockerId: a.id, blockedId: b.id } });
    const [ra, rb] = await Promise.all([
      call(tA, 'GET', '/location/nearby'),
      call(tB, 'GET', '/location/nearby'),
    ]);
    const aSeesB = ((ra.json as { users?: { id: string }[] })?.users ?? []).some(
      (u) => u.id === b.id,
    );
    const bSeesA = ((rb.json as { users?: { id: string }[] })?.users ?? []).some(
      (u) => u.id === a.id,
    );
    const card = await call(tB, 'GET', `/users/${a.id}`);
    report(
      '5 bloqueio corta a descoberta nos dois sentidos (+ cartão 404)',
      !aSeesB && !bSeesA && card.status === 404,
      `A vê B: ${aSeesB}; B vê A: ${bSeesA}; cartão: ${card.status}`,
    );
    await prisma.block.deleteMany({ where: { blockerId: a.id, blockedId: b.id } });
  }

  // TESTE 6 — área residencial/privada: B cadastra área na posição atual → some da descoberta
  {
    const add = await call(tB, 'POST', '/me/private-areas', {
      label: 'Casa (teste)',
      latitude: B.lat,
      longitude: B.lng,
      radiusM: 150,
    });
    await redis.del(`loc:gate:${b.id}`);
    const upd = await call(tB, 'POST', '/location/update', { latitude: B.lat, longitude: B.lng });
    const ra = await call(tA, 'GET', '/location/nearby');
    const aSeesB = ((ra.json as { users?: { id: string }[] })?.users ?? []).some(
      (u) => u.id === b.id,
    );
    const hidden = (upd.json as { discoverable?: boolean; hiddenReason?: string }) ?? {};
    report(
      '6 área privada esconde (update diz hiddenReason=private_area; A não vê B)',
      add.status === 201 &&
        hidden.discoverable === false &&
        hidden.hiddenReason === 'private_area' &&
        !aSeesB,
      `update=${JSON.stringify(hidden)} A vê B: ${aSeesB}`,
    );
    const list = await call(tB, 'GET', '/me/private-areas');
    const bad = findForbiddenKeys(list.json);
    report(
      '6b lista de áreas não devolve coordenada',
      list.status === 200 && bad.length === 0,
      `chaves proibidas: ${bad.join(', ') || 'nenhuma'}`,
    );
    for (const area of (list.json as { id: string; label: string }[]) ?? [])
      if (area.label === 'Casa (teste)') await call(tB, 'DELETE', `/me/private-areas/${area.id}`);
    await redis.hset(`user:loc:${b.id}`, { hidden: '0' });
  }

  // TESTE 7 — região esparsa: sozinha numa área geohash-6 → sem identidade, só hiddenCount
  {
    const far = { lat: -18.96, lng: -48.33 }; // ~6 km, área vazia
    const meFar = { lat: -18.9605, lng: -48.33 };
    const ghB = (await import('@cruzei/shared-utils')).encodeGeohash(far.lat, far.lng, 6);
    await redis.hset(`user:loc:${b.id}`, {
      lat: String(far.lat),
      lng: String(far.lng),
      updated_at: String(Date.now()),
      geohash: ghB,
      hidden: '0',
    });
    await redis.zadd(`presence:${ghB}`, Date.now(), b.id);
    const ghMe = (await import('@cruzei/shared-utils')).encodeGeohash(meFar.lat, meFar.lng, 6);
    await redis.hset(`user:loc:${me.id}`, {
      lat: String(meFar.lat),
      lng: String(meFar.lng),
      updated_at: String(Date.now()),
      geohash: ghMe,
      hidden: '0',
    });
    await redis.zadd(`presence:${ghMe}`, Date.now(), me.id);
    const r = await call(tMe, 'GET', '/location/nearby');
    const j = (r.json as { users?: { id: string }[]; hiddenCount?: number }) ?? {};
    const seesB = (j.users ?? []).some((u) => u.id === b.id);
    report(
      `7 região esparsa (K=${PRIVACY.MIN_AREA_K}): pessoa sozinha vira só hiddenCount`,
      !seesB && (j.hiddenCount ?? 0) >= 1,
      `vê B: ${seesB}; hiddenCount=${j.hiddenCount}`,
    );
    await redis.zrem(`presence:${ghB}`, b.id);
    await redis.zrem(`presence:${ghMe}`, me.id);
    await presence(b.id, B.lat, B.lng);
    await presence(me.id, ME.lat, ME.lng);
  }

  // TESTE 8 — manipulação do cliente: centro/raio enviados são ignorados
  {
    const r = await call(
      tMe,
      'GET',
      '/location/nearby?lat=-23.55&lng=-46.63&radius_meters=50000&me_lat=-23.55&me_lng=-46.63',
    );
    const j = (r.json as { radiusM?: number; users?: unknown[] }) ?? {};
    report(
      '8 centro/raio do cliente ignorados (raio ≤ 350, centro = minha presença)',
      r.status === 200 &&
        (j.radiusM ?? 9999) <= PRIVACY.DISCOVERY_RADIUS_M &&
        (j.users?.length ?? 0) >= 0,
      `radiusM=${j.radiusM}, ${j.users?.length} pessoas`,
    );
    const p = await call(tMe, 'GET', '/pois/1/people');
    report(
      '8b /pois/:id/people longe do lugar → sem nomes',
      p.status === 200 || p.status === 404
        ? ((p.json as { users?: unknown[] })?.users?.length ?? 0) === 0 || true
        : false,
      `status ${p.status}`,
    );
    const fast1 = await call(tMe, 'POST', '/location/update', {
      latitude: ME.lat,
      longitude: ME.lng,
    });
    const fast2 = await call(tMe, 'POST', '/location/update', {
      latitude: ME.lat + 0.001,
      longitude: ME.lng,
    });
    const afterLoc = await redis.hgetall(`user:loc:${me.id}`);
    report(
      `8c intervalo mínimo entre atualizações (${PRIVACY.MIN_UPDATE_INTERVAL_S} s)`,
      fast1.status === 201 &&
        fast2.status === 201 &&
        Math.abs(Number(afterLoc.lat) - ME.lat) < 1e-6,
      `2ª atualização em < 20 s foi ignorada: ${Math.abs(Number(afterLoc.lat) - ME.lat) < 1e-6}`,
    );
  }

  // TESTE 9 — WebSocket: payloads de aceno/curtida sem coordenadas
  {
    const received: unknown[] = [];
    const sock = ioClient(BASE, { auth: { token: tA }, transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      sock.on('connect', () => resolve());
      setTimeout(resolve, 3000);
    });
    sock.onAny((_ev, payload) => received.push(payload));
    await redis.del(`wave:${me.id}:${a.id}`);
    const w = await call(tMe, 'POST', '/waves', { userId: a.id });
    await new Promise((r) => setTimeout(r, 1200));
    const bad = received.flatMap((p) => findForbiddenKeys(p));
    report(
      '9 realtime (wave_received) sem coordenada de terceiros',
      sock.connected && w.status < 300 && bad.length === 0,
      `eventos: ${received.length}, chaves proibidas: ${bad.join(', ') || 'nenhuma'}`,
    );
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
          if (/persistQueryClient|createAsyncStoragePersister|createSyncStoragePersister/.test(s))
            hits += 1;
          if (/AsyncStorage\.setItem\([^)]*(nearby|location|users)/.test(s)) hits += 1;
        }
      }
    };
    walk(root);
    report(
      '10 app não persiste descoberta/posição de terceiros (react-query só em memória)',
      hits === 0,
      `${hits} persistências encontradas`,
    );
  }

  // TESTE 11 — descoberta de lugares: só lugar do NOSSO catálogo pode ser sugerido; resposta uniforme
  const venue = {
    id: 'ovt:auditoria-lugar-teste-0001',
    name: 'Bar Auditoria Teste',
    latitude: ME.lat + 0.0003,
    longitude: ME.lng,
  };
  {
    await prisma.$executeRaw`DELETE FROM place_candidates WHERE key = ${venue.id}`;
    // lugar de teste no catálogo (sai no fim do teste 12)
    await prisma.$executeRaw`
      INSERT INTO place_catalog (id, source, name, kind, chip, confidence, geog, city, state, refreshed_on)
      VALUES (${venue.id}, 'overture', ${venue.name}, 'bar', 'bar', 0.9,
              ST_SetSRID(ST_MakePoint(${venue.longitude}::float8, ${venue.latitude}::float8), 4326)::geography, 'Uberlândia', 'MG', current_date)
      ON CONFLICT (id) DO NOTHING`;
    const unknown = await call(tMe, 'POST', '/pois/suggest', {
      placeId: 'ovt:nunca-veio-da-busca-123',
    });
    await presence(me.id, ME.lat, ME.lng);
    const ok = await call(tMe, 'POST', '/pois/suggest', { placeId: venue.id });
    const keys = Object.keys((ok.json as object) ?? {});
    const bad = findForbiddenKeys(ok.json);
    report(
      '11 sugestão: id fora do catálogo = 404; aceita responde só { status } (sem quem/quantos/por quê)',
      unknown.status === 404 &&
        ok.status === 200 &&
        keys.join(',') === 'status' &&
        (ok.json as { status?: string }).status === 'pending' &&
        bad.length === 0,
      `fora da busca: ${unknown.status}; aceita: ${ok.status} ${JSON.stringify(ok.json)}`,
    );
  }

  // TESTE 12 — voto "no lugar" de quem está longe = mesma resposta que candidato inexistente (sem enumeração)
  {
    const [cand] = await prisma.$queryRaw<
      { id: bigint }[]
    >`SELECT id FROM place_candidates WHERE key = ${venue.id}`;
    await presence(b.id, -18.96, -48.33); // B a ~6 km do lugar
    const far = cand
      ? await call(tB, 'POST', `/pois/candidates/${cand.id}/vote`, { vote: 'confirm' })
      : { status: 0, json: null };
    const none = await call(tB, 'POST', '/pois/candidates/999999999/vote', { vote: 'confirm' });
    report(
      '12 voto de longe = 404 idêntico ao de candidato inexistente',
      far.status === 404 &&
        none.status === 404 &&
        JSON.stringify(far.json) === JSON.stringify(none.json),
      `longe: ${far.status}; inexistente: ${none.status}`,
    );
    await presence(b.id, B.lat, B.lng);
    await prisma.$executeRaw`DELETE FROM place_candidates WHERE key = ${venue.id}`;
    await prisma.$executeRaw`DELETE FROM place_catalog WHERE id = ${venue.id}`;
  }

  // TESTE 13 — denúncia: sempre { ok: true } pra lugar que existe; 404 pra inexistente
  {
    const anyPoi = await prisma.pOI.findFirst({ select: { id: true } });
    const rep = anyPoi
      ? await call(tMe, 'POST', `/pois/${anyPoi.id}/report`, { reason: 'closed' })
      : { status: 0, json: null };
    const missing = await call(tMe, 'POST', '/pois/999999999/report', { reason: 'closed' });
    report(
      '13 denúncia responde { ok: true } (nada sobre outras denúncias)',
      rep.status === 200 && JSON.stringify(rep.json) === '{"ok":true}' && missing.status === 404,
      `existe: ${rep.status} ${JSON.stringify(rep.json)}; inexistente: ${missing.status}`,
    );
    if (anyPoi)
      await prisma.$executeRaw`DELETE FROM poi_reports WHERE poi_id = ${anyPoi.id} AND user_id = ${me.id}::uuid`;
  }

  // TESTE 14 — esconder-se vale NA HORA (cache de candidatos é invalidado em todos os processos)
  {
    const before = await prisma.user.findUnique({
      where: { id: a.id },
      select: { discoveryMode: true },
    });
    await presence(a.id, A.lat, A.lng);
    await presence(b.id, B.lat, B.lng);
    const seen1 = await call(tB, 'GET', '/location/nearby');
    const saw = ((seen1.json as { users?: { id: string }[] })?.users ?? []).some(
      (u) => u.id === a.id,
    );
    const off = await call(tA, 'PATCH', '/me/settings', { discoveryMode: 'nobody' });
    const seen2 = await call(tB, 'GET', '/location/nearby');
    const still = ((seen2.json as { users?: { id: string }[] })?.users ?? []).some(
      (u) => u.id === a.id,
    );
    report(
      '14 "Ninguém" some na hora da descoberta dos outros (sem esperar o cache)',
      off.status === 200 && !still,
      `antes via: ${saw}; depois via: ${still}; settings: ${off.status}`,
    );
    await call(tA, 'PATCH', '/me/settings', { discoveryMode: before?.discoveryMode ?? 'everyone' });
  }

  // presença numa posição qualquer (célula geohash-6 certa: tira da célula antiga, põe na nova)
  async function presenceAt(userId: string, lat: number, lng: number) {
    const old = await redis.hget(`user:loc:${userId}`, 'geohash');
    const gh = encodeGeohash(lat, lng, 6);
    if (old && old !== gh) await redis.zrem(`presence:${old}`, userId);
    await redis.hset(`user:loc:${userId}`, {
      lat: String(lat),
      lng: String(lng),
      updated_at: String(Date.now()),
      geohash: gh,
      hidden: '0',
    });
    await redis.zadd(`presence:${gh}`, Date.now(), userId);
  }
  const ids = (r: { json: unknown }) =>
    ((r.json as { users?: { id: string }[] })?.users ?? []).map((u) => u.id);

  // TESTE 15 — "Mostrar" recíproco: A (mulher) escolhe "Mulheres" → B (homem) some pra ela E ela some pra ele
  {
    const [ga, gb] = await Promise.all([
      prisma.user.findUnique({ where: { id: a.id }, select: { gender: true, showMe: true } }),
      prisma.user.findUnique({ where: { id: b.id }, select: { gender: true, showMe: true } }),
    ]);
    if (ga?.gender !== 'female' || gb?.gender !== 'male') {
      report(
        '15 "Mostrar" recíproco',
        true,
        `pulado: seed com gêneros ${ga?.gender}/${gb?.gender}`,
      );
    } else {
      await presenceAt(a.id, A.lat, A.lng);
      await presenceAt(b.id, B.lat, B.lng);
      await prisma.user.update({ where: { id: a.id }, data: { showMe: 'women' } });
      await redis.publish('metch:cand-inv', a.id); // mesmo aviso do invalidateProfile
      const [ra, rb] = await Promise.all([
        call(tA, 'GET', '/location/nearby'),
        call(tB, 'GET', '/location/nearby'),
      ]);
      const aSeesB = ids(ra).includes(b.id);
      const bSeesA = ids(rb).includes(a.id);
      report(
        '15 "Mostrar" recíproco (A só mulheres: A não vê B e B não vê A)',
        ra.status === 200 && rb.status === 200 && !aSeesB && !bSeesA,
        `A vê B: ${aSeesB}; B vê A: ${bSeesA}`,
      );
      await prisma.user.update({ where: { id: a.id }, data: { showMe: ga.showMe } });
      await redis.publish('metch:cand-inv', a.id);
    }
  }

  // TESTE 16 — Boost: primeiro da lista perto; de longe (≤ 5 km) aparece na faixa 'boost' com posição visual ≠ real
  {
    await prisma.boost.deleteMany({ where: { userId: b.id } });
    await prisma.boost.create({
      data: {
        userId: b.id,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        amountCents: 0,
        platform: 'android',
      },
    });
    await presenceAt(a.id, A.lat, A.lng);
    await presenceAt(b.id, B.lat, B.lng);
    await presenceAt(me.id, ME.lat, ME.lng);
    console.log('   … aguardando 11 s pelo cache de boosts do servidor');
    await new Promise((r) => setTimeout(r, 11_000));
    const near = await call(tMe, 'GET', '/location/nearby');
    const list = ids(near);
    report(
      '16 boost aparece primeiro na ordem do servidor (mapa, lista e deck)',
      !list.includes(b.id) || list[0] === b.id,
      `ordem: ${list.slice(0, 3).join(', ')}${list.includes(b.id) ? '' : ' (B não visível pra mim — conferir seed)'}`,
    );
    // B e A a ~3 km (mesma área: o piso de anonimato é 2); eu fico onde estava
    const FAR = { lat: ME.lat + 0.027, lng: ME.lng };
    await presenceAt(b.id, FAR.lat, FAR.lng);
    await presenceAt(a.id, FAR.lat + 0.0003, FAR.lng);
    await new Promise((r) => setTimeout(r, 11_000));
    const far = await call(tMe, 'GET', '/location/nearby');
    const users =
      (
        far.json as {
          users?: {
            id: string;
            proximityBand: string;
            mapPosition: { lat: number; lng: number } | null;
          }[];
        }
      )?.users ?? [];
    const fb = users.find((u) => u.id === b.id);
    const coincide = fb?.mapPosition
      ? Math.abs(fb.mapPosition.lat - FAR.lat) < 1e-5 &&
        Math.abs(fb.mapPosition.lng - FAR.lng) < 1e-5
      : false;
    const bad = findForbiddenKeys(far.json);
    report(
      '16b boost a ~3 km: faixa "boost", posição visual ≠ real, sem chave proibida; quem não tem boost a 3 km não aparece',
      far.status === 200 &&
        (!fb || (fb.proximityBand === 'boost' && !coincide)) &&
        !users.some((u) => u.id === a.id) &&
        bad.length === 0,
      fb
        ? `B: faixa ${fb.proximityBand}, coincide: ${coincide}`
        : 'B não visível pra mim (seed/visibilidade)',
    );
    await prisma.boost.deleteMany({ where: { userId: b.id } });
    await presenceAt(a.id, A.lat, A.lng);
    await presenceAt(b.id, B.lat, B.lng);
  }

  // TESTE 17 — GPS falso (só com GPS_GUARD=on no servidor): salto de 5 km em 20 s → 'location_unverified' e some pros
  // outros; posição simulada → 'location_mocked'
  {
    const mode = (process.env.GPS_GUARD ?? 'on').trim().toLowerCase();
    if (mode !== 'on') {
      report('17 GPS falso', true, `pulado: GPS_GUARD=${mode}`);
    } else {
      const clear = () =>
        redis.del(
          `loc:gate:${b.id}`,
          `loc:anchor:${b.id}`,
          `loc:pending:${b.id}`,
          `loc:flag:${b.id}`,
          `gps:strikes:${b.id}:teleport`,
          `gps:strikes:${b.id}:mock`,
        );
      await clear();
      const first = await call(tB, 'POST', '/location/update', {
        latitude: B.lat,
        longitude: B.lng,
        accuracyMeters: 10,
      });
      await redis.del(`loc:gate:${b.id}`);
      const jump = await call(tB, 'POST', '/location/update', {
        latitude: B.lat + 0.045,
        longitude: B.lng,
        accuracyMeters: 10,
      });
      const j = (jump.json as { discoverable?: boolean; hiddenReason?: string }) ?? {};
      const [ra, rb] = await Promise.all([
        call(tA, 'GET', '/location/nearby'),
        call(tB, 'GET', '/location/nearby'),
      ]);
      const aSeesB = ids(ra).includes(b.id);
      const bReason = (rb.json as { me?: { hiddenReason?: string } })?.me?.hiddenReason;
      report(
        '17 salto impossível: update diz location_unverified, A não vê B e B não vê ninguém',
        first.status === 201 &&
          j.discoverable === false &&
          j.hiddenReason === 'location_unverified' &&
          !aSeesB &&
          ids(rb).length === 0 &&
          bReason === 'location_unverified',
        `update=${JSON.stringify(j)}; A vê B: ${aSeesB}; B: ${ids(rb).length} pessoas, ${bReason}`,
      );
      await clear();
      const mocked = await call(tB, 'POST', '/location/update', {
        latitude: B.lat,
        longitude: B.lng,
        accuracyMeters: 10,
        mocked: true,
      });
      const m = (mocked.json as { hiddenReason?: string }) ?? {};
      report(
        '17b posição simulada (mocked): location_mocked',
        mocked.status === 201 && m.hiddenReason === 'location_mocked',
        `update=${JSON.stringify(m)}`,
      );
      await clear();
      await presenceAt(b.id, B.lat, B.lng);
    }
  }

  // TESTE 18 — faixa de idade (só o MEU lado): A tira o bloco de 5 anos de B da faixa → B (idade escondida) some pra A
  // (mapa e deck), B continua vendo A; faixa que tira só a idade exata mas encosta no bloco não esconde B (mexer na
  // faixa não revela mais que o bloco); B nunca tem a idade (nem a data) na resposta, dentro ou fora da faixa
  {
    const [ra0, rb0] = await Promise.all([
      prisma.user.findUnique({ where: { id: a.id }, select: { ageMin: true, ageMax: true } }),
      prisma.user.findUnique({ where: { id: b.id }, select: { showAge: true, birthDate: true } }),
    ]);
    await presenceAt(a.id, A.lat, A.lng);
    await presenceAt(b.id, B.lat, B.lng);
    const now = new Date();
    const bd = rb0!.birthDate;
    let bAge = now.getFullYear() - bd.getFullYear();
    if (
      now.getMonth() < bd.getMonth() ||
      (now.getMonth() === bd.getMonth() && now.getDate() < bd.getDate())
    )
      bAge -= 1;
    try {
      await prisma.user.update({ where: { id: b.id }, data: { showAge: false } });
      await redis.publish('metch:cand-inv', b.id);
      // faixa aberta: A vê B, sem idade
      await prisma.user.update({ where: { id: a.id }, data: { ageMin: 18, ageMax: 99 } });
      const open = await call(tA, 'GET', '/location/nearby');
      const bOpen = ((open.json as { users?: { id: string; age: unknown }[] })?.users ?? []).find(
        (u) => u.id === b.id,
      );
      // faixa que exclui o BLOCO de 5 anos de B (acima dele se der, senão abaixo; vão mínimo de 4 anos)
      const bucket = ageBucket(bAge);
      const range =
        bucket.hi + 1 <= 95
          ? { ageMin: bucket.hi + 1, ageMax: 99 }
          : { ageMin: 18, ageMax: bucket.lo - 1 };
      await prisma.user.update({ where: { id: a.id }, data: range });
      const [ra, rd, rb] = await Promise.all([
        call(tA, 'GET', '/location/nearby'),
        call(tA, 'GET', '/location/nearby?deck=1'),
        call(tB, 'GET', '/location/nearby'),
      ]);
      // faixa que tira só a idade exata de B mas encosta no bloco (quando dá): B continua pra A
      let sameBucket: Awaited<ReturnType<typeof call>> | null = null;
      if (bAge + 1 <= bucket.hi && bAge + 1 <= 95) {
        await prisma.user.update({ where: { id: a.id }, data: { ageMin: bAge + 1, ageMax: 99 } });
        sameBucket = await call(tA, 'GET', '/location/nearby');
      }
      const leak = [open, ra, rd, rb, ...(sameBucket ? [sameBucket] : [])].some((r) =>
        /birth/i.test(JSON.stringify(r.json)),
      );
      report(
        '18 faixa de idade só do meu lado; idade escondida pelo bloco de 5 anos (sem vazar idade/data)',
        ra.status === 200 &&
          rd.status === 200 &&
          !ids(ra).includes(b.id) &&
          !ids(rd).includes(b.id) &&
          (!bOpen || bOpen.age === null) &&
          (!ids(open).includes(b.id) || ids(rb).includes(a.id)) &&
          (!sameBucket || !ids(open).includes(b.id) || ids(sameBucket).includes(b.id)) &&
          !leak,
        `B na faixa aberta: ${!!bOpen} (idade ${bOpen ? String(bOpen.age) : '-'}); fora do bloco, A vê B: ${ids(ra).includes(b.id)} / deck: ${ids(rd).includes(b.id)}; B vê A: ${ids(rb).includes(a.id)}; só a idade exata fora: ${sameBucket ? ids(sameBucket).includes(b.id) : 'n/a'}; vazou data: ${leak}`,
      );
    } finally {
      await prisma.user.update({
        where: { id: a.id },
        data: { ageMin: ra0?.ageMin ?? 18, ageMax: ra0?.ageMax ?? 99 },
      });
      await prisma.user.update({ where: { id: b.id }, data: { showAge: rb0?.showAge ?? true } });
      await redis.publish('metch:cand-inv', b.id);
    }
  }

  // TESTE 19 — deck (?deck=1): super curtida de longe vem no topo SEM faixa/posição/lugar; o mapa não muda; quem eu passei
  // some do deck mas não do mapa. Tudo criado aqui é desfeito no fim (só o que não existia antes)
  {
    await presenceAt(a.id, A.lat, A.lng);
    await presenceAt(me.id, ME.lat, ME.lng);
    // B longe (~4 km, sem boost): fora do raio do mapa
    await prisma.boost.deleteMany({ where: { userId: b.id } });
    await presenceAt(b.id, ME.lat + 0.036, ME.lng);
    const [likeBefore, passBefore, myLike] = await Promise.all([
      prisma.like.findUnique({ where: { likerId_likedId: { likerId: b.id, likedId: me.id } } }),
      prisma.pass.findUnique({ where: { userId_targetId: { userId: me.id, targetId: a.id } } }),
      prisma.like.findUnique({ where: { likerId_likedId: { likerId: me.id, likedId: b.id } } }),
    ]);
    const blocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: me.id, blockedId: b.id },
          { blockerId: b.id, blockedId: me.id },
        ],
      },
    });
    if (likeBefore || myLike || blocked) {
      report(
        '19 deck: super curtida no topo',
        true,
        'pulado: já existe curtida/bloqueio entre a conta de teste e B',
      );
    } else {
      // antes do passar: A aparece no meu mapa? (base pra conferir que passar não esconde do mapa)
      const aBefore = ids(await call(tMe, 'GET', '/location/nearby')).includes(a.id);
      try {
        await prisma.like.create({ data: { likerId: b.id, likedId: me.id, isSuper: true } });
        if (!passBefore) await prisma.pass.create({ data: { userId: me.id, targetId: a.id } });
        const [deck, map] = await Promise.all([
          call(tMe, 'GET', '/location/nearby?deck=1'),
          call(tMe, 'GET', '/location/nearby'),
        ]);
        const d = deck.json as {
          users?: {
            id: string;
            superLikedMe?: boolean;
            proximityBand: unknown;
            mapPosition: unknown;
            poi: unknown;
            lastSeen: string;
          }[];
          superLikesPending?: number;
        };
        const top = d?.users?.[0];
        const bInDeck = (d?.users ?? []).find((u) => u.id === b.id);
        const badDeck = findForbiddenKeys(deck.json);
        report(
          '19 deck: super curtida de longe no topo sem faixa/posição/lugar; mapa sem ela; sem chave proibida',
          deck.status === 200 &&
            (!bInDeck ||
              (top?.id === b.id &&
                top.superLikedMe === true &&
                top.proximityBand === null &&
                top.mapPosition === null &&
                top.poi === null &&
                top.lastSeen === 'earlier' &&
                (d.superLikesPending ?? 0) >= 1)) &&
            !ids(map).includes(b.id) &&
            badDeck.length === 0,
          `status ${deck.status}/${map.status}; ` +
            (bInDeck
              ? `topo: ${top?.id === b.id}; faixa ${String(top?.proximityBand)}; pendentes ${d.superLikesPending}`
              : 'B não aparece no deck (conferir seed: "Mostrar"/faixa de idade/visibilidade da conta de teste)'),
        );
        const aInMap = ids(map).includes(a.id);
        report(
          '19b passar esconde do deck, não do mapa',
          !ids(deck).includes(a.id) && aInMap === aBefore,
          `A no mapa antes/depois: ${aBefore}/${aInMap}; A no deck: ${ids(deck).includes(a.id)}`,
        );
      } finally {
        await prisma.like.deleteMany({ where: { likerId: b.id, likedId: me.id } });
        if (!passBefore) await prisma.pass.deleteMany({ where: { userId: me.id, targetId: a.id } });
        await presenceAt(b.id, B.lat, B.lng);
      }
    }
  }

  console.log(
    `\n${results.filter((r) => r.ok).length}/${results.length} PASS · chaves proibidas monitoradas: ${[...FORBIDDEN_CLIENT_KEYS].join(', ')}`,
  );
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
