jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

import * as fs from 'node:fs';
import * as path from 'node:path';

import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

import type { PrismaService } from '../../database/prisma.service';
import { LEGAL_KEEP_REASONS } from '../account-privacy/purge-plan';

import {
  EVIDENCE_HOLD_REASONS,
  GC_ALERT_ATTEMPTS,
  gcDecision,
  HELD_MOVE_ALERT_ATTEMPTS,
  heldMoveRetryAt,
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
  moved_to?: string | null;
};
/** SQL do jeito que o Prisma manda pro banco: fragmentos Prisma.sql aninhados achatados (texto com ? e valores) */
function flat(a0: unknown, rest: unknown[]): { sql: string; values: unknown[] } {
  const q = Array.isArray(a0)
    ? Prisma.sql(a0 as readonly string[], ...(rest as Prisma.Sql[]))
    : (a0 as Prisma.Sql);
  return { sql: q.strings.join('?'), values: q.values };
}
const callOf = (call: unknown[]) => flat(call[0], call.slice(1));

type Exec = {
  kind: 'delete-row' | 'reattach' | 'hold' | 'dry' | 'error' | 'other';
  key: unknown;
  values: unknown[];
  sql: string;
};

/** banco falso: fila `due` vencida; referências e donos segurados configuráveis; grava cada escrita */
function fakeDb(
  opts: {
    due?: Row[];
    inPhotos?: string[];
    elsewhere?: string[];
    held?: string[];
    /** linhas que a soltura das retidas apaga (acted = denúncia fechou com ação / conta banida) */
    released?: { id?: string; url: string; thumbnail_url: string | null; acted?: boolean }[];
    /** retidas que ainda apontam pra chave pública (moveRetainedToHeld) */
    retainedPublic?: {
      id: string;
      user_id: string;
      url: string;
      thumbnail_url: string | null;
      move_attempts?: number | null;
    }[];
    /** UPDATE photos da troca pra held/ devolve 0 (a linha mudou no meio) */
    swapMisses?: boolean;
  } = {},
) {
  let due = [...(opts.due ?? [])];
  const exec: Exec[] = [];
  const queries: string[] = [];
  const db = {
    $queryRaw: jest.fn(async (a0: unknown, ...rest: unknown[]) => {
      const { sql, values } = flat(a0, rest);
      queries.push(sql);
      if (sql.includes('UPDATE media_objects m')) {
        const only = values[0] as string[] | null;
        const limit = values[2] as number;
        const picked = due.filter((r) => !only || only.includes(r.key)).slice(0, limit);
        due = due.filter((r) => !picked.includes(r));
        return picked.map((r) => ({
          moved_to: null,
          ...r,
          delete_attempts: r.delete_attempts + 1,
        }));
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
      if (sql.includes('DELETE FROM photos WHERE id = ANY')) {
        const ids = values[0] as string[];
        return (opts.released ?? [])
          .filter((r, i) => ids.includes(r.id ?? U(500 + i)))
          .map(({ url, thumbnail_url }) => ({ url, thumbnail_url }));
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
      if (sql.includes('AS move_attempts')) {
        return (opts.retainedPublic ?? [])
          .slice(0, values[values.length - 1] as number)
          .map((r) => ({ move_attempts: null, ...r }));
      }
      if (sql.includes('AS acted')) {
        // fechou com ação (resolvida), ainda aberta e a espera da held/: todas com os motivos de evidência
        for (const v of values.slice(0, -1)) expect(v).toEqual(['underage', 'child_safety']);
        return (opts.released ?? [])
          .slice(0, values[values.length - 1] as number)
          .map((r, i) => ({ id: r.id ?? U(500 + i), acted: !!r.acted }));
      }
      if (sql.includes('UPDATE media_objects SET delete_after = now()')) return [{ key: key(3) }];
      throw new Error(`SQL inesperado: ${sql}`);
    }),
    $executeRaw: jest.fn(async (a0: unknown, ...rest: unknown[]) => {
      const { sql, values } = flat(a0, rest);
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
      exec.push({
        kind,
        key: kind === 'error' ? values[1] : values[values.length - 1],
        values,
        sql,
      });
      if (opts.swapMisses && sql.includes('UPDATE photos SET url')) return 0;
      return 1;
    }),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(self)),
  };
  const self: unknown = db;
  return { db, exec, queries, prisma: db as unknown as PrismaService };
}

function fakeStorage(fail: string[] = [], files: Record<string, Buffer> = {}) {
  const deleted: string[] = [];
  const storage = {
    driver: 'local' as const,
    put: jest.fn(async (k: string, b: Buffer) => {
      if (fail.includes(k) || fail.some((f) => f.endsWith('/') && k.startsWith(f)))
        throw new Error(`S3 PUT ${k} → 500`);
      files[k] = b;
    }),
    get: jest.fn(async (k: string) => files[k] ?? null),
    exists: jest.fn(async (k: string) => {
      if (fail.includes(k)) throw new Error(`S3 HEAD ${k} → 503`);
      return k in files;
    }),
    delete: jest.fn(async (k: string) => {
      if (fail.includes(k)) throw new Error(`S3 DELETE ${k} → 500`);
      deleted.push(k);
    }),
  };
  return { storage: storage as unknown as ObjectStorage, deleted, mock: storage, files };
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
    expect(callOf(f.db.$queryRaw.mock.calls[0]).values[2]).toBe(500);
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
    const del = f.db.$queryRaw.mock.calls
      .map(callOf)
      .find((c) => c.sql.includes('DELETE FROM photos'))!;
    expect(del.values).toEqual([OWNER, keep]);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(kick).toHaveBeenCalledWith(keys);
  });

  it("releaseUser: retida que fechou com ação ganha 'urgent' ANTES do DELETE; a de 'urgent' ainda na pública fica pro cron", async () => {
    const f = fakeDb();
    const s = svc(f.prisma, fakeStorage().storage);
    jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    await s.releaseUser(OWNER);

    const mark = f.exec.find((e) => e.sql.includes('UPDATE photos x SET moderation_labels'))!;
    expect(mark.sql).toContain(`x.moderation_labels || '{"urgent": true}'::jsonb`);
    expect(mark.sql).toContain("(x.moderation_labels -> 'retainedByReport') IS NOT NULL");
    // o MESMO "com ação" da soltura das retidas: banida ou denúncia de menor/abuso resolvida
    expect(mark.sql).toMatch(
      /account_status::text = 'banned' OR EXISTS[\s\S]*r\.status = 'resolved'/,
    );
    expect(mark.values).toEqual([OWNER, ['underage', 'child_safety']]);
    const delCall = f.db.$queryRaw.mock.calls.findIndex((c) =>
      callOf(c).sql.includes('DELETE FROM photos'),
    );
    expect(f.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.db.$queryRaw.mock.invocationCallOrder[delCall],
    );
    // fora do DELETE: retida com 'urgent' que ainda aponta pra chave pública (sem marca de arquivo sumido)
    const del = callOf(f.db.$queryRaw.mock.calls[delCall]).sql;
    expect(del).toMatch(
      /AND NOT \(\(x\.moderation_labels -> 'retainedByReport'\) IS NOT NULL\s+AND COALESCE\(x\.moderation_labels ->> 'urgent', ''\) = 'true'/,
    );
    expect(del).toContain("x.url !~ '^held/'");
    expect(del).toContain("(x.moderation_labels #> '{retainedByReport,moveFinal}') IS NULL");
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

  it('TODO ramo filtra por igualdade (= ANY / &&): nada de varrer selfie, capa e evidence_urls a cada kick', async () => {
    const { sql } = await sqlOf();
    const branches = sql.split('UNION ALL');
    expect(branches).toHaveLength(9);
    for (const b of branches) expect(b).toMatch(/WHERE[\s\S]*(= ANY\(|&& )\?::text\[\]/);
    const of = (re: RegExp) => branches.filter((b) => re.test(b));
    expect(of(/FROM photos p\b/)).toHaveLength(4);
    expect(of(/FROM users u\b/)).toHaveLength(2);
    expect(of(/FROM events e\b/)).toHaveLength(2);
    expect(of(/FROM reports rp\b/)).toHaveLength(1);
    // a leitura antiga (toda linha preenchida, filtrando só no fim) não volta
    expect(sql).not.toMatch(/AS raw FROM users/);
  });

  it('evidence_urls: procura a chave, a URL da base atual (o legado sai normalizado no índice)', async () => {
    const f = fakeDb();
    await svc(f.prisma, fakeStorage().storage).references([key(1)]);
    const call = f.db.$queryRaw.mock.calls[0];
    const parts = (call[0] as TemplateStringsArray).slice();
    const values = call.slice(1) as unknown[];
    const base = values.find((v) => typeof v === 'string' && v.endsWith('/')) as string;
    // o valor logo depois de "media_ref_keys(rp.evidence_urls) &&"
    const at = parts.findIndex((p) => /media_ref_keys\(rp\.evidence_urls\) && $/.test(p));
    expect(values[at]).toEqual([key(1), `${base}${key(1)}`]);
  });

  it('as expressões são as MESMAS dos índices das migrations (senão o índice não entra)', async () => {
    const { sql } = await sqlOf();
    const read = (name: string) =>
      fs.readFileSync(
        path.join(__dirname, `../../../prisma/migrations/${name}/migration.sql`),
        'utf8',
      );
    const mig300 = read('20261005000300_photo_retention_gc_idx');
    const mig400 = read('20261005000400_photo_held_refs');
    const re = `'^https?://[^/]+/uploads/'`;
    for (const col of ['url', 'thumbnail_url']) {
      expect(mig300).toContain(`regexp_replace(${col}, ${re}, '')`);
      expect(sql).toContain(`regexp_replace(p.${col}, ${re}, '') = ANY(`);
    }
    // o parcial da miniatura exige o IS NOT NULL na consulta
    expect(mig300).toMatch(/photos_thumb_key_norm_idx[\s\S]*WHERE thumbnail_url IS NOT NULL/);
    expect(sql).toMatch(/p\.thumbnail_url IS NOT NULL\s+AND regexp_replace\(p\.thumbnail_url/);
    // URL da base atual: índices simples (parciais) da 300
    for (const idx of ['users_verification_selfie_url_idx', 'events_cover_url_idx'])
      expect(mig300).toContain(idx);
    // chave normalizada de selfie e capa (parciais: a consulta repete o IS NOT NULL)
    for (const [alias, col, idx] of [
      ['u', 'verification_selfie_url', 'users_selfie_key_norm_idx'],
      ['e', 'cover_url', 'events_cover_key_norm_idx'],
    ]) {
      expect(mig400).toMatch(
        new RegExp(
          `${idx}[\\s\\S]*?regexp_replace\\(${col}, '\\^https\\?://\\[\\^/\\]\\+/uploads/', ''\\)[\\s\\S]*?WHERE ${col} IS NOT NULL`,
        ),
      );
      expect(sql).toContain(`${alias}.${col} IS NOT NULL`);
      expect(sql).toContain(`regexp_replace(${alias}.${col}, ${re}, '') = ANY(`);
    }
    // evidence_urls: GIN na função, parcial em evidence_urls IS NOT NULL
    expect(mig400).toMatch(
      /reports_evidence_keys_idx[\s\S]*USING gin \(media_ref_keys\(evidence_urls\)\)[\s\S]*WHERE evidence_urls IS NOT NULL/,
    );
    expect(mig400).toMatch(/CREATE OR REPLACE FUNCTION media_ref_keys\(j jsonb\)[\s\S]*IMMUTABLE/);
    expect(sql).toMatch(
      /rp\.evidence_urls IS NOT NULL\s+AND media_ref_keys\(rp\.evidence_urls\) && \?::text\[\]/,
    );
  });

  it('sem chave: nem consulta', async () => {
    const f = fakeDb();
    const refs = await svc(f.prisma, fakeStorage().storage).references([]);
    expect(refs.inPhotos.size + refs.elsewhere.size).toBe(0);
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('MediaGcService.releaseRetainedPhotos', () => {
  const HELD = `held/${U(9)}.jpg`;

  it('apaga as retidas sem denúncia aberta e manda as chaves pro GC na hora', async () => {
    const f = fakeDb({
      released: [
        { url: HELD, thumbnail_url: HELD },
        { url: `${U(2)}.png`, thumbnail_url: null },
      ],
    });
    const s = svc(f.prisma, fakeStorage().storage);
    const kick = jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    expect(await s.releaseRetainedPhotos()).toBe(2);
    expect(kick).toHaveBeenCalledWith([HELD, HELD, `${U(2)}.png`, null]);
    const sql = f.queries.find((q) => q.includes('AS acted'))!;
    // só quem não tem denúncia underage/child_safety pendente/em análise; lote com trava que não espera
    expect(sql).toMatch(/NOT EXISTS[\s\S]*status IN \('pending', 'reviewing'\)/);
    expect(sql).toContain('FOR UPDATE OF x SKIP LOCKED');
    // tudo numa transação: o rótulo e o DELETE (o gatilho lê o 'urgent' da linha apagada)
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("denúncia fechada COM ação (resolvida/banida): marca 'urgent' ANTES de apagar (o gatilho guarda 180 dias)", async () => {
    const f = fakeDb({
      released: [
        { id: U(31), url: HELD, thumbnail_url: HELD, acted: true },
        { id: U(32), url: `held/${U(10)}.jpg`, thumbnail_url: null, acted: false },
      ],
    });
    const s = svc(f.prisma, fakeStorage().storage);
    jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    expect(await s.releaseRetainedPhotos()).toBe(2);

    const sel = f.queries.find((q) => q.includes('AS acted'))!;
    // "com ação" = denúncia de menor/abuso resolvida ou conta banida
    expect(sel).toMatch(/account_status::text = 'banned' OR EXISTS[\s\S]*r\.status = 'resolved'/);
    const mark = f.exec.find((e) => e.sql.includes('UPDATE photos SET moderation_labels'))!;
    expect(mark.sql).toContain(`moderation_labels || '{"urgent": true}'::jsonb`);
    // só a que fechou com ação; a dispensada sai na hora
    expect(mark.values[0]).toEqual([U(31)]);
    // o rótulo vem antes do DELETE
    const delAt = f.db.$queryRaw.mock.calls.findIndex((c) =>
      callOf(c).sql.includes('DELETE FROM photos WHERE id = ANY'),
    );
    expect(f.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.db.$queryRaw.mock.invocationCallOrder[delAt],
    );
    expect(callOf(f.db.$queryRaw.mock.calls[delAt]).values).toEqual([[U(31), U(32)]]);
  });

  it("a que vai ficar 180 dias (com ação ou já 'urgent') e ainda está na chave pública espera a held/", async () => {
    const f = fakeDb();
    await svc(f.prisma, fakeStorage().storage).releaseRetainedPhotos();
    const sel = f.queries.find((q) => q.includes('AS acted'))!;
    // fora do lote: (com ação OU 'urgent') E ainda na pública, sem marca definitiva de arquivo sumido
    expect(sel).toMatch(
      /AND NOT \(\(\(u\.account_status::text = 'banned'[\s\S]*\) OR COALESCE\(x\.moderation_labels ->> 'urgent', ''\) = 'true'\) AND \(x\.url !~ '\^held\/'/,
    );
    // o SQL recebe \. (ponto literal na regex do Postgres)
    expect(sel).toContain('[0-9a-f]{12}\\.[a-z0-9]{1,5}$');
    expect(sel).toContain("(x.moderation_labels #> '{retainedByReport,moveFinal}') IS NULL");
  });

  it('todas dispensadas (sem ação): nenhum rótulo, só o DELETE', async () => {
    const f = fakeDb({ released: [{ url: HELD, thumbnail_url: HELD, acted: false }] });
    const s = svc(f.prisma, fakeStorage().storage);
    jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    expect(await s.releaseRetainedPhotos()).toBe(1);
    expect(f.exec.some((e) => e.sql.includes('UPDATE photos SET moderation_labels'))).toBe(false);
  });

  it('nada a soltar: não chama o GC nem o DELETE; lote fica entre 1 e 1000', async () => {
    const f = fakeDb();
    const s = svc(f.prisma, fakeStorage().storage);
    const kick = jest.spyOn(s, 'kick');
    expect(await s.releaseRetainedPhotos(99999)).toBe(0);
    expect(kick).not.toHaveBeenCalled();
    const limitOf = (i: number) => callOf(f.db.$queryRaw.mock.calls[i]).values.at(-1);
    expect(limitOf(0)).toBe(1000);
    expect(f.queries.some((q) => q.includes('DELETE FROM photos'))).toBe(false);
    await s.releaseRetainedPhotos(0);
    expect(limitOf(1)).toBe(1);
  });
});

describe('foto retida → cópia privada (held/)', () => {
  const SRC = key(40);
  const SRC_T = thumb(40);
  const bytes = Buffer.from('jpeg-da-foto');
  beforeEach(() => jest.clearAllMocks());

  it('gcDecision: cópia pública com a privada guardada sai mesmo com o dono em retenção; citação ainda segura', () => {
    const c: GcCandidate = {
      key: SRC,
      inPhotos: false,
      referencedElsewhere: false,
      ownerOnHold: true,
      movedToHeld: true,
    };
    expect(gcDecision(c, 'on')).toBe('delete');
    expect(gcDecision({ ...c, movedToHeld: false }, 'on')).toBe('hold');
    expect(gcDecision({ ...c, referencedElsewhere: true }, 'on')).toBe('hold');
    expect(gcDecision(c, 'dry')).toBe('dry');
  });

  it('copyToHeld: chave nova em held/ (uuid novo), registrada como órfã ANTES do PUT, sem cache público', async () => {
    const f = fakeDb();
    const st = fakeStorage([], { [SRC]: bytes });
    const s = svc(f.prisma, st.storage);
    const held = await s.copyToHeld(OWNER, SRC);
    expect(held).toMatch(/^held\/[0-9a-f-]{36}\.jpg$/);
    expect(held).not.toContain(U(40));
    expect(st.files[held!]).toEqual(bytes);
    expect(st.mock.put).toHaveBeenCalledWith(held, bytes, 'image/jpeg', {
      cacheControl: 'private, no-store',
    });
    const reg = f.exec.find((e) => e.sql.includes('INSERT INTO media_objects'))!;
    expect(reg.sql).toContain("'held'");
    expect(reg.values.slice(0, 3)).toEqual([held, OWNER, bytes.length]);
    // vence em 1 h se a troca não acontecer
    expect(reg.values[3]).toBe(60);
    // registro antes do PUT: se o processo cair depois do PUT, o GC acha a órfã
    expect(f.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      st.mock.put.mock.invocationCallOrder[0],
    );
  });

  it('copyToHeld: legado .png mantém a extensão; chave que não é nossa, já held/, arquivo sumido ou storage fora → null', async () => {
    const legacy = `${U(41)}.png`;
    const st = fakeStorage([], { [legacy]: bytes, [SRC]: bytes });
    expect(await svc(fakeDb().prisma, st.storage).copyToHeld(OWNER, legacy)).toMatch(
      /^held\/[0-9a-f-]{36}\.png$/,
    );
    for (const k of ['fakes/fake-1.jpg', `held/${U(42)}.jpg`, key(43), null]) {
      expect(await svc(fakeDb().prisma, st.storage).copyToHeld(OWNER, k)).toBeNull();
    }
    const broken = fakeStorage(['held/'], { [SRC]: bytes });
    expect(await svc(fakeDb().prisma, broken.storage).copyToHeld(OWNER, SRC)).toBeNull();
  });

  it('attachHeld: anexa a privada e põe original + miniatura públicas na fila com moved_to (saem já)', async () => {
    const f = fakeDb();
    const held = `held/${U(44)}.jpg`;
    const keys = await svc(f.prisma, fakeStorage().storage).attachHeld(
      f.db as never,
      OWNER,
      held,
      SRC,
      SRC_T,
    );
    expect(keys).toEqual([SRC, SRC_T]);
    const [attach, enqueue] = f.exec;
    expect(attach.sql).toContain('SET attached_at = now(), delete_after = NULL');
    expect(attach.values).toEqual([held]);
    expect(enqueue.sql).toMatch(
      /INSERT INTO media_objects[\s\S]*moved_to[\s\S]*ON CONFLICT \(key\) DO UPDATE/,
    );
    expect(enqueue.sql).toContain('moved_to = EXCLUDED.moved_to');
    expect(enqueue.values).toEqual([SRC, OWNER, SRC_T, held]);
  });

  it('attachHeld: legado (miniatura = original) só enfileira a chave; URL externa não enfileira nada', async () => {
    const f = fakeDb();
    const s = svc(f.prisma, fakeStorage().storage);
    const legacyUrl = `http://192.168.0.9:3000/uploads/${U(45)}.png`;
    expect(
      await s.attachHeld(f.db as never, OWNER, `held/${U(46)}.png`, legacyUrl, legacyUrl),
    ).toEqual([`${U(45)}.png`]);
    expect(
      await s.attachHeld(f.db as never, OWNER, `held/${U(47)}.jpg`, 'https://cdn.x/a.jpg', null),
    ).toEqual([]);
  });

  it('drain: cópia pública com moved_to sai mesmo com o dono em retenção — só se a privada existe', async () => {
    const heldOk = `held/${U(48)}.jpg`;
    const heldGone = `held/${U(49)}.jpg`;
    const f = fakeDb({
      due: [
        row(50, { owner_id: HELD_OWNER, moved_to: heldOk }),
        row(51, { owner_id: HELD_OWNER, moved_to: heldGone }),
        row(52, { owner_id: HELD_OWNER }),
      ],
      held: [HELD_OWNER],
    });
    const st = fakeStorage([], { [heldOk]: bytes });
    const r = await svc(f.prisma, st.storage).drain();
    expect(r).toMatchObject({ deleted: 1, held: 2 });
    expect(st.deleted).toEqual([thumb(50), key(50)]);
    expect(st.mock.exists).toHaveBeenCalledWith(heldOk);
    expect(st.mock.exists).toHaveBeenCalledWith(heldGone);
  });

  it('drain: dono sem retenção nem confere a cópia privada (apaga como sempre)', async () => {
    const f = fakeDb({ due: [row(53, { moved_to: `held/${U(54)}.jpg` })] });
    const st = fakeStorage();
    expect((await svc(f.prisma, st.storage).drain()).deleted).toBe(1);
    expect(st.mock.exists).not.toHaveBeenCalled();
  });

  it('moveRetainedToHeld: copia, troca a linha (só se não mudou), enfileira as públicas e chama o GC', async () => {
    const f = fakeDb({
      retainedPublic: [{ id: U(60), user_id: OWNER, url: SRC, thumbnail_url: SRC_T }],
    });
    const st = fakeStorage([], { [SRC]: bytes });
    const s = svc(f.prisma, st.storage);
    const kick = jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    expect(await s.moveRetainedToHeld()).toBe(1);

    const sel = f.queries.find((q) => q.includes('AS move_attempts'))!;
    expect(sel).toContain("(x.moderation_labels -> 'retainedByReport') IS NOT NULL");
    expect(sel).toContain("x.url !~ '^held/'");
    const swap = f.exec.find((e) => e.sql.includes('UPDATE photos SET url'))!;
    const held = swap.values[0] as string;
    expect(held).toMatch(/^held\//);
    // compara com o que leu (a pessoa/moderação pode ter mexido no meio) e exige que ainda seja retida
    expect(swap.sql).toMatch(
      /AND url = \?[\s\S]*COALESCE\(thumbnail_url, ''\) = \?[\s\S]*retainedByReport/,
    );
    expect(swap.values.slice(2)).toEqual([U(60), SRC, SRC_T]);
    expect(kick).toHaveBeenCalledWith([SRC, SRC_T]);
  });

  it('moveRetainedToHeld: linha mudou no meio → a cópia privada é abandonada (vai pro GC)', async () => {
    const f = fakeDb({
      retainedPublic: [{ id: U(61), user_id: OWNER, url: SRC, thumbnail_url: null }],
      swapMisses: true,
    });
    const s = svc(f.prisma, fakeStorage([], { [SRC]: bytes }).storage);
    const kick = jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    expect(await s.moveRetainedToHeld()).toBe(0);
    const abandon = f.exec.find((e) =>
      e.sql.includes(
        'UPDATE media_objects SET delete_after = now() WHERE key = ? AND attached_at IS NULL',
      ),
    )!;
    expect(abandon.values[0]).toMatch(/^held\//);
    expect(kick).toHaveBeenCalledWith([abandon.values[0]]);
  });

  it('drain: erro do storage ao conferir a cópia privada é FALHA (backoff curto), não "não existe" (30 dias)', async () => {
    const heldX = `held/${U(55)}.jpg`;
    const f = fakeDb({
      due: [row(56, { owner_id: HELD_OWNER, moved_to: heldX })],
      held: [HELD_OWNER],
    });
    // HEAD da held/ dá 503
    const st = fakeStorage([heldX], { [heldX]: bytes });
    const r = await svc(f.prisma, st.storage).drain();
    expect(r).toMatchObject({ leased: 1, failed: 1, held: 0, deleted: 0 });
    // nada de adiar 30 dias: só o erro fica gravado e o lease (10 min·2^tentativas) traz de volta
    expect(kinds(f.exec, key(56))).toEqual(['error']);
    expect(f.exec.find((e) => e.kind === 'error')!.values[0]).toBe(`S3 HEAD ${heldX} → 503`);
    expect(st.mock.delete).not.toHaveBeenCalled();
  });

  it('moveRetainedToHeld: pula as que estão no backoff e as de arquivo sumido (marca definitiva)', async () => {
    const f = fakeDb();
    const now = new Date('2026-10-05T12:00:00.000Z');
    await svc(f.prisma, fakeStorage().storage).moveRetainedToHeld(10, now);
    const call = callOf(f.db.$queryRaw.mock.calls[0]);
    expect(call.sql).toContain("(x.moderation_labels #> '{retainedByReport,moveFinal}') IS NULL");
    expect(call.sql).toContain(
      "COALESCE(x.moderation_labels #>> '{retainedByReport,moveRetryAt}', '') <= ?",
    );
    // ISO do agora (comparado como texto: lixo na marca nunca derruba a consulta) e o lote
    expect(call.values).toEqual([now.toISOString(), 10]);
  });

  it('moveRetainedToHeld: storage fora marca a tentativa e a próxima hora (backoff), sem trocar a linha', async () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    const f = fakeDb({
      retainedPublic: [
        { id: U(63), user_id: OWNER, url: SRC, thumbnail_url: null },
        { id: U(64), user_id: OWNER, url: key(41), thumbnail_url: null, move_attempts: 3 },
      ],
    });
    // PUT em held/ quebrado
    const st = fakeStorage(['held/'], { [SRC]: bytes, [key(41)]: bytes });
    expect(await svc(f.prisma, st.storage).moveRetainedToHeld(50, now)).toBe(0);
    expect(f.exec.some((e) => e.sql.includes('UPDATE photos SET url'))).toBe(false);
    const marks = f.exec.filter((e) => e.sql.includes('jsonb_set(moderation_labels'));
    expect(marks).toHaveLength(2);
    // preserva o resto da marca (|| no objeto) e só mexe se a linha não mudou desde a leitura
    expect(marks[0].sql).toMatch(/'\{retainedByReport\}'[\s\S]*\|\| \?::jsonb\)/);
    expect(marks[0].sql).toMatch(/WHERE id = \?::uuid AND url = \?/);
    expect(marks[0].values.slice(1)).toEqual([U(63), SRC]);
    const first = JSON.parse(marks[0].values[0] as string) as Record<string, unknown>;
    expect(first).toMatchObject({ moveAttempts: 1, moveRetryAt: '2026-10-05T12:30:00.000Z' });
    expect(first.moveError).toMatch(/^S3 PUT held\/.+ → 500$/);
    expect(first).not.toHaveProperty('moveFinal');
    // 4ª falha: 30 min·2^3 = 4 h
    expect(JSON.parse(marks[1].values[0] as string)).toMatchObject({
      moveAttempts: 4,
      moveRetryAt: '2026-10-05T16:00:00.000Z',
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it(`moveRetainedToHeld: na ${HELD_MOVE_ALERT_ATTEMPTS}ª falha avisa o Sentry (uma vez)`, async () => {
    const f = fakeDb({
      retainedPublic: [
        {
          id: U(65),
          user_id: OWNER,
          url: SRC,
          thumbnail_url: null,
          move_attempts: HELD_MOVE_ALERT_ATTEMPTS - 1,
        },
      ],
    });
    await svc(f.prisma, fakeStorage(['held/'], { [SRC]: bytes }).storage).moveRetainedToHeld();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(String((Sentry.captureMessage as jest.Mock).mock.calls[0][0])).toContain(U(65));
  });

  it('moveRetainedToHeld: arquivo sumido ganha marca definitiva (moveFinal) e não troca nada; lote entre 1 e 500', async () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    const f = fakeDb({
      retainedPublic: [{ id: U(62), user_id: OWNER, url: SRC, thumbnail_url: null }],
    });
    const s = svc(f.prisma, fakeStorage().storage);
    expect(await s.moveRetainedToHeld(9999, now)).toBe(0);
    expect(callOf(f.db.$queryRaw.mock.calls[0]).values.at(-1)).toBe(500);
    expect(f.exec.some((e) => e.sql.includes('UPDATE photos SET url'))).toBe(false);
    const mark = f.exec.find((e) => e.sql.includes('jsonb_set(moderation_labels'))!;
    expect(JSON.parse(mark.values[0] as string)).toEqual({
      moveAttempts: 1,
      moveFinal: 'missing',
      moveFinalAt: now.toISOString(),
    });
    // nada de cópia órfã registrada
    expect(f.exec.some((e) => e.sql.includes('INSERT INTO media_objects'))).toBe(false);
  });

  it('moveRetainedToHeld: original sumido com a miniatura pública no storage → a miniatura vai pra held/, a linha troca e a pública vai pro GC', async () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    const thumbBytes = Buffer.from('jpeg-da-miniatura');
    const f = fakeDb({
      retainedPublic: [{ id: U(66), user_id: OWNER, url: SRC, thumbnail_url: SRC_T }],
    });
    const st = fakeStorage([], { [SRC_T]: thumbBytes });
    const s = svc(f.prisma, st.storage);
    const kick = jest.spyOn(s, 'kick').mockImplementation(() => undefined);
    expect(await s.moveRetainedToHeld(50, now)).toBe(1);

    const swap = f.exec.find((e) => e.sql.includes('UPDATE photos SET url'))!;
    const held = swap.values[0] as string;
    expect(held).toMatch(/^held\/[0-9a-f-]{36}\.jpg$/);
    expect(st.files[held].equals(thumbBytes)).toBe(true);
    // a troca já grava a marca (miniatura + original que não volta), com a mesma trava da linha que não mudou
    expect(swap.sql).toMatch(
      /moderation_labels = jsonb_set\(moderation_labels, '\{retainedByReport\}'/,
    );
    expect(JSON.parse(swap.values[2] as string)).toEqual({
      heldFrom: 'thumbnail',
      moveFinal: 'missing',
      moveFinalAt: now.toISOString(),
    });
    expect(swap.values.slice(3)).toEqual([U(66), SRC, SRC_T]);
    // nenhuma marca solta de "falhou" (a definitiva só veio com a miniatura protegida)
    expect(f.exec.some((e) => e.sql.includes('SET moderation_labels = jsonb_set'))).toBe(false);
    // original (sumido) + miniatura na fila com moved_to e pro GC na hora
    const queued = f.exec.find((e) => e.sql.includes('INSERT INTO media_objects AS m'))!;
    expect(queued.values).toEqual([SRC, OWNER, SRC_T, held]);
    expect(kick).toHaveBeenCalledWith([SRC, SRC_T]);
  });

  it('moveRetainedToHeld: original sumido e a miniatura não copia (storage fora) → backoff, sem marca definitiva', async () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    const f = fakeDb({
      retainedPublic: [{ id: U(67), user_id: OWNER, url: SRC, thumbnail_url: SRC_T }],
    });
    const s = svc(f.prisma, fakeStorage(['held/'], { [SRC_T]: bytes }).storage);
    expect(await s.moveRetainedToHeld(50, now)).toBe(0);
    expect(f.exec.some((e) => e.sql.includes('UPDATE photos SET url'))).toBe(false);
    const mark = f.exec.find((e) => e.sql.includes('jsonb_set(moderation_labels'))!;
    const patch = JSON.parse(mark.values[0] as string) as Record<string, unknown>;
    expect(patch).toMatchObject({ moveAttempts: 1, moveRetryAt: '2026-10-05T12:30:00.000Z' });
    expect(patch).not.toHaveProperty('moveFinal');
  });

  it('moveRetainedToHeld: original e miniatura sumidos (ou miniatura = original, fakes/, held/) → marca definitiva', async () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    for (const thumbnail_url of [SRC_T, SRC, 'fakes/fake-1.jpg', `held/${U(68)}.jpg`]) {
      const f = fakeDb({
        retainedPublic: [{ id: U(69), user_id: OWNER, url: SRC, thumbnail_url }],
      });
      const st = fakeStorage([], { 'fakes/fake-1.jpg': bytes, [`held/${U(68)}.jpg`]: bytes });
      expect(await svc(f.prisma, st.storage).moveRetainedToHeld(50, now)).toBe(0);
      expect(st.mock.put).not.toHaveBeenCalled();
      const mark = f.exec.find((e) => e.sql.includes('jsonb_set(moderation_labels'))!;
      expect(JSON.parse(mark.values[0] as string)).toMatchObject({ moveFinal: 'missing' });
    }
  });

  it('heldMoveRetryAt: 30 min·2^(tentativas-1), no máximo 1 dia', () => {
    const now = new Date('2026-10-05T00:00:00.000Z');
    const plus = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
    expect(heldMoveRetryAt(0, now)).toBe(plus(30));
    expect(heldMoveRetryAt(1, now)).toBe(plus(30));
    expect(heldMoveRetryAt(2, now)).toBe(plus(60));
    expect(heldMoveRetryAt(3, now)).toBe(plus(120));
    expect(heldMoveRetryAt(6, now)).toBe(plus(960));
    expect(heldMoveRetryAt(7, now)).toBe(plus(1440));
    expect(heldMoveRetryAt(500, now)).toBe(plus(1440));
  });
});

describe('MediaGcTask', () => {
  it('releaseRetained: PRIMEIRO move as que faltam pra held/, DEPOIS solta; não derruba o cron se falhar', async () => {
    const ok = jest.fn().mockResolvedValue(3);
    const move = jest.fn().mockResolvedValue(1);
    await new MediaGcTask({
      releaseRetainedPhotos: ok,
      moveRetainedToHeld: move,
    } as unknown as MediaGcService).releaseRetained();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    // a que fecha com ação só sai já em held/ (senão a pública ficaria 180 dias no ar)
    expect(move.mock.invocationCallOrder[0]).toBeLessThan(ok.mock.invocationCallOrder[0]);
    // a mudança pra held/ falhou: a soltura roda igual (e a falha dela também não derruba o cron)
    const boom = jest.fn().mockRejectedValue(new Error('banco caiu'));
    const move2 = jest.fn().mockRejectedValue(new Error('storage fora'));
    await expect(
      new MediaGcTask({
        releaseRetainedPhotos: boom,
        moveRetainedToHeld: move2,
      } as unknown as MediaGcService).releaseRetained(),
    ).resolves.toBeUndefined();
    expect(move2).toHaveBeenCalledTimes(1);
    expect(boom).toHaveBeenCalledTimes(1);
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
