#!/usr/bin/env node
// Desliga a presença de TODAS as contas do teste (+5534911…) e, com --delete, apaga essas contas (o banco apaga em
// cascata fotos, interesses, curtidas, acenos, conversas e mensagens delas). Nunca toca em outra faixa de telefone.
//
//   node tools/loadtest/cleanup.js            # some do mapa (contas ficam, prontas pro seed --refresh)
//   node tools/loadtest/cleanup.js --delete   # apaga as contas
const L = require('./lib');

const a = L.parseArgs({ delete: false });
const dist = L.loadBackend();
const { RedisService } = dist('redis/redis.service');
const { prisma, redis } = L.prismaAndRedis();

async function main() {
  const users = await L.testUsers(prisma);
  const ids = users.map((x) => x.id);
  await L.forgetLocation(redis, ids);
  // toda instância esquece os candidatos em cache (a célula de presença já percebe quem saiu do ZSET)
  await new RedisService(redis).publishCandidateInvalidation('*');
  let deleted = 0;
  if (a.delete) deleted = (await prisma.user.deleteMany({ where: { phone: { startsWith: L.PHONE_PREFIX } } })).count;
  console.log(`${ids.length} contas ${L.PHONE_PREFIX}… sem presença${a.delete ? `; ${deleted} apagadas` : ''}`);
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
