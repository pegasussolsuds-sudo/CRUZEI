// Sprites do palco (stageSprites): cada corrida rasterizada uma vez, desenhada por quadro como imagem. Com o CanvasKit
// (CPU, a mesma API do react-native-skia) confere que o avatar parado montado com os sprites é o MESMO desenho das
// SkPictures (que o palco tocava a cada quadro) e que a caixa de cada corrida não corta nada.

import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';
import type { SkCanvas, SkImage, SkSurface } from '@shopify/react-native-skia';

// sem @types/node no app: o mínimo do 'path' e do require.resolve, tipado à mão
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

type Sk = {
  Surface: { Make(w: number, h: number): SkSurface | null };
  Color(c: string): Float32Array;
  XYWHRect(x: number, y: number, w: number, h: number): unknown;
  Paint(): unknown;
};
let Skia: Sk;

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
  Skia = JsiSkApi(CK) as Sk;
  mockSk.api = Skia;
}, 60000);

/* eslint-disable @typescript-eslint/no-var-requires */
const load = () => ({
  assets: require('../assets') as typeof import('../assets'),
  layout: require('../layout') as typeof import('../layout'),
  rig: require('../../../../avatar/rig') as typeof import('../../../../avatar/rig'),
  pose: require('../../../../avatar/pose') as typeof import('../../../../avatar/pose'),
  scene: require('../../../../avatar/scene') as typeof import('../../../../avatar/scene'),
});
/* eslint-enable @typescript-eslint/no-var-requires */

function rgba(s: SkSurface, w: number, h: number): Uint8Array {
  s.flush();
  return s.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, alphaType: 3, colorType: 4 }) as Uint8Array;
}

const cfg = (p: Partial<AvatarConfig>) => normalizeAvatarConfig({ ...DEFAULT_AVATAR, ...p }) as AvatarConfig;

describe('stageSprites', () => {
  it('parado, sprites = SkPictures (mesmo desenho, pixel a pixel na escala da tela)', () => {
    const { assets, layout, rig, pose, scene } = load();
    const PR = 2.75;
    const configs = [cfg({}), cfg({ hair: 'long', top: 'gown', outer: 'cape', bag: 'wings_angel', hat: 'witch', pet: 'cat_orange' }), cfg({ vehicle: 'wheelchair', pet: 'cat_orange', petPose: 'arms' })];
    for (const c of configs) {
      assets.clearStageCache();
      const a = assets.stageAssets(c, 'full', true, null);
      const L = layout.stageLayout('full', 160);
      const W = Math.round(L.w * PR);
      const H = Math.round(L.h * PR);
      const sprites = assets.stageSprites(a, L.s * PR);
      expect(sprites).not.toBeNull();
      expect(assets.peekStageSprites(a, L.s * PR)).toBe(sprites); // guardado: o 2º palco não rasteriza de novo
      // origem num pixel inteiro, como o palco faz
      const base = L.base.slice();
      base[2] = Math.round(base[2] * PR) / PR;
      base[5] = Math.round(base[5] * PR) / PR;
      const p0 = scene.applyScene(pose.zero(), a.rig.scene ?? null, 0);
      const draw = (useSprites: boolean): Uint8Array => {
        const s = Skia.Surface.Make(W, H) as SkSurface;
        const k: SkCanvas = s.getCanvas();
        k.clear(Skia.Color('rgba(0,0,0,0)') as never);
        k.scale(PR, PR);
        k.concat(base);
        if (useSprites) {
          for (const sp of sprites!) {
            if (sp.role !== 'n' && sp.role !== 'face' && sp.role !== 'held' && sp.role !== 'hand') continue;
            k.save();
            k.concat(rig.mToSkia(layout.snapToGrid(rig.groupMatrix(sp.g, a.rig, p0), L.s * PR)));
            const img = sp.img as SkImage;
            k.drawImageRectOptions(img, Skia.XYWHRect(0, 0, img.width(), img.height()) as never, Skia.XYWHRect(sp.x, sp.y, sp.w, sp.h) as never, 1 as never, 0 as never, null);
            k.restore();
          }
        } else {
          for (const run of a.runs) {
            if (run.role !== 'n' && run.role !== 'face' && run.role !== 'held' && run.role !== 'hand') continue;
            k.save();
            k.concat(rig.mToSkia(layout.snapToGrid(rig.groupMatrix(run.g, a.rig, p0), L.s * PR)));
            k.drawPicture(run.picture);
            k.restore();
          }
        }
        return rgba(s, W, H);
      };
      const ref = draw(false);
      const got = draw(true);
      let bad = 0;
      let ink = 0;
      for (let i = 0; i < ref.length; i += 4) {
        if (ref[i + 3] > 8) ink++;
        let d = 0;
        for (let j = 0; j < 4; j++) d = Math.max(d, Math.abs(ref[i + j] - got[i + j]));
        if (d > 24) bad++;
      }
      expect(ink).toBeGreaterThan(1000);
      // só a borda antisserrilhada pode mudar um tico (amostragem); nada cortado, nada faltando
      expect(bad / ink).toBeLessThan(0.01);
    }
  });

  it('caixa de cada corrida cobre a tinta (traço e desfoque) e respeita o teto de memória', () => {
    const { assets, layout } = load();
    assets.clearStageCache();
    const a = assets.stageAssets(cfg({ aura: 'flames', backdrop: 'beach', hair: 'afro', bag: 'wings_dragon' }), 'full', true, null);
    const L = layout.stageLayout('full', 336);
    const sprites = assets.stageSprites(a, L.s * 3)!;
    let px = 0;
    for (const sp of sprites) {
      expect(sp.w).toBeGreaterThan(0);
      expect(sp.h).toBeGreaterThan(0);
      px += sp.img.width() * sp.img.height();
    }
    // palco grande (336 dp, 3x): bem abaixo de 8 MB de pixels pras corridas todas
    expect((px * 4) / 1048576).toBeLessThan(8);
  });

  it('cache do palco conta os pixels dos sprites, fica no teto e solta tudo sem palco montado', () => {
    const { assets, layout } = load();
    /* eslint-disable-next-line @typescript-eslint/no-var-requires */
    const { memCacheStats } = require('../../../../services/memCache') as typeof import('../../../../services/memCache');
    assets.clearStageCache();
    const L = layout.stageLayout('full', 336);
    const looks: Partial<AvatarConfig>[] = [
      { hair: 'afro', bag: 'wings_dragon' },
      { hair: 'long', outer: 'cape' },
      { hat: 'witch', pet: 'cat_orange' },
      { top: 'gown', bag: 'wings_angel' },
      { hair: 'dreads', outer: 'trench' },
      { vehicle: 'wheelchair' },
    ];
    let last = 0;
    for (const p of looks) {
      const a = assets.stageAssets(cfg(p), 'full', true, null);
      last = assets.stageSprites(a, L.s * 3)!.reduce((s, sp) => s + sp.img.width() * sp.img.height() * 4, 0);
      const st = memCacheStats()['avatar.stage'];
      expect(st.items).toBeLessThanOrEqual(4);
      expect(st.bytes).toBeLessThanOrEqual(assets.STAGE_CACHE_BYTES);
    }
    expect(last).toBeGreaterThan(500_000);
    expect(memCacheStats()['avatar.stage'].bytes).toBeGreaterThanOrEqual(last);

    jest.useFakeTimers();
    try {
      const a = assets.stageAssets(cfg({ hair: 'afro', bag: 'wings_dragon' }), 'full', true, null);
      const off1 = assets.holdStage();
      const off2 = assets.holdStage();
      off1();
      off1(); // soltar duas vezes não conta duas
      jest.advanceTimersByTime(assets.STAGE_IDLE_MS * 2);
      expect(assets.stageAssets(cfg({ hair: 'afro', bag: 'wings_dragon' }), 'full', true, null)).toBe(a); // ainda montado
      off2();
      jest.advanceTimersByTime(assets.STAGE_IDLE_MS - 1000);
      const again = assets.holdStage(); // voltou pro perfil antes do prazo: nada sai
      jest.advanceTimersByTime(assets.STAGE_IDLE_MS * 2);
      expect(memCacheStats()['avatar.stage'].items).toBeGreaterThan(0);
      again();
      jest.advanceTimersByTime(assets.STAGE_IDLE_MS);
      expect(memCacheStats()['avatar.stage']).toEqual({ items: 0, bytes: 0 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('sem palco montado a limpeza descarta as imagens e SkPictures, e ler o cache no render adia a limpeza', () => {
    const { assets, layout } = load();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { memCacheStats } = require('../../../../services/memCache') as typeof import('../../../../services/memCache');
    assets.clearStageCache();
    const L = layout.stageLayout('full', 336);
    jest.useFakeTimers();
    try {
      const look = cfg({ hair: 'afro', bag: 'wings_dragon' });
      const a = assets.stageAssets(look, 'full', true, null);
      const img = assets.stageSprites(a, L.s * 3)![0].img;
      const pic = a.runs[0].picture;
      const off = assets.holdStage();
      off();
      jest.advanceTimersByTime(assets.STAGE_IDLE_MS - 1000);
      // um palco montando lê o cache no render, antes do efeito que segura (holdStage): a limpeza espera de novo
      expect(assets.stageAssets(look, 'full', true, null)).toBe(a);
      jest.advanceTimersByTime(2000);
      expect(img.width()).toBeGreaterThan(0);
      jest.advanceTimersByTime(assets.STAGE_IDLE_MS);
      expect(memCacheStats()['avatar.stage']).toEqual({ items: 0, bytes: 0 });
      // descartados na hora (CanvasKit: objeto apagado lança ao ser usado), sem esperar o coletor
      expect(() => img.width()).toThrow();
      expect(() => pic.serialize()).toThrow();
    } finally {
      jest.useRealTimers();
    }
  });
});
