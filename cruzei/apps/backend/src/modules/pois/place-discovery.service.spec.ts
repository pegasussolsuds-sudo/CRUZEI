import { Logger } from '@nestjs/common';
import type { CatalogPlace } from '@cruzei/shared-types';
import { PlaceDiscoveryService } from './place-discovery.service';

// Lápide no serviço (Prisma/Redis de mentira): suggest, upsertCandidate e o passo 4 (promoção) do detector.
const now = new Date('2026-09-29T15:00:00Z'); // 12:00 em Brasília
const today = '2026-09-29';
const m = (meters: number) => meters / 111_195;
const place: CatalogPlace = {
  id: 'ovt:novo-canonico', name: 'Bar do Léo', category: 'bar', kind: 'bar', nightlife: true, address: null, neighborhood: null,
  city: 'Uberlândia', state: 'MG', latitude: -18.9186, longitude: -48.2772, distanceM: 0, source: 'catalog',
};
/** lápide 'mbx:' (era Mapbox) do mesmo lugar, 20 m ao lado, recusada há 9 dias */
const mbxTomb = {
  id: 5n, key: 'mbx:dXJuOm1ieHBvaTphYmM', status: 'rejected', name: 'Bar do Leo', latitude: place.latitude + m(20), longitude: place.longitude, poi_id: null, resolved_on: '2026-09-20',
};
/** candidato pendente com o id novo que passou na regra A hoje */
const pendingK = {
  id: 42n, ext_id: place.id, cell: '6utsm7v', status: 'pending', name: place.name, category: 'bar', kind: 'bar', latitude: place.latitude, longitude: place.longitude,
  address: null, neighborhood: null, city: 'Uberlândia', state: 'MG', ambiguous: false, crowd_pass_on: today, last_evidence_on: today, poi_id: null, onsite3: 0, req14: 0, deny3: 0,
};

interface Setup {
  tombstones?: unknown[];
  pending?: unknown[];
  nearPois?: unknown[];
  poiById?: unknown;
}

function setup(o: Setup = {}) {
  const sqls: { sql: string; values: unknown[] }[] = [];
  const sqlOf = (s: TemplateStringsArray) => s.join('?').replace(/\s+/g, ' ');
  const prisma: Record<string, unknown> = {
    $queryRaw: jest.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlOf(s);
      sqls.push({ sql, values });
      if (sql.includes("status IN ('rejected', 'promoted')")) return o.tombstones ?? [];
      if (sql.includes('INSERT INTO place_candidates')) return [{ id: 99n, status: 'pending', poi_id: null }];
      if (sql.includes('LEFT JOIN place_votes')) return o.pending ?? [];
      return [];
    }),
    $executeRaw: jest.fn(async (s: TemplateStringsArray, ...values: unknown[]) => {
      sqls.push({ sql: sqlOf(s), values });
      return 0;
    }),
    pOI: {
      findUnique: jest.fn(async (a: { where: { id?: bigint } }) => (a.where.id != null ? (o.poiById ?? null) : null)),
      findMany: jest.fn(async () => o.nearPois ?? []),
      upsert: jest.fn(async () => ({ id: 777n })),
    },
    user: { findUnique: jest.fn(async () => ({ createdAt: new Date('2025-01-01'), isVerified: true, isPaused: false, deletedAt: null })) },
  };
  prisma.$transaction = jest.fn(async (arg: unknown) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg as Promise<unknown>[])));
  const redis = {
    incrRate: jest.fn(async () => 1),
    client: {
      hgetall: jest.fn(async () => ({ lat: String(place.latitude + m(30)), lng: String(place.longitude), updated_at: String(now.getTime()), hidden: '0', cell: '' })),
      sunion: jest.fn(async () => []),
    },
  };
  const places = { lookup: jest.fn(async () => place) };
  const location = { invalidatePoiIndex: jest.fn() };
  const svc = new PlaceDiscoveryService(prisma as never, redis as never, places as never, location as never);
  const ran = (frag: string) => sqls.filter((q) => q.sql.includes(frag));
  return { svc, prisma: prisma as { pOI: { upsert: jest.Mock } }, location, ran };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined); // resumo da rodada fora da saída do jest
});

describe('lápide no suggest (Pôr no Metch)', () => {
  it("lápide 'mbx:' do mesmo lugar: não cria candidato nem voto e responde igual (pending)", async () => {
    const t = setup({ tombstones: [mbxTomb] });
    await expect(t.svc.suggest('11111111-1111-1111-1111-111111111111', place.id, now)).resolves.toEqual({ status: 'pending' });
    expect(t.ran('INSERT INTO place_candidates')).toHaveLength(0);
    expect(t.ran('INSERT INTO place_votes')).toHaveLength(0);
    // procura pela mesma chave OU pelo lugar, com a janela de 90 dias
    const [q] = t.ran("status IN ('rejected', 'promoted')");
    expect(q.values).toEqual(expect.arrayContaining([place.id, '2026-07-01']));
  });

  it('sem lápide: cria o candidato e registra o pedido', async () => {
    const t = setup();
    await expect(t.svc.suggest('11111111-1111-1111-1111-111111111111', place.id, now)).resolves.toEqual({ status: 'pending' });
    expect(t.ran('INSERT INTO place_candidates')).toHaveLength(1);
    expect(t.ran('INSERT INTO place_votes')).toHaveLength(1);
  });

  it('lápide de outro lugar a 30 m (nome diferente) não bloqueia', async () => {
    const t = setup({ tombstones: [{ ...mbxTomb, name: 'Zenaide Bar', latitude: place.latitude + m(30) }] });
    await t.svc.suggest('11111111-1111-1111-1111-111111111111', place.id, now);
    expect(t.ran('INSERT INTO place_candidates')).toHaveLength(1);
  });

  it('publicado com outro id e o POI ainda existe: responde active com ele, sem candidato novo', async () => {
    const poi = { id: 33n, name: 'Bar do Leo', category: 'bar', latitude: place.latitude + m(80), longitude: place.longitude, source: 'catalog' };
    const t = setup({ tombstones: [{ ...mbxTomb, status: 'promoted', poi_id: 33n }], poiById: poi });
    const r = await t.svc.suggest('11111111-1111-1111-1111-111111111111', place.id, now);
    expect(r).toEqual({ status: 'active', poi: expect.objectContaining({ id: 33, name: 'Bar do Leo' }) });
    expect(t.ran('INSERT INTO place_candidates')).toHaveLength(0);
  });
});

describe('passo 4 do detector (promoção)', () => {
  it('o mesmo lugar já está no mapa: marca promoted apontando pro POI, sem POI duplicado', async () => {
    const poi = { id: 33n, name: 'Bar do Leo', category: 'bar', latitude: place.latitude + m(3), longitude: place.longitude, source: 'catalog' };
    const t = setup({ pending: [pendingK], nearPois: [poi] });
    const sum = await t.svc.runOnce(now, { promote: true });
    expect(sum).toMatchObject({ promoted: 0, merged: 1 });
    expect(t.prisma.pOI.upsert).not.toHaveBeenCalled();
    const [merge] = t.ran("SET status = 'promoted', poi_id =");
    expect(merge.values).toEqual([33n, today, 42n]);
    expect(t.location.invalidatePoiIndex).not.toHaveBeenCalled();
  });

  it('lápide do mesmo lugar com outro id: vence o candidato em vez de publicar', async () => {
    const t = setup({ pending: [pendingK], tombstones: [mbxTomb] });
    const sum = await t.svc.runOnce(now, { promote: true });
    expect(sum).toMatchObject({ promoted: 0, merged: 0 });
    expect(t.prisma.pOI.upsert).not.toHaveBeenCalled();
    const exp = t.ran("SET status = 'expired' WHERE id =");
    expect(exp).toHaveLength(1);
    expect(exp[0].values).toEqual([42n]);
  });

  it('sem POI nem lápide: publica', async () => {
    const t = setup({ pending: [pendingK] });
    const sum = await t.svc.runOnce(now, { promote: true });
    expect(sum).toMatchObject({ promoted: 1, merged: 0 });
    expect(t.prisma.pOI.upsert).toHaveBeenCalledTimes(1);
    expect(t.location.invalidatePoiIndex).toHaveBeenCalled();
  });

  it('modo sombra: não mexe em nada e não conta como "publicaria" o que já está no mapa ou tem lápide', async () => {
    const t = setup({ pending: [pendingK], tombstones: [mbxTomb] });
    const sum = await t.svc.runOnce(now, { promote: false });
    expect(sum.wouldPromote).toBe(0);
    expect(t.ran("SET status = 'expired' WHERE id =")).toHaveLength(0);
    expect(t.prisma.pOI.upsert).not.toHaveBeenCalled();
  });
});
