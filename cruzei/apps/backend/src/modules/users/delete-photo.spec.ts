import type { PrismaService } from '../../database/prisma.service';
import type { ChatGateway } from '../../realtime/chat.gateway';
import type { RedisService } from '../../redis/redis.service';
import type { PhotoModerationService } from '../moderation/photo-moderation.service';
import type { MediaGcService } from '../uploads/media-gc.service';
import { isRetainedPhoto, RETAINED_LABEL } from '../uploads/photo-retention';

import { UsersService } from './users.service';

// Apagar foto com denúncia underage/child_safety aberta contra o dono: a foto NÃO sai (some da frente do moderador);
// fica retida — fora do perfil do dono e do público, na ficha com a marca — e o dono vê sumir igual. Banco falso em
// memória; a transação de verdade (travas, gatilho) está em test/db/media.db-spec.ts.

const OWNER = '0a000000-0000-4000-8000-00000000000a';
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type PhotoRow = {
  id: string;
  userId: string;
  url: string;
  thumbnailUrl: string | null;
  orderIndex: number;
  isMain: boolean;
  status: 'approved' | 'pending' | 'rejected';
  rejectReason: string | null;
  moderationLabels: unknown;
};

function setup(opts: { held?: boolean; photos?: Partial<PhotoRow>[] } = {}) {
  let photos: PhotoRow[] = (opts.photos ?? [{}, {}, {}]).map((p, i) => ({
    id: pid(i + 1),
    userId: OWNER,
    url: `p/${pid(i + 1)}.jpg`,
    thumbnailUrl: `p/${pid(i + 1)}-t.jpg`,
    orderIndex: i,
    isMain: i === 0,
    status: 'approved',
    rejectReason: null,
    moderationLabels: null,
    ...p,
  }));
  const actions: unknown[] = [];
  const locks: string[] = [];
  const byOwner = () => photos.filter((p) => p.userId === OWNER);
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) {
        locks.push(sql.includes('FROM photos') ? 'photo' : 'user');
        return [{}];
      }
      if (sql.includes('FROM reports')) {
        expect(values[1]).toEqual(['underage', 'child_safety']);
        return opts.held ? [{ id: OWNER }] : [];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    }),
    photo: {
      // cópias, como o Prisma (ninguém enxerga a mutação do update depois)
      findFirst: jest.fn(async (a: { where: { id: string; userId: string } }) => {
        const p = photos.find((x) => x.id === a.where.id && x.userId === a.where.userId);
        return p ? { ...p } : null;
      }),
      findMany: jest.fn(async () =>
        byOwner()
          .map((p) => ({ ...p }))
          .sort((a, b) => a.orderIndex - b.orderIndex),
      ),
      aggregate: jest.fn(async () => ({
        _min: { orderIndex: Math.min(...byOwner().map((p) => p.orderIndex)) },
      })),
      delete: jest.fn(async (a: { where: { id: string } }) => {
        photos = photos.filter((p) => p.id !== a.where.id);
      }),
      update: jest.fn(async (a: { where: { id: string }; data: Partial<PhotoRow> }) => {
        const p = photos.find((x) => x.id === a.where.id)!;
        // o UNIQUE(user_id, order_index) de verdade
        if (
          a.data.orderIndex !== undefined &&
          byOwner().some((x) => x.id !== p.id && x.orderIndex === a.data.orderIndex)
        )
          throw new Error(`UNIQUE violado: order_index ${a.data.orderIndex}`);
        Object.assign(p, a.data);
        return p;
      }),
    },
    moderationAction: { create: jest.fn(async (a: unknown) => actions.push(a)) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    photo: {
      ...tx.photo,
      updateMany: jest.fn(
        async (a: { where: { id?: string; userId: string }; data: Partial<PhotoRow> }) => {
          const hit = byOwner().filter((p) => !a.where.id || p.id === a.where.id);
          hit.forEach((p) => Object.assign(p, a.data));
          return { count: hit.length };
        },
      ),
    },
    user: {
      findUnique: jest.fn(async () => ({
        name: 'Ana',
        bio: null,
        lookingFor: 'unspecified',
        isVerified: false,
        photos: byOwner(),
        userInterests: [],
      })),
      update: jest.fn(async () => ({})),
    },
  };
  const redis = { invalidateProfile: jest.fn(async () => undefined) };
  const kick = jest.fn();
  const svc = new UsersService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    {} as PhotoModerationService,
    {} as ChatGateway,
    { kick } as unknown as MediaGcService,
  );
  return { svc, tx, prisma, redis, kick, actions, locks, all: () => photos };
}

describe('UsersService.deletePhoto — retenção por denúncia', () => {
  it('sem denúncia aberta: apaga, reindexa, nova principal e o GC entra', async () => {
    const t = setup();
    await t.svc.deletePhoto(OWNER, pid(1));
    expect(t.all().map((p) => [p.id, p.orderIndex, p.isMain])).toEqual([
      [pid(2), 0, true],
      [pid(3), 1, false],
    ]);
    expect(t.kick).toHaveBeenCalledWith([`p/${pid(1)}.jpg`, `p/${pid(1)}-t.jpg`]);
    expect(t.actions).toHaveLength(0);
    // trava a conta e depois a foto (a mesma ordem do decide: sem deadlock)
    expect(t.locks).toEqual(['user', 'photo']);
  });

  it('com denúncia underage/child_safety aberta: a foto fica retida (não sai do banco nem do storage)', async () => {
    const t = setup({
      held: true,
      photos: [{ moderationLabels: { labels: ['menor'], urgent: true } }, {}, {}],
    });
    await expect(t.svc.deletePhoto(OWNER, pid(1))).resolves.toEqual({ ok: true });

    expect(t.tx.photo.delete).not.toHaveBeenCalled();
    expect(t.kick).not.toHaveBeenCalled();
    const kept = t.all().find((p) => p.id === pid(1))!;
    // fora do público (status) e do perfil do dono (marca), abaixo de tudo, sem ser principal
    expect(kept.status).toBe('rejected');
    expect(kept.isMain).toBe(false);
    expect(kept.orderIndex).toBe(-1);
    expect(isRetainedPhoto(kept.moderationLabels)).toBe(true);
    // rótulos da análise preservados (o urgent dá os 180 dias quando sair)
    expect(kept.moderationLabels).toMatchObject({
      labels: ['menor'],
      urgent: true,
      [RETAINED_LABEL]: { prevStatus: 'approved', wasMain: true },
    });
    // pro dono: a ordem e a principal se ajeitam como se tivesse apagado
    const visible = t.all().filter((p) => !isRetainedPhoto(p.moderationLabels));
    expect(visible.map((p) => [p.id, p.orderIndex, p.isMain])).toEqual([
      [pid(2), 0, true],
      [pid(3), 1, false],
    ]);
    // trilha da moderação (a ficha mostra) e cache do perfil derrubado
    expect(t.actions).toEqual([
      {
        data: expect.objectContaining({
          action: 'photo_retain',
          photoId: pid(1),
          targetUserId: OWNER,
          moderatorId: null,
        }),
      },
    ]);
    expect(t.redis.invalidateProfile).toHaveBeenCalledWith(OWNER);
    // completude conta só as visíveis
    expect(t.prisma.user.update).toHaveBeenCalled();
  });

  it('segunda retida vai pra baixo da primeira (sem bater no UNIQUE)', async () => {
    const t = setup({ held: true });
    await t.svc.deletePhoto(OWNER, pid(1));
    await t.svc.deletePhoto(OWNER, pid(2));
    const idx = Object.fromEntries(t.all().map((p) => [p.id, p.orderIndex]));
    expect(idx).toEqual({ [pid(1)]: -1, [pid(2)]: -2, [pid(3)]: 0 });
    expect(t.all().find((p) => p.id === pid(3))!.isMain).toBe(true);
  });

  it('retida já sumiu pro dono: apagar de novo é 404 (nem reter nem apagar)', async () => {
    const t = setup({ held: true });
    await t.svc.deletePhoto(OWNER, pid(1));
    await expect(t.svc.deletePhoto(OWNER, pid(1))).rejects.toMatchObject({ status: 404 });
    expect(t.tx.photo.delete).not.toHaveBeenCalled();
  });

  it('retida nunca vira principal nem volta pela reordenação', async () => {
    const t = setup({ held: true });
    await t.svc.deletePhoto(OWNER, pid(1));
    await expect(t.svc.setMain(OWNER, pid(1))).rejects.toMatchObject({ status: 404 });
    // a principal continua lá (antes zerava todas e não punha nenhuma)
    expect(t.all().find((p) => p.id === pid(2))!.isMain).toBe(true);

    await t.svc.reorderPhotos(OWNER, [pid(1), pid(3), pid(2)]);
    const idx = Object.fromEntries(t.all().map((p) => [p.id, p.orderIndex]));
    expect(idx).toEqual({ [pid(1)]: -1, [pid(3)]: 0, [pid(2)]: 1 });

    await t.svc.setMain(OWNER, pid(3));
    expect(
      t
        .all()
        .filter((p) => p.isMain)
        .map((p) => p.id),
    ).toEqual([pid(3)]);
  });

  it('id que não é uuid: 404 antes de qualquer SQL', async () => {
    const t = setup();
    await expect(t.svc.deletePhoto(OWNER, "1' OR 1=1")).rejects.toMatchObject({ status: 404 });
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });
});
