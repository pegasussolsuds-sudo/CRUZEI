// Rodada 4: transições das figuras e memória depois de interagir. MapEngine de verdade com o relógio do jest; o MLRN, o
// raster e o disco são de mentira (como no MapEngine.load.test). O que conta é o que o NATIVO mostraria: a fonte ENTREGUE
// (ch.view, depois do lote) — com `lag`, a entregue `lag` ms antes (Fabric + parse/re-tiling no worker), enquanto o
// feature-state vale na hora — e a opacidade do estilo, a x g x (h ? 0 : 1).
//   - o grupo abre / a câmera vai e volta / o refetch move a multidão: nenhuma silhueta cinza visível (com o nativo
//     instantâneo e atrasado), ninguém escondido esperando a imagem por muito tempo (nem no fim), e quem está dentro de um
//     grupo não sai andando (empilhado) dele;
//   - figura que nunca sai (raster falhando) não some do mapa; o selecionado não pisca quando o grupo abre;
//   - abrir e fechar o grupo 5 vezes: as imagens EM USO voltam perto do que eram antes.

import type { MapUser } from '../../../bridge';
import type { AvatarDef } from '../../contracts';
import { GENERIC_FIG, MapEngine, SRC } from '../MapEngine';
import { mapImages } from '../../images/store';

jest.mock('supercluster', () => jest.requireActual('../../../../../../../../node_modules/supercluster/dist/supercluster.js'));
// a figura de um visual marcado com c.fail nunca sai (Skia sem memória, disco cheio: o "Caio S." do teste de carga)
jest.mock('../../images/draw', () => ({
  mapDraw: new Proxy(
    {},
    { get: (_t, k) => (k === 'figure' ? (def: { c?: { fail?: boolean } } | null) => (def?.c?.fail ? null : new Uint8Array([1])) : () => new Uint8Array([1])) },
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
const defOf = (i: number, fail = false): AvatarDef => ({ l: [], p: { scene: null } as unknown as AvatarDef['p'], c: { outer: 'none', topColor: TOPS[i % TOPS.length], skin: 's4', fail } as unknown as AvatarDef['c'] });
const user = (id: string, pos: { lat: number; lng: number }, i: number): MapUser =>
  ({ id, name: id, label: id, avatarKey: 'k' + (i % 60), aura: '', isAnonymous: false, isBoosted: i % 25 === 0, premiumTier: 'premium_plus', isVerified: i % 3 === 0, isOnline: true, photo: null, isNew: false, mutual: false, mapPosition: pos }) as unknown as MapUser;

function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** multidão do teste de carga: metade num aglomerado de 70 m (o grupo da captura do S23), o resto em 300 m */
const crowd = (R: () => number) =>
  Array.from({ length: 300 }, (_, i) => {
    const dense = i % 2 === 0;
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * (dense ? 70 : 300);
    return user('p' + i, at((dense ? 60 : 0) + Math.cos(a) * d, (dense ? 40 : 0) + Math.sin(a) * d), i);
  });
const moveSome = (people: MapUser[], R: () => number) =>
  people.map((u, i) => {
    if (R() >= 0.6) return u;
    const p = u.mapPosition as { lat: number; lng: number };
    return user(u.id, at((p.lng - ME[0]) / M_LNG + (R() - 0.5) * 120, (p.lat - ME[1]) / M_LAT + (R() - 0.5) * 120), i);
  });
type Props = Record<string, unknown>;
const propsOf = (f: GeoJSON.Feature) => (f.properties ?? {}) as Props;

/**
 * `lag`: o nativo aplica a fonte entregue só depois disso (ms); `failEvery`: o visual com i % failEvery === 0 nunca rasteriza;
 * `keys`: prefixo das chaves dos visuais (o store de imagens é um só no arquivo: chave nova = figura ainda não desenhada)
 */
function setup({ lag = 0, failEvery = 0, keys = 'k' }: { lag?: number; failEvery?: number; keys?: string } = {}) {
  const engine = new MapEngine({ emit: () => {}, initTheme: 'night', initTier: 'high' });
  engine.attach({ current: { queryRenderedFeatures: () => Promise.resolve([]) } } as never, { current: { setStop: () => Promise.resolve() } } as never);
  /** feature-state aplicado no nativo: fonte -> id -> {a, g, pa} */
  const fs = new Map<string, Map<string, Record<string, number>>>();
  for (const id of Object.values(SRC)) {
    const m = new Map<string, Record<string, number>>();
    fs.set(id, m);
    const put = (fid: unknown, st: Record<string, number>) => m.set(String(fid), { ...(m.get(String(fid)) ?? {}), ...st });
    engine.attachSource(id, {
      current: {
        setFeatureStates: (e: { id: unknown; state: Record<string, number> }[]) => {
          for (const x of e) put(x.id, x.state);
          return Promise.resolve();
        },
        setFeatureState: (f: { id: unknown }, st: Record<string, number>) => {
          put(f.id, st);
          return Promise.resolve();
        },
      },
    } as never);
  }
  // o que o nativo tem de cada fonte de pessoas: a entregue há pelo menos `lag` ms
  const PEOPLE = ['users', 'usersBoost', 'movers', 'spot'] as const;
  const hist = new Map<string, { at: number; json: string }[]>();
  for (const k of PEOPLE) {
    hist.set(k, [{ at: -Infinity, json: engine.ch.view(k) }]);
    engine.ch.subscribe(k, () => hist.get(k)?.push({ at: Date.now(), json: engine.ch.view(k) }));
  }
  const nativeOf = (k: (typeof PEOPLE)[number]): GeoJSON.Feature[] => {
    const h = hist.get(k) as { at: number; json: string }[];
    while (h.length > 1 && h[1].at <= Date.now() - lag) h.shift();
    return (JSON.parse(h[0].json) as GeoJSON.FeatureCollection).features;
  };
  /** opacidade no nativo: a x g do feature-state x o 'h' do dado (layers.tsx S_ALPHA) */
  const alphaOf = (src: string, p: Props) => {
    const s = fs.get(src)?.get(String(p.id)) ?? {};
    return (s.a ?? 1) * (s.g ?? 1) * (p.h ? 0 : 1);
  };
  // o <Map> assina estes canais (sem assinante, o canal entrega na hora e não haveria lote)
  for (const k of [...Object.keys(SRC), 'images', 'phase', 'rings', 'look', 'pinLook', 'horizon', 'buildingScale']) engine.ch.subscribe(k as never, () => {});
  engine.onStyleLoaded();
  engine.onMapLoaded();
  const defs: Record<string, AvatarDef> = { 'k-me': defOf(99) };
  for (let i = 0; i < 60; i++) defs[keys + i] = defOf(i, failEvery > 0 && i % failEvery === 0);
  engine.run({ fn: 'defineAvatars', args: [defs] });
  engine.run({ fn: 'setMe', args: [{ lat: ME[1], lng: ME[0], heading: null, tier: 'free', isBoosted: false, isAnonymous: false, photoUrl: null, name: 'eu', avatarKey: 'k-me', aura: '' }] });
  let view = { e: 0, n: 0, z: 16.3 };
  const bounds = () => {
    const c = at(view.e, view.n);
    const mpp = (78271.517 * Math.cos((ME[1] * Math.PI) / 180)) / Math.pow(2, view.z);
    return [c.lng - 192 * mpp * M_LNG, c.lat - 417 * mpp * 0.8 * M_LAT, c.lng + 192 * mpp * M_LNG, c.lat + 417 * mpp * 1.25 * M_LAT];
  };
  const inView = (f: GeoJSON.Feature) => {
    const b = bounds();
    const c = (f.geometry as GeoJSON.Point).coordinates;
    return c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3];
  };
  const camEv = (gesture: boolean, animated: boolean) => {
    const c = at(view.e, view.n);
    return { userInteraction: gesture || animated, animated, center: [c.lng, c.lat], zoom: view.z, bearing: -12, pitch: 58, bounds: bounds() } as never;
  };
  // o que o nativo mostra agora
  const stat = { gray: 0, grayMs: 0, stacked: 0, hidMax: 0, samples: 0 };
  const hidSince = new Map<string, number>();
  const hooks: (() => void)[] = [];
  let t = 0;
  const sample = () => {
    const mpp = (78271.517 * Math.cos((ME[1] * Math.PI) / 180)) / Math.pow(2, view.z);
    const pts: [number, number][] = [];
    let gray = 0;
    const hid = new Set<string>();
    for (const k of ['users', 'usersBoost', 'movers'] as const) {
      for (const f of nativeOf(k)) {
        const p = propsOf(f);
        if (p.cluster || !inView(f)) continue;
        if (alphaOf(SRC[k], p) <= 0.05) {
          hid.add(String(p.id));
          continue;
        }
        const c = (f.geometry as GeoJSON.Point).coordinates;
        // empilhados: entre quem entra e sai de grupo (o boost nunca se agrupa, por regra de produto: fica de fora)
        if (k !== 'usersBoost') pts.push([(c[0] - ME[0]) / M_LNG / mpp, (c[1] - ME[1]) / M_LAT / mpp]);
        if (p.img === GENERIC_FIG || String(p.img).startsWith('sil-')) gray++;
      }
    }
    for (const id of hid) if (!hidSince.has(id)) hidSince.set(id, t);
    for (const [id, since] of hidSince) {
      if (hid.has(id)) continue;
      stat.hidMax = Math.max(stat.hidMax, t - since);
      hidSince.delete(id);
    }
    let stacked = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 18) stacked++;
    stat.samples++;
    stat.gray = Math.max(stat.gray, gray);
    if (gray) stat.grayMs += 20;
    stat.stacked = Math.max(stat.stacked, stacked);
    for (const fn of hooks) fn();
  };
  /** quem está solto na tela escondido AGORA, e há quanto tempo (o hidMax só vê quem já apareceu) */
  const stillHidden = () => {
    let max = 0;
    for (const since of hidSince.values()) max = Math.max(max, t - since);
    return max;
  };
  const wait = async (ms: number) => {
    for (let e = 0; e < ms; e += 20) {
      await jest.advanceTimersByTimeAsync(20);
      t += 20;
      sample();
    }
  };
  /** câmera animada (toque no grupo) ou gesto até o destino, em passos de 33 ms; o moveend vem 250 ms depois */
  const move = async (to: Partial<typeof view>, gesture: boolean, ms = 650) => {
    const from = view;
    const steps = Math.round(ms / 33);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      view = { e: from.e + ((to.e ?? from.e) - from.e) * k, n: from.n + ((to.n ?? from.n) - from.n) * k, z: from.z + ((to.z ?? from.z) - from.z) * k };
      engine.onRegionChange(camEv(gesture, !gesture));
      await wait(33);
    }
    engine.onRegionDidChange(camEv(gesture, !gesture));
  };
  engine.onRegionDidChange(camEv(false, false));
  return { engine, stat, wait, move, sample, fs, bounds, nativeOf, alphaOf, inView, stillHidden, hooks };
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  (mapImages as unknown as { timer: unknown }).timer = null;
  jest.useRealTimers();
});

describe('transição das figuras (rodada 4)', () => {
  // lag 150 ms = o assentamento de imagem que o próprio motor supõe (IMAGE_SETTLE_MS): o fade de entrada começa 50 ms depois do
  // lote e o tile novo chega depois; a cinza velha não pode aparecer no meio
  it.each([0, 150])('grupo abrindo, câmera indo e voltando e refetch com a multidão andando (nativo %i ms atrasado): nenhuma silhueta cinza visível nem bonecos empilhados', async (lag) => {
    const R = rnd(42);
    const { engine, stat, wait, move, stillHidden } = setup({ lag });
    let people = crowd(R);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await wait(8000);
    const P = engine as unknown as { figs: Map<string, { move: unknown }> };
    const soloIds = () => new Set([...engine.features('users'), ...engine.features('usersBoost'), ...engine.features('movers')].filter((f) => !propsOf(f).cluster).map((f) => String(propsOf(f).id)));
    let clusteredWalkers = 0;
    for (let lap = 0; lap < 2; lap++) {
      await move({ e: 60, n: 40, z: 18.2 }, false); // toque no grupo: easeTo de 650 ms
      await wait(4000);
      await move({ e: 760, n: 540 }, true, 400); // arrasta pra longe...
      await wait(3000);
      await move({ e: 60, n: 40 }, true, 400); // ...e volta
      await wait(4000);
      // refetch com a multidão andando: quem estava dentro de um grupo não sai andando (a movers não agrupa)
      const solo = soloIds();
      people = moveSome(people, R);
      engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
      for (const [id, f] of P.figs) if (f.move && id !== 'me' && !solo.has(id)) clusteredWalkers++;
      await wait(9000);
      await move({ z: 16.3 }, false); // o grupo fecha
      await wait(4000);
      people = moveSome(people, R);
      engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
      await wait(9000);
    }
    await move({ e: 60, n: 40, z: 18.2 }, false);
    await wait(4000);
    if (process.env.R4_PRINT) console.log('R4', lag, JSON.stringify({ ...stat, clusteredWalkers, stillHidden: stillHidden() }));
    // antes da rodada 4 (o mesmo teste no motor antigo): até 38 silhuetas cinza visíveis ao mesmo tempo, 8,3 s somados com
    // alguma na tela, 12 pares de bonecos empilhados e 71 pessoas saindo andando de dentro de um grupo. Com o nativo 150 ms
    // atrasado, o motor da rodada 4 antes da correção (só o fade 'g', sem o 'h' no dado) mostrava até 11 cinza juntas (0,6 s)
    expect(stat.gray).toBe(0);
    expect(stat.grayMs).toBe(0);
    expect(clusteredWalkers).toBe(0);
    expect(stat.stacked).toBeLessThanOrEqual(2);
    // ninguém fica escondido esperando a imagem além do tempo de um raster + assentamento (raster instantâneo aqui), nem no fim
    expect(stat.hidMax).toBeLessThan(1500);
    expect(stillHidden()).toBeLessThan(2000);
    expect(stat.samples).toBeGreaterThan(2000);
  }, 60_000);

  it('o grupo abre quando a câmera para, com as figuras de quem se solta prontas', async () => {
    const R = rnd(7);
    const { engine, wait, move, bounds } = setup();
    engine.run({ fn: 'setData', args: [{ users: crowd(R), pois: [] }] });
    await wait(8000);
    const P = engine as unknown as { clusterZoom: number; openTo: number | null; figs: Map<string, { own: boolean; imgReady: boolean }> };
    expect(P.clusterZoom).toBe(16);
    const delivered = () => (JSON.parse(engine.ch.view('users')) as GeoJSON.FeatureCollection).features;
    let openedAt = -1;
    let t = 0;
    let notReadyAtOpen = 0;
    const solo0 = new Set(delivered().filter((f) => !propsOf(f).cluster).map((f) => String(propsOf(f).id)));
    engine.ch.subscribe('users', () => {
      if (openedAt >= 0) return;
      const soloNow = delivered().filter((f) => !propsOf(f).cluster);
      if (soloNow.length <= solo0.size) return;
      openedAt = t;
      const b = bounds();
      for (const f of soloNow) {
        const id = String(propsOf(f).id);
        const c = (f.geometry as GeoJSON.Point).coordinates;
        const fig = P.figs.get(id);
        // quem se soltou NA TELA (fora dela a pessoa nem aparece; se aparecer sem imagem, fica escondida)
        if (c[0] < b[0] || c[0] > b[2] || c[1] < b[1] || c[1] > b[3]) continue;
        if (!solo0.has(id) && fig?.own && !fig.imgReady) notReadyAtOpen++;
      }
    });
    const tick = setInterval(() => (t += 10), 10);
    await move({ e: 60, n: 40, z: 18.2 }, false);
    await wait(3000);
    clearInterval(tick);
    if (process.env.R4_PRINT) console.log('R4open', openedAt);
    expect(openedAt).toBeGreaterThan(0);
    // a câmera cruza o z17 aos ~240 ms e o z18 aos ~580 ms dos 650; o prazo (500 ms) conta do primeiro: o grupo abre no
    // máximo ~100 ms depois de a câmera parar. (Aqui o raster é instantâneo e o grupo abre antes do prazo; com o custo do
    // raster do aparelho, no simulador, abria 1183–1302 ms depois do início do zoom e agora 612–796 ms)
    expect(openedAt).toBeLessThan(650 + 150);
    expect(notReadyAtOpen).toBe(0);
    expect(P.openTo).toBeNull();
    expect(P.clusterZoom).toBe(18);
  });

  it('figura que nunca sai (o raster falha) não some do mapa: a pessoa aparece com a silhueta colorida', async () => {
    const R = rnd(5);
    const { engine, wait, move, stat, stillHidden, nativeOf, alphaOf, inView, hooks } = setup({ failEvery: 3, keys: 'kf' });
    const people = crowd(R).map((u) => ({ ...u, avatarKey: 'kf' + u.avatarKey.slice(1) }));
    const failing = new Set(people.filter((_, i) => (i % 60) % 3 === 0).map((u) => u.id));
    // quem tem o raster falhando e aparece solto na tela: desde quando está escondido, quem já apareceu com a cor
    const hidAt = new Map<string, number>();
    const shown = new Set<string>();
    let hidMax = 0;
    let t = 0;
    hooks.push(() => {
      t += 20;
      const hid = new Set<string>();
      for (const k of ['users', 'movers'] as const) {
        for (const f of nativeOf(k)) {
          const p = propsOf(f);
          const id = String(p.id);
          if (p.cluster || !failing.has(id) || !inView(f)) continue;
          if (alphaOf(SRC[k], p) <= 0.95) hid.add(id);
          else if (String(p.img).startsWith('silc-')) shown.add(id);
        }
      }
      for (const id of hid) if (!hidAt.has(id)) hidAt.set(id, t);
      for (const [id, since] of hidAt) {
        hidMax = Math.max(hidMax, t - since);
        if (!hid.has(id)) hidAt.delete(id);
      }
    });
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await wait(8000);
    // o grupo abre e depois outro pedaço do mapa; cada parada dura mais que as 3 novas tentativas (6 s cada) da figura
    await move({ e: 60, n: 40, z: 18.2 }, false);
    await wait(25_000);
    await move({ e: -90, n: -120 }, true, 400);
    await wait(25_000);
    if (process.env.R4_PRINT) console.log('R4fail', JSON.stringify({ shown: shown.size, hidMax, stillHidden: stillHidden(), gray: stat.gray }));
    // antes da correção: quem falhava ficava escondido pra sempre (figura, nome, aura, foto) e o grupo esperava o teto
    expect(shown.size).toBeGreaterThanOrEqual(3);
    expect(hidMax).toBeLessThan(1500);
    expect(stillHidden()).toBeLessThan(2000);
    expect(stat.gray).toBe(0);
  }, 60_000);

  it('a pessoa escolhida na lista, de dentro do grupo, não pisca quando o grupo abre nem no refetch', async () => {
    const R = rnd(42);
    const { engine, wait, move, fs, nativeOf, hooks } = setup();
    let people = crowd(R);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await wait(8000);
    type Idx = { getLeaves(id: number, n: number): GeoJSON.Feature[]; getClusters(b: number[], z: number): GeoJSON.Feature[] };
    const idx = (engine as unknown as { usersIndex: Idx }).usersIndex;
    const inCluster = new Set<string>();
    for (const f of engine.features('users')) if (propsOf(f).cluster) for (const l of idx.getLeaves(Number(propsOf(f).cluster_id), Infinity)) inCluster.add(String(propsOf(l).id));
    const solo18 = new Set(idx.getClusters([-180, -85, 180, 85], 18).filter((f) => !propsOf(f).cluster).map((f) => String(propsOf(f).id)));
    const pick = people.find((u, i) => {
      const p = u.mapPosition as { lat: number; lng: number };
      return inCluster.has(u.id) && solo18.has(u.id) && i % 25 !== 0 && Math.hypot((p.lng - ME[0]) / M_LNG, (p.lat - ME[1]) / M_LAT) < 120;
    }) as MapUser;
    expect(pick).toBeDefined();
    let full = false;
    let dips = 0;
    hooks.push(() => {
      const f = nativeOf('spot').find((x) => propsOf(x).id === pick.id);
      if (!f) return;
      const s = fs.get(SRC.spot)?.get(pick.id) ?? {};
      const a = (s.a ?? 1) * (s.g ?? 1) * (propsOf(f).h ? 0 : 1);
      if (a >= 0.99) full = true;
      else if (full && a < 0.9) {
        dips++;
        full = false;
      }
    });
    engine.run({ fn: 'select', args: [pick.id] });
    await wait(3000);
    const p = pick.mapPosition as { lat: number; lng: number };
    await move({ e: (p.lng - ME[0]) / M_LNG, n: (p.lat - ME[1]) / M_LAT, z: 18.6 }, false);
    await wait(3000);
    people = moveSome(people, R);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await wait(4000);
    expect(full).toBe(true);
    // antes da correção: 2 quedas a 0 (o "acabou de sair do grupo" escondia todas as fontes, inclusive o destaque)
    expect(dips).toBe(0);
  }, 60_000);

  it('quem sai do mapa escondido esperando a imagem volta com a opacidade cheia (o feature-state fica na fonte)', async () => {
    const { engine, wait, fs } = setup();
    const R = rnd(3);
    const people = crowd(R);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    // logo depois do setData: os soltos sem figura ainda esperam escondidos
    await jest.advanceTimersByTimeAsync(0);
    const hidden = [...(fs.get(SRC.users) as Map<string, Record<string, number>>)].filter(([, s]) => s.g === 0).map(([id]) => id);
    expect(hidden.length).toBeGreaterThan(0);
    const gone = new Set(hidden);
    engine.run({ fn: 'setData', args: [{ users: people.filter((u) => !gone.has(u.id)), pois: [] }] });
    await wait(2000);
    for (const id of gone) for (const src of [SRC.users, SRC.usersBoost, SRC.movers, SRC.spot]) expect(fs.get(src)?.get(id)?.g ?? 1).toBe(1);
  });
});

describe('memória depois de interagir (rodada 4)', () => {
  it('abrir e fechar o grupo 5 vezes com a multidão andando: as imagens em uso voltam perto de antes', async () => {
    const R = rnd(11);
    const { engine, wait, move } = setup();
    let people = crowd(R);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await wait(40_000);
    const E = engine as unknown as { pools: Record<string, { owner: string | null }[]>; slotKeep(k: string): number };
    const free = (k: string) => E.pools[k].filter((s) => s.owner == null).length;
    const names = () => {
      let n = 0;
      for (const g of Object.values(engine.ch.get('images'))) n += Object.keys(g).length;
      return n;
    };
    /** nomes que alguma feature usa (vão pros atlas dos tiles): os registrados menos as vagas livres */
    const inUse = () => names() - free('f') - free('F') - free('b') - free('s');
    const before = inUse();
    const own0 = engine.stats().own.length;
    let peak = 0;
    for (let lap = 0; lap < 5; lap++) {
      people = moveSome(people, R);
      engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
      await wait(9000);
      await move({ e: 60, n: 40, z: 18.2 }, false);
      people = moveSome(people, R);
      engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
      await wait(6000);
      peak = Math.max(peak, inUse());
      await move({ z: 16.3 }, false);
      await wait(6000);
    }
    const right = inUse();
    await wait(60_000);
    const st = engine.stats();
    if (process.env.R4_PRINT) console.log('R4mem', JSON.stringify({ before, peak, right, after: inUse(), names: names(), own0, own: st.own.length, slots: st.slots }));
    // antes da rodada 4: 28 nomes → 97 (+69), as figuras de quem voltou pro grupo ficavam até o teto (60) e as 68 vagas a
    // sessão inteira. Agora as imagens em uso voltam a ~antes um minuto depois, com as figuras próprias de antes
    expect(peak).toBeGreaterThan(before + 10); // abrir o grupo registrou figuras de verdade
    expect(inUse()).toBeLessThanOrEqual(before + 8);
    expect(st.own.length).toBeLessThanOrEqual(own0 + 4);
    // as vagas livres que ficam registradas (só o bitmap no nativo, ~200 KB cada: nenhuma feature aponta pra elas) param na
    // metade do teto do tipo; elas evitam um nome novo (relayout de todos os tiles com símbolo) a cada abertura de grupo
    for (const k of ['f', 'F', 'b', 's'] as const) expect(free(k)).toBeLessThanOrEqual(E.slotKeep(k));
  }, 60_000);
});
