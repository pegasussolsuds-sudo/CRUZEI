import { ExpiringCache, SaturatedError, Semaphore, TtlMemo, chunk, historySignature, matchesHomeCells, planCellReload, selectTop, triageForDiscovery, type PresenceLite } from './hot-path';
import { PoiIndex } from './poi-index';
import { distanceMeters } from '@cruzei/shared-utils';

describe('hot-path', () => {
  describe('chunk', () => {
    it('divide em pedaços do tamanho pedido', () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(chunk([], 3)).toEqual([]);
    });
    it('recusa tamanho inválido', () => {
      expect(() => chunk([1], 0)).toThrow();
    });
  });

  describe('Semaphore', () => {
    it('limita a concorrência e passa a vaga pra quem espera', async () => {
      const s = new Semaphore(2);
      let running = 0;
      let peak = 0;
      const task = () =>
        s.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running--;
        });
      await Promise.all(Array.from({ length: 8 }, task));
      expect(peak).toBe(2);
      expect(s.inUse).toBe(0);
      expect(s.waiting).toBe(0);
    });

    it('fila cheia recusa na hora', async () => {
      const s = new Semaphore(1, { maxQueue: 1 });
      await s.acquire();
      const queued = s.acquire();
      await expect(s.acquire()).rejects.toBeInstanceOf(SaturatedError);
      s.release();
      await queued;
      s.release();
      expect(s.inUse).toBe(0);
    });

    it('quem esperou demais é recusado quando chega a vez', async () => {
      let now = 0;
      const s = new Semaphore(1, { maxWaitMs: 100, now: () => now });
      await s.acquire();
      const late = s.acquire();
      now = 500;
      s.release();
      await expect(late).rejects.toMatchObject({ reason: 'wait_timeout' });
      expect(s.inUse).toBe(0);
    });
  });

  describe('ExpiringCache', () => {
    it('expira pelo tempo e poda do mais antigo pro mais novo', () => {
      const c = new ExpiringCache<string, number>(100);
      c.set('a', 1, 0);
      c.set('b', 2, 50);
      expect(c.get('a', 99)).toBe(1);
      expect(c.prune(120)).toBe(1); // só "a" venceu
      expect(c.get('b', 120)).toBe(2);
      expect(c.size).toBe(1);
    });
    it('respeita o teto de tamanho', () => {
      const c = new ExpiringCache<number, number>(1_000, 3);
      for (let i = 0; i < 5; i++) c.set(i, i, 0);
      expect(c.size).toBe(3);
      expect(c.get(0, 1)).toBeUndefined();
      expect(c.get(4, 1)).toBe(4);
    });
    it('guarda null (ausente) diferente de não ter a chave', () => {
      const c = new ExpiringCache<string, number | null>(100);
      c.set('x', null, 0);
      expect(c.get('x', 1)).toBeNull();
      expect(c.get('y', 1)).toBeUndefined();
    });
  });

  describe('TtlMemo', () => {
    it('uma carga só pra quem chega junto e reaproveita dentro da validade', async () => {
      const m = new TtlMemo<string, number>(1_000);
      let loads = 0;
      const loader = async () => {
        loads++;
        return 42;
      };
      const [a, b] = await Promise.all([m.get('k', loader), m.get('k', loader)]);
      expect([a, b]).toEqual([42, 42]);
      await m.get('k', loader);
      expect(loads).toBe(1);
      m.invalidate('k');
      await m.get('k', loader);
      expect(loads).toBe(2);
    });
    it('poda valores vencidos a cada carga (não segura memória de chaves que ninguém mais pede)', async () => {
      const m = new TtlMemo<string, number>(10);
      await m.get('a', async () => 1);
      await m.get('b', async () => 2);
      await new Promise((r) => setTimeout(r, 15));
      await m.get('c', async () => 3);
      expect(m.size).toBe(1);
    });
    it('falha não fica em cache', async () => {
      const m = new TtlMemo<string, number>(1_000);
      await expect(m.get('k', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
      await expect(m.get('k', async () => 7)).resolves.toBe(7);
    });
  });

  describe('selectTop', () => {
    it('mesmo resultado que ordenar tudo e cortar', () => {
      const items = Array.from({ length: 5_000 }, (_, i) => ({ r: (i * 7919) % 3, n: `nome${(i * 104729) % 997}` }));
      const cmp = (a: { r: number; n: string }, b: { r: number; n: string }) => a.r - b.r || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0);
      const { top, rest } = selectTop(items, 300, cmp);
      const expected = items.slice().sort(cmp).slice(0, 300);
      expect(top.map((x) => `${x.r}|${x.n}`)).toEqual(expected.map((x) => `${x.r}|${x.n}`));
      expect(rest).toBe(4_700);
    });
    it('lista menor que o teto volta inteira e ordenada', () => {
      expect(selectTop([3, 1, 2], 10, (a, b) => a - b)).toEqual({ top: [1, 2, 3], rest: 0 });
    });
  });

  describe('triageForDiscovery', () => {
    const area = (p: { lat: number; lng: number }) => `${Math.floor(p.lat * 100)}:${Math.floor(p.lng * 100)}`;
    it('pega quem está no raio e quem entra nas contagens das mesmas áreas/lugares; ignora ocultos', () => {
      const center = { lat: -18.9186, lng: -48.2772 };
      const p = (lat: number, lng: number, extra: Partial<PresenceLite> = {}): PresenceLite => ({ lat, lng, hidden: false, poi: null, ...extra });
      const presences = new Map<string, PresenceLite>([
        ['perto', p(-18.9187, -48.2773)],
        ['mesma-area-fora-do-raio', p(-18.915, -48.2799)], // mesma célula de 0,01° que o centro, mais de 350 m
        ['outra-area', p(-18.95, -48.3)],
        ['no-lugar', p(-18.99, -48.2, { poi: { id: 7 } })],
        ['perto-no-lugar', p(-18.9185, -48.2771, { poi: { id: 7 } })],
        ['oculto', p(-18.9186, -48.2772, { hidden: true })],
      ]);
      const t = triageForDiscovery(center, 350, presences, area);
      expect([...t.inRadius.keys()].sort()).toEqual(['perto', 'perto-no-lugar']);
      expect(t.needed.sort()).toEqual(['mesma-area-fora-do-raio', 'no-lugar', 'perto', 'perto-no-lugar']);
      expect(t.areaOf.has('oculto')).toBe(false);
      // quem consulta fica fora de tudo
      const t2 = triageForDiscovery(center, 350, presences, area, 'perto');
      expect(t2.inRadius.has('perto')).toBe(false);
      expect(t2.needed).not.toContain('perto');
      expect(t2.areaOf.has('perto')).toBe(false);
    });
  });

  it('triagem com pré-filtro por caixa dá o mesmo raio que o haversine em todo mundo (inclusive na borda)', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const center of [{ lat: -18.9186, lng: -48.2772 }, { lat: 59.9, lng: 10.7 }, { lat: 0.001, lng: -179.999 }]) {
      const presences = new Map<string, PresenceLite>();
      for (let i = 0; i < 3_000; i++) {
        // anel entre 300 e 400 m + alguns longe: força casos na borda do raio de 350 m
        const r = i % 10 === 0 ? 2_000 * rand() : 300 + 100 * rand();
        const t = 2 * Math.PI * rand();
        const lat = center.lat + (r * Math.cos(t)) / 111_195;
        const lng = center.lng + (r * Math.sin(t)) / (111_195 * Math.cos((center.lat * Math.PI) / 180));
        presences.set(`p${i}`, { lat, lng, hidden: false, poi: null });
      }
      const t = triageForDiscovery(center, 350, presences, () => 'a');
      const brute = [...presences].filter(([, p]) => distanceMeters(center.lat, center.lng, p.lat, p.lng) <= 350).map(([id]) => id).sort();
      expect([...t.inRadius.keys()].sort()).toEqual(brute);
    }
  });

  it('recarga incremental da célula: reaproveita quem não mudou, relê quem mudou, esquece quem saiu ou venceu', () => {
    const prev = { scores: new Map([['a', 100], ['b', 200], ['c', 300]]), pres: new Map([['a', 'A'], ['b', 'B'], ['c', 'C']]) };
    // b atualizou (score novo), c saiu da célula, d entrou, e está vencido
    const raw = ['a', '100', 'b', '250', 'd', '260', 'e', '10'];
    const plan = planCellReload(raw, prev, 50);
    expect([...plan.keep]).toEqual([['a', 'A']]);
    expect(plan.fetch.sort()).toEqual(['b', 'd']);
    expect([...plan.scores.keys()].sort()).toEqual(['a', 'b', 'd']);
    // primeira carga: todo mundo vivo é lido
    expect(planCellReload(raw, undefined, 50).fetch.sort()).toEqual(['a', 'b', 'd']);
  });

  it('matchesHomeCells', () => {
    expect(matchesHomeCells([], ['a'])).toBe(false);
    expect(matchesHomeCells(['x', 'b'], ['a', 'b'])).toBe(true);
  });

  it('historySignature muda quando muda grade, lugar ou anonimato', () => {
    const base = { latitude: -18.918, longitude: -48.277, geohash: '6utsm7', poiId: null, isAnonymous: false };
    expect(historySignature(base)).toBe(historySignature({ ...base }));
    expect(historySignature(base)).not.toBe(historySignature({ ...base, poiId: 3 }));
    expect(historySignature(base)).not.toBe(historySignature({ ...base, isAnonymous: true }));
  });
});

describe('PoiIndex', () => {
  const idx = new PoiIndex([
    { id: 1, name: 'Bar do Léo', lat: -18.92209, lng: -48.2694, city: 'Uberlândia' },
    { id: 2, name: 'Praça', lat: -18.9186, lng: -48.2772, city: 'Uberlândia' },
    { id: 3, name: 'Longe', lat: -23.55, lng: -46.63, city: 'São Paulo' },
  ]);
  it('acha o lugar mais próximo dentro do raio de encaixe', () => {
    expect(idx.nearest(-18.92212, -48.26943, 60, 40)?.id).toBe(1);
    expect(idx.nearest(-18.93, -48.26, 60, 40)).toBeNull();
  });
  it('busca por retângulo cruzando células da grade', () => {
    expect(idx.inBox(-18.93, -18.91, -48.28, -48.26).map((p) => p.id).sort()).toEqual([1, 2]);
  });
  it('conta por cidade e por id', () => {
    expect(idx.countByCity('Uberlândia')).toBe(2);
    expect(idx.countByCity(null)).toBe(3);
    expect(idx.byId(3)?.name).toBe('Longe');
  });
});
