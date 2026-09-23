// Teste de conexão Prisma Client direto
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$connect()
  .then(() => p.$queryRaw`SELECT 1 as ok`)
  .then(r => { console.log('PRISMA OK:', r); p.$disconnect(); })
  .catch(e => { console.log('PRISMA ERR:', e.code, e.message); process.exit(1); });
