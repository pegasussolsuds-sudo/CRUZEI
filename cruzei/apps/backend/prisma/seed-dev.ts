// Seed de DESENVOLVIMENTO — cria usuários fake com presença ativa em volta de um ponto.
// Uso: pnpm exec ts-node prisma/seed-dev.ts <lat> <lng> [quantidade]
// Ex.:  pnpm exec ts-node prisma/seed-dev.ts -18.9186 -48.2772 6
//       pnpm exec ts-node prisma/seed-dev.ts -18.9186 -48.2772 120   (teste de carga: 8 fakes nomeados + 112 gerados)
//
// Acima de 8 pessoas o seed gera gente sintética cobrindo a matriz de testes do mapa (brief FOTO AVATAR §23):
// sem foto, foto quebrada (404), foto desligada no mapa, nome longo/curto, gente nova, multidão no evento.
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomAvatarConfig } from '@cruzei/shared-utils';
import { UPLOAD_DIR } from '../src/modules/uploads/uploads.constants';
import { makeThumbnail, thumbNameFor } from '../src/modules/uploads/thumbnails';

// seed de DEV: apaga/reescreve fotos e datas das contas fake — nunca contra produção
if (process.env.NODE_ENV === 'production' || /prod/i.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('seed-dev não roda em produção');
}
const prisma = new PrismaClient();
// Fotos dos fakes servidas pelo próprio backend (CORS liberado em /uploads) — o mapa desenha a bolha em canvas.
// 127.0.0.1 = túnel USB (adb reverse); na LAN use PUBLIC_BASE_URL=http://<ip>:3000.
const PHOTO_BASE = process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000';
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function encodeGeohash(lat: number, lng: number, precision = 5): string {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180, bit = 0, evenBit = true, hash = '';
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { hash += BASE32[bit * 2 + 1]; lngMin = mid; } else { hash += BASE32[bit * 2]; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { hash += BASE32[bit * 2 + 1]; latMin = mid; } else { hash += BASE32[bit * 2]; latMax = mid; }
    }
    evenBit = !evenBit;
    bit = bit < 4 ? bit + 1 : 0;
  }
  return hash;
}

type Fake = {
  name: string;
  gender: string;
  birth: string;
  bio: string;
  /** null = sem foto (só avatar no mapa) */
  photo: string | null;
  tier?: 'premium' | 'premium_plus';
  verified?: boolean;
  boosted?: boolean;
  /** preferência "mostrar minha foto no mapa" (default true) */
  showPhotoOnMap?: boolean;
  /** idade da conta em dias (< 7 = selo "novo por aqui") */
  daysOld?: number;
  /** onde a pessoa está: 'bar' (hotspot), 'event' (evento), 'crowd' (aglomeração pra cluster) ou 'spread' */
  where?: 'bar' | 'event' | 'crowd' | 'spread';
};

function fakePhoto(n: number): string { return `${PHOTO_BASE}/uploads/fakes/fake-${n}.jpg`; }

const FAKES: Fake[] = [
  { name: 'Aline', gender: 'female', birth: '2001-04-12', bio: 'Designer. Bar de sexta e trilha de domingo.', photo: fakePhoto(1), tier: 'premium_plus', verified: true, daysOld: 40, where: 'bar' },
  { name: 'Rafael', gender: 'male', birth: '1997-09-03', bio: 'Engenheiro recém-chegado. Me mostra a cidade?', photo: fakePhoto(2), boosted: true, daysOld: 3, where: 'bar' },
  { name: 'Bia', gender: 'female', birth: '1999-01-25', bio: 'Café forte, playlist melhor ainda.', photo: fakePhoto(3), daysOld: 60, where: 'bar' },
  { name: 'Caio', gender: 'male', birth: '1995-11-17', bio: 'Corrida no parque 6h. Cerveja às 18h.', photo: fakePhoto(4), daysOld: 25, where: 'bar' },
  { name: 'Marina', gender: 'female', birth: '2000-07-08', bio: 'Fotógrafa. Sempre no show de alguém.', photo: fakePhoto(5), tier: 'premium', verified: true, daysOld: 90, where: 'bar' },
  { name: 'Theo', gender: 'non_binary', birth: '1998-03-30', bio: 'Boêmio de carteirinha.', photo: fakePhoto(6), showPhotoOnMap: false, daysOld: 12, where: 'spread' },
  { name: 'Lívia', gender: 'female', birth: '1996-12-02', bio: 'Yoga, praia e um bom vinho.', photo: fakePhoto(7), daysOld: 45, where: 'spread' },
  { name: 'Pedro', gender: 'male', birth: '1994-05-21', bio: 'Games e churrasco. Nessa ordem.', photo: fakePhoto(8), daysOld: 200, where: 'spread' },
];

// gente sintética (teste de carga + matriz de casos)
const FIRST = ['Maria Eduarda', 'João Pedro', 'Leonardo', 'Ana', 'Guilherme Henrique', 'Lu', 'Fernanda', 'Vinícius', 'Wellington', 'Isa', 'Carolina', 'Matheus', 'Bárbara', 'Kauã', 'Letícia', 'Rodrigo'];
const LAST = ['Albuquerque', 'Silva', 'da Costa', 'Souza', 'de Oliveira', 'Nascimento', 'Ferreira', 'dos Santos', 'Ribeiro', 'Cavalcanti'];
const BIOS = ['Novo por aqui, indicações?', 'Café, livros e um rolê à noite.', 'Trabalho remoto, vida presencial.', 'Só na paz.', 'Bora conhecer a cidade?'];
function extraFake(i: number): Fake {
  const k = i - FAKES.length;
  const name = k % 7 === 6 ? FIRST[k % FIRST.length].split(' ')[0] : `${FIRST[k % FIRST.length]} ${LAST[(k * 3) % LAST.length]}`;
  let photo: string | null = fakePhoto((k % 8) + 1);
  if (k % 5 === 4) photo = null; // sem foto → só avatar
  if (k % 17 === 3) photo = `${PHOTO_BASE}/uploads/fakes/missing-${k}.jpg`; // foto quebrada (404) → não pode quebrar o mapa
  const where: Fake['where'] = k % 6 === 5 ? 'event' : k % 4 === 1 ? 'crowd' : 'spread';
  return {
    name,
    gender: k % 3 === 0 ? 'female' : k % 3 === 1 ? 'male' : 'non_binary',
    birth: `${1990 + (k % 15)}-${String((k % 12) + 1).padStart(2, '0')}-${String((k % 27) + 1).padStart(2, '0')}`,
    bio: BIOS[k % BIOS.length],
    photo,
    tier: k % 11 === 10 ? 'premium' : k % 29 === 28 ? 'premium_plus' : undefined,
    verified: k % 9 === 8,
    showPhotoOnMap: k % 13 !== 12,
    daysOld: k % 10 === 9 ? 1 : 30 + (k % 300),
    where,
  };
}

async function main() {
  const lat = Number(process.argv[2] ?? -18.9186);
  const lng = Number(process.argv[3] ?? -48.2772);
  const qty = Math.min(400, Number(process.argv[4] ?? 6));
  if (Number.isNaN(lat) || Number.isNaN(lng)) throw new Error('lat/lng inválidos');
  const mPerLng = 111_320 * Math.cos((lat * Math.PI) / 180);

  // thumbnails 256x256 das fotos fake (o mapa nunca baixa a foto grande)
  const fakesDir = path.join(UPLOAD_DIR, 'fakes');
  for (let n = 1; n <= 8; n++) {
    const src = path.join(fakesDir, `fake-${n}.jpg`);
    if (fs.existsSync(src) && !fs.existsSync(path.join(fakesDir, thumbNameFor(`fake-${n}.jpg`)))) await makeThumbnail(src);
  }
  const thumbOf = (photo: string | null): string | null => {
    if (!photo) return null;
    const file = photo.split('/').pop() ?? '';
    return fs.existsSync(path.join(fakesDir, thumbNameFor(file))) ? photo.replace(/[^/]+$/, thumbNameFor(file)) : photo;
  };

  // POI de demo a ~180m do ponto: vira hotspot (>= 5 pessoas) pra exercitar o pulso no mapa
  const hotLat = lat + 180 / 111_320;
  const hotLng = lng + 120 / mPerLng;
  const hotPoi = await prisma.pOI.upsert({
    where: { source_externalId: { source: 'dev', externalId: 'dev-bar-do-leo' } },
    update: { latitude: hotLat, longitude: hotLng },
    create: { externalId: 'dev-bar-do-leo', name: 'Bar do Léo', category: 'bar', latitude: hotLat, longitude: hotLng, city: 'Uberlândia', state: 'MG', source: 'dev', isPartner: true, partnerOffer: 'Chopp em dobro pra quem cruzou aqui' },
  });
  console.log('🍺 POI de demo', hotPoi.name, '@', hotLat.toFixed(5), hotLng.toFixed(5));

  // POI de evento de demo a ~250m (lat -150m, lng -200m): exercita categoria 'event' / "hoje" no mapa
  const evLat = lat - 150 / 111_320;
  const evLng = lng - 200 / mPerLng;
  const evPoi = await prisma.pOI.upsert({
    where: { source_externalId: { source: 'dev', externalId: 'dev-sunset-praca' } },
    update: { latitude: evLat, longitude: evLng, subcategory: 'hoje' },
    create: { externalId: 'dev-sunset-praca', name: 'Sunset na Praça', category: 'event', subcategory: 'hoje', latitude: evLat, longitude: evLng, city: 'Uberlândia', state: 'MG', source: 'dev' },
  });
  console.log('🌇 POI de evento', evPoi.name, '@', evLat.toFixed(5), evLng.toFixed(5));

  // aglomeração sem POI a ~320m NE (dezenas de pessoas no mesmo quarteirão → cluster "👥 27")
  const crowdLat = lat + 230 / 111_320;
  const crowdLng = lng + 220 / mPerLng;

  // catálogo de interesses (seed.ts) → 3 por fake, escolhidos de forma determinística
  const interests = await prisma.interest.findMany({ orderBy: { id: 'asc' }, select: { id: true } });

  for (let i = 0; i < qty; i++) {
    const f = i < FAKES.length ? FAKES[i] : extraFake(i);
    const phone = `+5534900000${String(i + 1).padStart(3, '0')}`;
    // avatar estável por fake (seed = telefone)
    const avatar = randomAvatarConfig(phone, { gender: f.gender as never }) as never;
    // posição: no bar (raio ~40m → hotspot), no evento (~30m), na aglomeração (~45m) ou espalhado até ~1,5km
    const where = f.where ?? 'spread';
    const angle = where === 'spread' ? i * 2.399963 : (i / 7) * Math.PI * 2;
    const dist = where === 'bar' ? 15 + (i % 5) * 6 : where === 'event' ? 8 + (i % 6) * 5 : where === 'crowd' ? 6 + (i % 9) * 5 : 120 + ((i * 137) % 1400);
    const baseLat = where === 'bar' ? hotLat : where === 'event' ? evLat : where === 'crowd' ? crowdLat : lat;
    const baseLng = where === 'bar' ? hotLng : where === 'event' ? evLng : where === 'crowd' ? crowdLng : lng;
    const uLat = baseLat + (dist * Math.cos(angle)) / 111_320;
    const uLng = baseLng + (dist * Math.sin(angle)) / mPerLng;
    const createdAt = new Date(Date.now() - (f.daysOld ?? 30) * 86_400_000);
    const poiId = where === 'bar' ? hotPoi.id : where === 'event' ? evPoi.id : undefined;
    const poiName = where === 'bar' ? hotPoi.name : where === 'event' ? evPoi.name : '';

    const user = await prisma.user.upsert({
      where: { phone },
      update: {
        name: f.name, bio: f.bio, visibilityMode: 'visible', lastActiveAt: new Date(), premiumTier: (f.tier ?? 'free') as never, isVerified: Boolean(f.verified), avatarConfig: avatar,
        showPhotoOnMap: f.showPhotoOnMap ?? true, createdAt,
      },
      create: {
        id: crypto.randomUUID(),
        phone,
        name: f.name,
        birthDate: new Date(f.birth),
        gender: f.gender as never,
        lookingFor: 'unspecified',
        bio: f.bio,
        visibilityMode: 'visible',
        profileCompleteness: 45,
        premiumTier: (f.tier ?? 'free') as never,
        isVerified: Boolean(f.verified),
        avatarConfig: avatar,
        showPhotoOnMap: f.showPhotoOnMap ?? true,
        createdAt,
      },
    });

    if (interests.length > 0) {
      const picks = [0, 1, 2].map((k) => interests[(i * 3 + k) % interests.length].id);
      await prisma.userInterest.createMany({ data: picks.map((interestId) => ({ userId: user.id, interestId })), skipDuplicates: true });
    }

    if (f.boosted) {
      const hasBoost = await prisma.boost.findFirst({ where: { userId: user.id, expiresAt: { gt: new Date() } } });
      if (!hasBoost) {
        await prisma.boost.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 6 * 3_600_000), amountCents: 0, platform: 'dev' } });
      }
    }

    // foto principal: sempre reflete o fake (URL/thumbnail atualizados a cada seed; sem foto = apaga)
    const existing = await prisma.photo.findFirst({ where: { userId: user.id, isMain: true } });
    if (f.photo) {
      const data = { url: f.photo, thumbnailUrl: thumbOf(f.photo) };
      if (existing) await prisma.photo.update({ where: { id: existing.id }, data });
      else await prisma.photo.create({ data: { userId: user.id, ...data, isMain: true, orderIndex: 0 } });
    } else if (existing) {
      await prisma.photo.deleteMany({ where: { userId: user.id } });
    }

    const geohash = encodeGeohash(uLat, uLng, 5);
    const ttl = 18_000;
    await prisma.location.create({
      data: { userId: user.id, latitude: uLat, longitude: uLng, geohash, expiresAt: new Date(Date.now() + ttl * 1000), poiId },
    });
    const p = redis.pipeline();
    p.zadd(`presence:${geohash}`, Date.now(), user.id);
    p.expire(`presence:${geohash}`, ttl);
    // poi_id/poi_name = lugar atual (o backend lê daqui no /nearby e no cartão); vazio = em lugar nenhum
    p.hset(`user:loc:${user.id}`, {
      lat: String(uLat),
      lng: String(uLng),
      geohash,
      updated_at: String(Date.now()),
      poi_id: poiId ? String(poiId) : '',
      poi_name: poiName,
    });
    p.expire(`user:loc:${user.id}`, ttl);
    p.del(`profile:${user.id}`);
    await p.exec();

    if (i < FAKES.length || i % 25 === 0) console.log(`👤 ${f.name.padEnd(14)} ${phone}  @ ${uLat.toFixed(5)}, ${uLng.toFixed(5)}  (${where}, ${dist}m)`);
  }
  console.log(`✅ ${qty} usuários fake com presença ativa em volta de ${lat}, ${lng}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); redis.disconnect(); });
