import type { PrismaService } from '../../database/prisma.service';
import type { ChatGateway } from '../../realtime/chat.gateway';
import type { RedisService } from '../../redis/redis.service';
import { withRetainedMark } from '../uploads/photo-retention';

import { ModerationService } from './moderation.service';
import { PhotoModerationService } from './photo-moderation.service';

// Foto retida por denúncia (a pessoa apagou com denúncia de menor/abuso aberta): a ficha mostra com a marca, ninguém
// aprova/recusa (aprovar a poria de volta no perfil público) e a análise automática em voo não mexe nela.

const U = '0a000000-0000-4000-8000-00000000000a';
const PHOTO = '0c000000-0000-4000-8000-00000000000c';
const retainedLabels = withRetainedMark(
  { labels: ['menor'], urgent: true },
  { at: '2026-10-05T12:00:00.000Z', prevStatus: 'approved', wasMain: true },
);

const HELD = `held/${PHOTO}.jpg`;

function moderation(
  photoLabels: unknown,
  opts: { url?: string; files?: Record<string, Buffer>; auditFails?: boolean } = {},
) {
  const decide = jest.fn(async () => undefined);
  const audit = jest.fn(async (a: unknown) => {
    if (opts.auditFails) throw new Error('banco caiu');
    return a;
  });
  const storage = {
    driver: 'local',
    get: jest.fn(async (k: string) => opts.files?.[k] ?? null),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({
        id: U,
        name: 'Alvo',
        birthDate: new Date('1990-01-01'),
        accountStatus: 'active',
        suspendedUntil: null,
        reviewHoldAt: null,
        createdAt: new Date('2026-01-01'),
        role: 'user',
        bio: null,
        instagramHandle: null,
        phone: null,
        photos: [
          {
            id: PHOTO,
            url: HELD,
            status: 'rejected',
            isMain: false,
            rejectReason: null,
            moderationLabels: retainedLabels,
          },
          {
            id: 'outra',
            url: 'p/outra.jpg',
            status: 'approved',
            isMain: true,
            rejectReason: null,
            moderationLabels: null,
          },
        ],
      })),
    },
    report: { findMany: jest.fn(async () => []) },
    moderationAction: { findMany: jest.fn(async () => []) },
    photo: {
      findUnique: jest.fn(async () => ({
        id: PHOTO,
        userId: U,
        url: opts.url ?? HELD,
        moderationLabels: photoLabels,
      })),
    },
    auditLog: { create: audit },
  };
  const svc = new ModerationService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    { decide } as unknown as PhotoModerationService,
    {} as never,
    storage as never,
  );
  return { svc, decide, audit, storage };
}

describe('ModerationService com foto retida', () => {
  it('a ficha traz a retida com a marca (e a principal continua sendo a visível)', async () => {
    const d = await moderation(null).svc.userDetail(U);
    expect(d.photos.map((p) => [p.id, p.retained])).toEqual([
      [PHOTO, true],
      ['outra', false],
    ]);
    expect(d.user.mainPhotoUrl).toContain('p/outra.jpg');
  });

  it('a retida sai pela rota AUTENTICADA da moderação, nunca pela URL pública (held/ nem vira URL)', async () => {
    const d = await moderation(null).svc.userDetail(U);
    const retained = d.photos.find((p) => p.id === PHOTO)!;
    expect(retained.url).toBe(`/v1/admin/photos/${PHOTO}/file`);
    expect(JSON.stringify(d)).not.toContain('held/');
    // a comum continua com a URL pública
    expect(d.photos.find((p) => p.id === 'outra')!.url).toMatch(/^https?:\/\/.*\/p\/outra\.jpg$/);
  });

  it('arquivo da retida: lê do storage (held/), devolve o tipo e grava a abertura na trilha', async () => {
    const m = moderation(retainedLabels, { files: { [HELD]: Buffer.from('prova') } });
    const f = await m.svc.retainedPhotoFile('mod-1', PHOTO);
    expect(f.body.toString()).toBe('prova');
    expect(f.contentType).toBe('image/jpeg');
    expect(m.storage.get).toHaveBeenCalledWith(HELD);
    expect(m.audit).toHaveBeenCalledWith({
      data: {
        userId: 'mod-1',
        action: 'admin.photo.retained_view',
        metadata: expect.objectContaining({ target: { kind: 'user', id: U }, photoId: PHOTO }),
      },
    });
  });

  it('retida ainda na chave pública (o cron não moveu) também abre; falha da trilha não barra', async () => {
    const legacy = `http://192.168.0.9:3000/uploads/${PHOTO}.png`;
    const m = moderation(retainedLabels, {
      url: legacy,
      files: { [`${PHOTO}.png`]: Buffer.from('png') },
      auditFails: true,
    });
    const f = await m.svc.retainedPhotoFile('mod-1', PHOTO);
    expect(f.contentType).toBe('image/png');
  });

  it('foto que não é retida, URL externa ou arquivo sumido: 404 (sem gravar trilha)', async () => {
    await expect(
      moderation({ labels: [] }, { files: { [HELD]: Buffer.from('x') } }).svc.retainedPhotoFile(
        'mod-1',
        PHOTO,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const ext = moderation(retainedLabels, { url: 'https://cdn.externo/x.jpg' });
    await expect(ext.svc.retainedPhotoFile('mod-1', PHOTO)).rejects.toMatchObject({ status: 404 });
    expect(ext.storage.get).not.toHaveBeenCalled();
    const gone = moderation(retainedLabels);
    await expect(gone.svc.retainedPhotoFile('mod-1', PHOTO)).rejects.toMatchObject({
      status: 404,
    });
    expect(gone.audit).not.toHaveBeenCalled();
  });

  it('aprovar/recusar a retida: 400 e nada muda', async () => {
    const m = moderation(retainedLabels);
    await expect(m.svc.photoDecision('mod', PHOTO, 'approve')).rejects.toMatchObject({
      status: 400,
    });
    expect(m.decide).not.toHaveBeenCalled();
  });

  it('foto comum segue pro decide', async () => {
    const m = moderation({ labels: ['sem alertas'] });
    await m.svc.photoDecision('mod', PHOTO, 'reject', 'nudez');
    expect(m.decide).toHaveBeenCalledWith(PHOTO, 'rejected', {
      moderatorId: 'mod',
      reason: 'nudez',
    });
  });
});

describe('PhotoModerationService.decide com foto retida', () => {
  function setup(labels: unknown) {
    const update = jest.fn(async () => ({ userId: U }));
    const queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
      expect(strings.join('?')).toContain('FOR UPDATE');
      return labels === undefined ? [] : [{ moderation_labels: labels }];
    });
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: queryRaw, photo: { update } }),
      ),
      moderationAction: { create: jest.fn(async () => ({})) },
    };
    const redis = { invalidateProfile: jest.fn(async () => undefined) };
    const gateway = { emitToUser: jest.fn() };
    const svc = new PhotoModerationService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      gateway as unknown as ChatGateway,
      {} as never,
    );
    return { svc, update, prisma, redis, gateway };
  }

  it('retida: não muda a situação, não grava trilha nem avisa (análise em voo ou moderador)', async () => {
    const t = setup(retainedLabels);
    await t.svc.decide(PHOTO, 'approved', { moderatorId: null, labels: ['sem alertas'] });
    expect(t.update).not.toHaveBeenCalled();
    expect(t.prisma.moderationAction.create).not.toHaveBeenCalled();
    expect(t.redis.invalidateProfile).not.toHaveBeenCalled();
    expect(t.gateway.emitToUser).not.toHaveBeenCalled();
  });

  it('comum: grava, registra e avisa o dono', async () => {
    const t = setup(null);
    await t.svc.decide(PHOTO, 'approved', { moderatorId: 'mod' });
    expect(t.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PHOTO },
        data: expect.objectContaining({ status: 'approved' }),
      }),
    );
    expect(t.prisma.moderationAction.create).toHaveBeenCalled();
    expect(t.gateway.emitToUser).toHaveBeenCalledWith(U, 'photo_moderated', {
      photoId: PHOTO,
      status: 'approved',
      reason: null,
    });
  });

  it('foto que não existe: 404', async () => {
    await expect(
      setup(undefined).svc.decide(PHOTO, 'rejected', { moderatorId: 'mod' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
