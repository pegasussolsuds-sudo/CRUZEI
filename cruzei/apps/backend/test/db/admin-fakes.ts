import type { PrismaClient } from '@prisma/client';

import type { AuthenticatedUser } from '../../src/common/decorators/current-user.decorator';
import type { PrismaService } from '../../src/database/prisma.service';
import type { AccountStateService } from '../../src/modules/account/account-state.service';
import { AuditService } from '../../src/modules/admin/audit.service';
import { CampaignsService } from '../../src/modules/admin/campaigns.service';
import type { LocationService } from '../../src/modules/location/location.service';
import { NotifyService } from '../../src/modules/notifications/notify.service';
import {
  PushService,
  type PushMessage,
  type PushOutcome,
  type PushTransport,
} from '../../src/modules/notifications/push.service';
import type { ChatGateway } from '../../src/realtime/chat.gateway';
import type { RedisService } from '../../src/redis/redis.service';

// Peças falsas compartilhadas pelos db-specs do painel admin: Redis em memória, gateway que só grava o que emitiria,
// transporte de push que responde como o FCM (com tokens "mortos" configuráveis). O banco é o cruzei_test de verdade.

/** Redis em memória: o que os serviços do painel usam (cache de perfil, incrRate, get/set NX/EX/PX, del) */
export function fakeRedis() {
  const kv = new Map<string, string>();
  const counters = new Map<string, number>();
  const redis = {
    kv,
    invalidateProfile: jest.fn(async (_id: string) => undefined),
    markPresenceHidden: jest.fn(async (_id: string) => undefined),
    getCachedProfile: jest.fn(async (_id: string) => null),
    cacheProfile: jest.fn(async () => undefined),
    incrRate: jest.fn(async (userId: string, action: string) => {
      const k = `rate:${userId}:${action}`;
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      return n;
    }),
    resetRates: () => counters.clear(),
    client: {
      get: async (k: string) => kv.get(k) ?? null,
      set: async (k: string, v: string, ...opts: unknown[]) => {
        if (opts.includes('NX') && kv.has(k)) return null;
        kv.set(k, v);
        return 'OK';
      },
      del: async (k: string) => Number(kv.delete(k)),
      publish: async () => 0,
    },
  };
  return redis;
}

export type FakeRedis = ReturnType<typeof fakeRedis>;

/** gateway que só grava: emitToUser / emitToUsers / emitToStaff / setStaffMembership */
export function fakeGateway() {
  return {
    emitToUser: jest.fn(),
    emitToUsers: jest.fn(),
    emitToStaff: jest.fn(),
    setStaffMembership: jest.fn(),
    removeFromConversation: jest.fn(),
    disconnectUser: jest.fn(),
    // invisível sem Premium sai das salas de conversa (UsersService.setVisibility, rebaixamento do Premium)
    leaveAllConversations: jest.fn(async (_id: string) => undefined),
  };
}

export type FakeGateway = ReturnType<typeof fakeGateway>;

/** eventos que o gateway falso "emitiu" pra uma pessoa / pra equipe */
export const emittedTo = (g: FakeGateway, userId: string, event?: string) =>
  g.emitToUser.mock.calls
    .filter((c) => c[0] === userId && (!event || c[1] === event))
    .map((c) => ({ event: c[1] as string, payload: c[2] as Record<string, unknown> }));

export const emittedToStaff = (g: FakeGateway, event?: string) =>
  g.emitToStaff.mock.calls
    .filter((c) => !event || c[0] === event)
    .map((c) => ({ event: c[0] as string, payload: c[1] as Record<string, unknown> }));

/** transporte de push falso: grava tudo; tokens em `dead` respondem como UNREGISTERED */
export function fakePush() {
  const sent: PushMessage[] = [];
  const dead = new Set<string>();
  const transport: PushTransport & { calls: number } = {
    calls: 0,
    async sendEach(messages: PushMessage[]): Promise<PushOutcome[]> {
      transport.calls++;
      sent.push(...messages);
      return messages.map((m) => (dead.has(m.token) ? 'invalid' : 'ok'));
    },
  };
  return { transport, sent, dead };
}

export const fakeAccounts = () => ({ invalidate: jest.fn(async (_id: string) => undefined) });
export const fakeLocation = () => ({ invalidatePoiIndex: jest.fn() });

/** NotifyService + PushService de verdade (banco de teste) com gateway e transporte falsos */
export function notifyStack(
  prisma: PrismaClient,
  gateway: FakeGateway,
  transport: PushTransport | null,
) {
  const db = prisma as unknown as PrismaService;
  const push = new PushService(db, transport);
  push.onModuleInit();
  const notify = new NotifyService(db, gateway as unknown as ChatGateway, push);
  const audit = new AuditService(db);
  const campaigns = new CampaignsService(db, notify, audit);
  return { db, push, notify, audit, campaigns };
}

export const asRedis = (r: FakeRedis) => r as unknown as RedisService;
export const asAccounts = (a: ReturnType<typeof fakeAccounts>) =>
  a as unknown as AccountStateService;
export const asGateway = (g: FakeGateway) => g as unknown as ChatGateway;
export const asLocation = (l: ReturnType<typeof fakeLocation>) => l as unknown as LocationService;

// TRUNCATE (não DELETE): o audit_log é só-anexar (trigger barra UPDATE/DELETE de linha)
export const resetAdminDb = (prisma: PrismaClient) =>
  prisma.$executeRawUnsafe(
    'TRUNCATE users, pois, events, push_campaigns, place_candidates, geo_areas RESTART IDENTITY CASCADE',
  );

let phoneSeq = 0;
/** pessoa de teste (telefone +55349777xxxxx, fora dos fakes do seed-dev) */
export async function newUser(
  prisma: PrismaClient,
  name: string,
  extra: Record<string, unknown> = {},
) {
  phoneSeq++;
  return prisma.user.create({
    data: {
      name,
      phone: `+5534977${String(phoneSeq).padStart(6, '0')}`,
      birthDate: new Date('1995-01-01'),
      gender: 'female',
      visibilityMode: 'visible',
      ...extra,
    } as never,
    select: { id: true, phone: true },
  });
}

export const actor = (id: string, role: 'admin' | 'moderator' | 'user'): AuthenticatedUser => ({
  id,
  role,
});

/** POI de teste */
export async function newPoi(
  prisma: PrismaClient,
  name: string,
  extra: Record<string, unknown> = {},
) {
  return prisma.pOI.create({
    data: {
      name,
      category: 'bar',
      latitude: -18.9186,
      longitude: -48.2772,
      city: 'Uberlândia',
      source: 'osm',
      ...extra,
    } as never,
    select: { id: true },
  });
}
