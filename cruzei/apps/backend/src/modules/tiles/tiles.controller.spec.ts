import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { gzipSync } from 'node:zlib';
import type { BuildingTile, BuildingTilesService } from './building-tiles.service';
import { MVT_CONTENT_TYPE, TILE_CACHE_CONTROL, TilesController } from './tiles.controller';

const MVT = Buffer.from('1a0b0a03626c6478021a0120', 'hex');
const ETAG = 'W/"0123456789abcdef0123456789abcdef"';

function fakeRes() {
  const headers: Record<string, string> = {};
  const out = { status: 0, body: undefined as Buffer | undefined, headers };
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
      return res;
    },
    status: (s: number) => {
      out.status = s;
      return res;
    },
    end: (b?: Buffer) => {
      out.body = b;
      return res;
    },
  };
  return { res: res as unknown as Response, out };
}

function call(tile: BuildingTile | null, headers: Record<string, string> = {}, zxy: [string, string, string] = ['14', '5994', '9069']) {
  const svc = { tile: jest.fn(async () => tile) };
  const ctl = new TilesController(svc as unknown as BuildingTilesService);
  const { res, out } = fakeRes();
  const req = { headers } as unknown as Request;
  return { run: () => ctl.bld(zxy[0], zxy[1], zxy[2], req, res), out, svc };
}

describe('TilesController', () => {
  const mvt: BuildingTile = { kind: 'mvt', gz: gzipSync(MVT), etag: ETAG, cache: 'hit' };

  it('z/x/y inválidos: 400 sem chamar o serviço', async () => {
    const { run, svc } = call(mvt, {}, ['14', '99999', '1']);
    await expect(run()).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.tile).not.toHaveBeenCalled();
  });

  it('com gzip: MVT gzipado, tipo MVT, cache longo, ETag e Vary', async () => {
    const { run, out } = call(mvt, { 'accept-encoding': 'gzip, deflate' });
    await run();
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe(MVT_CONTENT_TYPE);
    expect(out.headers['content-encoding']).toBe('gzip');
    expect(out.headers['cache-control']).toBe(TILE_CACHE_CONTROL);
    expect(out.headers.etag).toBe(ETAG);
    expect(out.headers.vary).toBe('Accept-Encoding');
    expect(out.headers['access-control-allow-origin']).toBe('*');
    expect(out.body!.equals(mvt.kind === 'mvt' ? mvt.gz : Buffer.alloc(0))).toBe(true);
    expect(out.headers['content-length']).toBe(String(out.body!.length));
  });

  it('sem gzip: MVT cru, sem Content-Encoding', async () => {
    const { run, out } = call(mvt);
    await run();
    expect(out.status).toBe(200);
    expect(out.headers['content-encoding']).toBeUndefined();
    expect(out.body!.equals(MVT)).toBe(true);
  });

  it('If-None-Match igual: 304 sem corpo', async () => {
    const { run, out } = call(mvt, { 'if-none-match': ETAG, 'accept-encoding': 'gzip' });
    await run();
    expect(out.status).toBe(304);
    expect(out.body).toBeUndefined();
    expect(out.headers.etag).toBe(ETAG);
  });

  it('tile vazio: 204 com cache longo', async () => {
    const { run, out } = call({ kind: 'empty', cache: 'skip' });
    await run();
    expect(out.status).toBe(204);
    expect(out.body).toBeUndefined();
    expect(out.headers['cache-control']).toBe(TILE_CACHE_CONTROL);
    expect(out.headers['content-type']).toBeUndefined();
  });

  it('rota pública com rate limit próprio por IP (ignora o bearer)', () => {
    const proto = TilesController.prototype as unknown as Record<string, unknown>;
    const handler = proto.bld as object;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(3000);
    const tracker = Reflect.getMetadata('THROTTLER:TRACKERdefault', handler) as (r: Record<string, unknown>) => string;
    expect(tracker({ ip: '10.0.0.1', ips: [], headers: { authorization: 'Bearer x' } })).toBe('ip:10.0.0.1');
    expect(Reflect.getMetadata('__guards__', TilesController)).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', handler)).toBeUndefined();
  });
});
