import { PrismaClient } from '@prisma/client';

import { CampaignsService } from '../../src/modules/admin/campaigns.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';

import {
  actor,
  emittedTo,
  fakeGateway,
  fakePush,
  newUser,
  notifyStack,
  resetAdminDb,
} from './admin-fakes';
import { assertTestDatabase } from './env';

// Campanhas contra o banco de TESTE: público (fora apagadas/suspensas/banidas e quem desligou o aviso; premium
// vigente; cidade/raio pela última posição), confirmação do número, notificações gravadas + socket + push falso,
// token morto apagado, "abriu", agendada que sai UMA vez com dois workers ao mesmo tempo, cancelar.
// Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const gateway = fakeGateway();
const push = fakePush();
const { notify, audit, db } = notifyStack(prisma, gateway, push.transport);
const svc = new CampaignsService(db, notify, audit);
// "segundo worker": outra instância do serviço no mesmo banco
const svc2 = new CampaignsService(db, notify, audit);
const inbox = new NotificationsService(db);

const U = { lat: -18.9186, lng: -48.2772 };
let adminId = '';
const people: Record<string, string> = {};

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetAdminDb(prisma);
  jest.clearAllMocks();
  push.sent.length = 0;
  push.dead.clear();
  adminId = (await newUser(prisma, 'Monteiro', { role: 'admin' })).id;
  const future = new Date(Date.now() + 30 * 86_400_000);
  people.free = (await newUser(prisma, 'Free')).id;
  people.premium = (
    await newUser(prisma, 'Premium', { premiumTier: 'premium', premiumExpiresAt: future })
  ).id;
  people.plusNoExpiry = (await newUser(prisma, 'Plus', { premiumTier: 'premium_plus' })).id;
  people.expired = (
    await newUser(prisma, 'Vencido', {
      premiumTier: 'premium',
      premiumExpiresAt: new Date(Date.now() - 86_400_000),
    })
  ).id;
  people.suspended = (await newUser(prisma, 'Suspensa', { accountStatus: 'suspended' })).id;
  people.banned = (await newUser(prisma, 'Banido', { accountStatus: 'banned' })).id;
  people.deleted = (await newUser(prisma, 'Apagada', { deletedAt: new Date() })).id;
  people.noCampaigns = (await newUser(prisma, 'Sem campanhas')).id;
  people.noEvents = (await newUser(prisma, 'Sem eventos')).id;
  await prisma.notificationPref.create({ data: { userId: people.noCampaigns, campaigns: false } });
  await prisma.notificationPref.create({ data: { userId: people.noEvents, events: false } });
  // aparelhos: um token vivo pra free, um vivo e um morto pra premium, nenhum pros outros
  await prisma.deviceToken.createMany({
    data: [
      { userId: people.free, token: 'tok-free', platform: 'android' },
      { userId: people.premium, token: 'tok-prem-1', platform: 'android' },
      { userId: people.premium, token: 'tok-prem-dead', platform: 'android' },
      { userId: people.banned, token: 'tok-banned', platform: 'android' },
    ],
  });
});

afterAll(async () => {
  await resetAdminDb(prisma);
  await prisma.$disconnect();
});

/** ativos, não apagados, que não desligaram campanhas: admin + free + premium + plus + vencido + sem-eventos */
const ALL_CAMPAIGN = () =>
  [
    adminId,
    people.free,
    people.premium,
    people.plusNoExpiry,
    people.expired,
    people.noEvents,
  ].sort();

describe('público', () => {
  it('conta só contas ativas que não desligaram o tipo de aviso; premium = vigente', async () => {
    expect(await svc.preview({ kind: 'all' })).toEqual({ targetCount: 6, withPushDevice: 2 });
    // aviso de evento: quem desligou eventos sai, quem desligou só campanhas entra
    const EV = '00000000-0000-4000-8000-000000000001';
    expect((await svc.preview({ kind: 'all' }, EV)).targetCount).toBe(6);
    expect((await svc.preview({ kind: 'user', userId: people.noEvents }, EV)).targetCount).toBe(0);
    expect((await svc.preview({ kind: 'user', userId: people.noEvents })).targetCount).toBe(1);
    expect((await svc.preview({ kind: 'user', userId: people.noCampaigns }, EV)).targetCount).toBe(
      1,
    );
    expect((await svc.preview({ kind: 'user', userId: people.noCampaigns })).targetCount).toBe(0);
    expect((await svc.preview({ kind: 'premium' })).targetCount).toBe(2);
    expect((await svc.preview({ kind: 'free' })).targetCount).toBe(4); // admin, free, vencido, sem-eventos
    expect((await svc.preview({ kind: 'user', userId: people.banned })).targetCount).toBe(0);
    expect((await svc.preview({ kind: 'user', userId: people.free })).targetCount).toBe(1);
  });

  it('raio e cidade pela ÚLTIMA posição conhecida', async () => {
    const at = (userId: string, lat: number, lng: number, minutesAgo: number) =>
      prisma.location.create({
        data: {
          userId,
          latitude: lat,
          longitude: lng,
          geohash: 'x',
          recordedAt: new Date(Date.now() - minutesAgo * 60_000),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
    await at(people.free, U.lat, U.lng, 5); // aqui agora
    await at(people.premium, U.lat, U.lng, 120); // estava aqui...
    await at(people.premium, -23.55, -46.63, 10); // ...mas a última é em São Paulo
    await at(people.banned, U.lat, U.lng, 1); // banido nunca
    expect(
      (await svc.preview({ kind: 'radius', lat: U.lat, lng: U.lng, radiusM: 1000 })).targetCount,
    ).toBe(1);

    await prisma.$executeRaw`
      INSERT INTO geo_areas (id, name, kind, admin_level, city, state, geom, refreshed_on)
      VALUES ('test:udi', 'Uberlândia', 'city', 8, 'Uberlândia', 'MG', ST_Multi(ST_MakeEnvelope(-48.6, -19.2, -48.0, -18.6, 4326)), CURRENT_DATE),
             ('test:sp', 'São Paulo', 'city', 8, 'São Paulo', 'SP', ST_Multi(ST_MakeEnvelope(-46.9, -23.8, -46.3, -23.3, 4326)), CURRENT_DATE)`;
    expect((await svc.preview({ kind: 'city', city: 'uberlandia' })).targetCount).toBe(1);
    expect((await svc.preview({ kind: 'city', city: 'São Paulo/SP' })).targetCount).toBe(1);
    expect((await svc.preview({ kind: 'city', city: 'São Paulo/MG' })).targetCount).toBe(0);
  });
});

describe('enviar agora', () => {
  it("público 'all' exige confirmar o número; depois grava, avisa no socket, manda push e apaga token morto", async () => {
    push.dead.add('tok-prem-dead');
    const payload = {
      title: 'Novidade no Metch',
      body: 'Agora dá pra falar com o suporte pelo app',
      audience: { kind: 'all' as const },
      channels: { push: true, inbox: true },
      target: { kind: 'support' as const },
    };
    await expect(svc.create(actor(adminId, 'admin'), payload)).rejects.toMatchObject({
      status: 409,
      response: { error: 'confirm_required', targetCount: 6 },
    });
    await expect(
      svc.create(actor(adminId, 'admin'), { ...payload, confirmCount: 5 }),
    ).rejects.toMatchObject({ status: 409 });

    const c = await svc.create(actor(adminId, 'admin'), { ...payload, confirmCount: 6 });
    expect(c.status).toBe('sending');
    await svc.settle(c.id);

    const rows = await prisma.notification.findMany({ where: { campaignId: c.id } });
    expect(rows.map((r) => r.userId).sort()).toEqual(ALL_CAMPAIGN());
    expect(
      rows.every(
        (r) => r.type === 'campaign' && (r.data as { target: unknown }).target !== undefined,
      ),
    ).toBe(true);
    expect(emittedTo(gateway, people.free, 'notification:new')).toHaveLength(1);
    expect(emittedTo(gateway, people.banned)).toHaveLength(0);

    // push: um por aparelho de quem recebe (o banido tem token e não recebe)
    expect(push.sent.map((m) => m.token).sort()).toEqual([
      'tok-free',
      'tok-prem-1',
      'tok-prem-dead',
    ]);
    const freeMsg = push.sent.find((m) => m.token === 'tok-free')!;
    const freeRow = rows.find((r) => r.userId === people.free)!;
    expect(freeMsg.payload).toMatchObject({
      title: 'Novidade no Metch',
      channelId: 'default',
      data: { notificationId: freeRow.id, type: 'campaign', target: '{"kind":"support"}' },
    });
    expect(await prisma.deviceToken.findMany({ where: { token: 'tok-prem-dead' } })).toHaveLength(
      0,
    );
    expect(await prisma.deviceToken.count({ where: { token: 'tok-banned' } })).toBe(1);

    const done = await svc.get(c.id);
    expect(done.status).toBe('sent');
    expect(done.stats).toEqual({
      targetCount: 6,
      notified: 6,
      pushSent: 2,
      pushFailed: 1,
      opened: 0,
    });

    // "abriu": tocar no aviso conta uma vez só; "ler tudo" não conta
    await inbox.markRead(people.free, freeRow.id);
    await inbox.markRead(people.free, freeRow.id);
    await inbox.markAllRead(people.premium);
    await inbox.markRead(people.premium, 'nao-e-uuid'); // push sem central manda '' / lixo: sem 500
    expect((await svc.get(c.id)).stats.opened).toBe(1);
    expect((await inbox.list(people.free))[0]).toMatchObject({
      id: freeRow.id,
      target: { kind: 'support' },
    });
    expect(await inbox.unreadCount(people.free)).toEqual({ count: 0 });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.campaign.send' },
    });
    expect(log.metadata).toMatchObject({ target: { kind: 'campaign', id: c.id } });
  });

  it('só push (sem central): nada gravado em notifications, push com notificationId vazio', async () => {
    const c = await svc.create(actor(adminId, 'admin'), {
      title: 'Só no celular',
      body: 'oi',
      audience: { kind: 'user', userId: people.free },
      channels: { push: true, inbox: false },
    });
    await svc.settle(c.id);
    expect(await prisma.notification.count()).toBe(0);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0].payload.data).toEqual({ notificationId: '', type: 'campaign' });
    expect((await svc.get(c.id)).stats).toMatchObject({ notified: 0, pushSent: 1 });
  });

  it('público vazio → 422; canais desligados → 400', async () => {
    await expect(
      svc.create(actor(adminId, 'admin'), {
        title: 't',
        body: 'b',
        audience: { kind: 'user', userId: people.deleted },
        channels: { push: true, inbox: true },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      svc.create(actor(adminId, 'admin'), {
        title: 't',
        body: 'b',
        audience: { kind: 'premium' },
        channels: { push: false, inbox: false },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('agendada', () => {
  it('sai UMA vez com dois workers rodando o cron ao mesmo tempo; cancelar só a agendada', async () => {
    const c = await svc.create(actor(adminId, 'admin'), {
      title: 'Sexta tem festa',
      body: 'Bora?',
      audience: { kind: 'premium' },
      channels: { push: true, inbox: true },
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(c.status).toBe('scheduled');
    // ainda não venceu: ninguém pega
    expect(await svc.dispatchDue()).toBe(0);

    await prisma.pushCampaign.update({
      where: { id: c.id },
      data: { scheduledAt: new Date(Date.now() - 1_000) },
    });
    const [a, b] = await Promise.all([svc.dispatchDue(), svc2.dispatchDue()]);
    expect(a + b).toBe(1);
    expect(await svc.dispatchDue()).toBe(0);
    expect(await prisma.notification.count({ where: { campaignId: c.id } })).toBe(2);
    expect(push.sent.filter((m) => m.payload.title === 'Sexta tem festa')).toHaveLength(2); // 2 tokens da premium, 1 vez cada
    expect((await svc.get(c.id)).status).toBe('sent');

    // cancelar: só agendada
    await expect(svc.cancel(actor(adminId, 'admin'), c.id)).rejects.toMatchObject({
      response: { error: 'not_scheduled' },
    });
    const later = await svc.create(actor(adminId, 'admin'), {
      title: 'Depois',
      body: 'x',
      audience: { kind: 'premium' },
      channels: { push: false, inbox: true },
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect((await svc.cancel(actor(adminId, 'admin'), later.id)).status).toBe('cancelled');
    await prisma.pushCampaign.update({
      where: { id: later.id },
      data: { scheduledAt: new Date(Date.now() - 1_000) },
    });
    expect(await svc.dispatchDue()).toBe(0);

    const list = await svc.list({});
    expect(list.items.map((x) => x.id)).toEqual([later.id, c.id]);
    expect(list.pushEnabled).toBe(true);
  });

  it("'sending' parado (processo caiu) vira 'failed' e nunca reenvia sozinho", async () => {
    const c = await prisma.pushCampaign.create({
      data: {
        title: 'Presa',
        body: 'x',
        audience: { kind: 'all' },
        channels: { push: true, inbox: true },
        status: 'sending',
        updatedAt: new Date(Date.now() - 3_600_000),
      },
    });
    await prisma.$executeRaw`UPDATE push_campaigns SET updated_at = now() - interval '1 hour' WHERE id = ${c.id}::uuid`;
    await svc.dispatchDue();
    expect((await svc.get(c.id)).status).toBe('failed');
    expect(await prisma.notification.count()).toBe(0);
  });
});
