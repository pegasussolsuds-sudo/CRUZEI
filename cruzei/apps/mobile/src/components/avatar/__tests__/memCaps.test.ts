// Tetos de memória dos caches de avatar fora do mapa, nos cenários da carga (1.000 pessoas vistas, 300 no nearby, lista
// rolando, 50 perfis abertos), com o código de verdade das camadas e dos efeitos. O que pesa no heap do Hermes são as
// strings de path: a estimativa em bytes nunca pode ficar abaixo dos caracteres retidos.

import type { AvatarConfig } from '@cruzei/shared-types';
import { avatarSlotDef, avatarTiersFor, normalizeAvatarConfig, randomAvatarConfig } from '@cruzei/shared-utils';

jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../screens/map/native/images/draw', () => ({ avatarPng: () => null }));
jest.mock('../../../screens/map/native/images/store', () => ({
  mapImages: { get: () => undefined, request: () => Promise.resolve(null), cancel: () => undefined },
}));

import { RESOLVED_CACHE_MAX, bustBoxFor, keyOf, layersBytes, resolveAvatar } from '../../../avatar';
import { clearMemCaches, memCacheStats } from '../../../services/memCache';
import { LAYER_CACHE_BYTES, cachedLayers } from '../CruzeiAvatar';
import { FX_STATIC_CACHE_BYTES, staticAura, staticBackdrop } from '../stage/fx-static';

const PLUS = avatarTiersFor('premium_plus');
const ids = (slot: string) => avatarSlotDef(slot as never).items.map((i: { id: string }) => i.id).filter((id: string) => id !== 'none');
const pick = (slot: string, i: number) => {
  const l = ids(slot);
  return l[i % l.length];
};
/** pior caso do loadtest: sobreposição, costas, chapéu, aura no máximo e fundo */
const heavy = (i: number): AvatarConfig =>
  normalizeAvatarConfig(
    {
      ...randomAvatarConfig('p' + i, { tiers: PLUS }),
      outer: pick('outer', i * 3),
      bag: pick('bag', i * 5),
      hat: pick('hat', i * 7),
      aura: pick('aura', i * 11),
      auraLevel: 'max',
      backdrop: pick('backdrop', i * 13),
    },
    PLUS,
  ) as AvatarConfig;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const stat = (name: string) => memCacheStats()[name] ?? { items: 0, bytes: 0 };
const pathChars = (layers: { d: string; cp?: string }[]) => layers.reduce((s, l) => s + l.d.length + (l.cp?.length ?? 0), 0);

beforeEach(() => clearMemCaches());

describe('tetos de memória dos caches de avatar', () => {
  it('1.000 pessoas vistas, 300 por resposta do nearby: configs prontas no teto; mesmo visual = mesmo objeto', () => {
    const people = Array.from({ length: 1000 }, (_, i) => ({ id: 'u' + i, avatar: randomAvatarConfig('p' + i, { tiers: PLUS }) }));
    for (let step = 0; step < 40; step++) {
      const res = copy(Array.from({ length: 300 }, (_, k) => people[(step * 50 + k) % 1000]));
      for (const p of res) keyOf(resolveAvatar(p.avatar, p.id));
      expect(stat('avatar.resolved').items).toBeLessThanOrEqual(RESOLVED_CACHE_MAX);
    }
    // a próxima busca (objetos novos) da mesma janela de 300 volta toda do cache, com a mesma identidade
    const win = Array.from({ length: 300 }, (_, k) => people[(39 * 50 + k) % 1000]);
    const a = copy(win).map((p) => resolveAvatar(p.avatar, p.id));
    const b = copy(win).map((p) => resolveAvatar(p.avatar, p.id));
    expect(b.every((c, i) => c === a[i])).toBe(true);
    // com config, o seed não entra: duas pessoas com o mesmo visual dividem a entrada
    expect(resolveAvatar(copy(people[1].avatar), 'outra')).toBe(resolveAvatar(copy(people[1].avatar), 'u1'));
    expect(stat('avatar.resolved').bytes).toBeLessThan(2 * 1024 * 1024);
  });

  it('lista rolando por 120 visuais pesados: camadas no teto de bytes (o antigo segurava 120)', () => {
    let built = 0;
    let lastCfg: AvatarConfig | null = null;
    let lastLayers: unknown = null;
    for (let i = 0; i < 120; i++) {
      const c = heavy(i);
      const l = cachedLayers(c, keyOf(c), { groundShadow: false, mode: 'bust', lod: 'lite' });
      const est = layersBytes(l);
      expect(est).toBeGreaterThanOrEqual(pathChars(l));
      built += est;
      const st = stat('avatar.layers');
      expect(st.bytes).toBeLessThanOrEqual(LAYER_CACHE_BYTES);
      expect(st.items).toBeLessThanOrEqual(24);
      lastCfg = c;
      lastLayers = l;
    }
    // o visual na tela volta do cache (o mesmo em outro tamanho não monta de novo)
    const c = lastCfg as AvatarConfig;
    expect(cachedLayers(c, keyOf(c), { groundShadow: false, mode: 'bust', lod: 'lite' })).toBe(lastLayers);
    // o que o teto antigo (120 visuais) seguraria nesta rolagem: mais de 10 vezes o teto novo
    expect(built).toBeGreaterThan(10 * LAYER_CACHE_BYTES);
  }, 60_000);

  it('50 perfis abertos (corpo inteiro, detalhe completo): camadas no teto', () => {
    for (let i = 0; i < 50; i++) {
      const c = heavy(500 + i);
      cachedLayers(c, keyOf(c), { groundShadow: true, mode: 'full', lod: 'full' });
      expect(stat('avatar.layers').bytes).toBeLessThanOrEqual(LAYER_CACHE_BYTES + 1024 * 1024); // o recém-chegado fica sempre
    }
    expect(stat('avatar.layers').items).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('aura e fundo parados de 300 visuais: no teto de bytes; o da tela volta do cache', () => {
    let last: unknown = null;
    let cfg: AvatarConfig | null = null;
    for (let i = 0; i < 300; i++) {
      const c = heavy(i);
      last = staticAura(c, 'bust', bustBoxFor(c));
      staticBackdrop(c, 'bust', bustBoxFor(c));
      cfg = c;
      expect(stat('avatar.fxStatic').bytes).toBeLessThanOrEqual(FX_STATIC_CACHE_BYTES);
    }
    expect(last).not.toBeNull();
    const c = cfg as AvatarConfig;
    expect(staticAura(c, 'bust', bustBoxFor(c))).toBe(last);
  }, 60_000);

  it('memória baixa / app no fundo: clearMemCaches solta tudo', () => {
    const c = heavy(1);
    resolveAvatar(c, 'x');
    cachedLayers(c, keyOf(c), { groundShadow: false, mode: 'bust', lod: 'lite' });
    staticAura(c, 'bust', bustBoxFor(c));
    clearMemCaches();
    for (const name of ['avatar.resolved', 'avatar.layers', 'avatar.fxStatic']) expect(stat(name)).toEqual({ items: 0, bytes: 0 });
  });
});
