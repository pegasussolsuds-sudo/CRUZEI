import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

import { resetPhotoUrlCache } from '../../src/common/photo-url';
import type { PrismaService } from '../../src/database/prisma.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import { MediaGcService } from '../../src/modules/uploads/media-gc.service';
import { MediaGcTask } from '../../src/modules/uploads/media-gc.task';
import { reprocessLegacyPhotos } from '../../src/modules/uploads/photo-reprocess';
import { isRetainedPhoto } from '../../src/modules/uploads/photo-retention';
import { LocalObjectStorage } from '../../src/modules/uploads/storage/local-storage';
import type { ObjectStorage } from '../../src/modules/uploads/storage/object-storage';
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { MAX_PHOTOS, UsersService } from '../../src/modules/users/users.service';

import { asGateway, asRedis, fakeGateway, fakeRedis, newUser, resetAdminDb } from './admin-fakes';
import { assertTestDatabase } from './env';

// Fotos contra o banco de TESTE (migration 20261005000100_media_objects) e um storage local de verdade numa pasta
// temporária: gatilho photos_release_media, upload → anexar (posse, frescor, idempotência), apagar foto, GC com as
// regras de evidência ('urgent' 180 dias, denúncia underage/child_safety aberta, citação em denúncia), lease
// concorrente, modo dry e a limpeza da conta (releaseUser).
// Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;
const BASE = 'https://fotos.test';

let root: string;
let storage: LocalObjectStorage;
let gc: MediaGcService;
let uploads: UploadsService;
let users: UsersService;
/** o kick do UsersService fica gravado (o GC roda na mão nos testes: nada de corrida com setImmediate) */
const kick = jest.fn();
const photoModeration = { initialStatus: () => 'approved' as const, enqueue: jest.fn() };

type MediaRow = {
  key: string;
  owner_id: string | null;
  thumb_key: string | null;
  attached_at: Date | null;
  delete_after: Date | null;
  delete_attempts: number;
  created_at: Date;
};

const mediaRow = async (key: string): Promise<MediaRow | undefined> =>
  (
    await prisma.$queryRaw<MediaRow[]>`
      SELECT key, owner_id::text AS owner_id, thumb_key, attached_at, delete_after, delete_attempts, created_at
        FROM media_objects WHERE key = ${key}`
  )[0];

/** segundos entre o delete_after e agora + `days` dias */
const offsetFromNow = (d: Date | null, days: number) =>
  Math.abs((d!.getTime() - Date.now()) / 1000 - days * 86400);

const onDisk = (key: string) => storage.exists(key);

const jpeg = (w = 120, h = 90) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#a44' } })
    .jpeg()
    .withExif({ IFD3: { GPSMapDatum: 'GPS-SECRETO' } })
    .toBuffer();

/** upload de verdade (reprocessa e grava no disco temporário) */
const upload = async (userId: string) => uploads.uploadPhoto(userId, await jpeg());

/** linha de photos direto no banco (fotos legadas, fakes, URL externa) */
const insertPhoto = (
  userId: string,
  url: string,
  thumbnailUrl: string | null,
  extra: Record<string, unknown> = {},
) =>
  prisma.photo.create({
    data: {
      userId,
      url,
      thumbnailUrl,
      orderIndex: (extra.orderIndex as number) ?? 0,
      status: 'approved',
      ...extra,
    } as never,
  });

/** faz o tempo passar pra uma linha da fila (created_at e delete_after juntos: a marca de upload fresco continua) */
const age = (key: string, hours: number) =>
  prisma.$executeRaw`
    UPDATE media_objects SET created_at = created_at - make_interval(hours => ${hours}::int),
                             delete_after = delete_after - make_interval(hours => ${hours}::int)
     WHERE key = ${key}`;
const dueNow = (key: string) =>
  prisma.$executeRaw`UPDATE media_objects SET delete_after = now() - interval '1 second' WHERE key = ${key}`;

async function errorOf(
  p: Promise<unknown>,
): Promise<{ status?: number; error?: string; message?: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { getStatus?: () => number; getResponse?: () => unknown };
    const body = (err.getResponse?.() ?? {}) as { error?: string; message?: string };
    return { status: err.getStatus?.(), error: body.error, message: body.message };
  }
  throw new Error('era pra ter falhado');
}

const uuidKey = (n: number, ext = 'jpg') =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}.${ext}`;

/** marca de retida por denúncia (photo-retention.ts) */
const retainedMark = () => ({
  retainedByReport: { at: new Date().toISOString(), prevStatus: 'approved', wasMain: false },
});

/** storage local com o PUT em held/ quebrado (a cópia privada não dá) */
const brokenHeldPut = (): ObjectStorage => ({
  driver: 'local',
  get: (k) => storage.get(k),
  exists: (k) => storage.exists(k),
  delete: (k) => storage.delete(k),
  put: async (k, b, t) => {
    if (k.startsWith('held/')) throw new Error('storage fora');
    return storage.put(k, b, t);
  },
});

const labelsOf = async (photoId: string) =>
  ((await prisma.photo.findUniqueOrThrow({ where: { id: photoId } })).moderationLabels ?? {}) as {
    retainedByReport?: Record<string, unknown>;
  };

beforeAll(async () => {
  await assertTestDatabase(prisma);
  process.env.STORAGE_PUBLIC_BASE_URL = BASE;
  resetPhotoUrlCache();
});

beforeEach(async () => {
  await resetAdminDb(prisma);
  await prisma.$executeRawUnsafe('TRUNCATE media_objects');
  jest.clearAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'metch-media-'));
  storage = new LocalObjectStorage(root);
  gc = new MediaGcService(db, storage, 'on');
  uploads = new UploadsService(db, storage, gc);
  users = usersWith(storage);
});

/**
 * UsersService com um GC de verdade (cópia pra held/, fila) mas com o kick gravado: o drain roda na mão nos testes.
 * `st` permite trocar o storage do apagar (ex.: PUT da held/ quebrado).
 */
function usersWith(st: LocalObjectStorage | ObjectStorage): UsersService {
  const usersGc = new MediaGcService(db, st, 'on');
  usersGc.kick = kick;
  return new UsersService(
    db,
    asRedis(fakeRedis()),
    photoModeration as unknown as PhotoModerationService,
    asGateway(fakeGateway()),
    usersGc,
  );
}

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await resetAdminDb(prisma);
  await prisma.$executeRawUnsafe('TRUNCATE media_objects');
  delete process.env.STORAGE_PUBLIC_BASE_URL;
  resetPhotoUrlCache();
  await prisma.$disconnect();
});

describe('gatilho photos_release_media (foto apagada por qualquer caminho)', () => {
  it('chave gerenciada entra na fila com dono e miniatura, pra sair agora', async () => {
    const u = await newUser(prisma, 'Ana');
    const p = await insertPhoto(
      u.id,
      `p/${uuidKey(1)}`,
      `p/${uuidKey(1).replace('.jpg', '-t.jpg')}`,
    );
    await prisma.photo.delete({ where: { id: p.id } });
    const m = await mediaRow(`p/${uuidKey(1)}`);
    expect(m).toMatchObject({
      owner_id: u.id,
      thumb_key: `p/${uuidKey(1).replace('.jpg', '-t.jpg')}`,
      attached_at: null,
    });
    expect(offsetFromNow(m!.delete_after, 0)).toBeLessThan(60);
  });

  it('URL legada /uploads/ de qualquer host vira chave; miniatura igual ao original vira NULL', async () => {
    const u = await newUser(prisma, 'Ana');
    const a = await insertPhoto(
      u.id,
      `http://192.168.0.9:3000/uploads/${uuidKey(2, 'png')}`,
      `http://192.168.0.9:3000/uploads/${uuidKey(2, 'png')}`,
    );
    const b = await insertPhoto(
      u.id,
      `http://127.0.0.1:3000/uploads/${uuidKey(3, 'webp')}`,
      `http://127.0.0.1:3000/uploads/${uuidKey(3, 'webp').replace('.webp', '-t.jpg')}`,
      { orderIndex: 1 },
    );
    await prisma.photo.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    expect(await mediaRow(uuidKey(2, 'png'))).toMatchObject({ thumb_key: null });
    expect(await mediaRow(uuidKey(3, 'webp'))).toMatchObject({
      thumb_key: uuidKey(3, 'webp').replace('.webp', '-t.jpg'),
    });
  });

  it('fakes/ do seed, URL externa e lixo nunca entram na fila', async () => {
    const u = await newUser(prisma, 'Ana');
    await insertPhoto(u.id, 'http://127.0.0.1:3000/uploads/fakes/fake-1.jpg', null);
    await insertPhoto(u.id, 'https://cdn.externo.example/foto.jpg', null, { orderIndex: 1 });
    await insertPhoto(u.id, 'p/nao-e-uuid.jpg', null, { orderIndex: 2 });
    await prisma.photo.deleteMany({ where: { userId: u.id } });
    const [{ n }] = await prisma.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM media_objects`;
    expect(n).toBe(0);
  });

  it("rótulo 'urgent' (possível menor) guarda o arquivo por 180 dias", async () => {
    const u = await newUser(prisma, 'Ana');
    const p = await insertPhoto(u.id, `p/${uuidKey(4)}`, null, {
      moderationLabels: { labels: ['x'], urgent: true },
    });
    await prisma.photo.delete({ where: { id: p.id } });
    expect(offsetFromNow((await mediaRow(`p/${uuidKey(4)}`))!.delete_after, 180)).toBeLessThan(60);
  });

  it('chave já na fila (upload anexado): solta de novo, sem encurtar um prazo maior', async () => {
    const u = await newUser(prisma, 'Ana');
    const up = await upload(u.id);
    const photo = await users.addPhoto(u.id, { key: up.key });
    await prisma.$executeRaw`UPDATE media_objects SET delete_after = now() + interval '9 days' WHERE key = ${up.key}`;
    await prisma.photo.delete({ where: { id: photo.id } });
    const m = await mediaRow(up.key);
    expect(m!.attached_at).toBeNull();
    expect(offsetFromNow(m!.delete_after, 9)).toBeLessThan(60);
  });

  it('uma linha de photos por objeto novo (photos_url_key_uq)', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia');
    await insertPhoto(a.id, `p/${uuidKey(5)}`, null);
    await expect(insertPhoto(b.id, `p/${uuidKey(5)}`, null)).rejects.toThrow();
  });
});

describe('upload → anexar (POST /uploads/photo + POST /me/photos)', () => {
  it('upload grava original e miniatura sem metadado; anexar pela chave cria a foto e tira da fila', async () => {
    const u = await newUser(prisma, 'Ana');
    const up = await upload(u.id);
    expect(up.url).toBe(`${BASE}/${up.key}`);
    expect(await onDisk(up.key)).toBe(true);
    expect(await onDisk(up.thumbnailKey)).toBe(true);
    const stored = (await storage.get(up.key))!;
    expect(stored.includes(Buffer.from('GPS-SECRETO'))).toBe(false);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();

    const fresh = await mediaRow(up.key);
    expect(fresh).toMatchObject({ owner_id: u.id, thumb_key: up.thumbnailKey, attached_at: null });
    expect(offsetFromNow(fresh!.delete_after, 1)).toBeLessThan(60);

    const photo = await users.addPhoto(u.id, { key: up.key });
    expect(photo).toMatchObject({
      url: up.url,
      thumbnailUrl: up.thumbnailUrl,
      isMain: true,
      orderIndex: 0,
    });
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } });
    expect(row.url).toBe(up.key); // o banco guarda a CHAVE
    expect(row.thumbnailUrl).toBe(up.thumbnailKey);
    const attached = await mediaRow(up.key);
    expect(attached!.attached_at).not.toBeNull();
    expect(attached!.delete_after).toBeNull();
    expect(photoModeration.enqueue).toHaveBeenCalledWith(photo.id);

    // repetir devolve a mesma foto (rede ruim, app reenviou)
    const again = await users.addPhoto(u.id, { key: up.key });
    expect(again.id).toBe(photo.id);
    expect(await prisma.photo.count({ where: { userId: u.id } })).toBe(1);
  });

  it('APK antigo: anexa pela url que o upload devolveu (e pela URL legada /uploads/ de outro host)', async () => {
    const u = await newUser(prisma, 'Ana');
    const a = await upload(u.id);
    const b = await upload(u.id);
    const pa = await users.addPhoto(u.id, { url: a.url });
    const pb = await users.addPhoto(u.id, { url: `http://192.168.0.9:3000/uploads/${b.key}` });
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: pa.id } })).url).toBe(a.key);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: pb.id } })).url).toBe(b.key);
    expect(pb.orderIndex).toBe(1);
  });

  it('upload de outra conta, vencido (23 h), já liberado ou inexistente: 400 upload_not_found', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia');
    const deB = await upload(b.id);
    expect((await errorOf(users.addPhoto(a.id, { key: deB.key }))).error).toBe('upload_not_found');

    const velho = await upload(a.id);
    await age(velho.key, 23);
    await prisma.$executeRaw`UPDATE media_objects SET created_at = created_at - interval '1 minute', delete_after = delete_after - interval '1 minute' WHERE key = ${velho.key}`;
    expect((await errorOf(users.addPhoto(a.id, { key: velho.key }))).error).toBe(
      'upload_not_found',
    );

    const liberado = await upload(a.id);
    await dueNow(liberado.key);
    expect((await errorOf(users.addPhoto(a.id, { key: liberado.key }))).error).toBe(
      'upload_not_found',
    );

    for (const ref of [
      { key: 'p/00000000-0000-4000-8000-000000000999.jpg' },
      { url: 'https://cdn.externo.example/x.jpg' },
      { key: 'fakes/fake-1.jpg' },
    ]) {
      expect((await errorOf(users.addPhoto(a.id, ref))).status).toBe(400);
    }
    expect(await prisma.photo.count()).toBe(0);
  });

  it(`teto de ${MAX_PHOTOS} fotos: a 7ª dá 400 sem mexer na principal nem gastar o upload`, async () => {
    const u = await newUser(prisma, 'Ana');
    for (let i = 0; i < MAX_PHOTOS; i++)
      await users.addPhoto(u.id, { key: (await upload(u.id)).key });
    const extra = await upload(u.id);
    const e = await errorOf(users.addPhoto(u.id, { key: extra.key }, true));
    expect(e.status).toBe(400);
    const mains = await prisma.photo.findMany({ where: { userId: u.id, isMain: true } });
    expect(mains).toHaveLength(1);
    expect(mains[0].orderIndex).toBe(0);
    expect((await mediaRow(extra.key))!.attached_at).toBeNull();
  });
});

describe('apagar foto (DELETE /me/photos/:id) + GC', () => {
  it('a foto sai, a ordem e a principal se ajeitam e o GC apaga original e miniatura do storage', async () => {
    const u = await newUser(prisma, 'Ana');
    const ups = [await upload(u.id), await upload(u.id), await upload(u.id)];
    const photos: { id: string }[] = [];
    for (const up of ups) photos.push(await users.addPhoto(u.id, { key: up.key }));

    await users.deletePhoto(u.id, photos[0].id);
    expect(kick).toHaveBeenCalledWith([ups[0].key, ups[0].thumbnailKey]);
    const rest = await prisma.photo.findMany({
      where: { userId: u.id },
      orderBy: { orderIndex: 'asc' },
    });
    expect(rest.map((p) => [p.url, p.orderIndex, p.isMain])).toEqual([
      [ups[1].key, 0, true],
      [ups[2].key, 1, false],
    ]);

    const r = await gc.drain({ keys: [ups[0].key] });
    expect(r).toMatchObject({ leased: 1, deleted: 1, failed: 0 });
    expect(await onDisk(ups[0].key)).toBe(false);
    expect(await onDisk(ups[0].thumbnailKey)).toBe(false);
    expect(await mediaRow(ups[0].key)).toBeUndefined();
    // as outras continuam no ar
    expect(await onDisk(ups[1].key)).toBe(true);
  });

  it("foto 'urgent' apagada: o arquivo fica 180 dias; vencido o prazo, sai", async () => {
    const u = await newUser(prisma, 'Ana');
    const up = await upload(u.id);
    const photo = await users.addPhoto(u.id, { key: up.key });
    await prisma.$executeRaw`UPDATE photos SET moderation_labels = '{"labels":["menor"],"urgent":true}'::jsonb WHERE id = ${photo.id}::uuid`;
    await users.deletePhoto(u.id, photo.id);

    expect((await gc.drain()).leased).toBe(0);
    expect(await onDisk(up.key)).toBe(true);

    await dueNow(up.key);
    expect((await gc.drain()).deleted).toBe(1);
    expect(await onDisk(up.key)).toBe(false);
  });

  it('dono com denúncia underage/child_safety aberta: apagar RETÉM a foto numa cópia privada (held/); a pública sai já', async () => {
    // underage fecha COM ação (resolvida: 180 dias); child_safety é dispensada (sai na hora)
    for (const [reason, closeAs] of [
      ['underage', 'resolved'],
      ['child_safety', 'dismissed'],
    ] as const) {
      kick.mockClear();
      const u = await newUser(prisma, `Alvo ${reason}`);
      const reporter = await newUser(prisma, `Quem denunciou ${reason}`);
      const up1 = await upload(u.id);
      const up2 = await upload(u.id);
      const p1 = await users.addPhoto(u.id, { key: up1.key });
      await users.addPhoto(u.id, { key: up2.key });
      const original = (await storage.get(up1.key))!;
      const report = await prisma.report.create({
        data: { reporterId: reporter.id, reportedId: u.id, reason, status: 'pending' },
      });
      await expect(users.deletePhoto(u.id, p1.id)).resolves.toEqual({ ok: true });

      // a linha fica: fora do público (rejected), fora do perfil do dono (marca), abaixo de tudo — e aponta pra held/
      const kept = await prisma.photo.findUnique({ where: { id: p1.id } });
      expect(kept).toMatchObject({ status: 'rejected', isMain: false, orderIndex: -1 });
      expect(isRetainedPhoto(kept!.moderationLabels)).toBe(true);
      const held = kept!.url;
      expect(held).toMatch(/^held\/[0-9a-f-]{36}\.jpg$/);
      // uuid novo: a URL pública antiga não leva até ela
      expect(held).not.toContain(up1.key.slice(2, 38));
      expect(kept!.thumbnailUrl).toBe(held);
      // cópia privada com os mesmos bytes, anexada (kind 'held')
      expect((await storage.get(held))!.equals(original)).toBe(true);
      const heldRow = (await mediaRow(held))!;
      expect(heldRow).toMatchObject({ owner_id: u.id, delete_after: null });
      expect(heldRow.attached_at).not.toBeNull();
      const [{ kind }] = await prisma.$queryRaw<{ kind: string }[]>`
        SELECT kind FROM media_objects WHERE key = ${held}`;
      expect(kind).toBe('held');
      // a pública (original + miniatura) vai pra fila marcada com moved_to e pro GC na hora
      expect(kick).toHaveBeenCalledWith([up1.key, up1.thumbnailKey]);
      const [pub] = await prisma.$queryRaw<{ moved_to: string; delete_after: Date }[]>`
        SELECT moved_to, delete_after FROM media_objects WHERE key = ${up1.key}`;
      expect(pub.moved_to).toBe(held);
      expect(pub.delete_after.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

      // o GC apaga a pública MESMO com a denúncia ainda aberta (a prova está em held/)
      expect((await gc.drain({ keys: [up1.key] })).deleted).toBe(1);
      expect(await onDisk(up1.key)).toBe(false);
      expect(await onDisk(up1.thumbnailKey)).toBe(false);
      expect(await onDisk(held)).toBe(true);
      // pro dono: a foto sumiu, e held/ nunca aparece
      const me = (await users.me(u.id)) as {
        photos: { id: string; isMain: boolean; orderIndex: number }[];
      };
      expect(me.photos.map((p) => [p.orderIndex, p.isMain])).toEqual([[0, true]]);
      expect(JSON.stringify(me)).not.toContain('held/');
      // apagar de novo: pro dono ela não existe
      expect((await errorOf(users.deletePhoto(u.id, p1.id))).status).toBe(404);

      // denúncia aberta: a soltura não mexe
      const release = jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
      expect(await gc.releaseRetainedPhotos()).toBe(0);
      // encerrada: a linha sai e o gatilho enfileira a cópia privada
      await prisma.report.update({ where: { id: report.id }, data: { status: closeAs } });
      expect(await gc.releaseRetainedPhotos()).toBe(1);
      expect(release).toHaveBeenCalledWith([held, held]);
      release.mockRestore();
      expect(await prisma.photo.findUnique({ where: { id: p1.id } })).toBeNull();
      if (closeAs === 'resolved') {
        // fechou com ação: 'urgent' antes de sair → o gatilho guarda o arquivo 180 dias
        expect(offsetFromNow((await mediaRow(held))!.delete_after, 180)).toBeLessThan(60);
        expect((await gc.drain({ keys: [held] })).leased).toBe(0);
        expect(await onDisk(held)).toBe(true);
        await dueNow(held);
      }
      expect((await gc.drain({ keys: [held] })).deleted).toBe(1);
      expect(await onDisk(held)).toBe(false);
      // a outra continua no ar
      expect(await onDisk(up2.key)).toBe(true);
    }
  });

  it('conta banida com a denúncia dispensada: a retida também ganha os 180 dias', async () => {
    const u = await newUser(prisma, 'Banida');
    const reporter = await newUser(prisma, 'Quem denunciou');
    const p = await users.addPhoto(u.id, { key: (await upload(u.id)).key });
    await users.addPhoto(u.id, { key: (await upload(u.id)).key });
    const report = await prisma.report.create({
      data: { reporterId: reporter.id, reportedId: u.id, reason: 'underage', status: 'pending' },
    });
    await users.deletePhoto(u.id, p.id);
    const held = (await prisma.photo.findUniqueOrThrow({ where: { id: p.id } })).url;
    expect(held).toMatch(/^held\//);
    await prisma.report.update({ where: { id: report.id }, data: { status: 'dismissed' } });
    await prisma.user.update({ where: { id: u.id }, data: { accountStatus: 'banned' } });
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    expect(await gc.releaseRetainedPhotos()).toBe(1);
    expect(offsetFromNow((await mediaRow(held))!.delete_after, 180)).toBeLessThan(60);
  });

  it('cópia privada não deu na hora (storage fora): retém no lugar; o cron move pra held/ e a pública sai', async () => {
    const u = await newUser(prisma, 'Alvo');
    const reporter = await newUser(prisma, 'Quem denunciou');
    const up = await upload(u.id);
    const p = await users.addPhoto(u.id, { key: up.key });
    await prisma.report.create({
      data: {
        reporterId: reporter.id,
        reportedId: u.id,
        reason: 'child_safety',
        status: 'pending',
      },
    });
    // PUT em held/ quebrado só no apagar
    const broken: ObjectStorage = {
      driver: 'local',
      get: (k) => storage.get(k),
      exists: (k) => storage.exists(k),
      delete: (k) => storage.delete(k),
      put: async (k, b, t) => {
        if (k.startsWith('held/')) throw new Error('storage fora');
        return storage.put(k, b, t);
      },
    };
    await usersWith(broken).deletePhoto(u.id, p.id);
    const kept = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    expect(isRetainedPhoto(kept.moderationLabels)).toBe(true);
    expect(kept.url).toBe(up.key);
    expect(await onDisk(up.key)).toBe(true);

    // cron: copia, troca a linha e manda a pública pro GC (com a denúncia ainda aberta)
    const moveKick = jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    expect(await gc.moveRetainedToHeld()).toBe(1);
    const moved = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    expect(moved.url).toMatch(/^held\//);
    expect(moveKick).toHaveBeenCalledWith([up.key, up.thumbnailKey]);
    moveKick.mockRestore();
    expect((await gc.drain({ keys: [up.key] })).deleted).toBe(1);
    expect(await onDisk(up.key)).toBe(false);
    expect(await onDisk(moved.url)).toBe(true);
    // rodar de novo não faz nada (já está em held/)
    expect(await gc.moveRetainedToHeld()).toBe(0);
  });

  it('retida legada (URL /uploads/ absoluta, de antes da held/): o cron move; fakes/ fica onde está', async () => {
    const u = await newUser(prisma, 'Alvo');
    const legacy = uuidKey(30, 'png');
    await storage.put(legacy, await jpeg(), 'image/png');
    const mark = {
      retainedByReport: { at: new Date().toISOString(), prevStatus: 'approved', wasMain: false },
    };
    const a = await insertPhoto(u.id, `http://192.168.0.9:3000/uploads/${legacy}`, null, {
      status: 'rejected',
      orderIndex: -1,
      moderationLabels: mark,
    });
    const f = await insertPhoto(u.id, 'fakes/fake-1.jpg', null, {
      status: 'rejected',
      orderIndex: -2,
      moderationLabels: mark,
    });
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    expect(await gc.moveRetainedToHeld()).toBe(1);
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.url).toMatch(/^held\/[0-9a-f-]{36}\.png$/);
    expect(await onDisk(row.url)).toBe(true);
    const [pub] = await prisma.$queryRaw<{ moved_to: string }[]>`
      SELECT moved_to FROM media_objects WHERE key = ${legacy}`;
    expect(pub.moved_to).toBe(row.url);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: f.id } })).url).toBe(
      'fakes/fake-1.jpg',
    );
  });

  it('gatilho: apagar a linha da retida (limpeza da conta, script) põe a cópia held/ na fila (kind held)', async () => {
    const u = await newUser(prisma, 'Ana');
    const held = `held/${uuidKey(31)}`;
    await prisma.$executeRaw`
      INSERT INTO media_objects (key, owner_id, kind, attached_at) VALUES (${held}, ${u.id}::uuid, 'held', now())`;
    const p = await insertPhoto(u.id, held, held, {
      status: 'rejected',
      orderIndex: -1,
      moderationLabels: { urgent: true, retainedByReport: { at: '', prevStatus: 'approved' } },
    });
    await prisma.photo.delete({ where: { id: p.id } });
    const m = await mediaRow(held);
    expect(m).toMatchObject({ attached_at: null, thumb_key: null });
    expect(offsetFromNow(m!.delete_after, 180)).toBeLessThan(60);
    // sem linha prévia (linha órfã do passado): entra como 'held'
    const held2 = `held/${uuidKey(32)}`;
    const p2 = await insertPhoto(u.id, held2, null, { orderIndex: -2 });
    await prisma.photo.delete({ where: { id: p2.id } });
    const [{ kind }] = await prisma.$queryRaw<{ kind: string }[]>`
      SELECT kind FROM media_objects WHERE key = ${held2}`;
    expect(kind).toBe('held');
  });

  it('foto apagada por outro caminho (script, cascade) com denúncia underage/child_safety aberta: o GC segura 30 dias; encerrada, sai', async () => {
    for (const reason of ['underage', 'child_safety']) {
      const u = await newUser(prisma, `Alvo ${reason}`);
      const reporter = await newUser(prisma, `Quem denunciou ${reason}`);
      const up = await upload(u.id);
      const photo = await users.addPhoto(u.id, { key: up.key });
      const report = await prisma.report.create({
        data: { reporterId: reporter.id, reportedId: u.id, reason, status: 'reviewing' },
      });
      await prisma.photo.delete({ where: { id: photo.id } });

      const r = await gc.drain({ keys: [up.key] });
      expect(r).toMatchObject({ held: 1, deleted: 0 });
      expect(await onDisk(up.key)).toBe(true);
      expect(offsetFromNow((await mediaRow(up.key))!.delete_after, 30)).toBeLessThan(60);

      await prisma.report.update({ where: { id: report.id }, data: { status: 'resolved' } });
      await dueNow(up.key);
      expect((await gc.drain({ keys: [up.key] })).deleted).toBe(1);
      expect(await onDisk(up.key)).toBe(false);
    }
  });

  it('denúncia aberta por outro motivo (spam) não segura', async () => {
    const u = await newUser(prisma, 'Ana');
    const reporter = await newUser(prisma, 'Bia');
    const up = await upload(u.id);
    const photo = await users.addPhoto(u.id, { key: up.key });
    await prisma.report.create({
      data: { reporterId: reporter.id, reportedId: u.id, reason: 'spam', status: 'pending' },
    });
    await users.deletePhoto(u.id, photo.id);
    expect((await gc.drain({ keys: [up.key] })).deleted).toBe(1);
  });

  it('arquivo citado numa denúncia (evidence_urls) ou na selfie de verificação: segura e confere de novo', async () => {
    const u = await newUser(prisma, 'Ana');
    const outro = await newUser(prisma, 'Bia');
    const up1 = await upload(u.id);
    const up2 = await upload(u.id);
    const p1 = await users.addPhoto(u.id, { key: up1.key });
    const p2 = await users.addPhoto(u.id, { key: up2.key });
    await prisma.report.create({
      data: {
        reporterId: u.id,
        reportedId: outro.id,
        reason: 'spam',
        status: 'resolved',
        evidenceUrls: [`http://10.0.0.2:3000/uploads/${up1.key}`],
      },
    });
    await prisma.$executeRaw`UPDATE users SET verification_selfie_url = ${up2.url} WHERE id = ${outro.id}::uuid`;
    await users.deletePhoto(u.id, p1.id);
    await users.deletePhoto(u.id, p2.id);

    const r = await gc.drain({ keys: [up1.key, up2.key] });
    expect(r).toMatchObject({ held: 2, deleted: 0, reattached: 0 });
    expect(await onDisk(up1.key)).toBe(true);
    expect(await onDisk(up2.key)).toBe(true);
    // nunca reanexa: continua na fila, pra sair quando a citação sumir
    expect((await mediaRow(up1.key))!.attached_at).toBeNull();

    await prisma.$executeRaw`UPDATE users SET verification_selfie_url = NULL WHERE id = ${outro.id}::uuid`;
    await dueNow(up2.key);
    expect((await gc.drain({ keys: [up2.key] })).deleted).toBe(1);
  });

  it('chave ainda usada por outra linha de photos (legado duplicado): reanexa e não apaga', async () => {
    const u = await newUser(prisma, 'Ana');
    const legacy = uuidKey(10);
    await storage.put(legacy, await jpeg(), 'image/jpeg');
    const a = await insertPhoto(u.id, `http://127.0.0.1:3000/uploads/${legacy}`, null);
    await insertPhoto(u.id, legacy, null, { orderIndex: 1 });
    await prisma.photo.delete({ where: { id: a.id } });

    const r = await gc.drain({ keys: [legacy] });
    expect(r).toMatchObject({ reattached: 1, deleted: 0 });
    expect(await onDisk(legacy)).toBe(true);
    const m = await mediaRow(legacy);
    expect(m!.attached_at).not.toBeNull();
    expect(m!.delete_after).toBeNull();
  });
});

describe('foto retida ainda na chave pública × soltura (cron de hora em hora)', () => {
  /** retida que ficou na chave pública (a cópia privada não deu na hora do apagar) */
  async function retainedOnPublic(reason: 'underage' | 'child_safety' = 'underage') {
    const u = await newUser(prisma, 'Alvo');
    const reporter = await newUser(prisma, 'Quem denunciou');
    const up = await upload(u.id);
    const p = await users.addPhoto(u.id, { key: up.key });
    await users.addPhoto(u.id, { key: (await upload(u.id)).key });
    const report = await prisma.report.create({
      data: { reporterId: reporter.id, reportedId: u.id, reason, status: 'pending' },
    });
    await usersWith(brokenHeldPut()).deletePhoto(u.id, p.id);
    const kept = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    expect(isRetainedPhoto(kept.moderationLabels)).toBe(true);
    expect(kept.url).toBe(up.key);
    return { u, up, photoId: p.id, reportId: report.id };
  }

  it('fechou COM ação: só sai depois de ir pra held/ (a pública não fica 180 dias no ar); o cron move e solta na mesma rodada', async () => {
    const { u, up, photoId, reportId } = await retainedOnPublic();
    await prisma.report.update({ where: { id: reportId }, data: { status: 'resolved' } });
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    // cópia privada órfã da tentativa que falhou no apagar (sai sozinha em 1 h): fora da conta abaixo
    const orphans = (
      await prisma.$queryRaw<{ key: string }[]>`
        SELECT key FROM media_objects WHERE owner_id = ${u.id}::uuid AND kind = 'held'`
    ).map((r) => r.key);

    // soltura sozinha: espera (ainda na chave pública)
    expect(await gc.releaseRetainedPhotos()).toBe(0);
    expect(await prisma.photo.findUnique({ where: { id: photoId } })).not.toBeNull();
    // a pública nem entrou na fila (segue anexada à linha retida)
    expect(await mediaRow(up.key)).toMatchObject({ delete_after: null });

    // cron: move pra held/ PRIMEIRO e solta DEPOIS
    await new MediaGcTask(gc).releaseRetained();
    expect(await prisma.photo.findUnique({ where: { id: photoId } })).toBeNull();
    const helds = await prisma.$queryRaw<{ key: string; delete_after: Date }[]>`
      SELECT key, delete_after FROM media_objects
       WHERE owner_id = ${u.id}::uuid AND kind = 'held' AND attached_at IS NULL
         AND NOT (key = ANY(${orphans}::text[]))`;
    expect(helds).toHaveLength(1);
    const [held] = helds;
    expect(held.key).toMatch(/^held\//);
    // a prova fica 180 dias na cópia privada; a pública sai já
    expect(offsetFromNow(held.delete_after, 180)).toBeLessThan(60);
    expect(await onDisk(held.key)).toBe(true);
    const [pub] = await prisma.$queryRaw<{ moved_to: string; delete_after: Date }[]>`
      SELECT moved_to, delete_after FROM media_objects WHERE key = ${up.key}`;
    expect(pub.moved_to).toBe(held.key);
    expect(pub.delete_after.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await gc.drain({ keys: [up.key] })).deleted).toBe(1);
    expect(await onDisk(up.key)).toBe(false);
  });

  it('dispensada (sem ação): sai na hora mesmo na chave pública (o arquivo não fica guardado)', async () => {
    const { up, photoId, reportId } = await retainedOnPublic('child_safety');
    await prisma.report.update({ where: { id: reportId }, data: { status: 'dismissed' } });
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    expect(await gc.releaseRetainedPhotos()).toBe(1);
    expect(await prisma.photo.findUnique({ where: { id: photoId } })).toBeNull();
    expect(offsetFromNow((await mediaRow(up.key))!.delete_after, 0)).toBeLessThan(60);
  });

  it('cron de mover: arquivo sumido ganha marca definitiva; storage fora fica de fora até o backoff e tenta de novo', async () => {
    const u = await newUser(prisma, 'Alvo');
    const gone = `p/${uuidKey(60)}`;
    const flaky = `p/${uuidKey(61)}`;
    await storage.put(flaky, await jpeg(), 'image/jpeg');
    const a = await insertPhoto(u.id, gone, null, {
      status: 'rejected',
      orderIndex: -1,
      moderationLabels: retainedMark(),
    });
    const b = await insertPhoto(u.id, flaky, null, {
      status: 'rejected',
      orderIndex: -2,
      moderationLabels: retainedMark(),
    });
    const broken = brokenHeldPut();
    const put = jest.spyOn(broken, 'put');
    const brokenGc = new MediaGcService(db, broken, 'on');
    brokenGc.kick = jest.fn();

    const t0 = new Date();
    expect(await brokenGc.moveRetainedToHeld(50, t0)).toBe(0);
    // sumido: marca definitiva, o resto da marca fica
    expect((await labelsOf(a.id)).retainedByReport).toMatchObject({
      prevStatus: 'approved',
      moveAttempts: 1,
      moveFinal: 'missing',
    });
    // storage fora: 1ª tentativa, volta em 30 min
    const mb = (await labelsOf(b.id)).retainedByReport!;
    expect(mb).toMatchObject({
      prevStatus: 'approved',
      moveAttempts: 1,
      moveRetryAt: new Date(t0.getTime() + 30 * 60_000).toISOString(),
    });
    expect(String(mb.moveError)).toContain('storage fora');
    expect(put).toHaveBeenCalledTimes(1);

    // dentro do backoff: nem tenta (nenhum PUT), e a sumida nunca mais entra no lote
    put.mockClear();
    expect(await brokenGc.moveRetainedToHeld(50, new Date(t0.getTime() + 10 * 60_000))).toBe(0);
    expect(put).not.toHaveBeenCalled();
    // 2ª falha depois do prazo: dobra (1 h)
    const t1 = new Date(t0.getTime() + 31 * 60_000);
    expect(await brokenGc.moveRetainedToHeld(50, t1)).toBe(0);
    expect((await labelsOf(b.id)).retainedByReport).toMatchObject({
      moveAttempts: 2,
      moveRetryAt: new Date(t1.getTime() + 60 * 60_000).toISOString(),
    });

    // storage de volta, passado o prazo: move (a sumida continua de fora)
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    expect(await gc.moveRetainedToHeld(50, new Date(t1.getTime() + 61 * 60_000))).toBe(1);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: b.id } })).url).toMatch(/^held\//);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: a.id } })).url).toBe(gone);

    // conta banida: a sumida (marca definitiva) sai mesmo na chave pública — não há arquivo pra proteger
    await prisma.user.update({ where: { id: u.id }, data: { accountStatus: 'banned' } });
    expect(await gc.releaseRetainedPhotos()).toBe(2);
    expect(await prisma.photo.count({ where: { userId: u.id } })).toBe(0);
  });

  it('original sumido com a miniatura pública no storage: a miniatura vai pra held/ antes da marca definitiva (não fica 180 dias aberta)', async () => {
    const u = await newUser(prisma, 'Alvo');
    const reporter = await newUser(prisma, 'Quem denunciou');
    const gone = `p/${uuidKey(70)}`;
    const thumbKey = `p/${uuidKey(70).replace('.jpg', '-t.jpg')}`;
    const thumbBytes = await jpeg(40, 30);
    await storage.put(thumbKey, thumbBytes, 'image/jpeg');
    const p = await insertPhoto(u.id, gone, thumbKey, {
      status: 'rejected',
      orderIndex: -1,
      moderationLabels: retainedMark(),
    });
    const report = await prisma.report.create({
      data: { reporterId: reporter.id, reportedId: u.id, reason: 'underage', status: 'pending' },
    });

    // storage fora no PUT da held/: falha passageira (backoff), NUNCA a marca definitiva com a miniatura no ar
    const brokenGc = new MediaGcService(db, brokenHeldPut(), 'on');
    brokenGc.kick = jest.fn();
    const t0 = new Date();
    expect(await brokenGc.moveRetainedToHeld(50, t0)).toBe(0);
    const m0 = (await labelsOf(p.id)).retainedByReport!;
    expect(m0).toMatchObject({
      moveAttempts: 1,
      moveRetryAt: new Date(t0.getTime() + 30 * 60_000).toISOString(),
    });
    expect(m0).not.toHaveProperty('moveFinal');
    // denúncia resolvida (fechou com ação): a soltura espera a miniatura ir pra held/
    await prisma.report.update({ where: { id: report.id }, data: { status: 'resolved' } });
    const kick = jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    expect(await gc.releaseRetainedPhotos()).toBe(0);
    expect(await prisma.photo.findUnique({ where: { id: p.id } })).not.toBeNull();

    // storage de volta, passado o backoff: a miniatura vira a cópia privada e a linha troca
    expect(await gc.moveRetainedToHeld(50, new Date(t0.getTime() + 31 * 60_000))).toBe(1);
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.url).toMatch(/^held\/[0-9a-f-]{36}\.jpg$/);
    expect(row.thumbnailUrl).toBe(row.url);
    expect((await storage.get(row.url))!.equals(thumbBytes)).toBe(true);
    expect((await labelsOf(p.id)).retainedByReport).toMatchObject({
      prevStatus: 'approved',
      heldFrom: 'thumbnail',
      moveFinal: 'missing',
    });
    // original (sumido) + miniatura pública na fila com moved_to, pro GC na hora
    expect(kick).toHaveBeenCalledWith([gone, thumbKey]);
    const [pub] = await prisma.$queryRaw<{ moved_to: string; thumb_key: string }[]>`
      SELECT moved_to, thumb_key FROM media_objects WHERE key = ${gone}`;
    expect(pub).toEqual({ moved_to: row.url, thumb_key: thumbKey });
    expect((await gc.drain({ keys: [gone] })).deleted).toBe(1);
    expect(await onDisk(thumbKey)).toBe(false);
    expect(await onDisk(row.url)).toBe(true);

    // agora a soltura sai com 'urgent': a prova fica 180 dias só na cópia privada
    expect(await gc.releaseRetainedPhotos()).toBe(1);
    expect(offsetFromNow((await mediaRow(row.url))!.delete_after, 180)).toBeLessThan(60);
    expect(await onDisk(thumbKey)).toBe(false);
  });

  it('original e miniatura sumidos: marca definitiva (sem arquivo não há o que proteger)', async () => {
    const u = await newUser(prisma, 'Alvo');
    const gone = `p/${uuidKey(71)}`;
    const goneThumb = `p/${uuidKey(71).replace('.jpg', '-t.jpg')}`;
    const p = await insertPhoto(u.id, gone, goneThumb, {
      status: 'rejected',
      orderIndex: -1,
      moderationLabels: retainedMark(),
    });
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    expect(await gc.moveRetainedToHeld()).toBe(0);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: p.id } })).url).toBe(gone);
    const mark = (await labelsOf(p.id)).retainedByReport!;
    expect(mark).toMatchObject({ moveAttempts: 1, moveFinal: 'missing' });
    expect(mark).not.toHaveProperty('heldFrom');
  });

  it('erro do storage ao conferir a cópia privada: falha com backoff curto (não segura 30 dias com a pública no ar)', async () => {
    const u = await newUser(prisma, 'Alvo');
    const reporter = await newUser(prisma, 'Quem denunciou');
    const up = await upload(u.id);
    const p = await users.addPhoto(u.id, { key: up.key });
    await prisma.report.create({
      data: { reporterId: reporter.id, reportedId: u.id, reason: 'underage', status: 'pending' },
    });
    await users.deletePhoto(u.id, p.id);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: p.id } })).url).toMatch(/^held\//);

    const headDown: ObjectStorage = {
      driver: 'local',
      get: (k) => storage.get(k),
      put: (k, b, t) => storage.put(k, b, t),
      delete: (k) => storage.delete(k),
      exists: async (k) => {
        if (k.startsWith('held/')) throw new Error('HEAD 503');
        return storage.exists(k);
      },
    };
    const r = await new MediaGcService(db, headDown, 'on').drain({ keys: [up.key] });
    expect(r).toMatchObject({ failed: 1, held: 0, deleted: 0 });
    const m = (await mediaRow(up.key))!;
    // lease: 10 min (1ª tentativa), não 30 dias
    expect(m.delete_attempts).toBe(1);
    expect(offsetFromNow(m.delete_after, 10 / 1440)).toBeLessThan(60);
    expect(await onDisk(up.key)).toBe(true);

    // storage de volta: a pública sai (a prova está em held/)
    await dueNow(up.key);
    expect((await gc.drain({ keys: [up.key] })).deleted).toBe(1);
    expect(await onDisk(up.key)).toBe(false);
  });
});

describe('referências fora de photos (selfie, capa, evidence_urls) por igualdade', () => {
  it('acha a chave crua, a URL da base atual e o legado /uploads/ de qualquer host', async () => {
    const u = await newUser(prisma, 'Ana');
    const outro = await newUser(prisma, 'Bia');
    const k = (n: number) => `p/${uuidKey(n)}`;
    await prisma.report.create({
      data: {
        reporterId: u.id,
        reportedId: outro.id,
        reason: 'spam',
        evidenceUrls: [k(40), `${BASE}/${k(41)}`, `http://10.0.0.2:3000/uploads/${k(42)}`, 7, null],
      },
    });
    // evidence_urls que não é lista não quebra a consulta
    await prisma.report.create({
      data: { reporterId: u.id, reportedId: outro.id, reason: 'spam', evidenceUrls: { x: k(49) } },
    });
    await prisma.$executeRaw`UPDATE users SET verification_selfie_url = ${`http://192.168.0.9:3000/uploads/${k(43)}`} WHERE id = ${outro.id}::uuid`;
    await prisma.event.create({
      data: {
        title: 'Show',
        category: 'show',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
        latitude: -18.9,
        longitude: -48.2,
        coverUrl: `${BASE}/${k(44)}`,
      },
    });

    const refs = await gc.references([k(40), k(41), k(42), k(43), k(44), k(45), k(49)]);
    expect([...refs.elsewhere].sort()).toEqual([k(40), k(41), k(42), k(43), k(44)].sort());
    expect(refs.inPhotos.size).toBe(0);
  });

  it('o índice entra (EXPLAIN): selfie e capa pela chave normalizada, evidence_urls pelo GIN', async () => {
    // tabela vazia: o planejador prefere qualquer índice parcial pequeno. Sem seqscan e sem o concorrente (DROP numa
    // transação desfeita no fim), só sobra o índice de expressão — se a expressão não batesse, viria Seq Scan
    class Rollback extends Error {}
    const plan = async (sql: string, without: string) => {
      let out = '';
      await prisma
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
          await tx.$executeRawUnsafe(`DROP INDEX ${without}`);
          const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`);
          out = rows.map((r) => r['QUERY PLAN']).join('\n');
          throw new Rollback();
        })
        .catch((e) => {
          if (!(e instanceof Rollback)) throw e;
        });
      return out;
    };
    const re = `'^https?://[^/]+/uploads/'`;
    const selfie = await plan(
      `SELECT 1 FROM users u WHERE u.verification_selfie_url IS NOT NULL AND regexp_replace(u.verification_selfie_url, ${re}, '') = ANY(ARRAY['p/x.jpg'])`,
      'users_verification_selfie_url_idx',
    );
    expect(selfie).toContain('users_selfie_key_norm_idx');
    expect(selfie).not.toContain('Seq Scan');
    const cover = await plan(
      `SELECT 1 FROM events e WHERE e.cover_url IS NOT NULL AND regexp_replace(e.cover_url, ${re}, '') = ANY(ARRAY['p/x.jpg'])`,
      'events_cover_url_idx',
    );
    expect(cover).toContain('events_cover_key_norm_idx');
    expect(cover).not.toContain('Seq Scan');
    const evidence = await plan(
      `SELECT 1 FROM reports rp WHERE rp.evidence_urls IS NOT NULL AND media_ref_keys(rp.evidence_urls) && ARRAY['p/x.jpg']`,
      'reports_evidence_urls_idx',
    );
    expect(evidence).toContain('reports_evidence_keys_idx');
    expect(evidence).not.toContain('Seq Scan');
    // os índices continuam lá (a transação foi desfeita)
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_indexes
       WHERE indexname IN ('users_verification_selfie_url_idx', 'events_cover_url_idx', 'reports_evidence_urls_idx')`;
    expect(n).toBe(3);
  });

  it('media_ref_keys: cada item cru e normalizado; o que não é lista vira vazio', async () => {
    const [r] = await prisma.$queryRaw<{ a: string[]; b: string[]; c: string[] }[]>`
      SELECT media_ref_keys('["p/a.jpg", "http://h:3000/uploads/p/b.jpg"]'::jsonb) AS a,
             media_ref_keys('{"x": 1}'::jsonb) AS b,
             media_ref_keys(NULL) AS c`;
    expect(r.a.sort()).toEqual(['http://h:3000/uploads/p/b.jpg', 'p/a.jpg', 'p/b.jpg']);
    expect(r.b).toEqual([]);
    expect(r.c).toEqual([]);
  });
});

describe('GC — fila', () => {
  it('upload nunca anexado: depois de 24 h o GC apaga os arquivos e a linha', async () => {
    const u = await newUser(prisma, 'Ana');
    const up = await upload(u.id);
    expect((await gc.drain()).leased).toBe(0);
    await age(up.key, 25);
    expect((await gc.drain()).deleted).toBe(1);
    expect(await onDisk(up.key)).toBe(false);
    expect(await onDisk(up.thumbnailKey)).toBe(false);
    expect(await mediaRow(up.key)).toBeUndefined();
  });

  it('modo dry: nada sai do storage e a linha volta em 1 dia', async () => {
    const u = await newUser(prisma, 'Ana');
    const up = await upload(u.id);
    await age(up.key, 25);
    const r = await new MediaGcService(db, storage, 'dry').drain();
    expect(r).toMatchObject({ leased: 1, dry: 1, deleted: 0 });
    expect(await onDisk(up.key)).toBe(true);
    expect(offsetFromNow((await mediaRow(up.key))!.delete_after, 1)).toBeLessThan(60);
  });

  it('chave que não é nossa na fila (fakes/): some da fila sem tocar no arquivo', async () => {
    await storage.put('fakes/fake-1.jpg', await jpeg(), 'image/jpeg');
    await prisma.$executeRaw`INSERT INTO media_objects (key, kind, delete_after) VALUES ('fakes/fake-1.jpg', 'photo', now())`;
    expect((await gc.drain()).forgotten).toBe(1);
    expect(await onDisk('fakes/fake-1.jpg')).toBe(true);
    expect(await mediaRow('fakes/fake-1.jpg')).toBeUndefined();
  });

  it('dois GCs ao mesmo tempo nunca pegam a mesma linha (lease com SKIP LOCKED)', async () => {
    const u = await newUser(prisma, 'Ana');
    const keys: string[] = [];
    for (let i = 0; i < 8; i++) {
      const up = await upload(u.id);
      await age(up.key, 25);
      keys.push(up.key);
    }
    const other = new MediaGcService(db, storage, 'on');
    const [r1, r2] = await Promise.all([gc.drain({ limit: 5 }), other.drain({ limit: 5 })]);
    expect(r1.leased + r2.leased).toBe(8);
    expect(r1.deleted + r2.deleted).toBe(8);
    expect(r1.failed + r2.failed).toBe(0);
    for (const k of keys) expect(await onDisk(k)).toBe(false);
  });

  it('lease adia o item (falha de storage tenta de novo mais tarde, com backoff)', async () => {
    const u = await newUser(prisma, 'Ana');
    const up = await upload(u.id);
    await age(up.key, 25);
    const broken = {
      ...storage,
      driver: 'local' as const,
      delete: jest.fn(async () => Promise.reject(new Error('disco travado'))),
    };
    const r = await new MediaGcService(db, broken as unknown as LocalObjectStorage, 'on').drain();
    expect(r.failed).toBe(1);
    const m = await mediaRow(up.key);
    expect(m!.delete_attempts).toBe(1);
    expect(offsetFromNow(m!.delete_after, 10 / 1440)).toBeLessThan(60); // 10 min
    const [{ last_error }] = await prisma.$queryRaw<
      { last_error: string }[]
    >`SELECT last_error FROM media_objects WHERE key = ${up.key}`;
    expect(last_error).toBe('disco travado');
  });
});

describe('limpeza da conta (releaseUser)', () => {
  it("apaga as fotos menos as guardadas, vence os uploads soltos e não encurta a retenção do 'urgent'", async () => {
    // o GC roda na mão no fim (sem corrida com o kick do releaseUser)
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    const u = await newUser(prisma, 'Ana');
    const [a, b, c, solto] = [
      await upload(u.id),
      await upload(u.id),
      await upload(u.id),
      await upload(u.id),
    ];
    await users.addPhoto(u.id, { key: a.key });
    const pb = await users.addPhoto(u.id, { key: b.key });
    const pc = await users.addPhoto(u.id, { key: c.key });
    await prisma.$executeRaw`UPDATE photos SET moderation_labels = '{"urgent":true}'::jsonb WHERE id = ${pc.id}::uuid`;
    // urgent antigo, já na fila: o vencimento de upload solto não pode mexer nele
    const antigo = await upload(u.id);
    const pAntigo = await users.addPhoto(u.id, { key: antigo.key });
    await prisma.$executeRaw`UPDATE photos SET moderation_labels = '{"urgent":true}'::jsonb WHERE id = ${pAntigo.id}::uuid`;
    await users.deletePhoto(u.id, pAntigo.id);

    const keys = await gc.releaseUser(u.id, { keepPhotoIds: [pb.id] });
    expect(keys.sort()).toEqual([a.key, a.thumbnailKey, c.key, c.thumbnailKey, solto.key].sort());
    expect((await prisma.photo.findMany({ where: { userId: u.id } })).map((p) => p.id)).toEqual([
      pb.id,
    ]);
    expect(offsetFromNow((await mediaRow(c.key))!.delete_after, 180)).toBeLessThan(60);
    expect(offsetFromNow((await mediaRow(antigo.key))!.delete_after, 180)).toBeLessThan(60);

    expect(gc.kick).toHaveBeenCalledWith(keys);
    await gc.drain();
    expect(await onDisk(a.key)).toBe(false);
    expect(await onDisk(solto.key)).toBe(false);
    expect(await onDisk(b.key)).toBe(true); // guardada (citada em denúncia)
    expect(await onDisk(c.key)).toBe(true); // urgent: 180 dias
    expect(await onDisk(antigo.key)).toBe(true);
  });

  it("retida em held/: fechou com ação (banida ou denúncia resolvida) ganha 'urgent' e fica 180 dias; dispensada sai já", async () => {
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    const cases = [
      { name: 'banida, denúncia dispensada', close: 'dismissed', ban: true, days: 180 },
      { name: 'denúncia de menor resolvida', close: 'resolved', ban: false, days: 180 },
      { name: 'denúncia dispensada', close: 'dismissed', ban: false, days: 0 },
    ] as const;
    for (const c of cases) {
      const u = await newUser(prisma, `Alvo ${c.name}`);
      const reporter = await newUser(prisma, `Quem denunciou ${c.name}`);
      const p = await users.addPhoto(u.id, { key: (await upload(u.id)).key });
      const report = await prisma.report.create({
        data: { reporterId: reporter.id, reportedId: u.id, reason: 'underage', status: 'pending' },
      });
      await users.deletePhoto(u.id, p.id);
      const held = (await prisma.photo.findUniqueOrThrow({ where: { id: p.id } })).url;
      expect(held).toMatch(/^held\//);
      await prisma.report.update({ where: { id: report.id }, data: { status: c.close } });
      if (c.ban)
        await prisma.user.update({ where: { id: u.id }, data: { accountStatus: 'banned' } });

      const keys = await gc.releaseUser(u.id);
      expect(keys).toContain(held);
      expect(await prisma.photo.count({ where: { userId: u.id } })).toBe(0);
      expect(offsetFromNow((await mediaRow(held))!.delete_after, c.days)).toBeLessThan(60);
    }
  });

  it('retida que fechou com ação ainda na chave pública: a linha fica pro cron mover e soltar (a pública não fica 180 dias no ar)', async () => {
    jest.spyOn(gc, 'kick').mockImplementation(() => undefined);
    const u = await newUser(prisma, 'Alvo');
    const reporter = await newUser(prisma, 'Quem denunciou');
    const up = await upload(u.id);
    const p = await users.addPhoto(u.id, { key: up.key });
    const other = await upload(u.id);
    await users.addPhoto(u.id, { key: other.key });
    const report = await prisma.report.create({
      data: {
        reporterId: reporter.id,
        reportedId: u.id,
        reason: 'child_safety',
        status: 'pending',
      },
    });
    await usersWith(brokenHeldPut()).deletePhoto(u.id, p.id);
    await prisma.report.update({ where: { id: report.id }, data: { status: 'resolved' } });

    const keys = await gc.releaseUser(u.id);
    // a outra foto sai; a retida fica (com 'urgent' já marcado) e a chave pública nem entra na fila
    expect(keys).toContain(other.key);
    expect(keys).not.toContain(up.key);
    const kept = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    expect(kept.url).toBe(up.key);
    expect(kept.moderationLabels).toMatchObject({ urgent: true });
    expect(await mediaRow(up.key)).toMatchObject({ delete_after: null });

    // cron: move pra held/ e solta com os 180 dias na cópia privada; a pública sai já
    await new MediaGcTask(gc).releaseRetained();
    expect(await prisma.photo.count({ where: { userId: u.id } })).toBe(0);
    const [pub] = await prisma.$queryRaw<{ moved_to: string }[]>`
      SELECT moved_to FROM media_objects WHERE key = ${up.key}`;
    expect(pub.moved_to).toMatch(/^held\//);
    expect(offsetFromNow((await mediaRow(pub.moved_to))!.delete_after, 180)).toBeLessThan(60);
    expect((await gc.drain({ keys: [up.key] })).deleted).toBe(1);
    expect(await onDisk(up.key)).toBe(false);
    expect(await onDisk(pub.moved_to)).toBe(true);
  });
});

describe('backfill das fotos antigas (pnpm photos:reprocess)', () => {
  it('foto legada com EXIF (PNG com nome .jpg): vira p/<uuid>.jpg sem metadado, o antigo vai pro GC com folga; idempotente', async () => {
    const u = await newUser(prisma, 'Ana');
    const legacy = uuidKey(20, 'jpg');
    const legacyThumb = uuidKey(20).replace('.jpg', '-t.jpg');
    const png = await sharp({
      create: { width: 200, height: 150, channels: 3, background: '#4a4' },
    })
      .png()
      .withExif({ IFD3: { GPSMapDatum: 'GPS-SECRETO' } })
      .toBuffer();
    await storage.put(legacy, png, 'image/jpeg');
    await storage.put(legacyThumb, await jpeg(), 'image/jpeg');
    const p = await insertPhoto(u.id, legacy, legacyThumb);

    const dry = await reprocessLegacyPhotos({ db: prisma, storage }, { dryRun: true });
    expect(dry).toMatchObject({ legacy: 1, dry: 1, reprocessed: 0 });
    expect((await prisma.photo.findUnique({ where: { id: p.id } }))!.url).toBe(legacy);

    const r = await reprocessLegacyPhotos({ db: prisma, storage });
    expect(r).toMatchObject({ legacy: 1, reprocessed: 1, failed: 0, missing: 0 });
    const row = await prisma.photo.findUnique({ where: { id: p.id } });
    expect(row!.url).toMatch(/^p\/[0-9a-f-]{36}\.jpg$/);
    expect(row!.thumbnailUrl).toBe(row!.url.replace('.jpg', '-t.jpg'));
    const meta = await sharp((await storage.get(row!.url))!).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    // a nova está anexada; as antigas na fila, com a folga de 24 h
    expect((await mediaRow(row!.url))!.attached_at).not.toBeNull();
    expect(offsetFromNow((await mediaRow(legacy))!.delete_after, 1)).toBeLessThan(60);
    expect(offsetFromNow((await mediaRow(legacyThumb))!.delete_after, 1)).toBeLessThan(60);
    expect(await onDisk(legacy)).toBe(true);

    expect(await reprocessLegacyPhotos({ db: prisma, storage })).toMatchObject({ legacy: 0 });
    // vencida a folga, o GC apaga o antigo (ninguém mais aponta pra ele)
    await dueNow(legacy);
    expect((await gc.drain({ keys: [legacy] })).deleted).toBe(1);
    expect(await onDisk(legacy)).toBe(false);
    expect(await onDisk(row!.url)).toBe(true);
  });
});
