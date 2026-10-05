import sharp from 'sharp';

import { resetPhotoUrlCache } from '../../common/photo-url';
import type { PrismaService } from '../../database/prisma.service';

import { PhotoBusy, PhotoProcessingUnavailable, PhotoRejected } from './image-pipeline';
import type { MediaGcService } from './media-gc.service';
import type { ObjectStorage } from './storage/object-storage';
import { PHOTO_ERROR_MESSAGES, photoHttpError } from './uploads.controller';
import { PhotoStorageUnavailable, UploadsService } from './uploads.service';

// Upload de foto sem banco nem disco: registra em media_objects ANTES de gravar, grava original + miniatura com as
// chaves novas e devolve a URL montada pela base; storage caído vira 503 e o que foi gravado vai pro GC.

const USER = '11111111-2222-4333-8444-555555555555';

function deps(failPut = false) {
  const order: string[] = [];
  const sql: { text: string; values: unknown[] }[] = [];
  const prisma = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      sql.push({ text, values });
      order.push(text.includes('INSERT INTO media_objects') ? 'insert' : 'update');
      return 1;
    }),
  };
  const stored = new Map<string, { body: Buffer; type: string }>();
  const storage = {
    driver: 'local',
    put: jest.fn(async (k: string, body: Buffer, type: string) => {
      order.push(`put:${k.endsWith('-t.jpg') ? 'thumb' : 'main'}`);
      if (failPut && k.endsWith('-t.jpg')) throw new Error(`S3 PUT ${k} → 503`);
      stored.set(k, { body, type });
    }),
    get: jest.fn(),
    exists: jest.fn(),
    delete: jest.fn(),
  };
  const gc = { kick: jest.fn() };
  const svc = new UploadsService(
    prisma as unknown as PrismaService,
    storage as unknown as ObjectStorage,
    gc as unknown as MediaGcService,
  );
  return { svc, prisma, storage, gc, order, sql, stored };
}

beforeAll(() => {
  process.env.STORAGE_PUBLIC_BASE_URL = 'https://fotos.metch.app';
  resetPhotoUrlCache();
});
afterAll(() => {
  delete process.env.STORAGE_PUBLIC_BASE_URL;
  resetPhotoUrlCache();
});

const photo = () =>
  sharp({ create: { width: 120, height: 80, channels: 3, background: '#a33' } })
    .jpeg()
    .withExif({ IFD3: { GPSMapDatum: 'GPS-SECRETO' } })
    .toBuffer();

describe('UploadsService.uploadPhoto', () => {
  it('registra na fila (24 h) antes de gravar, grava original e miniatura reprocessados e devolve chave + URL', async () => {
    const d = deps();
    const r = await d.svc.uploadPhoto(USER, await photo());

    expect(r.key).toMatch(/^p\/[0-9a-f-]{36}\.jpg$/);
    expect(r.thumbnailKey).toBe(r.key.replace('.jpg', '-t.jpg'));
    expect(r.url).toBe(`https://fotos.metch.app/${r.key}`);
    expect(r.thumbnailUrl).toBe(`https://fotos.metch.app/${r.thumbnailKey}`);
    expect(r).toMatchObject({ mimeType: 'image/jpeg', width: 120, height: 80 });

    expect(d.order[0]).toBe('insert');
    expect(d.order.slice(1).sort()).toEqual(['put:main', 'put:thumb']);
    const ins = d.sql[0];
    expect(ins.values.slice(0, 3)).toEqual([r.key, USER, r.thumbnailKey]);
    expect(ins.values[ins.values.length - 1]).toBe(24);

    const main = d.stored.get(r.key)!;
    expect(main.type).toBe('image/jpeg');
    expect(main.body.length).toBe(r.size);
    expect(main.body.includes(Buffer.from('GPS-SECRETO'))).toBe(false);
    expect((await sharp(main.body).metadata()).exif).toBeUndefined();
    expect(d.gc.kick).not.toHaveBeenCalled();
  });

  it('storage caído: PhotoStorageUnavailable, a linha vence na hora e o GC leva o que chegou a gravar', async () => {
    const d = deps(true);
    await expect(d.svc.uploadPhoto(USER, await photo())).rejects.toBeInstanceOf(
      PhotoStorageUnavailable,
    );
    const upd = d.sql.find((s) => s.text.includes('UPDATE media_objects SET delete_after = now()'));
    expect(upd).toBeDefined();
    const key = d.sql[0].values[0];
    expect(upd!.values).toEqual([key]);
    expect(d.gc.kick).toHaveBeenCalledWith([key]);
  });

  it('foto recusada pelo conteúdo: nada entra na fila nem no storage', async () => {
    const d = deps();
    await expect(d.svc.uploadPhoto(USER, Buffer.from('<html>oi</html>'))).rejects.toBeInstanceOf(
      PhotoRejected,
    );
    expect(d.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(d.storage.put).not.toHaveBeenCalled();
  });
});

describe('photoHttpError', () => {
  const body = (e: ReturnType<typeof photoHttpError>) => ({
    status: e?.getStatus(),
    ...(e?.getResponse() as object),
  });

  it('recusa pelo conteúdo: 400 (413 quando é tamanho) com {error, message} pro app', () => {
    expect(body(photoHttpError(new PhotoRejected('photo_invalid', 'x')))).toEqual({
      status: 400,
      error: 'photo_invalid',
      message: PHOTO_ERROR_MESSAGES.photo_invalid,
    });
    expect(body(photoHttpError(new PhotoRejected('photo_unsupported', 'x'))).status).toBe(400);
    expect(body(photoHttpError(new PhotoRejected('photo_too_big', 'x')))).toMatchObject({
      status: 413,
      error: 'photo_too_big',
    });
  });

  it('sem sharp, fila cheia ou storage caído: 503', () => {
    expect(body(photoHttpError(new PhotoProcessingUnavailable()))).toMatchObject({
      status: 503,
      error: 'photo_processing_unavailable',
    });
    expect(body(photoHttpError(new PhotoBusy()))).toMatchObject({
      status: 503,
      error: 'photo_busy',
      message: PHOTO_ERROR_MESSAGES.photo_busy,
    });
    expect(body(photoHttpError(new PhotoStorageUnavailable()))).toMatchObject({
      status: 503,
      error: 'photo_processing_unavailable',
      message: PHOTO_ERROR_MESSAGES.photo_processing_unavailable,
    });
  });

  it('erro desconhecido segue adiante (vira 500 no filtro global)', () => {
    expect(photoHttpError(new Error('x'))).toBeNull();
  });
});
