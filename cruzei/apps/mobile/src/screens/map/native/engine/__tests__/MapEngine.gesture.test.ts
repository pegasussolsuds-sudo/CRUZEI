// Dedo no mapa (rodada 3): enquanto o gesto dura, nenhum commit do React vindo do mapa (cada commit é uma montagem na
// thread de UI e fazia a sobreposição RN redesenhar no arraste: 342 quadros em ~12 s no S23). O que mudou no gesto sai
// num lote só quando ele acaba, sem a vaga trocada e a feature que aponta pra ela no mesmo commit.
// MapEngine de verdade com o relógio do jest; o MLRN, o raster e o disco são de mentira (como no MapEngine.load.test).

import type { MapEvent, MapUser } from '../../../bridge';
import type { AvatarDef } from '../../contracts';
import { Channels } from '../channels';
import { MapEngine, SRC } from '../MapEngine';
import { mapImages } from '../../images/store';
import { monoNow } from '../../../../../services/frameBatch';

jest.mock('supercluster', () => jest.requireActual('../../../../../../../../node_modules/supercluster/dist/supercluster.js'));
/** quadros de animação rasterizados (mapDraw.figure com pose) */
const mockDraws = { frames: 0 };
jest.mock('../../images/draw', () => ({
  mapDraw: new Proxy(
    {},
    {
      get: (_t, name) =>
        (...a: unknown[]) => {
          if (name === 'figure' && a[3] != null) mockDraws.frames++;
          return new Uint8Array([1]);
        },
    },
  ),
  clearDrawCaches: jest.fn(),
}));
jest.mock('../../images/photos', () => ({
  mapPhotos: { retryAt: () => 0, status: () => 'none', request: () => Promise.resolve(false), thumb: () => null, reprioritize: () => {} },
}));
jest.mock('expo-file-system', () => {
  const mockFiles = new Set<string>();
  class Directory {
    uri = 'file:///cache/mapimg/';
    exists = true;
    size = 0;
    create() {}
    listAsRecords() {
      return [];
    }
  }
  class File {
    private mockName: string;
    constructor(_d: unknown, n: string) {
      this.mockName = n;
    }
    get exists() {
      return mockFiles.has(this.mockName);
    }
    write() {
      mockFiles.add(this.mockName);
    }
    rename(n: string) {
      mockFiles.delete(this.mockName);
      mockFiles.add(n);
    }
    delete() {
      mockFiles.delete(this.mockName);
    }
  }
  return { Directory, File, Paths: { cache: {} } };
});

const ME: [number, number] = [-48.271, -18.924];
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((ME[1] * Math.PI) / 180));
const at = (east: number, north: number) => ({ lat: ME[1] + north * M_LAT, lng: ME[0] + east * M_LNG });
const TOPS = ['c_black', 'c_white', 'c_red', 'c_orange', 'c_yellow', 'c_green', 'c_denim', 'c_navy'];
const defOf = (i: number): AvatarDef => ({ l: [], p: { scene: null } as unknown as AvatarDef['p'], c: { outer: 'none', topColor: TOPS[i % TOPS.length], skin: 's4' } as unknown as AvatarDef['c'] });
const user = (id: string, pos: { lat: number; lng: number }, i: number): MapUser =>
  ({ id, name: id, label: id, avatarKey: 'k' + (i % 40), aura: '', isAnonymous: false, isBoosted: i % 25 === 0, premiumTier: 'premium_plus', isVerified: false, isOnline: true, photo: null, isNew: false, mutual: false, mapPosition: pos }) as unknown as MapUser;

function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const crowd = (n: number, R: () => number, radius = 300, from = 0) =>
  Array.from({ length: n }, (_, k) => {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * radius;
    return user('p' + (from + k), at(Math.cos(a) * d, Math.sin(a) * d), from + k);
  });
const moveSome = (people: MapUser[], R: () => number, step: number) =>
  people.map((u, i) => {
    if (R() >= 0.6) return u;
    const p = u.mapPosition as { lat: number; lng: number };
    return user(u.id, at((p.lng - ME[0]) / M_LNG + (R() - 0.5) * step, (p.lat - ME[1]) / M_LAT + (R() - 0.5) * step), i);
  });

function setup(zoom: number, emit: (ev: MapEvent) => void = () => {}) {
  const engine = new MapEngine({ emit, initTheme: 'night', initTier: 'high' });
  engine.attach({ current: { queryRenderedFeatures: () => Promise.resolve([]) } } as never, { current: { setStop: () => Promise.resolve() } } as never);
  for (const id of Object.values(SRC)) engine.attachSource(id, { current: { setFeatureStates: () => Promise.resolve(), setFeatureState: () => Promise.resolve() } } as never);
  engine.onStyleLoaded();
  engine.onMapLoaded();
  const defs: Record<string, AvatarDef> = { 'k-me': defOf(99) };
  for (let i = 0; i < 40; i++) defs['k' + i] = defOf(i);
  engine.run({ fn: 'defineAvatars', args: [defs] });
  const me = (east: number, north: number) => {
    const c = at(east, north);
    engine.run({ fn: 'setMe', args: [{ lat: c.lat, lng: c.lng, heading: null, tier: 'free', isBoosted: false, isAnonymous: false, photoUrl: null, name: 'eu', avatarKey: 'k-me', aura: '' }] });
  };
  me(0, 0);
  /** evento de câmera: gesto = dedo no mapa (userInteraction sem animação); pitch fixo de 58° (arrastar não inclina) */
  const cam = (east: number, north: number, gesture: boolean, extra: Record<string, unknown> = {}) => {
    const c = at(east, north);
    const mpp = (78271.517 * Math.cos((ME[1] * Math.PI) / 180)) / Math.pow(2, zoom);
    const hw = 192 * mpp;
    const hh = 417 * mpp;
    const ev = { userInteraction: gesture, animated: false, center: [c.lng, c.lat], zoom, bearing: -12, pitch: 58, bounds: [c.lng - hw * M_LNG, c.lat - hh * 0.8 * M_LAT, c.lng + hw * M_LNG, c.lat + hh * 1.25 * M_LAT], ...extra };
    if (gesture) engine.onRegionChange(ev as never);
    else engine.onRegionDidChange(ev as never);
  };
  cam(0, 0, false);
  return { engine, cam, me };
}

/** canais que algum componente do <Map> assina (layers.tsx, NativeMap.tsx) */
const RENDERED = [...Object.keys(SRC), 'images', 'phase', 'rings', 'look', 'buildingScale', 'pinLook', 'horizon'] as const;

type Groups = Record<string, Record<string, { source: { uri: string } }>>;
const keyByPath = () => {
  const out = new Map<string, string>();
  for (const [k, r] of (mapImages as unknown as { refs: Map<string, { path: string }> }).refs) out.set(r.path, k);
  return out;
};
/** visual de uma imagem (avatar + selo + tamanho): troca de quadro do mesmo visual não é troca de dona */
const familyOf = (key: string | undefined) => (key ? key.split('|').slice(0, 4).join('|').replace(/^fr\|/, 'fig|') : '?');

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  (mapImages as unknown as { timer: unknown }).timer = null;
  jest.useRealTimers();
});

describe('canais com o lote preso (hold)', () => {
  it('nada sai com o lote preso, só os canais live; soltar entrega o resto num lote; o componente lê o valor entregue', async () => {
    const ch = new Channels<{ a: number; h: number; u: number }>({ a: 0, h: 0, u: 0 });
    ch.minGapMs = 66;
    ch.live.add('h');
    ch.urgent.add('u');
    const seen: string[] = [];
    for (const k of ['a', 'h', 'u'] as const) ch.subscribe(k, () => seen.push(k + ch.view(k)));
    ch.hold(true);
    ch.set('a', 1);
    ch.set('u', 1); // urgente também espera
    ch.set('h', 1); // live sai
    await jest.advanceTimersByTimeAsync(500);
    expect(seen).toEqual(['h1']);
    expect(ch.get('a')).toBe(1); // o motor já vê o novo
    expect(ch.view('a')).toBe(0); // o componente, não
    ch.set('a', 2);
    await jest.advanceTimersByTimeAsync(500);
    expect(seen).toEqual(['h1']);
    ch.hold(false);
    await Promise.resolve();
    expect(seen).toEqual(['h1', 'a2', 'u1']); // um lote só, com o valor final
    expect(ch.flushes).toBe(2);
  });
});

describe('dedo no mapa', () => {
  it('arrastar 2 s sob 300 pessoas andando, refetch com gente nova, eu andando e figuras animando: zero commits; no fim um lote com tudo certo', async () => {
    const R = rnd(21);
    const { engine, cam, me } = setup(17);
    const P = engine as unknown as { figs: Map<string, { own: boolean; imgReady: boolean }> };
    let people = crowd(300, R);
    engine.run({ fn: 'setPin', args: [{ id: 'bar', lat: at(40, 60).lat, lng: at(40, 60).lng, name: 'Bar do Léo', emoji: '🍺', nightlife: true }, false] });
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(8000);
    people = moveSome(people, R, 120); // gente andando de verdade quando o dedo encosta
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(700);

    // cada lote: quando saiu e o que entregou (o que o React desenha); e o que mudou de dona nas vagas
    const log: { t: number; flush: number; key: string }[] = [];
    for (const k of RENDERED) engine.ch.subscribe(k as never, () => log.push({ t: monoNow(), flush: engine.ch.flushes, key: k }));
    const slotFamily = new Map<string, { fam: string; since: number }>();
    let earlyPointers = 0;
    let swaps = 0;
    const readSlots = (since: (was: boolean) => number) => {
      const byPath = keyByPath();
      for (const g of Object.values(engine.ch.view('images') as Groups))
        for (const [n, e] of Object.entries(g)) {
          if (!/^cz|^silc-/.test(n)) continue;
          const fam = familyOf(byPath.get(e.source.uri));
          const was = slotFamily.get(n);
          if (!was || was.fam !== fam) {
            if (was) swaps++;
            slotFamily.set(n, { fam, since: since(Boolean(was)) });
          }
        }
    };
    readSlots(() => -Infinity); // o que já estava entregue antes de começar a olhar
    engine.ch.subscribe('images', () => readSlots(() => monoNow()));
    // invariante do boneco trocado: nenhuma feature ENTREGUE aponta pra uma vaga que trocou de visual há menos de 160 ms
    // (inclusive no mesmo lote: era o risco do lote preso soltar a vaga trocada e a feature juntas; com a espera antiga,
    // contada do pedido e não do lote, este teste dá 52)
    const checkPointers = () => {
      const now = monoNow();
      for (const k of ['users', 'usersBoost', 'movers', 'spot'] as const)
        for (const f of (JSON.parse(engine.ch.view(k)) as GeoJSON.FeatureCollection).features) {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          for (const key of ['img', 'ph']) {
            const sl = typeof p[key] === 'string' ? slotFamily.get(p[key] as string) : undefined;
            if (sl && now - sl.since < 160) earlyPointers++;
          }
        }
    };
    for (const k of ['users', 'usersBoost', 'movers', 'spot'] as const) engine.ch.subscribe(k, checkPointers);

    // dedo no mapa: 2 s arrastando (um evento por quadro de 16 ms), com tudo acontecendo junto
    const flushes0 = engine.ch.flushes;
    const sends0 = engine.stats().sends;
    const log0 = log.length;
    const newcomers = crowd(25, R, 120, 1000);
    for (let i = 0; i <= 125; i++) {
      cam(i * 0.6, i * 0.4, true);
      if (i === 30) engine.run({ fn: 'setData', args: [{ users: [...moveSome(people, R, 80), ...newcomers], pois: [] }] }); // refetch no meio
      if (i === 50) me(4, 3); // eu andei (GPS)
      if (i === 70) engine.run({ fn: 'emote', args: ['p3', 'wave'] });
      if (i === 90) engine.run({ fn: 'burst', args: [{ lat: at(10, 10).lat, lng: at(10, 10).lng, kind: 'like' }] }); // urgente: espera também
      await jest.advanceTimersByTimeAsync(16);
    }
    const during = engine.ch.flushes - flushes0;
    const deliveredDuring = log.length - log0;
    expect(during).toBe(0);
    expect(deliveredDuring).toBe(0);
    // o que o React vê ficou no começo do gesto; o motor seguiu (gente nova no refetch)
    expect(engine.ch.view('users')).not.toBe(engine.sourceData('users'));
    // a movers não é montada no ritmo de quem anda (8–15 Hz = 16–30 vezes em 2 s) pra nada: só nos pushes da users (≤ 2/s)
    expect((engine.stats().sends.movers ?? 0) - (sends0.movers ?? 0)).toBeLessThanOrEqual(6);

    // soltou: um lote com tudo, na hora
    cam(125 * 0.6, 125 * 0.4, false);
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.ch.flushes - flushes0).toBe(1);
    for (const k of Object.keys(SRC) as (keyof typeof SRC)[]) expect(engine.ch.view(k)).toBe(engine.sourceData(k));
    // eu ainda onde fui desenhado (a caminhada pedida no gesto parte de quando ele acaba, sem salto) e o pino no lugar dele
    const meAt = () => ((JSON.parse(engine.ch.view('me')) as GeoJSON.FeatureCollection).features[0].geometry as GeoJSON.Point).coordinates;
    expect(meAt()[0]).toBeCloseTo(at(0, 0).lng, 7);
    await jest.advanceTimersByTimeAsync(500);
    expect(meAt()[0]).toBeGreaterThan(at(0, 0).lng);
    const pin = (JSON.parse(engine.ch.view('pin')) as GeoJSON.FeatureCollection).features;
    expect(pin.length).toBe(1);
    expect((pin[0].properties as Record<string, unknown>).id).toBe('bar');
    expect(engine.ch.view('pinLook')).toEqual({ dy: 0, alpha: 1 });

    // depois do gesto a vida segue: quem chegou no gesto ganha figura (nada de silhueta presa) e nenhuma vaga trocada
    // apareceu com a feature apontando cedo
    await jest.advanceTimersByTimeAsync(4000);
    expect(meAt()[0]).toBeCloseTo(at(4, 3).lng, 5);
    expect(meAt()[1]).toBeCloseTo(at(4, 3).lat, 5);
    const stuck = [...P.figs.entries()].filter(([id, f]) => id !== 'me' && f.own && !f.imgReady).length;
    expect(stuck).toBe(0);
    expect(swaps).toBeGreaterThan(0); // houve troca de dona nas vagas durante o teste (senão o invariante não diz nada)
    expect(earlyPointers).toBe(0);
  });

  it('dedo parado no mapa (sem mexer a câmera) não segura os lotes pra sempre: o moveend de 250 ms solta', async () => {
    const { engine, cam } = setup(17);
    engine.run({ fn: 'setData', args: [{ users: crowd(60, rnd(3)), pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    cam(1, 1, true);
    expect(engine.ch.isHeld).toBe(true);
    await jest.advanceTimersByTimeAsync(300);
    expect(engine.ch.isHeld).toBe(false);
  });

  it('animação nossa (flyTo, sem dedo) não prende os lotes', async () => {
    const { engine, cam } = setup(17);
    engine.run({ fn: 'setData', args: [{ users: crowd(60, rnd(4)), pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    const f0 = engine.ch.flushes;
    for (let i = 0; i < 30; i++) {
      // evento de câmera de animação: userInteraction com animated (o MLRN Android manda assim nas nossas)
      const c = at(i, i);
      engine.onRegionChange({ userInteraction: true, animated: true, center: [c.lng, c.lat], zoom: 17, bearing: 0, pitch: 58, bounds: [c.lng - 0.001, c.lat - 0.001, c.lng + 0.001, c.lat + 0.001] } as never);
      if (i === 10) engine.run({ fn: 'select', args: ['p1'] });
      await jest.advanceTimersByTimeAsync(16);
    }
    expect(engine.ch.isHeld).toBe(false);
    expect(engine.ch.flushes - f0).toBeGreaterThan(0);
    void cam;
  });
});

describe('revisão da rodada 3', () => {
  type FigLike = { own: boolean; imgReady: boolean; settling: unknown; move: unknown };
  const figsOf = (engine: MapEngine) => (engine as unknown as { figs: Map<string, FigLike> }).figs;
  const positions = (json: string) =>
    new Map((JSON.parse(json) as GeoJSON.FeatureCollection).features.map((f) => [String((f.properties as { id: string }).id), (f.geometry as GeoJSON.Point).coordinates]));

  it('fps do tier vem do nativo (renderFps na câmera ociosa), não do ritmo dos eventos de câmera', async () => {
    const perf: MapEvent[] = [];
    const { cam } = setup(17, (ev) => ev.type === 'perf' && perf.push(ev));
    // arraste com um evento de câmera a cada 8 ms (lote de toque a 120 Hz, a GL podendo estar a 25 fps): antes dava 60
    for (let i = 0; i < 100; i++) {
      cam(i * 0.2, 0, true);
      await jest.advanceTimersByTimeAsync(8);
    }
    await jest.advanceTimersByTimeAsync(400);
    expect(perf).toEqual([]);
    cam(20, 0, false); // ociosa sem amostra (menos de 20 quadros contados no nativo)
    expect(perf).toEqual([]);
    cam(20, 0, false, { renderFps: 27.6 });
    cam(20, 0, false, { renderFps: 143 }); // painel de 120 Hz sem teto: o tier conta até 60
    expect(perf).toEqual([
      { type: 'perf', fps: 28 },
      { type: 'perf', fps: 60 },
    ]);
  });

  it('quem anda fica onde foi desenhado durante o gesto e retoma dali ao soltar (sem salto), sem rasterizar quadro à toa', async () => {
    const R = rnd(33);
    const { engine, cam } = setup(18.5);
    let people = crowd(120, R, 120);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(8000);
    people = moveSome(people, R, 40);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(600);
    const before = positions(engine.ch.view('movers'));
    expect(before.size).toBeGreaterThan(10);
    const frames0 = mockDraws.frames;
    // 2 s de dedo no mapa
    const trace: number[] = [];
    for (let i = 0; i <= 125; i++) {
      cam(i * 0.3, 0, true);
      await jest.advanceTimersByTimeAsync(16);
      trace.push(mockDraws.frames - frames0);
    }
    // o quadro novo nem apareceria (lote preso): passada a 1ª volta do relógio (o que já estava na fila do raster roda),
    // ninguém rasteriza (eu parado, ninguém selecionado). Antes: um quadro novo por andante a cada passada
    expect(trace[125] - trace[9]).toBe(0);
    cam(125 * 0.3, 0, false);
    await Promise.resolve();
    await Promise.resolve();
    const after = positions(engine.ch.view('movers'));
    let jump = 0;
    let common = 0;
    for (const [id, c] of before) {
      const d = after.get(id);
      if (!d) continue;
      common++;
      jump = Math.max(jump, Math.hypot((d[0] - c[0]) / M_LNG, (d[1] - c[1]) / M_LAT));
    }
    expect(common).toBeGreaterThan(10);
    // o que andou entre o último lote entregue e o dedo encostar (um intervalo da movers): antes, os 2 s inteiros (~3 m)
    expect(jump).toBeLessThan(0.5);
    // e a caminhada segue de onde parou
    await jest.advanceTimersByTimeAsync(1000);
    const later = positions(engine.sourceData('movers'));
    let walked = 0;
    for (const [id, c] of after) {
      const d = later.get(id);
      if (d && Math.hypot((d[0] - c[0]) / M_LNG, (d[1] - c[1]) / M_LAT) > 0.3) walked++;
    }
    expect(walked).toBeGreaterThan(5);
    expect(mockDraws.frames - frames0).toBeGreaterThan(0); // e volta a animar
  });

  it('dispose() no meio da espera de assentamento zera a espera (o attach seguinte arma de novo)', async () => {
    const { engine } = setup(17);
    engine.run({ fn: 'setData', args: [{ users: crowd(40, rnd(6), 100), pois: [] }] });
    const figs = figsOf(engine);
    const waiting = () => [...figs.values()].filter((f) => f.settling).length;
    for (let t = 0; t < 3000 && !waiting(); t += 5) await jest.advanceTimersByTimeAsync(5);
    expect(waiting()).toBeGreaterThan(0);
    engine.attach(null, null);
    engine.dispose();
    await jest.advanceTimersByTimeAsync(2000);
    expect(waiting()).toBe(0);
  });

  it('soltar o gesto de dentro do tick do relógio não cria um segundo relógio', async () => {
    const R = rnd(8);
    const { engine, cam } = setup(18);
    const people = crowd(60, R, 100);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    engine.run({ fn: 'setData', args: [{ users: moveSome(people, R, 40), pois: [] }] });
    await jest.advanceTimersByTimeAsync(300);
    const P = engine as unknown as { loop: () => void; camera: { gestureActive: boolean } };
    const live = new Set<unknown>();
    let most = 0;
    const st = setTimeout;
    const ct = clearTimeout;
    const sSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (fn !== P.loop) return st(fn, ms);
      const id: unknown = st(() => {
        live.delete(id);
        fn();
      }, ms);
      live.add(id);
      most = Math.max(most, live.size);
      return id;
    }) as unknown as typeof setTimeout);
    const cSpy = jest.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: ReturnType<typeof setTimeout>) => {
      live.delete(id);
      ct(id);
    }) as typeof clearTimeout);
    try {
      cam(1, 1, true);
      expect(engine.ch.isHeld).toBe(true);
      // o gesto acaba sem passar pelo updateCommitGap (como depois de um camera.dispose()): quem solta é o tick
      P.camera.gestureActive = false;
      await jest.advanceTimersByTimeAsync(2000);
      expect(engine.ch.isHeld).toBe(false);
      expect(most).toBe(1);
    } finally {
      sSpy.mockRestore();
      cSpy.mockRestore();
    }
  });
});
