// Motor do mapa sob multidão (300 pessoas na resposta do /nearby de 1.000 em volta, andando): o que vira trabalho no
// aparelho. Simula com o MapEngine de verdade e o relógio do jest; o MLRN, o raster e o disco são de mentira.
//   - fontes GeoJSON: quantas vezes por segundo vão pro nativo, com quantas propriedades; conteúdo igual não vai;
//   - commits do React vindos do mapa: em lote, com intervalo mínimo;
//   - <Images>: arrastar o mapa troca o arquivo das vagas, não cria nem remove nomes (cada nome novo/removido = relayout
//     de todos os tiles no MapLibre); o total registrado tem teto;
//   - quem chega andando não some entre a fonte movers e a users;
//   - além do teto de figuras: silhueta com a cor da roupa da pessoa, e quem está perto e visível tem a figura própria.

import { AppState } from 'react-native';
import type { MapUser } from '../../../bridge';
import type { AvatarDef } from '../../contracts';
import { Channels } from '../channels';
import { MapEngine, SRC, silTintOf } from '../MapEngine';
import { clearDrawCaches } from '../../images/draw';
import { mapImages } from '../../images/store';
import { monoNow } from '../../../../../services/frameBatch';

jest.mock('supercluster', () => jest.requireActual('../../../../../../../../node_modules/supercluster/dist/supercluster.js'));
jest.mock('../../images/draw', () => ({ mapDraw: new Proxy({}, { get: () => () => new Uint8Array([1]) }), clearDrawCaches: jest.fn() }));
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
const SKINS = ['s1', 's4', 's7'];
/** visual de teste: sem camadas (o raster é de mentira), com a cor da blusa e da pele variando */
const defOf = (i: number): AvatarDef => ({ l: [], p: { scene: null } as unknown as AvatarDef['p'], c: { outer: 'none', topColor: TOPS[i % TOPS.length], skin: SKINS[i % SKINS.length] } as unknown as AvatarDef['c'] });

function user(id: string, pos: { lat: number; lng: number }, i = 0, boost = i % 25 === 0): MapUser {
  return { id, name: id, label: id, avatarKey: 'k' + (i % 24), aura: '155,92,255', isAnonymous: false, isBoosted: boost, premiumTier: 'premium_plus', isVerified: i % 3 === 0, isOnline: true, photo: null, isNew: false, mutual: false, mapPosition: pos } as unknown as MapUser;
}

/** semente fixa: a mesma multidão em toda rodada */
function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function setup(tier: 'high' | 'mid' | 'low' = 'high', zoom = 16.5) {
  const engine = new MapEngine({ emit: () => {}, initTheme: 'night', initTier: tier });
  engine.attach({ current: { queryRenderedFeatures: () => Promise.resolve([]) } } as never, { current: { setStop: () => Promise.resolve() } } as never);
  for (const id of Object.values(SRC)) engine.attachSource(id, { current: { setFeatureStates: () => Promise.resolve(), setFeatureState: () => Promise.resolve() } } as never);
  engine.onStyleLoaded();
  engine.onMapLoaded();
  const defs: Record<string, AvatarDef> = { 'k-me': defOf(99) };
  for (let i = 0; i < 24; i++) defs['k' + i] = defOf(i);
  engine.run({ fn: 'defineAvatars', args: [defs] });
  engine.run({ fn: 'setMe', args: [{ lat: ME[1], lng: ME[0], heading: null, tier: 'free', isBoosted: false, isAnonymous: false, photoUrl: null, name: 'eu', avatarKey: 'k-me', aura: '' }] });
  const cam = (east: number, north: number, z = zoom, gesture = false) => {
    const c = at(east, north);
    const mpp = (78271.517 * Math.cos((ME[1] * Math.PI) / 180)) / Math.pow(2, z);
    const hw = 192 * mpp;
    const hh = 417 * mpp;
    const ev = { userInteraction: gesture, animated: false, center: [c.lng, c.lat], zoom: z, bearing: 0, pitch: 0, bounds: [c.lng - hw * M_LNG, c.lat - hh * 0.8 * M_LAT, c.lng + hw * M_LNG, c.lat + hh * 1.25 * M_LAT] };
    if (gesture) engine.onRegionChange(ev as never);
    else engine.onRegionDidChange(ev as never);
  };
  cam(0, 0);
  return { engine, cam };
}

/** nomes registrados no <Images> agora */
function imageNames(engine: MapEngine): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of Object.values(engine.ch.get('images'))) for (const [n, e] of Object.entries(g)) out.set(n, e.source.uri);
  return out;
}

const crowd = (n: number, R: () => number) =>
  Array.from({ length: n }, (_, i) => {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * 300;
    return user('p' + i, at(Math.cos(a) * d, Math.sin(a) * d), i);
  });

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  // os timers falsos somem entre os testes: o agendador do store (singleton) não pode ficar esperando um que não existe
  (mapImages as unknown as { timer: unknown }).timer = null;
  jest.useRealTimers();
});

describe('canais em lote', () => {
  it('tudo o que muda no mesmo turno vira um aviso; dois lotes ficam a pelo menos minGapMs', async () => {
    const ch = new Channels<{ a: number; b: number }>({ a: 0, b: 0 });
    ch.minGapMs = 100;
    const seen: string[] = [];
    ch.subscribe('a', () => seen.push('a' + ch.get('a')));
    ch.subscribe('b', () => seen.push('b' + ch.get('b')));
    for (let i = 1; i <= 10; i++) {
      ch.set('a', i);
      ch.set('b', i);
    }
    expect(ch.get('a')).toBe(10); // o valor muda na hora
    await Promise.resolve();
    expect(seen).toEqual(['a10', 'b10']);
    ch.set('a', 11);
    await Promise.resolve();
    expect(seen.length).toBe(2); // segura até completar o intervalo
    await jest.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(['a10', 'b10', 'a11']);
    expect(ch.flushes).toBe(2);
  });

  it('canal urgente (queda do pino) não espera o intervalo e leva junto o que estava esperando', async () => {
    const ch = new Channels<{ a: number; pin: number }>({ a: 0, pin: 0 });
    ch.minGapMs = 100;
    ch.urgent.add('pin');
    const seen: string[] = [];
    ch.subscribe('a', () => seen.push('a' + ch.get('a')));
    ch.subscribe('pin', () => seen.push('pin' + ch.get('pin')));
    ch.set('a', 1);
    await Promise.resolve();
    ch.set('a', 2); // espera o intervalo
    ch.set('pin', 1); // sai agora, com o 'a' junto
    await Promise.resolve();
    expect(seen).toEqual(['a1', 'a2', 'pin1']);
    await jest.advanceTimersByTimeAsync(200);
    expect(seen.length).toBe(3); // o timer velho não repete nada
  });
});

describe('fontes de pessoas sob 300 pessoas andando', () => {
  it('poucos envios por segundo, só as propriedades que o estilo lê, e conteúdo igual não vai pro nativo', async () => {
    const R = rnd(7);
    const { engine } = setup('high');
    let people = crowd(300, R);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(8000);
    // refetch: 60% andaram até ±60 m (o MOVE_CAP anda de verdade, o resto chega direto)
    people = people.map((u, i) => (R() < 0.6 ? user(u.id, at(((u.mapPosition as { lng: number }).lng - ME[0]) / M_LNG + (R() - 0.5) * 120, ((u.mapPosition as { lat: number }).lat - ME[1]) / M_LAT + (R() - 0.5) * 120), i) : u));
    const base = engine.stats();
    const perSec: number[] = [];
    let prev = Object.values(base.sends).reduce((a, b) => a + b, 0);
    let commits0 = base.commits;
    const commitsPerSec: number[] = [];
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    for (let s = 0; s < 15; s++) {
      await jest.advanceTimersByTimeAsync(1000);
      const st = engine.stats();
      const total = Object.values(st.sends).reduce((a, b) => a + b, 0);
      perSec.push(total - prev);
      prev = total;
      commitsPerSec.push(st.commits - commits0);
      commits0 = st.commits;
    }
    const end = engine.stats();
    const sent = (k: string) => (end.sends[k] ?? 0) - (base.sends[k] ?? 0);
    // antes (simulador, mesma rajada): até 30 envios de fonte e 58 commits no pior segundo; users a 5/s. Teto 12: desde a
    // rodada 3 o próprio motor assina o canal 'images' (como o <MapImages> no app), e o código da rodada 2 com um assinante
    // de 'images' também dá 12 no pior segundo (o 10 era do teste sem assinante, que não existia no app)
    expect(Math.max(...perSec)).toBeLessThanOrEqual(12);
    expect(Math.max(...commitsPerSec)).toBeLessThanOrEqual(16); // 1000/66 ms
    expect(sent('users') + sent('usersBoost')).toBeLessThanOrEqual(2 * 15); // ≤ 1/s cada com multidão
    expect(sent('movers')).toBeLessThanOrEqual(15 * 9);
    // propriedades: só o que o estilo lê; coordenada com 6 casas
    for (const k of ['users', 'usersBoost', 'movers'] as const) {
      for (const f of engine.features(k)) {
        const p = f.properties as Record<string, unknown>;
        if (p.cluster) continue;
        // ('h' = escondida pelo dado até a figura ou a cor chegar: layers.tsx S_ALPHA)
        for (const key of Object.keys(p)) expect(['id', 'img', 'sz', 'label', 'aura', 'ph', 'b', 'h']).toContain(key);
        for (const c of (f.geometry as GeoJSON.Point).coordinates) expect(Math.abs(c * 1e6 - Math.round(c * 1e6))).toBeLessThan(1e-6);
      }
    }
    // mesma resposta de novo (nada mudou): nenhuma fonte vai pro nativo
    await jest.advanceTimersByTimeAsync(15_000);
    const before = engine.stats().sends;
    engine.run({ fn: 'setData', args: [{ users: people.map((u) => ({ ...u, mapPosition: { ...(u.mapPosition as object) } }) as MapUser), pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    const after = engine.stats().sends;
    for (const k of ['users', 'usersBoost', 'movers']) expect(after[k] ?? 0).toBe(before[k] ?? 0);
  });

  it('1.000 pessoas na resposta: o motor segura 300 e o <Images> tem teto', async () => {
    const R = rnd(11);
    const { engine } = setup('high');
    engine.run({ fn: 'setData', args: [{ users: crowd(1000, R), pois: [] }] });
    await jest.advanceTimersByTimeAsync(10_000);
    const st = engine.stats();
    const feats = engine.features('users').length + engine.features('usersBoost').length + engine.features('movers').length;
    expect(feats).toBeLessThanOrEqual(300);
    expect(st.own.length).toBeLessThanOrEqual(60);
    expect(st.slots.f).toBeLessThanOrEqual(60 + 8);
    expect(st.images).toBeLessThanOrEqual(68 + 20 + 68 + 7 + 24 + 8);
  });
});

describe('vagas do <Images>', () => {
  it('arrastar o mapa troca arquivos nas vagas: quase nenhum nome novo ou removido (cada um = relayout geral)', async () => {
    const { engine, cam } = setup('mid', 15.2);
    // grade de 200 m: todo mundo solto (sem grupo), 441 pessoas
    const us: MapUser[] = [];
    let i = 0;
    for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) us.push(user(`u${x}_${y}`, at(x * 200, y * 200), i++));
    engine.run({ fn: 'setData', args: [{ users: us.slice(0, 300), pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    let names = imageNames(engine);
    let added = 0;
    let removed = 0;
    let swapped = 0;
    for (const [e, n] of [[400, 0], [800, 0], [800, 600], [400, 600], [0, 600], [0, 0]]) {
      cam(e, n, 15.2, true);
      await jest.advanceTimersByTimeAsync(3000);
      const next = imageNames(engine);
      for (const [k, uri] of next) if (!names.has(k)) added++;
      else if (names.get(k) !== uri) swapped++;
      for (const k of names.keys()) if (!next.has(k)) removed++;
      names = next;
    }
    // antes: cada figura que entrava no teto era um nome novo e cada uma que saía, um nome removido (dezenas por arraste)
    expect(swapped).toBeGreaterThan(20);
    expect(added).toBeLessThanOrEqual(8 + 8); // folga das vagas + silhuetas coloridas novas
    expect(removed).toBe(0);
    expect(engine.stats().own.length).toBeLessThanOrEqual(45);
  });
});

describe('quem chega andando', () => {
  it('nunca some entre a fonte movers e a users', async () => {
    const R = rnd(3);
    const { engine } = setup('high', 22); // z22: sem grupos, toda pessoa é uma feature
    let people = Array.from({ length: 40 }, (_, i) => user('w' + i, at((R() - 0.5) * 60, (R() - 0.5) * 60), i));
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    people = people.map((u, i) => user(u.id, at((R() - 0.5) * 60, (R() - 0.5) * 60), i));
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    let missing = 0;
    for (let t = 0; t < 12_000; t += 20) {
      await jest.advanceTimersByTimeAsync(20);
      const ids = new Set<string>();
      for (const k of ['users', 'usersBoost', 'movers'] as const) for (const f of engine.features(k)) ids.add(String((f.properties as Record<string, unknown>).id));
      for (const u of people) if (!ids.has(u.id)) missing++;
    }
    expect(missing).toBe(0);
  });
});

describe('silhueta', () => {
  it('a cor vem da roupa e da pele da pessoa (paleta curta)', () => {
    const red = silTintOf(defOf(2));
    const navy = silTintOf(defOf(7));
    expect(red?.body).toBe('#D8434F');
    expect(navy?.id).not.toBe(red?.id);
    expect(silTintOf({ l: [], p: {} as AvatarDef['p'] })).toBeNull();
  });

  it('além do teto: silhueta colorida (nunca o boneco cinza); perto e visível: figura própria', async () => {
    const { engine } = setup('mid', 15.2);
    const us: MapUser[] = [];
    let i = 0;
    for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) us.push(user(`u${x}_${y}`, at(x * 200, y * 200), i++));
    engine.run({ fn: 'setData', args: [{ users: us.slice(0, 300), pois: [] }] });
    await jest.advanceTimersByTimeAsync(6000);
    const feats = [...engine.features('users'), ...engine.features('usersBoost')].filter((f) => !(f.properties as Record<string, unknown>).cluster);
    const img = (f: GeoJSON.Feature) => String((f.properties as Record<string, unknown>).img);
    const generic = feats.filter((f) => img(f) === 'fig-generic' || img(f).startsWith('sil-'));
    const tinted = feats.filter((f) => img(f).startsWith('silc-'));
    const own = feats.filter((f) => img(f).startsWith('cz'));
    expect(own.length).toBe(45);
    // tela no z15,2 (setup): ±384 m pro lado, de -667 a +1042 m na vertical; o motor escolhe com 25% de margem
    const rel = (f: GeoJSON.Feature) => {
      const c = (f.geometry as GeoJSON.Point).coordinates;
      return [(c[0] - ME[0]) / M_LNG, (c[1] - ME[1]) / M_LAT];
    };
    const onScreen = (f: GeoJSON.Feature) => {
      const [e, n] = rel(f);
      return Math.abs(e) <= 384 && n >= -667 && n <= 1042;
    };
    const visible = feats.filter(onScreen);
    expect(visible.length).toBeGreaterThan(20);
    // perto e visível = figura própria: quem fica de silhueta na tela está nos cantos de longe (o teto vai do centro pra fora,
    // contando a margem de 25%); a 900 m do centro no z15,2 ninguém
    const far = (f: GeoJSON.Feature) => Math.hypot(rel(f)[0], rel(f)[1]);
    expect(visible.filter((f) => !img(f).startsWith('cz') && far(f) < 900)).toEqual([]);
    expect(visible.filter((f) => img(f).startsWith('cz')).length).toBeGreaterThan(visible.length * 0.8);
    // quem ficou além do teto (na margem) usa a silhueta colorida, nunca o boneco cinza
    expect(tinted.length).toBeGreaterThan(0);
    expect(generic.filter((f) => {
      const [e, n] = rel(f);
      return Math.abs(e) <= 480 && n >= -834 && n <= 1302;
    })).toEqual([]);
    expect(engine.stats().tints).toBeLessThanOrEqual(24);
  });
});

// ───────────── revisão da rodada 2 ─────────────
type PrivSlot = { name: string; owner: string | null; freeAt: number };
type PrivFig = { own: boolean; imgReady: boolean; slot: PrivSlot | null; user?: { isBoosted: boolean } };
interface Priv {
  pools: Record<string, PrivSlot[]>;
  figs: Map<string, PrivFig>;
  users: Map<string, unknown>;
  setImage: (group: string, name: string, ref: { path: string }, fresh?: boolean) => void;
  useGeneric: (u: unknown) => void;
  ensureOwn: (u: unknown) => void;
}
const priv = (e: MapEngine) => e as unknown as Priv;

/** nome de vaga/silhueta -> ids que a fonte publicada (o JSON que foi pro nativo) aponta pra ele */
function refsOf(engine: MapEngine): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const k of ['users', 'usersBoost', 'movers', 'spot'] as const) {
    for (const f of JSON.parse(engine.sourceData(k)).features as { properties?: Record<string, unknown> }[]) {
      const p = f.properties ?? {};
      for (const key of ['img', 'ph']) {
        const n = p[key];
        if (typeof n !== 'string' || !(n.startsWith('cz') || n.startsWith('silc-'))) continue;
        let set = out.get(n);
        if (!set) out.set(n, (set = new Set()));
        set.add(String(p.id));
      }
    }
  }
  return out;
}

const moveSome = (people: MapUser[], R: () => number, step: number) =>
  people.map((u, i) => {
    if (R() >= 0.6) return u;
    const p = u.mapPosition as { lat: number; lng: number };
    return user(u.id, at((p.lng - ME[0]) / M_LNG + (R() - 0.5) * step, (p.lat - ME[1]) / M_LAT + (R() - 0.5) * step), i);
  });

describe('revisão da rodada 2', () => {
  it('relógio do aparelho voltando 1 h no meio da multidão andando: commits, fontes e figuras seguem (relógio monotônico)', async () => {
    const R = rnd(21);
    const { engine } = setup('mid', 16.5);
    const seen: Record<string, number> = { users: 0, movers: 0, images: 0 };
    for (const k of Object.keys(seen) as ('users' | 'movers' | 'images')[]) engine.ch.subscribe(k, () => seen[k]++);
    let people = crowd(300, R);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(4000);
    // o relógio monotônico (performance.now, que os timers falsos do jest movem) é o que o motor usa: não pula com o Date
    const t0 = monoNow();
    jest.setSystemTime(Date.now() - 3_600_000); // ajuste automático de hora
    const s0 = { ...seen };
    const sends0 = { ...engine.stats().sends };
    people = moveSome(people, R, 120);
    engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    expect(monoNow() - t0).toBe(3000);
    const sends = engine.stats().sends;
    // antes: o lote dos canais esperava "último + 66 ms - agora" = 1 h, a fonte movers e os pushes também (mapa parado)
    expect(seen.movers - s0.movers).toBeGreaterThan(5);
    expect(seen.users - s0.users).toBeGreaterThan(0);
    expect((sends.movers ?? 0) - (sends0.movers ?? 0)).toBeGreaterThan(5);
    expect((sends.users ?? 0) - (sends0.users ?? 0)).toBeGreaterThan(1);
    // e o relógio adiantando 2 h também não trava nada
    jest.setSystemTime(Date.now() + 7_200_000);
    const s1 = { ...seen };
    engine.run({ fn: 'setData', args: [{ users: moveSome(people, R, 120), pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    expect(seen.movers - s1.movers).toBeGreaterThan(5);
  });

  it('canais: relógio voltando não segura o lote no timer (no máx. um intervalo)', async () => {
    const ch = new Channels<{ a: number }>({ a: 0 });
    ch.minGapMs = 100;
    const seen: number[] = [];
    ch.subscribe('a', () => seen.push(ch.get('a')));
    ch.set('a', 1);
    await Promise.resolve();
    jest.setSystemTime(Date.now() - 3_600_000);
    ch.set('a', 2);
    expect(ch.pendingMs()).toBeLessThanOrEqual(100);
    await jest.advanceTimersByTimeAsync(100);
    expect(seen).toEqual([1, 2]);
  });

  it('desenho que falhou: a trava de 5 s do store não vira 1 h com o relógio voltando', async () => {
    const key = 'teste|falha|relogio';
    const first = mapImages.request(key, 0, () => null, 2.5);
    await jest.advanceTimersByTimeAsync(50);
    expect(await first).toBeNull();
    jest.setSystemTime(Date.now() - 3_600_000);
    await jest.advanceTimersByTimeAsync(5_100);
    const again = mapImages.request(key, 0, () => new Uint8Array([1]), 2.5);
    await jest.advanceTimersByTimeAsync(50);
    expect(await again).not.toBeNull(); // antes: recusada por 1 h (a figura ficava na silhueta)
  });

  it('mais de 20 pessoas com boost na tela: todas ganham figura (eram 20 presas na silhueta)', async () => {
    const { engine } = setup('mid', 16.5);
    const us: MapUser[] = [];
    for (let i = 0; i < 120; i++) {
      const a = i * 2.4;
      const d = 15 + (i % 30) * 4;
      us.push(user('b' + i, at(Math.cos(a) * d, Math.sin(a) * d), i, i < 40));
    }
    engine.run({ fn: 'setData', args: [{ users: us, pois: [] }] });
    await jest.advanceTimersByTimeAsync(15_000);
    let boostReady = 0;
    let boostStuck = 0;
    let normal = 0;
    for (const [id, f] of priv(engine).figs) {
      if (id === 'me' || !f.own) continue;
      if (!f.user?.isBoosted) normal++;
      else if (f.imgReady) boostReady++;
      else boostStuck++;
    }
    // antes (revisor): 20 prontas, 20 presas sem figura, 1 sem boost com figura
    expect(boostStuck).toBe(0);
    expect(boostReady).toBe(40);
    expect(boostReady + normal).toBeLessThanOrEqual(45); // teto do tier mid (as sem boost na tela estão quase todas em grupos)
  });

  it('vaga solta só volta a servir depois que a fonte publicada parou de apontar pra ela (multidão densa andando, z19–20)', async () => {
    let stale = 0;
    let wrong = 0;
    let fresh = 0;
    for (const [tier, z, seed, radius] of [['high', 20, 3, 80], ['mid', 19, 5, 150]] as const) {
      const R = rnd(seed);
      const { engine, cam } = setup(tier, z);
      const P = priv(engine);
      const ownerOf = (n: string) => {
        for (const k of Object.keys(P.pools)) for (const sl of P.pools[k]) if (sl.name === n) return sl.owner;
        return undefined;
      };
      // vaga trocando de dono (setImage com fresh): ninguém além da dona nova pode estar na fonte apontando pra ela
      const setImage = P.setImage.bind(engine);
      P.setImage = (g, n, ref, isFresh) => {
        if (isFresh) {
          fresh++;
          const owner = ownerOf(n);
          if ([...(refsOf(engine).get(n) ?? [])].some((id) => id !== owner)) wrong++;
        }
        setImage(g, n, ref, isFresh);
      };
      let people = Array.from({ length: 300 }, (_, i) => {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R()) * radius;
        return user('p' + i, at(Math.cos(a) * d, Math.sin(a) * d), i);
      });
      engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
      await jest.advanceTimersByTimeAsync(5000);
      for (let round = 0; round < 4; round++) {
        people = moveSome(people, R, 60);
        engine.run({ fn: 'setData', args: [{ users: people, pois: [] }] });
        if (round % 2) cam((R() - 0.5) * 80, (R() - 0.5) * 80, z, false);
        for (let t = 0; t < 6000; t += 20) {
          await jest.advanceTimersByTimeAsync(20);
          const refs = refsOf(engine);
          const now = monoNow();
          for (const k of Object.keys(P.pools)) for (const sl of P.pools[k]) if (sl.owner == null && sl.freeAt <= now && refs.has(sl.name)) stale++;
        }
      }
    }
    // antes (revisor, z20 com 200+ features): vaga livre ainda referenciada em 80 amostras, janela de até 390 ms
    expect(fresh).toBeGreaterThan(50);
    expect(stale).toBe(0);
    expect(wrong).toBe(0);
  }, 30_000);

  it('timer velho da espera não marca pronta a vaga seguinte antes do arquivo dela chegar', async () => {
    const { engine } = setup('high', 18);
    engine.run({ fn: 'setData', args: [{ users: [user('x', at(5, 5), 1)], pois: [] }] });
    await jest.advanceTimersByTimeAsync(3000);
    const P = priv(engine);
    const f = P.figs.get('x') as PrivFig;
    const u = P.users.get('x');
    expect(f.imgReady).toBe(true);
    P.useGeneric(u); // saiu do teto...
    P.ensureOwn(u); // ...e voltou: vaga nova, espera nova (T1)
    expect(f.slot).not.toBeNull();
    await jest.advanceTimersByTimeAsync(150);
    P.useGeneric(u); // de novo, no meio da espera de T1
    P.ensureOwn(u); // vaga seguinte: precisa da espera inteira (≥ 160 + 120 ms) a partir de agora
    const second = f.slot;
    expect(second).not.toBeNull();
    // T1 venceria aqui (150 + ~130 ms): antes, marcava pronta a vaga nova com o arquivo da dona anterior
    await jest.advanceTimersByTimeAsync(270);
    expect(f.imgReady).toBe(false);
    await jest.advanceTimersByTimeAsync(1500);
    expect(f.slot).toBe(second);
    expect(f.imgReady).toBe(true);
  });

  it('silhueta colorida: as cores sem uso voltam pra cota (300 visuais diferentes, 5 arrastes, nenhum boneco cinza)', async () => {
    const engine = new MapEngine({ emit: () => {}, initTheme: 'night', initTier: 'mid' });
    engine.attach({ current: { queryRenderedFeatures: () => Promise.resolve([]) } } as never, { current: { setStop: () => Promise.resolve() } } as never);
    for (const id of Object.values(SRC)) engine.attachSource(id, { current: { setFeatureStates: () => Promise.resolve(), setFeatureState: () => Promise.resolve() } } as never);
    engine.onStyleLoaded();
    engine.onMapLoaded();
    const TOPS2 = [...TOPS, 'c_pink', 'c_purple', 'c_brown'];
    const defs: Record<string, AvatarDef> = { 'k-me': defOf(99) };
    for (let i = 0; i < 300; i++) defs['v' + i] = { l: [], p: { scene: null }, c: { outer: 'none', topColor: TOPS2[i % TOPS2.length], skin: SKINS[Math.floor(i / 11) % 3] } } as unknown as AvatarDef;
    engine.run({ fn: 'defineAvatars', args: [defs] });
    engine.run({ fn: 'setMe', args: [{ lat: ME[1], lng: ME[0], heading: null, tier: 'free', isBoosted: false, isAnonymous: false, photoUrl: null, name: 'eu', avatarKey: 'k-me', aura: '' }] });
    const cam = (east: number, north: number, z = 15.2) => {
      const c = at(east, north);
      const mpp = (78271.517 * Math.cos((ME[1] * Math.PI) / 180)) / Math.pow(2, z);
      const hw = 192 * mpp;
      const hh = 417 * mpp;
      engine.onRegionChange({ userInteraction: true, animated: false, center: [c.lng, c.lat], zoom: z, bearing: 0, pitch: 0, bounds: [c.lng - hw * M_LNG, c.lat - hh * 0.8 * M_LAT, c.lng + hw * M_LNG, c.lat + hh * 1.25 * M_LAT] } as never);
    };
    cam(0, 0);
    const tiers = ['free', 'premium', 'premium_plus'];
    const us: MapUser[] = [];
    let i = 0;
    for (let x = -10; x <= 10 && us.length < 300; x++)
      for (let y = -10; y <= 10 && us.length < 300; y++, i++)
        us.push({ id: `u${i}`, name: 'n', label: 'n', avatarKey: 'v' + i, aura: '', isAnonymous: false, isBoosted: false, premiumTier: tiers[i % 3], isVerified: i % 2 === 0, isOnline: true, photo: null, isNew: i % 5 === 0, mutual: false, mapPosition: at(x * 200, y * 200) } as unknown as MapUser);
    engine.run({ fn: 'setData', args: [{ users: us, pois: [] }] });
    await jest.advanceTimersByTimeAsync(5000);
    let maxGray = 0;
    let tinted = 0;
    for (const [e, n] of [[400, 0], [800, 600], [-400, 600], [-800, -600], [0, 0]]) {
      cam(e, n);
      await jest.advanceTimersByTimeAsync(5000);
      const vis = [...engine.features('users'), ...engine.features('usersBoost')].filter((f) => {
        const p = f.properties as Record<string, unknown>;
        if (p.cluster) return false;
        const c = (f.geometry as GeoJSON.Point).coordinates;
        const de = (c[0] - ME[0]) / M_LNG - e;
        const dn = (c[1] - ME[1]) / M_LAT - n;
        return Math.abs(de) <= 384 && dn >= -667 && dn <= 1042;
      });
      const img = (f: GeoJSON.Feature) => String((f.properties as Record<string, unknown>).img);
      maxGray = Math.max(maxGray, vis.filter((f) => img(f).startsWith('sil-') || img(f) === 'fig-generic').length);
      tinted += vis.filter((f) => img(f).startsWith('silc-')).length;
      expect(engine.stats().tints).toBeLessThanOrEqual(24);
      expect(engine.stats().slots.s).toBeLessThanOrEqual(24);
    }
    // antes (revisor): cota 24/24 gasta pra sempre e 3 silhuetas cinza na tela
    expect(tinted).toBeGreaterThan(0);
    expect(maxGray).toBe(0);
  });

  it('quem é tocado não espera vaga esfriar, e o anel sai no mesmo turno', async () => {
    const { engine } = setup('low', 16.5);
    const R = rnd(9);
    engine.run({ fn: 'setData', args: [{ users: crowd(300, R), pois: [] }] });
    await jest.advanceTimersByTimeAsync(5000);
    const P = priv(engine);
    // vagas de figura todas ocupadas (teto low 30 + folga 8)
    while (P.pools.f.length < 38) P.pools.f.push({ name: `czfghost${P.pools.f.length}`, owner: 'ghost', freeAt: 0 });
    for (const sl of P.pools.f) if (sl.owner == null) sl.owner = 'ghost';
    const far = [...P.figs.entries()].find(([id, f]) => id !== 'me' && !f.own)?.[0] as string;
    expect(far).toBeDefined();
    let sel = 0;
    engine.ch.subscribe('sel', () => sel++);
    let rings = 0;
    engine.ch.subscribe('rings', () => rings++);
    engine.ch.set('rings', { ...engine.ch.get('rings') }); // lote agora: o próximo (não urgente) esperaria o intervalo
    await Promise.resolve();
    expect(rings).toBe(1);
    engine.run({ fn: 'select', args: [far] });
    await Promise.resolve();
    expect(sel).toBe(1);
    await jest.advanceTimersByTimeAsync(1000);
    const f = P.figs.get(far) as PrivFig;
    expect(f.slot).not.toBeNull(); // passou do teto de vagas
    expect(f.imgReady).toBe(true);
  });

  it('cache de desenho: solto só depois de 30 s fora do mapa (trocar de aba e voltar não derruba)', async () => {
    const clear = clearDrawCaches as jest.Mock;
    const { engine } = setup('high', 16.5);
    clear.mockClear();
    engine.setActive(false);
    await jest.advanceTimersByTimeAsync(10_000);
    engine.setActive(true);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(clear).not.toHaveBeenCalled();
    engine.setActive(false);
    await jest.advanceTimersByTimeAsync(29_000);
    expect(clear).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(clear).toHaveBeenCalledTimes(1);
    // app indo pro fundo: solta na hora (lá os timers param)
    engine.setActive(true);
    const state = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    try {
      engine.setActive(false);
      expect(clear).toHaveBeenCalledTimes(2);
    } finally {
      if (state) Object.defineProperty(AppState, 'currentState', state);
      else delete (AppState as { currentState?: string }).currentState;
    }
  });
});
