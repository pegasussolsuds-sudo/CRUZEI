// Motor do mapa com o MLRN, o raster e o disco de mentira: o que importa pro desempenho e pra silhueta presa.
//   - anéis pulsam alguns segundos e param (cada passo redesenha o mapa inteiro);
//   - o giro automático da câmera roda uma vez, não a cada 50 s;
//   - figura própria só pra quem aparece solto na tela (quem está num grupo não rasteriza nada);
//   - figura parada sempre antes de quadro de animação na fila, e quadro velho sai da fila.

import type { MapUser } from '../../../bridge';
import type { AvatarDef } from '../../contracts';
import { mapImages } from '../../images/store';
import { MapEngine, RING_REST, SRC } from '../MapEngine';

// (o babel-jest sobe os jest.mock pra antes dos imports)

// o pacote é ESM (exports: index.js); o UMD de dist serve pro jest
jest.mock('supercluster', () => jest.requireActual('../../../../../../../../node_modules/supercluster/dist/supercluster.js'));
jest.mock('../../images/draw', () => ({ mapDraw: new Proxy({}, { get: () => () => new Uint8Array([1]) }), clearDrawCaches: () => {} }));
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
const DEF: AvatarDef = { l: [], p: { scene: null } as unknown as AvatarDef['p'] };

function user(id: string, pos: { lat: number; lng: number }): MapUser {
  return { id, name: id, label: id, avatarKey: 'k-' + id, aura: '', isAnonymous: false, isBoosted: false, premiumTier: 'free', isVerified: false, isOnline: true, photo: null, isNew: false, mutual: false, mapPosition: pos } as unknown as MapUser;
}

function setup(tier: 'high' | 'mid' = 'mid') {
  const setStop = jest.fn(() => Promise.resolve());
  const engine = new MapEngine({ emit: () => {}, initTheme: 'night', initTier: tier });
  engine.attach({ current: { queryRenderedFeatures: () => Promise.resolve([]) } } as never, { current: { setStop } } as never);
  for (const id of Object.values(SRC)) engine.attachSource(id, { current: { setFeatureStates: () => Promise.resolve(), setFeatureState: () => Promise.resolve() } } as never);
  engine.onStyleLoaded();
  engine.onMapLoaded();
  // câmera no z16,5 com ~340 m x 680 m de tela em volta de mim
  engine.onRegionDidChange({ center: ME, zoom: 16.5, bearing: 0, pitch: 0, bounds: [ME[0] - 170 * M_LNG, ME[1] - 260 * M_LAT, ME[0] + 170 * M_LNG, ME[1] + 420 * M_LAT] } as never);
  const phases: number[] = [];
  engine.ch.subscribe('phase', () => phases.push(engine.ch.get('phase')));
  return { engine, setStop, phases };
}

function defineAll(engine: MapEngine, users: MapUser[]) {
  const defs: Record<string, AvatarDef> = { 'k-me': DEF };
  for (const u of users) defs[u.avatarKey] = DEF;
  engine.run({ fn: 'defineAvatars', args: [defs] });
}

function setMe(engine: MapEngine) {
  engine.run({ fn: 'setMe', args: [{ lat: ME[1], lng: ME[0], heading: null, tier: 'free', isBoosted: false, isAnonymous: false, photoUrl: null, name: 'eu', avatarKey: 'k-me', aura: '' }] });
}

/** quem tem figura própria (fora eu) */
function owned(engine: MapEngine): string[] {
  return engine.stats().own;
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('anéis (sonar, eu, auras)', () => {
  it('pulsam alguns segundos e param num desenho fixo; parado, o relógio dorme', async () => {
    const { engine, phases } = setup();
    setMe(engine); // liga o anel do eu
    await jest.advanceTimersByTimeAsync(2000);
    const live = phases.length;
    expect(live).toBeGreaterThan(10); // pulsando (15 fps no tier mid)
    await jest.advanceTimersByTimeAsync(4000);
    expect(engine.ch.get('phase')).toBe(RING_REST);
    const atRest = phases.length;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(phases.length).toBe(atRest); // um minuto parado: nenhum passo de anel
    expect(jest.getTimerCount()).toBeLessThan(5);
  });

  it('voltam a pulsar quando algo novo aparece (seleção) e param de novo', async () => {
    const { engine, phases } = setup();
    setMe(engine);
    const u = user('a', at(30, 30));
    defineAll(engine, [u]);
    engine.run({ fn: 'setData', args: [{ users: [u], pois: [] }] });
    await jest.advanceTimersByTimeAsync(10_000);
    const before = phases.length;
    engine.run({ fn: 'select', args: ['a'] });
    await jest.advanceTimersByTimeAsync(2000);
    expect(phases.length).toBeGreaterThan(before + 10);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(engine.ch.get('phase')).toBe(RING_REST);
  });
});

describe('giro automático da câmera (tier high)', () => {
  it('uma volta só, não a cada 50 s', async () => {
    const { engine, setStop } = setup('high');
    setMe(engine);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    const spins = setStop.mock.calls.filter((c) => (c as unknown as [{ duration?: number }])[0]?.duration === 20_000);
    expect(spins.length).toBe(1);
  });
});

describe('figura própria', () => {
  it('só pra quem aparece solto na tela: quem está num grupo não rasteriza', async () => {
    const { engine } = setup();
    setMe(engine);
    // 40 pessoas num bar (grupo) e 6 espalhadas, longe umas das outras (soltas)
    const crowd = Array.from({ length: 40 }, (_, i) => user('g' + i, at(100 + (i % 5), 100 + Math.floor(i / 5))));
    const loose = [at(-150, -200), at(150, -200), at(-150, 380), at(150, 380), at(-150, 100), at(0, -230)].map((p, i) => user('s' + i, p));
    defineAll(engine, [...crowd, ...loose]);
    engine.run({ fn: 'setData', args: [{ users: [...crowd, ...loose], pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    const own = owned(engine);
    expect(own.sort()).toEqual(loose.map((u) => u.id).sort());
    // as soltas apontam pra figura própria (nada de silhueta presa)
    const imgs = engine
      .features('users')
      .filter((f) => !(f.properties as Record<string, unknown>).cluster)
      .map((f) => (f.properties as Record<string, unknown>).img);
    expect(imgs.length).toBe(loose.length);
    expect(imgs.every((img) => typeof img === 'string' && !img.startsWith('sil') && img !== 'fig-generic')).toBe(true);
  });
});

describe('teto de figuras próprias', () => {
  it('arrastar o mapa não soma figuras: fica no teto do tier (mid = 45)', async () => {
    const { engine } = setup();
    setMe(engine);
    // grade de 200 m (acima do raio do grupo no z15): todo mundo solto, 441 pessoas
    const us: MapUser[] = [];
    for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) us.push(user(`u${x}_${y}`, at(x * 200, y * 200)));
    defineAll(engine, us);
    const cam = (east: number, north: number) => {
      const c = at(east, north);
      engine.onRegionChange({ userInteraction: true, animated: false, center: [c.lng, c.lat], zoom: 15.2, bearing: 0, pitch: 0, bounds: [c.lng - 700 * M_LNG, c.lat - 1400 * M_LAT, c.lng + 700 * M_LNG, c.lat + 1400 * M_LAT] } as never);
    };
    cam(0, 0);
    engine.run({ fn: 'setData', args: [{ users: us, pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    const counts = [owned(engine).length];
    for (const [e, n] of [[400, 0], [800, 0], [800, 600], [400, 600], [0, 600]]) {
      cam(e, n);
      await jest.advanceTimersByTimeAsync(3000); // moveEnded vem 250 ms depois
      counts.push(owned(engine).length);
    }
    // era 45, 53, 47, 62, 66, 75 (teto mole: quem sobrava de uma câmera anterior e seguia na tela nunca soltava)
    for (const n of counts) expect(n).toBeLessThanOrEqual(45);
    expect(counts[counts.length - 1]).toBe(45);
  });
});

describe('fila de imagens', () => {
  it('figura parada vem antes de quadro de animação, e quadro de quem parou sai da fila', async () => {
    const req = jest.spyOn(mapImages, 'request');
    const { engine } = setup();
    setMe(engine);
    const us = [user('w1', at(-40, 20)), user('w2', at(60, -60)), user('w3', at(-120, 300))];
    defineAll(engine, us);
    engine.run({ fn: 'setData', args: [{ users: us, pois: [] }] });
    await jest.advanceTimersByTimeAsync(2000);
    // todos andam ~60 m (caminhada de 40 s não: 1,5 m/s → ~9 s, teto)
    const moved = us.map((u, i) => user(u.id, at([-40, 60, -120][i] + 50, [20, -60, 300][i] + 30)));
    engine.run({ fn: 'setData', args: [{ users: moved, pois: [] }] });
    await jest.advanceTimersByTimeAsync(1500);
    const pri = (prefix: string) => req.mock.calls.filter((c) => String(c[0]).startsWith(prefix)).map((c) => Number(c[1]));
    const statics = pri('fig|');
    const frames = pri('fr|');
    expect(statics.length).toBeGreaterThan(0);
    expect(frames.length).toBeGreaterThan(0);
    expect(Math.min(...frames)).toBeGreaterThan(Math.max(...statics));
    // fim das caminhadas: nenhum quadro pendente fica na fila
    await jest.advanceTimersByTimeAsync(15_000);
    expect(mapImages.stats().queued).toBe(0);
    req.mockRestore();
  });
});
