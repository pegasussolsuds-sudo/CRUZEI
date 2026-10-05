import { parseCliArgs } from '../../database/scripts/photos-reprocess';

import { PhotoRejected, type ProcessedPhoto } from './image-pipeline';
import {
  legacyPlan,
  REPROCESS_GRACE_HOURS,
  reprocessLegacyPhotos,
  URGENT_RETENTION_DAYS,
  type LegacyPhotoRow,
} from './photo-reprocess';
import type { ObjectStorage } from './storage/object-storage';

// Backfill das fotos antigas sem banco: o plano puro (o que é legado) e a orquestração com banco/storage falsos.

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = U(900);

describe('legacyPlan (pura)', () => {
  it('legado na raiz (com miniatura -t.jpg): reprocessa a partir do original e larga os dois', () => {
    expect(legacyPlan({ url: `${U(1)}.png`, thumbnail_url: `${U(1)}-t.jpg` })).toEqual({
      sourceKey: `${U(1)}.png`,
      oldKeys: [`${U(1)}.png`, `${U(1)}-t.jpg`],
    });
  });

  it('miniatura igual ao original ou ausente: uma chave só', () => {
    expect(legacyPlan({ url: `${U(2)}.jpg`, thumbnail_url: `${U(2)}.jpg` })!.oldKeys).toEqual([
      `${U(2)}.jpg`,
    ]);
    expect(legacyPlan({ url: `${U(2)}.jpg`, thumbnail_url: null })!.oldKeys).toEqual([
      `${U(2)}.jpg`,
    ]);
  });

  it('URL absoluta legada /uploads/ de qualquer host conta como legado', () => {
    expect(
      legacyPlan({ url: `http://192.168.0.9:3000/uploads/${U(3)}.jpg`, thumbnail_url: null }),
    ).toEqual({ sourceKey: `${U(3)}.jpg`, oldKeys: [`${U(3)}.jpg`] });
  });

  it('já reprocessada (p/), fakes/ do seed, URL externa ou lixo: nada a fazer', () => {
    for (const row of [
      { url: `p/${U(4)}.jpg`, thumbnail_url: `p/${U(4)}-t.jpg` },
      { url: 'fakes/fake-1.jpg', thumbnail_url: 'fakes/fake-1-t.jpg' },
      { url: 'https://cdn.externo/x.jpg', thumbnail_url: null },
      { url: '../etc/passwd', thumbnail_url: null },
      // miniatura legada mas original de fora: não tem de onde reprocessar
      { url: 'https://cdn.externo/x.jpg', thumbnail_url: `${U(5)}-t.jpg` },
    ]) {
      expect(legacyPlan(row)).toBeNull();
    }
  });

  it('cópia privada da foto retida (held/) nunca volta pra uma chave pública', () => {
    expect(legacyPlan({ url: `held/${U(7)}.jpg`, thumbnail_url: `held/${U(7)}.jpg` })).toBeNull();
    expect(legacyPlan({ url: `held/${U(7)}.png`, thumbnail_url: null })).toBeNull();
  });

  it('original novo com miniatura legada (raro): refaz o par e larga os dois', () => {
    expect(legacyPlan({ url: `p/${U(6)}.jpg`, thumbnail_url: `${U(6)}-t.jpg` })).toEqual({
      sourceKey: `p/${U(6)}.jpg`,
      oldKeys: [`p/${U(6)}.jpg`, `${U(6)}-t.jpg`],
    });
  });
});

type Exec = { sql: string; values: unknown[] };

function setup(
  rows: LegacyPhotoRow[],
  opts: { files?: Record<string, string>; swap?: (id: string) => number; putFails?: boolean } = {},
) {
  const files = new Map(Object.entries(opts.files ?? {}).map(([k, v]) => [k, Buffer.from(v)]));
  const exec: Exec[] = [];
  const txExec: Exec[] = [];
  const record = (into: Exec[]) =>
    jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      into.push({ sql, values });
      if (sql.includes('UPDATE photos SET url'))
        return (opts.swap ?? (() => 1))(values[2] as string);
      return 1;
    });
  const tx = { $executeRaw: record(txExec) };
  const db = {
    $queryRaw: jest.fn(async () => rows),
    $executeRaw: record(exec),
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const put = jest.fn(async (k: string, body: Buffer) => {
    if (opts.putFails) throw new Error(`PUT ${k} → 503`);
    files.set(k, body);
  });
  const storage = {
    driver: 'local' as const,
    get: jest.fn(async (k: string) => files.get(k) ?? null),
    put,
    exists: jest.fn(),
    delete: jest.fn(),
  } as unknown as ObjectStorage;
  const processed: ProcessedPhoto = {
    main: Buffer.from('JPEG-SEM-EXIF'),
    thumb: Buffer.from('THUMB'),
    width: 800,
    height: 600,
    bytes: 13,
    inputFormat: 'png',
  };
  const process = jest.fn(async (b: Buffer) => {
    if (b.toString() === 'html')
      throw new PhotoRejected('photo_invalid', 'arquivo não é uma imagem');
    return processed;
  });
  return { db, tx, exec, txExec, storage, put, files, process };
}

const legacyRow = (n: number, extra: Partial<LegacyPhotoRow> = {}): LegacyPhotoRow => ({
  id: U(100 + n),
  user_id: OWNER,
  url: `${U(n)}.jpg`,
  thumbnail_url: `${U(n)}-t.jpg`,
  moderation_labels: null,
  ...extra,
});

describe('reprocessLegacyPhotos', () => {
  it('a busca do legado deixa de fora a foto retida por denúncia (é prova; vai pra held/)', async () => {
    const t = setup([]);
    await reprocessLegacyPhotos({ db: t.db as never, storage: t.storage, process: t.process });
    const sql = (t.db.$queryRaw.mock.calls[0] as unknown[])[0] as TemplateStringsArray;
    expect(sql.join('?')).toContain("(moderation_labels -> 'retainedByReport') IS NULL");
  });

  it('troca a linha pela cópia nova, registra o objeto e põe os antigos no GC com folga', async () => {
    const t = setup(
      [legacyRow(1), { ...legacyRow(9), url: 'fakes/fake-1.jpg', thumbnail_url: null }],
      {
        files: { [`${U(1)}.jpg`]: 'png-com-exif' },
      },
    );
    const r = await reprocessLegacyPhotos({
      db: t.db as never,
      storage: t.storage,
      process: t.process,
    });

    expect(r).toMatchObject({
      legacy: 1,
      reprocessed: 1,
      missing: 0,
      failed: 0,
      changed: 0,
      dry: 0,
    });
    const [newKey, newThumb] = r.written;
    expect(newKey).toMatch(/^p\/[0-9a-f-]{36}\.jpg$/);
    expect(newThumb).toBe(newKey.replace('.jpg', '-t.jpg'));
    // gravou original + miniatura reprocessados
    expect(t.files.get(newKey)!.toString()).toBe('JPEG-SEM-EXIF');
    expect(t.files.get(newThumb)!.toString()).toBe('THUMB');
    expect(t.put).toHaveBeenCalledWith(newKey, expect.any(Buffer), 'image/jpeg');
    // registrou como upload fresco (24 h) antes de gravar
    expect(t.exec[0].sql).toContain('INSERT INTO media_objects');
    expect(t.exec[0].values.slice(0, 3)).toEqual([newKey, OWNER, newThumb]);
    // troca condicional (a linha que lemos) + anexa a nova + antigos na fila
    const swap = t.txExec.find((e) => e.sql.includes('UPDATE photos SET url'))!;
    expect(swap.values).toEqual([newKey, newThumb, U(101), `${U(1)}.jpg`, `${U(1)}-t.jpg`]);
    expect(t.txExec.some((e) => e.sql.includes('attached_at = now(), delete_after = NULL'))).toBe(
      true,
    );
    const queued = t.txExec.filter((e) => e.sql.includes('INSERT INTO media_objects AS m'));
    expect(queued.map((e) => e.values[0])).toEqual([`${U(1)}.jpg`, `${U(1)}-t.jpg`]);
    // folga padrão de 24 h, sem os 180 dias (não é urgent)
    expect(queued[0].values.slice(2)).toEqual([0, REPROCESS_GRACE_HOURS]);
  });

  it("foto 'urgent': os arquivos antigos ficam 180 dias (= gatilho)", async () => {
    const t = setup([legacyRow(1, { moderation_labels: { urgent: true } })], {
      files: { [`${U(1)}.jpg`]: 'x' },
    });
    await reprocessLegacyPhotos(
      { db: t.db as never, storage: t.storage, process: t.process },
      { graceHours: 0 },
    );
    const queued = t.txExec.filter((e) => e.sql.includes('INSERT INTO media_objects AS m'));
    expect(queued[0].values.slice(2)).toEqual([URGENT_RETENTION_DAYS, 0]);
  });

  it('--dry-run: reprocessa em memória e não grava nada (nem banco nem storage)', async () => {
    const t = setup([legacyRow(1), legacyRow(2)], {
      files: { [`${U(1)}.jpg`]: 'x', [`${U(2)}.jpg`]: 'y' },
    });
    const log = jest.fn();
    const r = await reprocessLegacyPhotos(
      { db: t.db as never, storage: t.storage, process: t.process, log },
      { dryRun: true },
    );
    expect(r).toMatchObject({ legacy: 2, dry: 2, reprocessed: 0 });
    expect(t.process).toHaveBeenCalledTimes(2);
    expect(t.put).not.toHaveBeenCalled();
    expect(t.db.$executeRaw).not.toHaveBeenCalled();
    expect(t.db.$transaction).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0][0])).toContain('reprocessaria');
  });

  it('arquivo sumido e formato recusado ficam como estão (e entram no relatório)', async () => {
    const t = setup([legacyRow(1), legacyRow(2)], { files: { [`${U(2)}.jpg`]: 'html' } });
    const r = await reprocessLegacyPhotos({
      db: t.db as never,
      storage: t.storage,
      process: t.process,
    });
    expect(r).toMatchObject({ legacy: 2, missing: 1, failed: 1, reprocessed: 0 });
    expect(r.failures).toEqual([{ id: U(102), key: `${U(2)}.jpg`, reason: 'photo_invalid' }]);
    expect(t.put).not.toHaveBeenCalled();
    expect(t.db.$executeRaw).not.toHaveBeenCalled();
  });

  it('linha mudou no meio (apagada/trocada): não troca nada e a cópia nova vai pro GC', async () => {
    const t = setup([legacyRow(1)], { files: { [`${U(1)}.jpg`]: 'x' }, swap: () => 0 });
    const r = await reprocessLegacyPhotos({
      db: t.db as never,
      storage: t.storage,
      process: t.process,
    });
    expect(r).toMatchObject({ reprocessed: 0, changed: 1 });
    expect(t.txExec.some((e) => e.sql.includes('INSERT INTO media_objects AS m'))).toBe(false);
    const last = t.exec[t.exec.length - 1];
    expect(last.sql).toContain('SET delete_after = now()');
    expect(last.values[0]).toMatch(/^p\//);
  });

  it('storage falhou ao gravar: a linha não muda e o objeto novo vence na hora', async () => {
    const t = setup([legacyRow(1)], { files: { [`${U(1)}.jpg`]: 'x' }, putFails: true });
    const r = await reprocessLegacyPhotos({
      db: t.db as never,
      storage: t.storage,
      process: t.process,
    });
    expect(r).toMatchObject({ reprocessed: 0, failed: 1 });
    expect(t.db.$transaction).not.toHaveBeenCalled();
    expect(t.exec[t.exec.length - 1].sql).toContain('SET delete_after = now()');
  });

  it('--limit corta depois do filtro (fakes/ não gastam o limite)', async () => {
    const t = setup(
      [
        { ...legacyRow(9), url: 'fakes/fake-1.jpg', thumbnail_url: null },
        legacyRow(1),
        legacyRow(2),
      ],
      { files: { [`${U(1)}.jpg`]: 'x', [`${U(2)}.jpg`]: 'y' } },
    );
    const r = await reprocessLegacyPhotos(
      { db: t.db as never, storage: t.storage, process: t.process },
      { limit: 1 },
    );
    expect(r).toMatchObject({ legacy: 1, reprocessed: 1 });
    expect(t.storage.get).toHaveBeenCalledWith(`${U(1)}.jpg`);
  });
});

describe('photos-reprocess (CLI)', () => {
  it('lê as opções', () => {
    expect(parseCliArgs([])).toEqual({ dryRun: false, graceHours: REPROCESS_GRACE_HOURS });
    expect(parseCliArgs(['--', '--dry-run', '--limit', '5', '--grace-hours', '0'])).toEqual({
      dryRun: true,
      limit: 5,
      graceHours: 0,
    });
  });

  it('opção estranha ou número inválido: erro com o uso', () => {
    expect(() => parseCliArgs(['--apagar-tudo'])).toThrow(/opção desconhecida[\s\S]*uso:/);
    expect(() => parseCliArgs(['--limit', 'muito'])).toThrow(/--limit/);
    expect(() => parseCliArgs(['--grace-hours', '-1'])).toThrow(/--grace-hours/);
  });
});
