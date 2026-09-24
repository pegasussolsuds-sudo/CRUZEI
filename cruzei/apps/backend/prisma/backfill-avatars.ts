// Backfill único: contas com avatar_config NULL ganham um avatar determinístico (seed = id, mesma regra do
// fallback do backend → o boneco não muda depois do backfill). Uso: npx ts-node prisma/backfill-avatars.ts
import { Prisma, PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { randomAvatarConfig } from '@cruzei/shared-utils';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

async function main() {
  const users = await prisma.user.findMany({
    where: { avatarConfig: { equals: Prisma.AnyNull } },
    select: { id: true, name: true, gender: true },
  });
  for (const u of users) {
    const avatar = randomAvatarConfig(u.id, { gender: u.gender });
    await prisma.user.update({ where: { id: u.id }, data: { avatarConfig: avatar as never } });
    await redis.del(`profile:${u.id}`); // cache do /me
    console.log(`👤 ${u.name.padEnd(18)} ${u.id}  → avatar gerado`);
  }
  console.log(`✅ ${users.length} avatar(es) preenchido(s)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); redis.disconnect(); });
