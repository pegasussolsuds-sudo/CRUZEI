// Seed de DESENVOLVIMENTO — cria usuários fake com presença ativa em volta de um ponto.
// Uso: pnpm exec ts-node prisma/seed-dev.ts <lat> <lng> [quantidade]
// Ex.:  pnpm exec ts-node prisma/seed-dev.ts -18.9186 -48.2772 6
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import * as crypto from 'node:crypto';
import { randomAvatarConfig } from '@cruzei/shared-utils';

const prisma = new PrismaClient();
// Fotos dos fakes servidas pelo próprio backend (CORS liberado em /uploads) — o mapa desenha avatares em canvas.
const PHOTO_BASE = process.env.PUBLIC_BASE_URL ?? 'http://192.168.1.8:3000';
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

type Fake = { name: string; gender: string; birth: string; bio: string; photo: string; tier?: 'premium' | 'premium_plus'; verified?: boolean; boosted?: boolean };
const FAKES: Fake[] = [
  { name: 'Aline', gender: 'female', birth: '2001-04-12', bio: 'Designer. Bar de sexta e trilha de domingo.', photo: PHOTO_BASE + '/uploads/fakes/fake-1.jpg', tier: 'premium_plus', verified: true },
  { name: 'Rafael', gender: 'male', birth: '1997-09-03', bio: 'Engenheiro recém-chegado. Me mostra a cidade?', photo: PHOTO_BASE + '/uploads/fakes/fake-2.jpg', boosted: true },
  { name: 'Bia', gender: 'female', birth: '1999-01-25', bio: 'Café forte, playlist melhor ainda.', photo: PHOTO_BASE + '/uploads/fakes/fake-3.jpg' },
  { name: 'Caio', gender: 'male', birth: '1995-11-17', bio: 'Corrida no parque 6h. Cerveja às 18h.', photo: PHOTO_BASE + '/uploads/fakes/fake-4.jpg' },
  { name: 'Marina', gender: 'female', birth: '2000-07-08', bio: 'Fotógrafa. Sempre no show de alguém.', photo: PHOTO_BASE + '/uploads/fakes/fake-5.jpg', tier: 'premium', verified: true },
  { name: 'Theo', gender: 'non_binary', birth: '1998-03-30', bio: 'Boêmio de carteirinha.', photo: PHOTO_BASE + '/uploads/fakes/fake-6.jpg' },
  { name: 'Lívia', gender: 'female', birth: '1996-12-02', bio: 'Yoga, praia e um bom vinho.', photo: PHOTO_BASE + '/uploads/fakes/fake-7.jpg' },
  { name: 'Pedro', gender: 'male', birth: '1994-05-21', bio: 'Games e churrasco. Nessa ordem.', photo: PHOTO_BASE + '/uploads/fakes/fake-8.jpg' },
];

async function main() {
  const lat = Number(process.argv[2] ?? -18.9186);
  const lng = Number(process.argv[3] ?? -48.2772);
  const qty = Math.min(FAKES.length, Number(process.argv[4] ?? 6));
  if (Number.isNaN(lat) || Number.isNaN(lng)) throw new Error('lat/lng inválidos');

  // POI de demo a ~180m do ponto: vira hotspot (>= 5 pessoas) pra exercitar o pulso no mapa
  const hotLat = lat + 180 / 111_320;
  const hotLng = lng + 120 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const hotPoi = await prisma.pOI.upsert({
    where: { source_externalId: { source: 'dev', externalId: 'dev-bar-do-leo' } },
    update: { latitude: hotLat, longitude: hotLng },
    create: { externalId: 'dev-bar-do-leo', name: 'Bar do Léo', category: 'bar', latitude: hotLat, longitude: hotLng, city: 'Uberlândia', state: 'MG', source: 'dev', isPartner: true, partnerOffer: 'Chopp em dobro pra quem cruzou aqui' },
  });
  console.log('🍺 POI de demo', hotPoi.name, '@', hotLat.toFixed(5), hotLng.toFixed(5));

  // POI de evento de demo a ~250m (lat -150m, lng -200m): exercita categoria 'event' / "hoje" no mapa
  const evLat = lat - 150 / 111_320;
  const evLng = lng - 200 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const evPoi = await prisma.pOI.upsert({
    where: { source_externalId: { source: 'dev', externalId: 'dev-sunset-praca' } },
    update: { latitude: evLat, longitude: evLng, subcategory: 'hoje' },
    create: { externalId: 'dev-sunset-praca', name: 'Sunset na Praça', category: 'event', subcategory: 'hoje', latitude: evLat, longitude: evLng, city: 'Uberlândia', state: 'MG', source: 'dev' },
  });
  console.log('🌇 POI de evento', evPoi.name, '@', evLat.toFixed(5), evLng.toFixed(5));

  // catálogo de interesses (seed.ts) → 3 por fake, escolhidos de forma determinística
  const interests = await prisma.interest.findMany({ orderBy: { id: 'asc' }, select: { id: true } });

  for (let i = 0; i < qty; i++) {
    const f = FAKES[i];
    const phone = `+5534900000${String(i + 1).padStart(3, '0')}`;
    // avatar estável por fake (seed = telefone)
    const avatar = randomAvatarConfig(phone, { gender: f.gender as never }) as never;
    // espalha num raio de ~800m
    // os 5 primeiros ficam 'no Bar do Léo' (raio ~40m) → hotspot; o resto espalhado num raio de ~800m
    const atBar = i < 5;
    const angle = (i / qty) * Math.PI * 2;
    const dist = atBar ? 15 + i * 6 : 150 + (i * 97) % 650;
    const baseLat = atBar ? hotLat : lat;
    const baseLng = atBar ? hotLng : lng;
    const uLat = baseLat + (dist * Math.cos(angle)) / 111_320;
    const uLng = baseLng + (dist * Math.sin(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180));

    const user = await prisma.user.upsert({
      where: { phone },
      update: { name: f.name, bio: f.bio, visibilityMode: 'visible', lastActiveAt: new Date(), premiumTier: (f.tier ?? 'free') as never, isVerified: Boolean(f.verified), avatarConfig: avatar },
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

    const existing = await prisma.photo.findFirst({ where: { userId: user.id } });
    if (!existing) {
      await prisma.photo.create({ data: { userId: user.id, url: f.photo, thumbnailUrl: f.photo, isMain: true, orderIndex: 0 } });
    }

    const geohash = encodeGeohash(uLat, uLng, 5);
    const ttl = 18_000;
    await prisma.location.create({
      data: { userId: user.id, latitude: uLat, longitude: uLng, geohash, expiresAt: new Date(Date.now() + ttl * 1000), poiId: atBar ? hotPoi.id : undefined },
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
      poi_id: atBar ? String(hotPoi.id) : '',
      poi_name: atBar ? hotPoi.name : '',
    });
    p.expire(`user:loc:${user.id}`, ttl);
    p.del(`profile:${user.id}`);
    await p.exec();

    console.log(`👤 ${f.name.padEnd(8)} ${phone}  @ ${uLat.toFixed(5)}, ${uLng.toFixed(5)}  (${dist}m)`);
  }
  console.log(`✅ ${qty} usuários fake com presença ativa em volta de ${lat}, ${lng}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); redis.disconnect(); });
