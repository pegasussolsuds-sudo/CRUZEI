import { BadRequestException, Controller, Get, Param, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { gunzipSync } from 'node:zlib';
import { ipTracker } from '../../common/guards/user-throttler.guard';
import { BuildingTilesService } from './building-tiles.service';
import { acceptsGzip, etagMatches, parseTileCoords } from './tile-coords';

export const MVT_CONTENT_TYPE = 'application/vnd.mapbox-vector-tile';
/** 1 dia no aparelho (o MapLibre guarda no cache dele e revalida com If-None-Match) */
export const TILE_CACHE_CONTROL = 'public, max-age=86400';
/** um mapa pede dezenas de tiles de uma vez e vários aparelhos dividem o IP (CGNAT): 3000/min por IP */
export const TILE_RATE_PER_MIN = 3000;

/**
 * Tiles públicos do mapa: o MapLibre busca tile sem o JWT do app. Só dado público (prédios), nada de usuário.
 * Rate limit próprio por IP (o global é por token; aqui não tem token e cada rota tem o seu balde).
 */
@Controller('tiles')
export class TilesController {
  constructor(private readonly buildings: BuildingTilesService) {}

  /** prédios extras (Microsoft, ODbL) em MVT: camada 'bld' com height/min_height; z13–z16, fora disso 204 */
  @Get('bld/:z/:x/:y.mvt')
  @Throttle({ default: { ttl: 60_000, limit: TILE_RATE_PER_MIN, getTracker: ipTracker } })
  async bld(
    @Param('z') zRaw: string,
    @Param('x') xRaw: string,
    @Param('y') yRaw: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const t = parseTileCoords(zRaw, xRaw, yRaw);
    if (!t) throw new BadRequestException({ error: 'invalid_tile', message: 'z/x/y inválidos' });
    const tile = await this.buildings.tile(t);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', TILE_CACHE_CONTROL);
    res.setHeader('X-Tile-Cache', tile.cache);
    if (tile.kind === 'empty') {
      res.status(204).end();
      return;
    }
    res.setHeader('ETag', tile.etag);
    res.setHeader('Vary', 'Accept-Encoding');
    if (etagMatches(req.headers['if-none-match'], tile.etag)) {
      res.status(304).end();
      return;
    }
    // guardado gzipado; quem não aceita gzip recebe o MVT cru
    const gz = acceptsGzip(req.headers['accept-encoding']);
    const body = gz ? tile.gz : gunzipSync(tile.gz);
    res.setHeader('Content-Type', MVT_CONTENT_TYPE);
    if (gz) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', String(body.length));
    res.status(200).end(body);
  }
}
