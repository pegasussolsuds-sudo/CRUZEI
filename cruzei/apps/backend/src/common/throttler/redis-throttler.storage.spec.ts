import Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

// usa o Redis local do dev (docker cruzei-redis) com prefixo próprio; pula se não estiver no ar
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
const PREFIX = `thr-test-${process.pid}`;
let up = true;

beforeAll(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    up = false;
  }
});

afterAll(async () => {
  if (up) {
    const keys = await redis.keys(`${PREFIX}:*`);
    if (keys.length) await redis.del(...keys);
  }
  redis.disconnect();
});

describe('RedisThrottlerStorage', () => {
  it('conta na janela e bloqueia ao passar do limite', async () => {
    if (!up) return;
    const s = new RedisThrottlerStorage(redis, PREFIX);
    const r1 = await s.increment('k1', 60_000, 2, 30_000, 'default');
    const r2 = await s.increment('k1', 60_000, 2, 30_000, 'default');
    expect(r1).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(r2).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(r2.timeToExpire).toBeGreaterThan(50);
    const r3 = await s.increment('k1', 60_000, 2, 30_000, 'default');
    expect(r3.isBlocked).toBe(true);
    expect(r3.timeToBlockExpire).toBeGreaterThan(25);
    // bloqueado: não conta mais, só informa
    const r4 = await s.increment('k1', 60_000, 2, 30_000, 'default');
    expect(r4.isBlocked).toBe(true);
  });

  it('chaves e nomes de throttler diferentes não se misturam', async () => {
    if (!up) return;
    const s = new RedisThrottlerStorage(redis, PREFIX);
    await s.increment('a', 60_000, 1, 1_000, 'default');
    const other = await s.increment('b', 60_000, 1, 1_000, 'default');
    const strict = await s.increment('a', 60_000, 1, 1_000, 'strict');
    expect(other).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(strict).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('bloqueio acaba e a janela recomeça do zero', async () => {
    if (!up) return;
    const s = new RedisThrottlerStorage(redis, PREFIX);
    await s.increment('c', 60_000, 1, 150, 'default');
    const blocked = await s.increment('c', 60_000, 1, 150, 'default');
    expect(blocked.isBlocked).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    const after = await s.increment('c', 60_000, 1, 150, 'default');
    expect(after).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('Redis fora do ar: deixa passar', async () => {
    const dead = new Redis('redis://127.0.0.1:1', { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    const s = new RedisThrottlerStorage(dead, PREFIX);
    const r = await s.increment('x', 60_000, 1, 1_000, 'default');
    expect(r).toMatchObject({ totalHits: 0, isBlocked: false });
    dead.disconnect();
  });
});
