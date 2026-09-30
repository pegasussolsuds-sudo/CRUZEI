import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';

import { GPS_GUARD, type Fix, type GuardConfig, type GuardState } from './anti-spoof';
import { GpsGuard, fixFields, parseFix } from './gps-guard';

// GpsGuard sem Redis de verdade: só confere o que vai pro hash da âncora (janela junto, sempre grosseira)
const cfg: GuardConfig = { ...GPS_GUARD, WINDOW_S: 300, STATE_TTL_S: 43_200 };

function fakeRedis(hashes: Record<string, Record<string, string>> = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const chain = () => {
    const m: Record<string, (...args: unknown[]) => unknown> = {};
    for (const op of ['hset', 'expire', 'del', 'set', 'hgetall', 'get']) {
      m[op] = (...args: unknown[]) => {
        calls.push({ op, args });
        return m;
      };
    }
    m.exec = async () =>
      calls
        .filter((c) => c.op === 'hgetall' || c.op === 'get')
        .map((c) => [null, c.op === 'hgetall' ? (hashes[c.args[0] as string] ?? {}) : null]);
    return m;
  };
  const redis = { client: { multi: chain, pipeline: chain } } as unknown as RedisService;
  return { redis, calls };
}

const fix = (lat: number, lng: number, s: number, acc = 12): Fix => ({
  lat,
  lng,
  t: Date.UTC(2026, 9, 3, 20) + s * 1000,
  acc,
});
const decimals = (v: string) => (v.split('.')[1] ?? '').length;

describe('GpsGuard: âncora da janela no mesmo hash da âncora', () => {
  it('parseFix / fixFields com prefixo: só 3 casas (≈ 110 m) vão pro Redis', () => {
    const f = fix(-18.9234567, -48.2712345, 0);
    const w = fixFields(f, 'w');
    expect(Object.keys(w).sort()).toEqual(['wa', 'wla', 'wlo', 'wt']);
    expect(decimals(w.wla)).toBeLessThanOrEqual(3);
    expect(decimals(w.wlo)).toBeLessThanOrEqual(3);
    expect(parseFix({ ...fixFields(f), ...w }, 'w')).toEqual({
      lat: -18.923,
      lng: -48.271,
      t: f.t,
      acc: 12,
    });
    // hash antigo (sem campos w*): sem janela
    expect(parseFix(fixFields(f), 'w')).toBeNull();
  });

  it('read devolve âncora e janela', async () => {
    const hash = {
      ...fixFields(fix(-18.923, -48.27, 100)),
      ...fixFields(fix(-18.92, -48.27, 0), 'w'),
    };
    const { redis } = fakeRedis({ 'loc:anchor:u1': hash });
    const s = await new GpsGuard({} as PrismaService, redis, cfg).read('u1');
    expect(s.anchor?.t).toBe(fix(0, 0, 100).t);
    expect(s.win?.t).toBe(fix(0, 0, 0).t);
    expect(s.win?.lat).toBe(-18.92);
  });

  it('accepted grava a âncora nova e a janela certa (anda pra âncora anterior depois de WINDOW_S), tudo grosseiro', async () => {
    const anchor = fix(-18.923, -48.27, 100);
    const win = fix(-18.92, -48.27, 0);
    const next = fix(-18.9291234, -48.2701234, 320);
    const state: GuardState = { anchor, win, pending: null, flag: null };
    const { redis, calls } = fakeRedis();
    await new GpsGuard({} as PrismaService, redis, cfg).accepted('u1', next, state, 'ok');
    const hset = calls.find((c) => c.op === 'hset');
    expect(hset?.args[0]).toBe('loc:anchor:u1');
    const fields = hset?.args[1] as Record<string, string>;
    expect(fields.la).toBe('-18.929');
    expect(fields.t).toBe(String(next.t));
    // 320 s desde a janela > 300 s: vira a âncora anterior (nunca o fix que acabou de chegar)
    expect(fields.wt).toBe(String(anchor.t));
    for (const k of ['la', 'lo', 'wla', 'wlo']) expect(decimals(fields[k])).toBeLessThanOrEqual(3);
  });

  it('viagem confirmada recomeça a janela no lugar novo', async () => {
    const state: GuardState = {
      anchor: fix(-18.923, -48.27, 0),
      win: fix(-18.92, -48.27, 0),
      pending: fix(-19.5, -48.27, 60),
      flag: 'teleport',
    };
    const next = fix(-19.5001, -48.2702, 120);
    const { redis, calls } = fakeRedis();
    await new GpsGuard({} as PrismaService, redis, cfg).accepted('u1', next, state, 'confirmed');
    const fields = calls.find((c) => c.op === 'hset')?.args[1] as Record<string, string>;
    expect(fields.wt).toBe(String(next.t));
    expect(fields.wla).toBe('-19.5');
    // pendente e aviso somem
    expect(calls.filter((c) => c.op === 'del').map((c) => c.args[0])).toEqual([
      'loc:pending:u1',
      'loc:flag:u1',
    ]);
  });
});
