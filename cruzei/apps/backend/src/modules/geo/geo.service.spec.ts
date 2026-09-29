import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import { GeoService } from './geo.service';

// Serviço com Prisma/Redis de mentira: aviso de boot sem Photon, rótulo com o município mais perto e cobertura.
function setup(env: { NODE_ENV?: string; PHOTON_URL?: string }, answers: unknown[][] = []) {
  const saved = { NODE_ENV: process.env.NODE_ENV, PHOTON_URL: process.env.PHOTON_URL };
  process.env.NODE_ENV = env.NODE_ENV ?? 'test';
  process.env.PHOTON_URL = env.PHOTON_URL ?? '';
  const sqls: string[] = [];
  const prisma = {
    $queryRaw: jest.fn(async (s: TemplateStringsArray) => {
      sqls.push(s.join('?').replace(/\s+/g, ' '));
      return answers.shift() ?? [];
    }),
  };
  const sets: { key: string; ttl: number }[] = [];
  const redis = {
    client: {
      get: jest.fn(async () => null),
      set: jest.fn(async (key: string, _v: string, _ex: string, ttl: number) => {
        sets.push({ key, ttl });
        return 'OK';
      }),
    },
  };
  const svc = new GeoService(prisma as unknown as PrismaService, redis as unknown as RedisService);
  // process.env.X = undefined grava a string "undefined": sem valor antes, apaga
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { svc, sqls, sets, restore };
}

describe('GeoService', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('produção sem PHOTON_URL: avisa no boot', () => {
    const { svc, restore } = setup({ NODE_ENV: 'production' });
    svc.onModuleInit();
    restore();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PHOTON_URL vazio em produção'));
  });

  it('dev, ou produção com Photon: não avisa', () => {
    const dev = setup({ NODE_ENV: 'development' });
    dev.svc.onModuleInit();
    dev.restore();
    const prod = setup({ NODE_ENV: 'production', PHOTON_URL: 'http://photon:2322' });
    prod.svc.onModuleInit();
    prod.restore();
    expect(warn).not.toHaveBeenCalled();
  });

  it('centro da célula fora de todo polígono (mar): fica o município mais perto, cache de 7 dias', async () => {
    const rio = { kind: 'city', name: 'Rio de Janeiro', city: 'Rio de Janeiro', state: 'RJ' };
    const { svc, sqls, sets, restore } = setup({}, [[], [rio]]);
    const out = await svc.label(-22.975, -43.18);
    restore();
    expect(out).toEqual({ city: 'Rio de Janeiro', neighborhood: null, state: 'RJ' });
    expect(sqls[0]).toContain('ST_Covers');
    expect(sqls[1]).toContain('ST_DWithin');
    expect(sets[0]).toMatchObject({ key: expect.stringMatching(/^geo:label:v2:/), ttl: 7 * 86_400 });
  });

  it('cobertura: célula de 0,1° no cache; sem lugar nem rua perto = false', async () => {
    const { svc, sets, restore } = setup({}, [[{ covered: false }]]);
    const out = await svc.coverage(-23.5505, -46.6333);
    restore();
    expect(out).toEqual({ covered: false });
    expect(sets[0].key).toBe('geo:cov:v1:-23.6,-46.6');
  });
});
