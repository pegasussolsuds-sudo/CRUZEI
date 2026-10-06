#!/usr/bin/env node
// Semeia N pessoas falsas (+5534911xxxxxx) com presença ativa num raio em volta de um ponto, com o PIOR CASO de avatar:
// roupa sobreposta, top elaborado, asas/jetpack, cabelo volumoso, chapéu+óculos+colar+pulso, aura animada no máximo,
// fundo, animação assinatura e, em boa parte, pet, veículo, orgulho e pronomes. Todos premium_plus (itens plus valem).
// Mesmo esquema do apps/backend/prisma/seed-dev.ts (usuário, foto fake, interesses) + aceite dos termos; a presença
// é gravada pelo próprio RedisService do backend (mesmo script Lua do /location/update).
//
//   node tools/loadtest/seed.js --n 1000 --lat -18.924 --lng -48.271 --radius 300
//   node tools/loadtest/seed.js --refresh --n 1000 --lat -18.924 --lng -48.271 --radius 300   (só renova a presença)
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ngeohash = require('ngeohash');
const L = require('./lib');

const a = L.parseArgs({ n: 1000, lat: -18.924, lng: -48.271, radius: 300, refresh: false, 'photo-share': 0.75, concurrency: 8 });
const dist = L.loadBackend();
const u = L.breq('@cruzei/shared-utils');
const { LEGAL_VERSION } = L.breq('@cruzei/shared-types');
const { PRIVACY, cellOf } = dist('modules/location/discovery-privacy');
const { RedisService } = dist('redis/redis.service');
const { prisma, redis } = L.prismaAndRedis();
const presence = new RedisService(redis);

// mesmo geohash da presença que o backend usa (location.service PRESENCE_PRECISION)
const PRESENCE_PRECISION = 6;
const PHOTO_BASE = process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000';

// ---------------- avatar pesado ----------------
const PLUS = u.avatarTiersFor('premium_plus');
const okItem = (slot, id) => !!u.avatarItem(slot, id) && PLUS.has(u.avatarTierOf(slot, id));
const paidItems = (slot) =>
  u.avatarSlotDef(slot).items.filter((i) => i.id !== 'none' && i.tier !== 'free' && PLUS.has(i.tier)).map((i) => i.id);
/** a lista pedida, só com o que existe no catálogo e vale no Premium+; se o catálogo mudar e nada sobrar, os pagos do slot */
const heavy = (slot, ids) => {
  const list = ids.filter((id) => okItem(slot, id));
  return list.length ? list : paidItems(slot);
};
const colors = (slot) => u.AVATAR_COLOR_SLOTS.find((s) => s.slot === slot).items.filter((c) => PLUS.has(c.tier)).map((c) => c.id);

const H = {
  outer: heavy('outer', ['cape', 'mantle', 'trench', 'kimono', 'puffer', 'mecha']),
  top: heavy('top', ['gown', 'sequin', 'armor', 'royal', 'holo']),
  bag: heavy('bag', ['wings_angel', 'wings_butterfly', 'wings_dragon', 'wings_neon', 'jetpack']),
  hair: heavy('hair', ['afro', 'long_curly', 'braids', 'dreads', 'braid_crown']),
  hat: heavy('hat', ['neon_crown', 'tiara', 'top_hat', 'witch', 'halo', 'horns', 'cat_ears', 'cowboy', 'turban']),
  glasses: heavy('glasses', ['cyber', 'visor', 'heart', 'star', 'aviator', 'round_gold', 'monocle']),
  accessory: heavy('accessory', ['butterflies', 'flower_crown', 'headset', 'hoops', 'pearl_earrings']),
  neck: heavy('neck', ['amulet', 'medal', 'chain', 'pearls', 'lei']),
  wrist: heavy('wrist', ['luxury', 'cuff', 'smartwatch', 'bangles']),
  aura: heavy('aura', [
    'galaxy', 'flames', 'electric', 'crystals', 'supernova', 'hologram', 'golden', 'rainbow', 'pride', 'stardust',
    'petals', 'fireflies', 'hearts', 'music', 'snow', 'bubbles', 'mist', 'sparkle',
  ]),
  pet: heavy('pet', ['dragon', 'phoenix', 'unicorn', 'fox_spirit', 'robot_dog', 'ghost', 'axolotl', 'capybara', 'arara']),
  vehicle: heavy('vehicle', ['ufo', 'sport', 'carpet', 'cloud', 'hoverboard', 'moto', 'jeep', 'car', 'classic', 'lambreta']),
  backdrop: heavy('backdrop', ['stage', 'galaxy', 'aurora', 'neon_grid', 'night_city', 'confetti', 'gold_luxe', 'carnival', 'pride']),
  emote: paidItems('emote'),
  held: heavy('held', ['orb', 'saber', 'wand', 'sparkler', 'crystal_ball', 'lantern', 'guitar', 'trophy', 'potion']),
  shoes: heavy('shoes', ['hover', 'glass', 'skates', 'platform']),
  bottom: heavy('bottom', ['tutu', 'metallic', 'kilt', 'midi', 'wide']),
  face: heavy('face', ['starry', 'hearts']),
  faceDetail: heavy('faceDetail', ['glitter', 'glam', 'star_cheek']),
  pride: u.avatarSlotDef('pride').items.filter((i) => i.id !== 'none').map((i) => i.id),
  prideFlag: u.avatarSlotDef('prideFlag').items.map((i) => i.id),
};
const C = Object.fromEntries(
  ['hairColor', 'topColor', 'outerColor', 'bottomColor', 'shoesColor', 'hatColor', 'auraColor', 'vehicleColor'].map((s) => [s, colors(s)]),
);
const PRONOUNS = {
  female: ['ela', 'ela_elu', 'any'],
  male: ['ele', 'ele_elu', 'any'],
  other: ['elu', 'ela_ele', 'ela_elu', 'ele_elu', 'any'],
};

function heavyAvatar(phone, gender, pick, chance) {
  const cfg = {
    ...u.randomAvatarConfig(phone, { gender, tiers: PLUS }),
    hair: pick(H.hair), hairColor: pick(C.hairColor),
    top: pick(H.top), topColor: pick(C.topColor),
    outer: pick(H.outer), outerColor: pick(C.outerColor),
    bottom: pick(H.bottom), bottomColor: pick(C.bottomColor),
    shoes: pick(H.shoes), shoesColor: pick(C.shoesColor),
    hat: pick(H.hat), hatColor: pick(C.hatColor),
    glasses: pick(H.glasses), accessory: pick(H.accessory), neck: pick(H.neck), wrist: pick(H.wrist),
    bag: pick(H.bag), held: chance(0.6) ? pick(H.held) : 'none',
    face: pick(H.face), faceDetail: pick(H.faceDetail),
    aura: pick(H.aura), auraLevel: 'max', auraColor: pick(C.auraColor),
    backdrop: pick(H.backdrop), emote: pick(H.emote),
  };
  if (chance(0.75)) {
    cfg.pet = pick(H.pet);
    const poses = u.petPosesOf(cfg.pet);
    if (poses.length) cfg.petPose = pick(poses);
  }
  if (chance(0.55)) Object.assign(cfg, { vehicle: pick(H.vehicle), vehicleColor: pick(C.vehicleColor) });
  if (chance(0.4)) Object.assign(cfg, { pride: pick(H.pride), prideFlag: pick(H.prideFlag) });
  if (chance(0.45)) cfg.pronouns = pick(PRONOUNS[gender]);
  // validação: o que o normalize trocaria não vale no app (item inexistente ou fora do plano)
  const norm = u.normalizeAvatarConfig(cfg, PLUS);
  return { avatar: norm, lost: Object.keys(cfg).filter((k) => norm[k] !== cfg[k]) };
}

// ---------------- perfil ----------------
const FIRST = {
  female: ['Ana', 'Beatriz', 'Camila', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Júlia', 'Larissa', 'Mariana', 'Natália', 'Olívia', 'Paula', 'Rafaela', 'Sofia', 'Tainá', 'Valentina', 'Yasmin'],
  male: ['André', 'Bruno', 'Caio', 'Diego', 'Eduardo', 'Felipe', 'Gustavo', 'Henrique', 'Igor', 'João', 'Lucas', 'Mateus', 'Nicolas', 'Otávio', 'Pedro', 'Rafael', 'Samuel', 'Thiago', 'Vitor', 'Wagner'],
  other: ['Alex', 'Ariel', 'Cris', 'Dani', 'Jordan', 'Kim', 'Luca', 'Noa', 'Sam', 'Rê'],
};
const LAST = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Costa', 'Ribeiro', 'Almeida', 'Carvalho', 'Gomes', 'Martins', 'Araújo', 'Barbosa', 'Rocha', 'Dias', 'Moreira'];
const BIOS = ['Bora conhecer a cidade?', 'Café, livros e um rolê à noite.', 'Trabalho remoto, vida presencial.', 'Só na paz.', 'Novo por aqui, indicações?', 'Show, praia e boteco.', 'Corrida de manhã, samba à noite.', ''];
const ORIENTATIONS = {
  female: ['straight', 'straight', 'straight', 'bisexual', 'bisexual', 'lesbian', 'pansexual', 'queer', 'demisexual', null, null],
  male: ['straight', 'straight', 'straight', 'straight', 'gay', 'gay', 'bisexual', 'pansexual', 'curious', null, null],
  other: ['queer', 'pansexual', 'bisexual', 'asexual', 'demisexual', null],
};
const LOOKING = ['relationship', 'casual', 'friendship', 'network', 'unspecified'];
const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const fakesDir = path.join(L.BACKEND, 'uploads', 'fakes');
const hasThumbs = fs.existsSync(path.join(fakesDir, 'fake-1-t.jpg'));
const stats = { lost: 0, pets: 0, vehicles: 0, pride: 0, pronouns: 0, photos: 0 };

function profileOf(i) {
  const phone = L.phoneOf(i);
  const rnd = L.seededRandom(phone);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const chance = (p) => rnd() < p;
  const g = rnd();
  const gender = g < 0.45 ? 'female' : g < 0.9 ? 'male' : 'other';
  const first = pick(FIRST[gender]);
  const age = 18 + Math.floor(rnd() ** 1.6 * 42); // mais gente de 20 e poucos, até 59
  const birthDate = new Date(Date.UTC(new Date().getUTCFullYear() - age - 1, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)));
  const createdAt = new Date(Date.now() - (chance(0.05) ? 1 + rnd() * 4 : 8 + rnd() * 400) * 86_400_000); // 5% "novo por aqui"
  const orientation = pick(ORIENTATIONS[gender]);
  const s = rnd();
  const isVerified = chance(0.35);
  const { avatar, lost } = heavyAvatar(phone, gender, pick, chance);
  stats.lost += lost.length;
  if (avatar.pet !== 'none') stats.pets++;
  if (avatar.vehicle !== 'none') stats.vehicles++;
  if (avatar.pride !== 'none') stats.pride++;
  if (avatar.pronouns !== 'none') stats.pronouns++;
  const photoN = chance(a['photo-share']) ? 1 + Math.floor(rnd() * 8) : 0;
  return {
    phone,
    photoN,
    interestPicks: Array.from({ length: 3 + Math.floor(rnd() * 4) }, () => rnd()),
    data: {
      name: `${first} ${pick(LAST)}`,
      birthDate,
      gender,
      bio: pick(BIOS) || null,
      lookingFor: pick(LOOKING),
      orientation,
      orientationConsentedAt: orientation ? createdAt : null,
      showOrientation: Boolean(orientation) && chance(0.5),
      sameOrientationFirst: Boolean(orientation) && chance(0.15),
      showMe: s < 0.7 ? 'everyone' : s < 0.85 ? 'women' : 'men',
      instagramHandle: chance(0.25) ? `${ascii(first)}_${i + 1}` : null,
      avatarConfig: avatar,
      premiumTier: 'premium_plus',
      premiumExpiresAt: null,
      visibilityMode: 'visible',
      anonymousUntil: null,
      isPaused: false,
      pausedUntil: null,
      discoveryMode: 'everyone',
      showPhotoOnMap: true,
      showAge: true,
      showDistance: true,
      ageMin: 18,
      ageMax: 99,
      isVerified,
      verifiedAt: isVerified ? createdAt : null,
      profileCompleteness: 85,
      termsVersion: LEGAL_VERSION,
      termsAcceptedAt: createdAt,
      accountStatus: 'active',
      suspendedUntil: null,
      moderationReason: null,
      reviewHoldAt: null,
      deletedAt: null,
      sessionsValidAfter: null,
      lastActiveAt: new Date(),
      createdAt,
    },
  };
}

async function upsertUser(i, interests) {
  const p = profileOf(i);
  const user = await prisma.user.upsert({
    where: { phone: p.phone },
    update: p.data,
    create: { id: crypto.randomUUID(), phone: p.phone, ...p.data },
    select: { id: true },
  });
  if (interests.length) {
    const ids = [...new Set(p.interestPicks.map((r) => interests[Math.floor(r * interests.length)].id))];
    await prisma.userInterest.createMany({ data: ids.map((interestId) => ({ userId: user.id, interestId })), skipDuplicates: true });
  }
  // foto principal igual ao seed-dev: fotos fake servidas pelo backend; sem foto = só avatar no mapa
  const existing = await prisma.photo.findFirst({ where: { userId: user.id, isMain: true }, select: { id: true } });
  if (p.photoN) {
    stats.photos++;
    const data = {
      url: `${PHOTO_BASE}/uploads/fakes/fake-${p.photoN}.jpg`,
      thumbnailUrl: `${PHOTO_BASE}/uploads/fakes/fake-${p.photoN}${hasThumbs ? '-t' : ''}.jpg`,
      status: 'approved',
    };
    if (existing) await prisma.photo.update({ where: { id: existing.id }, data });
    else await prisma.photo.create({ data: { userId: user.id, ...data, isMain: true, orderIndex: 0 } });
  } else if (existing) {
    await prisma.photo.deleteMany({ where: { userId: user.id } });
  }
  return user.id;
}

/** posição fixa por pessoa (mesma seed = mesmo lugar): o --refresh devolve cada um pro seu ponto */
function setPresence(id, phone) {
  const pos = L.pointInDisk(a.lat, a.lng, a.radius, L.seededRandom(`${phone}#pos`));
  const cell = cellOf(pos.lat, pos.lng);
  return presence.setUserPresence(
    id, u.encodeGeohash(pos.lat, pos.lng, PRESENCE_PRECISION), pos.lat, pos.lng, PRIVACY.PRESENCE_TTL_S,
    null, false, cell, ngeohash.neighbors(cell), null,
  );
}

async function pool(count, k, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: k }, async () => {
    while (next < count) await fn(next++);
  }));
}

async function main() {
  if (a.n < 1 || a.n > 999_999) throw new Error('--n entre 1 e 999999');
  const t0 = Date.now();
  if (a.refresh) {
    const users = await L.testUsers(prisma, a.n);
    if (!users.length) throw new Error('nenhuma conta +5534911 — rode sem --refresh primeiro');
    await pool(users.length, 32, (k) => setPresence(users[k].id, users[k].phone));
    await presence.publishCandidateInvalidation('*');
    console.log(`presença renovada: ${users.length} pessoas por ${PRIVACY.PRESENCE_TTL_S / 60} min em volta de ${a.lat}, ${a.lng} (r=${a.radius} m)`);
    return;
  }
  if (!hasThumbs) console.warn('aviso: sem miniaturas em apps/backend/uploads/fakes (rode o seed-dev uma vez); usando a foto grande');
  const lostSlots = Object.entries(H).filter(([, l]) => !l.length).map(([s]) => s);
  if (lostSlots.length) console.warn(`aviso: catálogo sem itens pesados em ${lostSlots.join(', ')}`);
  const interests = await prisma.interest.findMany({ orderBy: { id: 'asc' }, select: { id: true } });
  const ids = new Array(a.n);
  await pool(a.n, a.concurrency, async (i) => {
    ids[i] = await upsertUser(i, interests);
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${a.n} contas`);
  });
  // estado de localização do zero (âncora do GPS_GUARD, casa aprendida…) e presença nova
  await L.forgetLocation(redis, ids);
  await pool(a.n, 32, (i) => setPresence(ids[i], L.phoneOf(i)));
  await presence.publishCandidateInvalidation('*');
  console.log(
    `${a.n} pessoas (${L.phoneOf(0)}…${L.phoneOf(a.n - 1)}) em ${((Date.now() - t0) / 1000).toFixed(1)} s, ` +
      `presença ${PRIVACY.PRESENCE_TTL_S / 60} min em volta de ${a.lat}, ${a.lng} (r=${a.radius} m)\n` +
      `avatar pesado em todas (aura max, asas/jetpack, sobreposição, fundo, animação): pet ${stats.pets}, veículo ${stats.vehicles}, ` +
      `orgulho ${stats.pride}, pronomes ${stats.pronouns}, com foto ${stats.photos}; itens recusados pelo normalize: ${stats.lost}`,
  );
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
