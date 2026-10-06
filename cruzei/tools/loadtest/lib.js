// Base comum do teste de carga: caminhos, argumentos, ambiente do backend e a faixa de telefones das contas falsas.
// Os .env do backend são carregados pelo PRÓPRIO código da aplicação (dist/src/config/load-env), sem imprimir nada.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'apps', 'backend');
const DIST = path.join(BACKEND, 'dist', 'src');
const OUT = path.join(__dirname, 'out');
/** require a partir do backend (os pacotes @cruzei/* só estão linkados lá) */
const breq = createRequire(path.join(BACKEND, 'package.json'));

/** +5534911 + 6 dígitos (celular BR válido, 14 caracteres) — nunca colide com o +553490000xxxx do seed-dev */
const PHONE_PREFIX = '+5534911';
const phoneOf = (i) => PHONE_PREFIX + String(i + 1).padStart(6, '0');
const indexOf = (phone) => Number(phone.slice(PHONE_PREFIX.length)) - 1;

/** --chave valor | --flag (vira true); números viram número. Chave desconhecida = erro (pega erro de digitação). */
function parseArgs(defaults, argv = process.argv.slice(2)) {
  try {
    return readArgs(defaults, argv);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

function readArgs(defaults, argv) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/i.exec(argv[i]);
    if (!m) throw new Error(`argumento inválido: ${argv[i]}`);
    const key = m[1];
    if (!(key in defaults)) throw new Error(`argumento desconhecido: --${key} (aceitos: ${Object.keys(defaults).join(', ')})`);
    let val = m[2];
    if (val === undefined) val = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = typeof defaults[key] === 'number' ? Number(val) : typeof defaults[key] === 'boolean' ? val !== 'false' : val;
    if (typeof defaults[key] === 'number' && !Number.isFinite(out[key])) throw new Error(`--${key} precisa ser número`);
  }
  return out;
}

/** carrega o ambiente do backend como o main.ts e recusa rodar fora de desenvolvimento (mesma trava do seed-dev) */
function loadBackend() {
  if (!fs.existsSync(path.join(DIST, 'config', 'load-env.js')))
    throw new Error('apps/backend/dist não existe: compile o backend antes (cd apps/backend && npx tsc -p tsconfig.build.json)');
  require(path.join(DIST, 'config', 'load-env'));
  const { appEnv } = require(path.join(DIST, 'config', 'security'));
  if (appEnv() !== 'development' || /prod/i.test(process.env.DATABASE_URL ?? ''))
    throw new Error('o teste de carga só roda com NODE_ENV=development (e nunca num banco de produção)');
  return (p) => require(path.join(DIST, p));
}

function prismaAndRedis() {
  const { PrismaClient } = require('@prisma/client');
  const Redis = require('ioredis');
  return { prisma: new PrismaClient(), redis: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379') };
}

/** contas do teste em ordem de telefone (limit = só as N primeiras) */
function testUsers(prisma, limit) {
  return prisma.user.findMany({
    where: { phone: { startsWith: PHONE_PREFIX } },
    select: { id: true, phone: true },
    orderBy: { phone: 'asc' },
    ...(limit ? { take: limit } : {}),
  });
}

/**
 * Esquece o estado de localização das contas no Redis (presença, trava de 20 s, última resposta, âncora do GPS_GUARD,
 * casa aprendida): o próximo envio começa do zero. Tira cada uma do ZSET da célula — a descoberta percebe na próxima
 * recarga incremental.
 */
async function forgetLocation(redis, ids) {
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const ghs = await redis.pipeline(part.map((id) => ['hget', `user:loc:${id}`, 'geohash'])).exec();
    const p = redis.pipeline();
    part.forEach((id, k) => {
      const gh = ghs[k][1];
      if (gh) p.zrem(`presence:${gh}`, id);
      p.del(
        `user:loc:${id}`, `loc:gate:${id}`, `loc:last:${id}`, `loc:hist:${id}`, `la:gate:${id}`,
        `loc:anchor:${id}`, `loc:pending:${id}`, `loc:flag:${id}`, `gps:flagged:${id}`,
        `gps:strikes:${id}:mock`, `gps:strikes:${id}:teleport`, `home:cells:${id}`, `profile:${id}`,
      );
    });
    await p.exec();
  }
}

/** ponto aleatório uniforme num disco de raio `radiusM` (rnd ∈ [0,1)) */
function pointInDisk(lat, lng, radiusM, rnd) {
  const r = radiusM * Math.sqrt(rnd());
  const a = rnd() * 2 * Math.PI;
  return offset(lat, lng, r * Math.cos(a), r * Math.sin(a));
}

function offset(lat, lng, northM, eastM) {
  return { lat: lat + northM / 111_320, lng: lng + eastM / (111_320 * Math.cos((lat * Math.PI) / 180)) };
}

/** distância aproximada (m) — basta pra caminhada de algumas centenas de metros */
function distM(a, b) {
  const n = (b.lat - a.lat) * 111_320;
  const e = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(n, e);
}

/** gerador determinístico (mulberry32) a partir de um texto */
function seededRandom(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let t = h >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function outFile(name) {
  fs.mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

module.exports = {
  ROOT, BACKEND, OUT, breq, PHONE_PREFIX, phoneOf, indexOf, parseArgs, loadBackend, prismaAndRedis, testUsers,
  forgetLocation, pointInDisk, offset, distM, seededRandom, stamp, outFile,
};
