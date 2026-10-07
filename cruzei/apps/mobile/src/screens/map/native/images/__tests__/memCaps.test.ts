// Tetos de memória do lado do mapa (rodada 3), com o desenho de verdade no CanvasKit de CPU (a mesma API do
// react-native-skia): o cache de paths tem teto em bytes, as camadas montadas e as da assinatura têm teto em itens, e tudo
// é solto quando a fila de imagens fica ociosa. No node, 300 pessoas pesadas por 90 s: heap retido de 85,6 → 39,0 MB
// (e 23,4 MB depois de 30 s parado); medidor em scratchpad/r3/mem.ts.

import type { AvatarConfig } from '@cruzei/shared-types';
import { avatarSlotDef, avatarTiersFor, normalizeAvatarConfig, randomAvatarConfig } from '@cruzei/shared-utils';

const path = jest.requireActual('path') as { join(...p: string[]): string; dirname(p: string): string };
const resolve = (require as unknown as { resolve(id: string): string }).resolve;

const mockSk: { api: unknown } = { api: null };
jest.mock('@shopify/react-native-skia', () => {
  const types = jest.requireActual('@shopify/react-native-skia/lib/commonjs/skia/types');
  return {
    ...types,
    get Skia() {
      return mockSk.api;
    },
  };
});
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

beforeAll(async () => {
  const ckPath = resolve('canvaskit-wasm/bin/canvaskit.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const init = require(ckPath);
  const g = globalThis as unknown as { TextDecoder: unknown };
  const prev = g.TextDecoder;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  g.TextDecoder = require('util').TextDecoder;
  let CK: unknown;
  try {
    CK = await init({ locateFile: (f: string) => path.join(path.dirname(ckPath), f) });
  } finally {
    g.TextDecoder = prev;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { JsiSkApi } = jest.requireActual('@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia');
  mockSk.api = JsiSkApi(CK);
}, 60000);

/* eslint-disable @typescript-eslint/no-var-requires */
const load = () => ({
  draw: require('../draw') as typeof import('../draw'),
  avatar: require('../mapAvatar') as typeof import('../mapAvatar'),
  store: require('../store') as typeof import('../store'),
  mem: require('../../../../../services/memCache') as typeof import('../../../../../services/memCache'),
  contracts: require('../../contracts') as typeof import('../../contracts'),
});
/* eslint-enable @typescript-eslint/no-var-requires */

const PLUS = avatarTiersFor('premium_plus');
const ids = (slot: string) => avatarSlotDef(slot as never).items.map((i: { id: string }) => i.id).filter((id: string) => id !== 'none');
const pick = (slot: string, i: number) => {
  const l = ids(slot);
  return l[i % l.length];
};
/** pior caso do loadtest: sobreposição, costas, chapéu, aura no máximo */
const heavy = (i: number): AvatarConfig =>
  normalizeAvatarConfig({ ...randomAvatarConfig('p' + i, { tiers: PLUS }), outer: pick('outer', i * 3), bag: pick('bag', i * 5), hat: pick('hat', i * 7), aura: pick('aura', i * 11), auraLevel: 'max' }, PLUS) as AvatarConfig;
const LOOK = { recent: true, boosted: false, premiumTier: 'premium_plus' as const, verified: true, aura: '155,92,255', anonymous: false };

describe('tetos de memória do desenho do mapa', () => {
  it('30 figuras pesadas: paths no teto de bytes, camadas montadas no teto de itens; soltar zera', () => {
    const { draw, avatar, mem, contracts } = load();
    draw.clearDrawCaches();
    avatar.clearMapAvatarCaches();
    let maxBytes = 0;
    for (let i = 0; i < 30; i++) {
      const def = avatar.mapAvatarDef(heavy(i));
      expect(draw.mapDraw.figure(def, LOOK, contracts.IMG.fig, null, false)).not.toBeNull();
      const st = draw.drawCacheStats();
      maxBytes = Math.max(maxBytes, st.bytes);
      expect(st.bytes).toBeLessThanOrEqual(4 * 1024 * 1024 + 64 * 1024); // teto + a última entrada (sempre fica)
      expect(mem.memCacheStats()['map.layers'].items).toBeLessThanOrEqual(avatar.MAP_LAYERS_LRU);
    }
    // o teto trabalha de verdade (o cache encheu e soltou os mais antigos)
    expect(maxBytes).toBeGreaterThan(3 * 1024 * 1024);
    draw.clearDrawCaches();
    avatar.clearMapAvatarCaches();
    expect(draw.drawCacheStats()).toEqual({ paths: 0, bytes: 0, colors: 0 });
    expect(mem.memCacheStats()['map.layers'].items).toBe(0);
  }, 60000);

  it('assinatura: no máximo 4 montagens vivas (era uma por pessoa no mapa enquanto ela estivesse lá)', () => {
    const { avatar, mem } = load();
    avatar.clearMapAvatarCaches();
    for (let i = 0; i < 12; i++) avatar.sigAssets(avatar.mapAvatarDef(normalizeAvatarConfig({ ...randomAvatarConfig('s' + i, { tiers: PLUS }), emote: pick('emote', i) }, PLUS) as AvatarConfig));
    expect(mem.memCacheStats()['map.sig'].items).toBeLessThanOrEqual(4);
    // a mesma definição volta do cache (a passada não remonta a cada quadro)
    const d = avatar.mapAvatarDef(heavy(99));
    expect(avatar.sigAssets(d)).toBe(avatar.sigAssets(d));
  });

  it('fila de imagens ociosa: avisa quem pediu depois de IDLE_RELEASE_MS sem desenhar (cada desenho rearma)', async () => {
    jest.useFakeTimers();
    try {
      const { store } = load();
      const s = new store.ImageStore();
      const idle = jest.fn();
      s.onIdle(idle);
      void s.request('a', 0, () => new Uint8Array([1]));
      await jest.advanceTimersByTimeAsync(10);
      await jest.advanceTimersByTimeAsync(store.IDLE_RELEASE_MS - 5000);
      void s.request('b', 0, () => new Uint8Array([1])); // desenhou de novo antes de vencer: conta de novo
      await jest.advanceTimersByTimeAsync(10);
      await jest.advanceTimersByTimeAsync(store.IDLE_RELEASE_MS - 1000);
      expect(idle).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(2000);
      expect(idle).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(store.IDLE_RELEASE_MS * 3);
      expect(idle).toHaveBeenCalledTimes(1); // parado não repete
    } finally {
      jest.useRealTimers();
    }
  });
});
