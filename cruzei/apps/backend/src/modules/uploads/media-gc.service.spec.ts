jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as Sentry from '@sentry/nestjs';

import type { PrismaService } from '../../database/prisma.service';
import { LEGAL_KEEP_REASONS } from '../account-privacy/purge-plan';

import {
  EVIDENCE_HOLD_REASONS,
  GC_ALERT_ATTEMPTS,
  gcDecision,
  MediaGcService,
  type GcCandidate,
} from './media-gc.service';
import { MediaGcTask } from './media-gc.task';
import type { ObjectStorage, StorageGcMode } from './storage/object-storage';

// GC dos arquivos de foto sem banco: a decisão pura (regras de evidência) e a orquestração do drain com um banco falso
// que reconhece cada SQL. As consultas de verdade (lease, gatilho, referências) estão em test/db/media.db-spec.ts.

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (n: number) => `p/${U(n)}.jpg`;
const thumb = (n: number) => `p/${U(n)}-t.jpg`;
const OWNER = U(900);
const HELD_OWNER = U(901);

type Row = {
  key: string;
  thumb_key: string | null;
  owner_id: string | null;
  delete_attempts: number;
};
type Exec = {
  kind: 'delete-row' | 'reattach' | 'hold' | 'dry' | 'error' | 'other';
  key: unknown;
  values: unknown[];
};

/** banco falso: fila `due` vencida; referências e donos segurados configuráveis; grava cada escrita */
function fakeDb(
  opts: {
    due?: Row[];
    inPhotos?: string[];
    elsewhere?: string[];
    held?: string[];
    /** linhas que a soltura das retidas apaga */
    released?: { url: string; thumbnail_url: string | null }[];
  } = {},
) {
  let due = [...(opts.due ?? [])];
  const exec: Exec[] = [];
  const queries: string[] = [];
  const db = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      queries.push(sql);
      if (sql.includes('UPDATE media_objects m')) {
        const only = values[0] as string[] | null;
        const limit = values[2] as number;
        const picked = due.filter((r) => !only || only.includes(r.key)).slice(0, limit);
        due = due.filter((r) => !picked.includes(r));
        return picked.map((r) => ({ ...r, delete_attempts: r.delete_attempts + 1 }));
      }
      if (sql.includes('SELECT DISTINCT r.k, r.src')) {
        // chaves (photos pela chave normalizada), URLs da base atual e, por último, as chaves de novo
        const keys = values[values.length - 1] as string[];
        expect(values[0]).toEqual(keys);
        const base = values.find((v) => typeof v === 'string' && v.endsWith('/')) as string;
        expect(values).toContainEqual(keys.map((k) => `${base}${k}`));
        expect(values).toContain(base.length);
        return [
          ...(opts.inPhotos ?? [])
            .filter((k) => keys.includes(k))
            .map((k) => ({ k, src: 'photos' })),
          ...(opts.elsewhere ?? [])
            .filter((k) => keys.includes(k))
            .map((k) => ({ k, src: 'other' })),
        ];
      }
      if (sql.includes('SELECT DISTINCT reported_id')) {
        const owners = values[0] as string[];
        expect(values[1]).toEqual(['underage', 'child_safety']);
        return (opts.held ?? []).filter((o) => owners.includes(o)).map((id) => ({ id }));
      }
      if (sql.includes("'retainedByReport'")) {
        expect(values[0]).toEqual(['underage', 'child_safety']);
        return (opts.released ?? []).slice(0, values[1] as number);
      }
      if (sql.includes('DELETE FROM photos')) {
        return [
          { url: key(1), thumbnail_url: thumb(1) },
          {
            url: `http://192.168.0.9:3000/uploads/${U(2)}.png`,
            thumbnail_url: `http://192.168.0.9:3000/uploads/${U(2)}.png`,
          },
          { url: 'https://cdn.externo/x.jpg', thumbnail_url: null },
        ];
      }
      if (sql.includes('UPDATE media_objects SET delete_after = now()')) return [{ key: key(3) }];
      throw new Error(`SQL inesperado: ${sql}`);
    }),
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      const kind: Exec['kind'] = sql.includes('DELETE FROM media_objects')
        ? 'delete-row'
        : sql.includes('attached_at = COALESCE')
          ? 'reattach'
          : sql.includes('make_interval(days')
            ? 'hold'
            : sql.includes("interval '1 day'")
              ? 'dry'
              : sql.includes('last_error = left')
                ? 'error'
                : 'other';
      exec.push({ kind, key: kind === 'error' ? values[1] : values[values.length - 1], values });
      return 1;
    }),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(self)),
  };
  const self: unknown = db;
  return { db, exec, queries, prisma: db as unknown as PrismaService };
}

function fakeStorage(fail: string[] = []) {
  const deleted: string[] = [];
  const storage = {
    driver: 'local' as const,
    put: jest.fn(),
    get: jest.fn(),
    exists: jest.fn(),
    delete: jest.fn(async (k: string) => {
      if (fail.includes(k)) throw new Error(`S3 DELETE ${k} → 500`);
      deleted.push(k);
    }),
  };
  return { storage: storage as unknown as ObjectStorage, deleted, mock: storage };
}

const row = (n: number, extra: Partial<Row> = {}): Row => ({
  key: key(n),
  thumb_key: thumb(n),
  owner_id: OWNER,
  delete_attempts: 0,
  ...extra,
});
const svc = (prisma: PrismaService, storage: ObjectStorage, mode: StorageGcMode = 'on') =>
  new MediaGcService(prisma, storage, mode);
const kinds = (exec: Exec[], k: string) => exec.filter((e) => e.key === k).map((e) => e.kind);

describe('gcDecision (pura)', () => {
  const base: GcCandidate = {
    key: key(1),
    inPhotos: false,
    referencedElsewhere: false,
    ownerOnHold: false,
  };

  it('chave que não é nossa sai da fila sem tocar no storage (fakes/, URL externa, lixo)', () => {
    for (const k of [
      'fakes/fake-1.jpg',
      'https://cdn.x/a.jpg',
      `fakes/${U(1)}.jpg`,
      'p/nao-uuid.jpg',
    ]) {
      expect(gcDecision({ ...base, key: k }, 'on')).toBe('forget');
    }
  });

  it('em uso numa foto: reanexa (vence até a retenção do dono)', () => {
    expect(
      gcDecision({ ...base, inPhotos: true, ownerOnHold: true, referencedElsewhere: true }, 'on'),
    ).toBe('reattach');
  });

  it('dono com denúncia underage/child_safety aberta: segura', () => {
    expect(gcDecision({ ...base, ownerOnHold: true }, 'on')).toBe('hold');
  });

  it('citada fora de photos (denúncia, selfie, capa): segura e confere de novo (não reanexa pra sempre)', () => {
    expect(gcDecision({ ...base, referencedElsewhere: true }, 'on')).toBe('hold');
  });

  it('modo dry/off nunca apaga; on apaga o resto', () => {
    expect(gcDecision(base, 'dry')).toBe('dry');
    expect(gcDecision(base, 'off')).toBe('dry');
    expect(gcDecision(base, 'on')).toBe('delete');
  });

  it('a lista de denúncias que seguram arquivos é a mesma da limpeza da conta', () => {
    expect([...EVIDENCE_HOLD_REASONS].sort()).toEqual([...LEGAL_KEEP_REASONS].sort());
  });
});

describe('MediaGcService.drain', () => {
  beforeEach(() => jest.clearAllMocks());

  it('aplica cada regra: apaga (miniatura antes), segura evidência, reanexa o que voltou a uso, esquece o que não é nosso', async () => {
    const f = fakeDb({
      due: [
        row(1),
        row(2, { owner_id: HELD_OWNER }),
        row(3),
        row(4),
        row(5),
        { key: 'fakes/fake-1.jpg', thumb_key: null, owner_id: null, delete_attempts: 0 },
      ],
      inPhotos: [key(3), thumb(5)],
      elsewhere: [key(4)],
      held: [HELD_OWNER],
    });
    const s = fakeStorage();
    const r = await svc(f.prisma, s.storage).drain();

    expect(r).toEqual({
      leased: 6,
      deleted: 1,
      forgotten: 1,
      reattached: 2,
      held: 2,
      dry: 0,
      failed: 0,
    });
    expect(s.deleted).toEqual([thumb(1), key(1)]);
    expect(kinds(f.exec, key(1))).toEqual(['delete-row']);
    expect(kinds(f.exec, key(2))).toEqual(['hold']);
    expect(kinds(f.exec, key(3))).toEqual(['reattach']);
    expect(kinds(f.exec, key(4))).toEqual(['hold']);
    expect(kinds(f.exec, key(5))).toEqual(['reattach']); // só a miniatura estava em uso: o par fica
    expect(kinds(f.exec, 'fakes/fake-1.jpg')).toEqual(['delete-row']);
    // segurado volta em 30 dias
    const hold = f.exec.find((e) => e.kind === 'hold')!;
    expect(hold.values[0]).toBe(30);
  });

  it('falha no storage: guarda o erro, mantém a linha (tenta de novo) e avisa o Sentry na 12ª tentativa', async () => {
    const f = fakeDb({ due: [row(1, { delete_attempts: GC_ALERT_ATTEMPTS - 1 }), row(2)] });
    const s = fakeStorage([key(1)]);
    const r = await svc(f.prisma, s.storage).drain();
    expect(r).toMatchObject({ leased: 2, deleted: 1, failed: 1 });
    // a miniatura saiu, o original não: a linha fica pra próxima rodada (delete é idempotente)
    expect(s.deleted).toEqual([thumb(1), thumb(2), key(2)]);
    expect(kinds(f.exec, key(1))).toEqual(['error']);
    expect(f.exec.find((e) => e.kind === 'error')!.values[0]).toBe(`S3 DELETE ${key(1)} → 500`);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(String((Sentry.captureMessage as jest.Mock).mock.calls[0][0])).toContain(key(1));
  });

  it('modo dry: nada sai do storage, a linha volta em 1 dia', async () => {
    const f = fakeDb({ due: [row(1)] });
    const s = fakeStorage();
    const r = await svc(f.prisma, s.storage, 'dry').drain();
    expect(r).toMatchObject({ leased: 1, dry: 1, deleted: 0 });
    expect(s.mock.delete).not.toHaveBeenCalled();
    expect(kinds(f.exec, key(1))).toEqual(['dry']);
  });

  it('modo off: nem consulta a fila', async () => {
    const f = fakeDb({ due: [row(1)] });
    const r = await svc(f.prisma, fakeStorage().storage, 'off').drain();
    expect(r.leased).toBe(0);
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('limite do lote fica entre 1 e 500; keys limita às chaves pedidas', async () => {
    const f = fakeDb({ due: [row(1), row(2), row(3)] });
    const s = svc(f.prisma, fakeStorage().storage);
    expect((await s.drain({ keys: [key(2)], limit: 9999 })).leased).toBe(1);
    expect(f.db.$queryRaw.mock.calls[0][3]).toBe(500);
    expect((await s.drain({ limit: 0 })).leased).toBe(1);
  });
});

describe('MediaGcService.kick e releaseUser', () => {
  it('kick: converte URL em chave, tira repetida e lixo, drena só essas', async () => {
    const f = fakeDb();
    const s = svc(f.prisma, fakeStorage().storage);
    const drain = jest.spyOn(s, 'drain').mockResolvedValue({} as never);
    s.kick([
      key(1),
      `http://10.0.0.2:3000/uploads/${key(1)}`,
      null,
      undefined,
      'https://cdn.externo/x.jpg',
      thumb(1),
    ]);
    await new Promise((r) => setImmediate(r));
    expect(drain).toHaveBeenCalledWith({ keys: [key(1), thumb(1)] });
  });

  it('kick no modo off ou sem chave não faz nada', async () => {
    const f = fakeDb();
    const off = svc(f.prisma, fakeStorage().storage, 'off');
    const d1 = jest.spyOn(off, 'drain');
    off.kick([key(1)]);
    const on = svc(f.prisma, fakeStorage().storage);
    const d2 = jest.spyOn(on, 'drain');
    on.kick([null, 'https://cdn.externo/x.jpg']);
    await new Promise((r) => setImmediate(r));
    expect(d1).not.toHaveBeenCalled();
    expect(d2).not.toHaveBeenCalled();
  });

  it('releaseUser: apaga as fotos (menos as guardadas), vence os uploads soltos e devolve só chaves válidas', async () => {
    const f = fakeDb();
    const s = svc(f.prisma, fakeStorage().storage);
    const kick = jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    const keep = [U(77)];
    const keys = await s.releaseUser(OWNER, { keepPhotoIds: keep });
    expect(keys.sort()).toEqual([key(1), thumb(1), `${U(2)}.png`, key(3)].sort());
    const del = f.db.$queryRaw.mock.calls.find((c) =>
      (c[0] as TemplateStringsArray).join('?').includes('DELETE FROM photos'),
    )!;
    expect(del.slice(1)).toEqual([OWNER, keep]);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(kick).toHaveBeenCalledWith(keys);
  });

  it('releaseUser com tx: usa a transação de quem chama e NÃO chama kick (quem chama faz depois do commit)', async () => {
    const f = fakeDb();
    const s = svc(f.prisma, fakeStorage().storage);
    const kick = jest.spyOn(s, 'kick');
    const tx = fakeDb();
    await s.releaseUser(OWNER, { tx: tx.db as never });
    expect(tx.db.$queryRaw).toHaveBeenCalled();
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });
});

describe('MediaGcService.references — sem varrer tabela inteira', () => {
  const sqlOf = async () => {
    const f = fakeDb({ inPhotos: [key(1)], elsewhere: [key(2)] });
    const refs = await svc(f.prisma, fakeStorage().storage).references([key(1), key(2), key(3)]);
    return { refs, sql: f.queries.find((q) => q.includes('SELECT DISTINCT r.k, r.src'))! };
  };

  it('separa photos (reanexa) do resto (segura)', async () => {
    const { refs } = await sqlOf();
    expect([...refs.inPhotos]).toEqual([key(1)]);
    expect([...refs.elsewhere]).toEqual([key(2)]);
  });

  it('todo ramo de photos filtra por igualdade (= ANY) e o resto só pega linha preenchida', async () => {
    const { sql } = await sqlOf();
    const branches = sql.split('UNION ALL');
    const photoBranches = branches.filter((b) => /FROM photos p\b/.test(b));
    expect(photoBranches).toHaveLength(4);
    for (const b of photoBranches) expect(b).toMatch(/WHERE[\s\S]*= ANY\(\?::text\[\]\)/);
    expect(sql).toContain('WHERE u.verification_selfie_url IS NOT NULL');
    expect(sql).toContain('WHERE e.cover_url IS NOT NULL');
    expect(sql).toContain('WHERE rp.evidence_urls IS NOT NULL');
  });

  it('a chave normalizada usa a MESMA expressão dos índices da migration (senão o índice não entra)', async () => {
    const { sql } = await sqlOf();
    const mig = fs.readFileSync(
      path.join(
        __dirname,
        '../../../prisma/migrations/20261005000300_photo_retention_gc_idx/migration.sql',
      ),
      'utf8',
    );
    const re = `'^https?://[^/]+/uploads/'`;
    for (const col of ['url', 'thumbnail_url']) {
      expect(mig).toContain(`regexp_replace(${col}, ${re}, '')`);
      expect(sql).toContain(`regexp_replace(p.${col}, ${re}, '') = ANY(`);
    }
    // o parcial da miniatura exige o IS NOT NULL na consulta
    expect(mig).toMatch(/photos_thumb_key_norm_idx[\s\S]*WHERE thumbnail_url IS NOT NULL/);
    expect(sql).toMatch(/p\.thumbnail_url IS NOT NULL\s+AND regexp_replace\(p\.thumbnail_url/);
    for (const idx of [
      'users_verification_selfie_url_idx',
      'events_cover_url_idx',
      'reports_evidence_urls_idx',
    ])
      expect(mig).toContain(idx);
  });

  it('sem chave: nem consulta', async () => {
    const f = fakeDb();
    const refs = await svc(f.prisma, fakeStorage().storage).references([]);
    expect(refs.inPhotos.size + refs.elsewhere.size).toBe(0);
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('MediaGcService.releaseRetainedPhotos', () => {
  it('apaga as retidas sem denúncia aberta e manda as chaves pro GC na hora', async () => {
    const f = fakeDb({
      released: [
        { url: key(1), thumbnail_url: thumb(1) },
        { url: `${U(2)}.png`, thumbnail_url: null },
      ],
    });
    const s = svc(f.prisma, fakeStorage().storage);
    const kick = jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    expect(await s.releaseRetainedPhotos()).toBe(2);
    expect(kick).toHaveBeenCalledWith([key(1), thumb(1), `${U(2)}.png`, null]);
    const sql = f.queries.find((q) => q.includes("'retainedByReport'"))!;
    // só quem não tem denúncia underage/child_safety pendente/em análise; lote com trava que não espera
    expect(sql).toMatch(/NOT EXISTS[\s\S]*status IN \('pending', 'reviewing'\)/);
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('nada a soltar: não chama o GC; lote fica entre 1 e 1000', async () => {
    const f = fakeDb();
    const s = svc(f.prisma, fakeStorage().storage);
    const kick = jest.spyOn(s, 'kick');
    expect(await s.releaseRetainedPhotos(99999)).toBe(0);
    expect(kick).not.toHaveBeenCalled();
    expect(f.db.$queryRaw.mock.calls[0][2]).toBe(1000);
    await s.releaseRetainedPhotos(0);
    expect(f.db.$queryRaw.mock.calls[1][2]).toBe(1);
  });
});

describe('MediaGcTask', () => {
  it('releaseRetained: solta as retidas e não derruba o cron se falhar', async () => {
    const ok = jest.fn().mockResolvedValue(3);
    await new MediaGcTask({
      releaseRetainedPhotos: ok,
    } as unknown as MediaGcService).releaseRetained();
    expect(ok).toHaveBeenCalledTimes(1);
    const boom = jest.fn().mockRejectedValue(new Error('banco caiu'));
    await expect(
      new MediaGcTask({
        releaseRetainedPhotos: boom,
      } as unknown as MediaGcService).releaseRetained(),
    ).resolves.toBeUndefined();
  });

  const report = (leased: number) => ({
    leased,
    deleted: 0,
    forgotten: 0,
    reattached: 0,
    held: 0,
    dry: 0,
    failed: 0,
  });

  it('drena em lotes de 200 até a fila esvaziar (no máximo 5 por rodada)', async () => {
    const drain = jest
      .fn()
      .mockResolvedValueOnce(report(200))
      .mockResolvedValueOnce(report(200))
      .mockResolvedValueOnce(report(17));
    await new MediaGcTask({ drain } as unknown as MediaGcService).run();
    expect(drain).toHaveBeenCalledTimes(3);
    expect(drain).toHaveBeenCalledWith({ limit: 200 });

    const always = jest.fn().mockResolvedValue(report(200));
    await new MediaGcTask({ drain: always } as unknown as MediaGcService).run();
    expect(always).toHaveBeenCalledTimes(5);
  });

  it('não sobrepõe rodadas e não derruba o cron se o banco falhar', async () => {
    let release!: () => void;
    const slow = jest.fn(() => new Promise((r) => (release = () => r(report(0)))));
    const task = new MediaGcTask({ drain: slow } as unknown as MediaGcService);
    const first = task.run();
    await task.run(); // ainda rodando: pula
    expect(slow).toHaveBeenCalledTimes(1);
    release();
    await first;

    const boom = new MediaGcTask({
      drain: jest.fn().mockRejectedValue(new Error('banco caiu')),
    } as unknown as MediaGcService);
    await expect(boom.run()).resolves.toBeUndefined();
    await expect(boom.run()).resolves.toBeUndefined();
  });
});
