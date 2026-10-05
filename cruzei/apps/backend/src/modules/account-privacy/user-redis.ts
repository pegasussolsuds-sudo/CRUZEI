// Chaves do Redis ligadas a UMA pessoa: o que "apagar histórico de localização" e a limpeza da conta tiram.
// Chaves de prazo curto com o id no meio (rate:<id>:*, push:msg/match/like, wave, acct:delch) vencem sozinhas em até
// 7 dias e só guardam contadores/ids: sem SCAN do keyspace por elas. crowd:u:* é HyperLogLog de HMAC (anônimo).
import type { Redis } from 'ioredis';

import { LAST_ACTIVE_PENDING, locationForgetKey } from '../location/location-writes';

export { locationForgetKey };
/** a marca só precisa durar mais que a fila (o gravador roda a cada 10 s); 1 dia sobra */
export const LOCATION_FORGET_TTL_S = 86_400;

/** DECR que não passa de zero (contador agregado de casas por célula, usado pelo detector de lugares) */
const DECR_FLOOR_LUA = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v <= 1 then redis.call('DEL', KEYS[1]) return 0 end
return redis.call('DECR', KEYS[1])
`;

/** posição atual (user:loc, precisa, 2 h) e o lugar dela no ZSET da célula */
export async function removePresence(client: Redis, userId: string): Promise<void> {
  const gh = await client.hget(`user:loc:${userId}`, 'geohash');
  const m = client.multi();
  if (gh) m.zrem(`presence:${gh}`, userId);
  m.del(`user:loc:${userId}`);
  await m.exec();
}

/** marca o corte do histórico antes de mexer no banco: o que ainda está na fila não volta depois do DELETE */
export async function markLocationForget(
  client: Redis,
  userId: string,
  nowMs = Date.now(),
): Promise<void> {
  await client.set(locationForgetKey(userId), String(nowMs), 'EX', LOCATION_FORGET_TTL_S);
}

/** noites por célula de uma pessoa (SCAN só com o prefixo dela; COUNT alto pra poucas idas) */
async function scanKeys(client: Redis, pattern: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    cursor = next;
    out.push(...keys);
  } while (cursor !== '0');
  return out;
}

/** residência aprendida: células (com o contador agregado decrementado) e as noites contadas */
export async function forgetLearnedHome(client: Redis, userId: string): Promise<void> {
  const cells = await client.smembers(`home:cells:${userId}`);
  for (const cell of cells) await client.eval(DECR_FLOOR_LUA, 1, `home:cnt:${cell}`);
  await client.del(`home:cells:${userId}`);
  const nights = await scanKeys(client, `home:nights:${userId}:*`);
  for (let i = 0; i < nights.length; i += 500) await client.unlink(...nights.slice(i, i + 500));
}

/** células da residência aprendida com as noites contadas (cópia dos dados) */
export async function learnedHomeCells(
  client: Redis,
  userId: string,
): Promise<{ cell: string; nights: number }[]> {
  const cells = await client.smembers(`home:cells:${userId}`);
  const out: { cell: string; nights: number }[] = [];
  for (const cell of cells.sort()) {
    out.push({ cell, nights: await client.scard(`home:nights:${userId}:${cell}`) });
  }
  return out;
}

/**
 * "apagar histórico de localização": assinatura do último ponto, resposta em cache, posição atual (some do mapa até o
 * app mandar a próxima) e as âncoras do anti-GPS-falso. Com alerta de GPS falso ativo (loc:flag) as âncoras ficam até
 * ele passar: senão apagar viraria um jeito de burlar o anti-teleporte. Devolve se as âncoras saíram.
 */
export async function forgetLocationKeys(
  client: Redis,
  userId: string,
  opts: { learnedHome: boolean },
): Promise<{ anchors: boolean }> {
  await client.del(`loc:hist:${userId}`, `loc:last:${userId}`);
  await removePresence(client, userId);
  const flagged = (await client.exists(`loc:flag:${userId}`)) > 0;
  if (!flagged) await client.del(`loc:anchor:${userId}`, `loc:pending:${userId}`);
  if (opts.learnedHome) await forgetLearnedHome(client, userId);
  return { anchors: !flagged };
}

/** limpeza da conta: tudo que o Redis guarda da pessoa (depois do commit; idempotente) */
export async function purgeUserKeys(
  client: Redis,
  userId: string,
  phone: string | null,
): Promise<void> {
  await removePresence(client, userId);
  const keys = [
    `loc:gate:${userId}`,
    `loc:last:${userId}`,
    `loc:hist:${userId}`,
    `la:gate:${userId}`,
    `prompt:cool:${userId}`,
    `profile:${userId}`,
    `loc:anchor:${userId}`,
    `loc:pending:${userId}`,
    `loc:flag:${userId}`,
    `gps:strikes:${userId}:mock`,
    `gps:strikes:${userId}:teleport`,
    `gps:flagged:${userId}`,
    `auth:claim:fails:${userId}`,
    `auth:claim:rl:u:${userId}`,
    `auth:claim:lock:u:${userId}`,
    `push:likes:n:${userId}`,
    `push:likes:gate:${userId}`,
  ];
  // estado do SMS (código em HMAC, tetos, trava) usa o hash do telefone e vence em até 24 h; a trava fica de propósito
  if (phone) keys.push(`sms:verified:${phone}`);
  await client.del(...keys);
  await client.hdel(LAST_ACTIVE_PENDING, userId);
  await forgetLearnedHome(client, userId);
  // histórico ainda na fila (loc:hist:q) não entra depois da limpeza (o gravador também descarta conta excluída)
  await markLocationForget(client, userId);
}
