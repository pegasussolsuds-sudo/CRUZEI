import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import { AdminPlacesService } from '../../src/modules/admin/admin-places.service';
import { EventsService } from '../../src/modules/admin/events.service';
import type { PlacesService } from '../../src/modules/places/places.service';
import { PlaceDiscoveryService } from '../../src/modules/pois/place-discovery.service';
import { PoisService } from '../../src/modules/pois/pois.service';

import {
  actor,
  asLocation,
  asRedis,
  emittedTo,
  fakeGateway,
  fakeLocation,
  fakePush,
  fakeRedis,
  newPoi,
  newUser,
  notifyStack,
  resetAdminDb,
} from './admin-fakes';
import { assertTestDatabase } from './env';

// Lugares e eventos do painel contra o banco de TESTE: aprovar (idempotente, avisa quem pediu), recusar (lápide),
// ocultar (some de nearby/vibe/hotspots/detalhe/check-in; volta com o mesmo id), denúncias; evento publicado vira
// POI visível no mapa, cancelado ou terminado some. Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;
const redis = fakeRedis();
const gateway = fakeGateway();
const location = fakeLocation();
const push = fakePush();
const { notify, audit, campaigns } = notifyStack(prisma, gateway, push.transport);
const discovery = new PlaceDiscoveryService(
  db,
  asRedis(redis),
  {} as PlacesService,
  asLocation(location),
);
const places = new AdminPlacesService(db, discovery, asLocation(location), notify, audit);
const events = new EventsService(db, asLocation(location), campaigns, audit);
// leituras do app: o instantâneo de presença usa o Redis falso
const pois = new PoisService(db, asLocation(location), asRedis(redis));

const HERE = { lat: -18.9186, lng: -48.2772 };
let staffId = '';
let voterA = '';
let voterB = '';

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetAdminDb(prisma);
  jest.clearAllMocks();
  redis.kv.clear();
  staffId = (await newUser(prisma, 'Mari Mod', { role: 'moderator' })).id;
  voterA = (await newUser(prisma, 'Aline')).id;
  voterB = (await newUser(prisma, 'Bruno')).id;
});

afterAll(async () => {
  await resetAdminDb(prisma);
  await prisma.$disconnect();
});

const appSees = async (poiId: bigint | string) => {
  const id = Number(poiId);
  const near = await pois.nearby(HERE.lat, HERE.lng, 2000);
  const vibe = await pois.vibe({
    me: voterA,
    lat: HERE.lat,
    lng: HERE.lng,
    radiusM: 2000,
    filter: 'all',
    limit: 60,
  });
  const hot = await prisma.pOI.findMany({
    where: { city: 'Uberlândia', hiddenAt: null },
    select: { id: true },
  });
  const detail = await pois.get(id).then(
    () => true,
    () => false,
  );
  const checkin = await pois.checkin(voterA, id).then(
    () => true,
    () => false,
  );
  return {
    nearby: near.some((p) => p.id === id),
    vibe: vibe.places.some((p) => p.id === id),
    hotspotsQuery: hot.some((p) => p.id === BigInt(id)),
    detail,
    checkin,
  };
};

async function candidate(
  name: string,
  status = 'pending',
  extId = `ovt:${name.replace(/\W/g, '')}`,
) {
  const [c] = await prisma.$queryRaw<{ id: bigint }[]>`
    INSERT INTO place_candidates (key, ext_id, mapbox_id, cell, status, name, category, kind, latitude, longitude, city, state,
                                  last_evidence_on, created_on)
    VALUES (${extId}, ${extId}, ${extId}, '6utsm7v', ${status}, ${name}, 'bar', 'bar', ${HERE.lat + 0.01}, ${HERE.lng}, 'Uberlândia', 'MG',
            CURRENT_DATE, CURRENT_DATE)
    RETURNING id`;
  return c.id;
}

describe('sugestões da galera', () => {
  it('aprovar: vira POI no mapa, avisa quem pediu/confirmou (não quem negou), idempotente', async () => {
    const id = await candidate('Bar do Léo');
    await prisma.$executeRaw`INSERT INTO place_votes (candidate_id, user_id, kind, voted_on) VALUES
      (${id}, ${voterA}::uuid, 'request', CURRENT_DATE), (${id}, ${voterB}::uuid, 'deny', CURRENT_DATE),
      (${id}, ${staffId}::uuid, 'onsite', CURRENT_DATE)`;

    const list = await places.candidates({});
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      status: 'pending',
      name: 'Bar do Léo',
      votes: { requests: 1, onsite: 1, deny: 1 },
    });
    expect(list.items[0].crowdHint).toBeTruthy();

    const c = await places.approve(actor(staffId, 'moderator'), String(id));
    expect(c.status).toBe('promoted');
    const poi = await prisma.pOI.findUniqueOrThrow({ where: { id: BigInt(c.poiId!) } });
    expect(poi).toMatchObject({ name: 'Bar do Léo', source: 'catalog', hiddenAt: null });
    expect(location.invalidatePoiIndex).toHaveBeenCalled();

    const notified = await prisma.notification.findMany({ where: { type: 'place_approved' } });
    expect(notified.map((n) => n.userId).sort()).toEqual([voterA, staffId].sort());
    expect((notified[0].data as { target: unknown }).target).toEqual({
      kind: 'place',
      poiId: c.poiId,
    });
    expect(emittedTo(gateway, voterB)).toHaveLength(0);

    // de novo: mesmo POI, ninguém avisado outra vez, uma auditoria só
    const again = await places.approve(actor(staffId, 'moderator'), String(id));
    expect(again.poiId).toBe(c.poiId);
    expect(await prisma.notification.count({ where: { type: 'place_approved' } })).toBe(2);
    expect(await prisma.pOI.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'admin.place.approve' } })).toBe(1);
  });

  it('aprovar duas vezes ao mesmo tempo cria UM POI', async () => {
    const id = await candidate('Café Central');
    const [a, b] = await Promise.all([
      places.approve(actor(staffId, 'moderator'), String(id)),
      places.approve(actor(staffId, 'moderator'), String(id)),
    ]);
    expect(a.poiId).toBe(b.poiId);
    expect(await prisma.pOI.count()).toBe(1);
  });

  it('recusar: lápide (status rejected); já no mapa → 409; sugestão da época do Mapbox não entra', async () => {
    const id = await candidate('Boteco X');
    const r = await places.reject(actor(staffId, 'moderator'), String(id), 'é residência');
    expect(r.status).toBe('rejected');
    const [a] = await prisma.auditLog.findMany({ where: { action: 'admin.place.reject' } });
    expect((a.metadata as { detail: string }).detail).toBe('é residência');

    const promoted = await candidate('Outro Bar');
    await places.approve(actor(staffId, 'moderator'), String(promoted));
    await expect(
      places.reject(actor(staffId, 'moderator'), String(promoted), 'x'),
    ).rejects.toMatchObject({ response: { error: 'already_on_map' } });

    const mbx = await candidate('Velho', 'pending', 'mbx:abc123');
    await expect(places.approve(actor(staffId, 'moderator'), String(mbx))).rejects.toMatchObject({
      response: { error: 'mapbox_candidate' },
    });
  });
});

describe('POI oculto some de toda leitura do app', () => {
  it('ocultar/desocultar: nearby, vibe, hotspots, detalhe e check-in', async () => {
    const poi = await newPoi(prisma, 'Bar Oculto');
    expect(await appSees(poi.id)).toEqual({
      nearby: true,
      vibe: true,
      hotspotsQuery: true,
      detail: true,
      checkin: true,
    });

    const hidden = await places.hide(actor(staffId, 'moderator'), String(poi.id));
    expect(hidden.hiddenAt).not.toBeNull();
    expect(await appSees(poi.id)).toEqual({
      nearby: false,
      vibe: false,
      hotspotsQuery: false,
      detail: false,
      checkin: false,
    });
    expect(await pois.hotspotsInCity('Uberlândia')).toEqual([]);

    // o painel continua vendo (com filtro de ocultos)
    const list = await places.pois({ q: 'oculto', hidden: '1' });
    expect(list.items.map((p) => p.id)).toEqual([String(poi.id)]);

    await places.unhide(actor(staffId, 'moderator'), String(poi.id));
    expect((await appSees(poi.id)).nearby).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: { in: ['admin.poi.hide', 'admin.poi.unhide'] } },
      }),
    ).toBe(2);
  });

  it('denúncia de lugar oculto responde 404 (igual a "não existe"); sugestão do mesmo lugar não reaparece', async () => {
    const poi = await newPoi(prisma, 'Some Daqui');
    await places.hide(actor(staffId, 'moderator'), String(poi.id));
    await expect(discovery.report(voterA, Number(poi.id), 'closed')).rejects.toMatchObject({
      status: 404,
    });

    // "Pôr no Metch" do mesmo lugar: resposta uniforme de pedido, sem candidato novo e sem revelar o POI oculto
    const catalog = {
      lookup: async () => ({
        id: 'ovt:some-daqui',
        name: 'Some Daqui',
        category: 'bar',
        kind: 'bar',
        nightlife: true,
        address: null,
        neighborhood: null,
        city: 'Uberlândia',
        state: 'MG',
        latitude: -18.9186,
        longitude: -48.2772,
        distanceM: 0,
        source: 'catalog',
      }),
    };
    const withCatalog = new PlaceDiscoveryService(
      db,
      asRedis(redis),
      catalog as unknown as PlacesService,
      asLocation(location),
    );
    await prisma.user.update({ where: { id: voterA }, data: { isVerified: true } });
    await expect(withCatalog.suggest(voterA, 'ovt:some-daqui')).resolves.toEqual({
      status: 'pending',
    });
    expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM place_candidates`).toHaveLength(0);
  });

  it('denúncias: fila agrupada por lugar; "ocultar" fecha e esconde; "descartar" só fecha; denunciar de novo reabre', async () => {
    const a = await newPoi(prisma, 'Denunciado A');
    const b = await newPoi(prisma, 'Denunciado B', { latitude: -18.92 });
    await discovery.report(voterA, Number(a.id), 'closed');
    await discovery.report(voterB, Number(a.id), 'not_public');
    await discovery.report(voterA, Number(b.id), 'offensive');

    const q = await places.reports();
    expect(q.items.map((g) => [g.poi.name, g.reports.length])).toEqual([
      ['Denunciado A', 2],
      ['Denunciado B', 1],
    ]);

    await places.resolveReports(actor(staffId, 'moderator'), String(a.id), { action: 'hide' });
    await places.resolveReports(actor(staffId, 'moderator'), String(b.id), {
      action: 'dismiss',
      note: 'ok',
    });
    expect((await places.reports()).items).toEqual([]);
    expect((await prisma.pOI.findUniqueOrThrow({ where: { id: a.id } })).hiddenAt).not.toBeNull();
    expect((await prisma.pOI.findUniqueOrThrow({ where: { id: b.id } })).hiddenAt).toBeNull();

    await discovery.report(voterB, Number(b.id), 'closed');
    expect((await places.reports()).items.map((g) => g.poi.name)).toEqual(['Denunciado B']);
  });

  it('criar e editar lugar da equipe (source admin); categoria inválida → 400', async () => {
    const p = await places.createPoi(actor(staffId, 'moderator'), {
      name: 'Praça Nova',
      category: 'park',
      lat: HERE.lat,
      lng: HERE.lng,
    });
    expect(p).toMatchObject({ source: 'admin', category: 'park', hiddenAt: null });
    const e = await places.updatePoi(actor(staffId, 'moderator'), p.id, {
      name: 'Praça Nova 2',
      isPartner: true,
    });
    expect(e).toMatchObject({ name: 'Praça Nova 2', isPartner: true });
    await expect(
      places.createPoi(actor(staffId, 'moderator'), {
        name: 'X',
        category: 'boate',
        lat: 0,
        lng: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('eventos', () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const base = {
    title: 'Festa no Parque',
    description: 'DJ até tarde',
    category: 'party' as const,
    startsAt: inHours(-1),
    endsAt: inHours(3),
    venueName: 'Parque do Sabiá',
    lat: HERE.lat,
    lng: HERE.lng,
    address: 'Av. Anselmo Alves dos Santos',
    city: 'Uberlândia',
  };

  it('rascunho não aparece; publicar cria o POI de mapa (evento) que o app vê e o filtro de eventos pega', async () => {
    const ev = await events.create(actor(staffId, 'moderator'), base);
    expect(ev).toMatchObject({
      status: 'draft',
      mapPoiId: null,
      createdBy: { id: staffId, name: 'Mari Mod' },
    });
    expect((await pois.nearby(HERE.lat, HERE.lng, 2000)).length).toBe(0);

    const pub = await events.publish(actor(staffId, 'moderator'), ev.id);
    expect(pub.status).toBe('published');
    expect(pub.mapPoiId).not.toBeNull();
    const poi = await prisma.pOI.findUniqueOrThrow({ where: { id: BigInt(pub.mapPoiId!) } });
    expect(poi).toMatchObject({
      name: 'Festa no Parque',
      category: 'event',
      subcategory: 'party',
      source: 'admin',
      eventId: ev.id,
      hiddenAt: null,
    });

    const seen = await appSees(pub.mapPoiId!);
    expect(seen.nearby && seen.vibe && seen.detail).toBe(true);
    const onlyEvents = await pois.vibe({
      me: voterA,
      lat: HERE.lat,
      lng: HERE.lng,
      radiusM: 2000,
      filter: 'events',
      limit: 60,
    });
    expect(onlyEvents.places.map((p) => [p.name, p.isEvent])).toEqual([['Festa no Parque', true]]);
    expect(onlyEvents.places[0].eventLabel).toMatch(/^Agora · até \d{2}:\d{2}$/);

    // editar o publicado atualiza o POI na hora; show vira categoria show
    await events.update(actor(staffId, 'moderator'), ev.id, {
      title: 'Festa no Parque 2',
      category: 'show',
    });
    expect(
      await prisma.pOI.findUniqueOrThrow({ where: { id: BigInt(pub.mapPoiId!) } }),
    ).toMatchObject({ name: 'Festa no Parque 2', category: 'show' });
    // republicar não duplica
    await events.publish(actor(staffId, 'moderator'), ev.id);
    expect(await prisma.pOI.count({ where: { eventId: ev.id } })).toBe(1);
  });

  it('cancelar esconde na hora e cancela aviso agendado; terminado some no cron; publicar terminado → 409', async () => {
    const ev = await events.publish(
      actor(staffId, 'moderator'),
      (await events.create(actor(staffId, 'moderator'), base)).id,
    );
    await prisma.pushCampaign.create({
      data: {
        title: 'Aviso',
        body: 'vem',
        audience: { kind: 'all' },
        channels: { push: true, inbox: true },
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 3_600_000),
        eventId: ev.id,
      },
    });
    const c = await events.cancel(actor(staffId, 'moderator'), ev.id);
    expect(c.status).toBe('cancelled');
    expect(c.announcements.map((a) => a.status)).toEqual(['cancelled']);
    expect((await appSees(ev.mapPoiId!)).nearby).toBe(false);
    await expect(events.publish(actor(staffId, 'moderator'), ev.id)).rejects.toMatchObject({
      response: { error: 'event_cancelled' },
    });
    // POI de evento cancelado não volta pelo "desocultar"
    await expect(places.unhide(actor(staffId, 'moderator'), ev.mapPoiId!)).rejects.toMatchObject({
      response: { error: 'event_over' },
    });

    // outro evento que termina: o cron do minuto tira do mapa
    const ev2 = await events.publish(
      actor(staffId, 'moderator'),
      (await events.create(actor(staffId, 'moderator'), { ...base, title: 'Show curto' })).id,
    );
    await prisma.event.update({
      where: { id: ev2.id },
      data: { endsAt: new Date(Date.now() - 60_000), startsAt: new Date(Date.now() - 3_600_000) },
    });
    expect((await appSees(ev2.mapPoiId!)).nearby).toBe(true);
    expect(await events.hideEnded()).toBe(1);
    expect((await appSees(ev2.mapPoiId!)).nearby).toBe(false);
    expect(await events.hideEnded()).toBe(0); // idempotente

    const old = await events.create(actor(staffId, 'moderator'), {
      ...base,
      startsAt: inHours(-5),
      endsAt: inHours(-2),
    });
    await expect(events.publish(actor(staffId, 'moderator'), old.id)).rejects.toMatchObject({
      response: { error: 'event_over' },
    });
  });

  it('validação e apagar só rascunho', async () => {
    await expect(
      events.create(actor(staffId, 'moderator'), { ...base, endsAt: base.startsAt }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      events.create(actor(staffId, 'moderator'), { ...base, coverUrl: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ status: 400 });
    const d = await events.create(actor(staffId, 'moderator'), base);
    const p = await events.publish(
      actor(staffId, 'moderator'),
      (await events.create(actor(staffId, 'moderator'), base)).id,
    );
    await expect(events.remove(actor(staffId, 'moderator'), p.id)).rejects.toMatchObject({
      response: { error: 'not_draft' },
    });
    await events.remove(actor(staffId, 'moderator'), d.id);
    expect(await prisma.event.count()).toBe(1);

    const upcoming = await events.list({ when: 'live' });
    expect(upcoming.items.map((e) => e.id)).toEqual([p.id]);
  });
});
