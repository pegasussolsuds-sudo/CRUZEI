// Fumaça do palco: monta o AvatarStage com Skia/Reanimated de mentira (componentes vazios, SharedValue simples) e a
// lógica REAL de camadas, papéis de troca, pose, cena e matrizes. Pega erro de hook, de worklet e de montagem.

import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// Reanimated mínimo (o mock oficial inicializa o módulo nativo de worklets): SharedValue = objeto com value,
// derivado = calcula uma vez (roda o worklet de verdade no JS), relógio desligado (cada liga/desliga fica anotado)
const mockClock: boolean[] = [];
jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual('react');
  return {
    useSharedValue: (v: unknown) => R.useRef({ value: v }).current,
    // como o de verdade: o mapper só é refeito quando as deps mudam (sem deps = sempre)
    useDerivedValue: (fn: () => unknown, deps?: unknown[]) => {
      const ref = R.useRef(null as null | { sv: { value: unknown }; deps?: unknown[] });
      const same = !!ref.current && !!deps && !!ref.current.deps && deps.length === ref.current.deps.length && deps.every((d, i) => Object.is(d, ref.current!.deps![i]));
      if (!same) ref.current = { sv: { value: fn() }, deps };
      return ref.current!.sv;
    },
    useFrameCallback: () => ({ setActive: (v: boolean) => mockClock.push(v), isActive: false, callbackId: 1 }),
    useReducedMotion: () => false,
    runOnJS: (f: unknown) => f,
  };
});

jest.mock('@shopify/react-native-skia', () => {
  const R = jest.requireActual('react');
  const host = (name: string) =>
    function Host(props: Record<string, unknown>) {
      return R.createElement(name, props, props.children as never);
    };
  return {
    Canvas: host('Canvas'),
    Group: host('Group'),
    Picture: host('Picture'),
    Circle: host('Circle'),
    RadialGradient: host('RadialGradient'),
    LinearGradient: host('LinearGradient'),
    Rect: host('Rect'),
    RoundedRect: host('RoundedRect'),
    vec: (x: number, y: number) => ({ x, y }),
    Skia: { XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }), RRectXY: (rect: unknown, rx: number, ry: number) => ({ rect, rx, ry }) },
  };
});

// gravação de SkPicture trocada por um objeto marcador; o resto (camadas, papéis, corridas) é o código de verdade
jest.mock('../assets', () => {
  const avatar = jest.requireActual('../../../../avatar');
  const st = jest.requireActual('../stageLayers');
  return {
    stageAssets: (cfg: AvatarConfig, mode: 'full' | 'bust', shadow: boolean, def: { face?: { face: string }[]; prop?: string } | null) => {
      const opts = { groundShadow: shadow && mode === 'full', mode };
      const base = avatar.buildAvatarLayers(cfg, opts);
      const altFaces: string[] = [];
      const altFaceLayers: unknown[][] = [];
      for (const f of def?.face ?? []) {
        if (f.face === cfg.face || altFaces.includes(f.face)) continue;
        altFaces.push(f.face);
        altFaceLayers.push(avatar.layersWithTag(avatar.buildAvatarLayers({ ...cfg, face: f.face }, opts), 'face'));
      }
      const prop = def?.prop ? [{ d: 'M0,0H4V4Z', f: '#f00', g: 'foreR', k: 'held' }] : [];
      // a animação de teste troca as duas mãos pela aberta (papéis 'hand' / 'handOpen' nos dois antebraços)
      const hands = def ? avatar.layersWithTag(avatar.buildAvatarLayers(cfg, { ...opts, hands: { L: 'open', R: 'open' } }), 'hand') : [];
      const merged = st.mergeStageLayers({ base, altFaces: altFaceLayers, prop, propAt: base.length - 3, hands });
      const runs = st.stageRuns(merged).map((r: { g: string; role: string }, i: number) => ({ g: r.g, role: r.role, picture: { id: i, g: r.g } }));
      return { key: avatar.keyOf(cfg), rig: avatar.buildAvatarRig(cfg, { mode }), runs, altFaces, hasProp: prop.length > 0, hasHands: hands.length > 0 };
    },
    // sem raster nos testes: o palco toca as SkPictures (o caminho dos sprites tem a prova dele, stageSprites.test)
    peekStageSprites: () => null,
    stageSprites: () => null,
    holdStage: () => () => undefined,
  };
});

// uma animação de teste com troca de rosto e objeto
jest.mock('../../../../avatar/emotes/gestures', () => {
  const pose = jest.requireActual('../../../../avatar/pose');
  return {
    GESTURES: {
      test_wave: {
        id: 'test_wave',
        dur: 1.5,
        loop: false,
        usesArms: true,
        usesLegs: false,
        keyK: 0.4,
        face: [{ from: 0.2, to: 0.8, face: 'grin' }],
        prop: 'mic',
        fx: [{ kind: 'sparkles', from: 'handR', start: 0.1, end: 0.9, rate: 6 }],
        pose: (k: number) => {
          'worklet';
          const p = pose.zero();
          p.armR.r = -140 * Math.sin(Math.PI * k);
          p.foreR = { r: -30 * Math.sin(Math.PI * k) };
          return p;
        },
      },
    },
  };
});

import { AvatarStage } from '../AvatarStage';
import { stageLayout } from '../layout';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;

function mount(el: React.ReactElement): ReactTestRenderer {
  let r: ReactTestRenderer | null = null;
  act(() => {
    r = create(el);
  });
  return r as unknown as ReactTestRenderer;
}
function unmount(r: ReactTestRenderer): void {
  act(() => r.unmount());
}
const OFF = [1, 0, -100000, 0, 1, -100000, 0, 0, 1];

describe('AvatarStage (fumaça)', () => {
  it('monta parado: uma corrida por Picture, matriz em cada grupo, canvas no tamanho do enquadramento', () => {
    const r = mount(<AvatarStage config={base} size={300} />);
    const canvas = r.root.findByType('Canvas' as never);
    const L = stageLayout('full', 300);
    expect(canvas.props.style).toEqual({ width: L.w, height: L.h });
    const pics = r.root.findAllByType('Picture' as never);
    expect(pics.length).toBeGreaterThan(10);
    const groups = r.root.findAllByType('Group' as never);
    expect(groups.some((g) => Array.isArray(g.props.matrix) && g.props.matrix.length === 9)).toBe(true); // base
    expect(groups.filter((g) => Array.isArray(g.props.matrix?.value) && g.props.matrix.value.length === 9).length).toBe(pics.length); // uma matriz por corrida
    unmount(r);
  });

  it('com animação de troca: corridas alternativas de rosto e objeto montadas', () => {
    const r = mount(<AvatarStage config={base} size={320} emote="test_wave" playing showPronouns showBackdrop />);
    expect(r.root.findAllByType('Picture' as never).length).toBeGreaterThan(12);
    // parado no início: a expressão alternativa e o objeto existem mas ficam fora do canvas
    const groups = r.root.findAllByType('Group' as never);
    expect(groups.filter((g) => JSON.stringify(g.props.matrix?.value) === JSON.stringify(OFF)).length).toBeGreaterThanOrEqual(2);
    unmount(r);
  });

  it('config nova (lista de corridas desloca): cada corrida visível usa a matriz do PRÓPRIO grupo', () => {
    /** matriz de cada corrida visível, agrupada pelo grupo da corrida */
    const byGroup = (r: ReactTestRenderer) => {
      const out: Record<string, string[]> = {};
      for (const g of r.root.findAllByType('Group' as never)) {
        const pic = g.findAllByType('Picture' as never, { deep: false })[0];
        const m = g.props.matrix?.value;
        if (!pic || !Array.isArray(m) || JSON.stringify(m) === JSON.stringify(OFF)) continue;
        (out[pic.props.picture.g] ??= []).push(JSON.stringify(m));
      }
      return out;
    };
    const el = (cfg: AvatarConfig) => <AvatarStage config={cfg} size={300} emote="test_wave" playing reduceMotion />;
    const r = mount(el(base));
    const cfgs = [{ ...base, bag: 'backpack' }, { ...base, hair: 'long', bag: 'backpack' }, { ...base, hair: 'long_curly', held: 'coffee' }, base] as AvatarConfig[];
    for (const cfg of cfgs) {
      act(() => r.update(el(cfg)));
      const groups = byGroup(r);
      expect(groups.foreL?.length).toBeGreaterThan(1);
      expect(groups.foreR?.length).toBeGreaterThan(1);
      expect(groups.foreL[0]).not.toBe(groups.foreR[0]); // a animação gira o braço direito: as matrizes diferem
      for (const [g, ms] of Object.entries(groups)) expect([g, new Set(ms).size]).toEqual([g, 1]);
    }
    unmount(r);
  });

  it('parado não anima: com aura e fundo, o relógio nunca liga; liga só tocando animação ou com respiração pedida', () => {
    const fancy = { ...base, aura: 'galaxy', auraLevel: 'max', backdrop: 'beach' } as AvatarConfig;
    mockClock.length = 0;
    let r = mount(<AvatarStage config={fancy} size={200} showBackdrop showPronouns />);
    expect(mockClock.includes(true)).toBe(false);
    // assinatura parada (sem tocar) também não
    act(() => r.update(<AvatarStage config={fancy} size={200} showBackdrop emote="test_wave" playing={false} />));
    expect(mockClock.includes(true)).toBe(false);
    act(() => r.update(<AvatarStage config={fancy} size={200} showBackdrop emote="test_wave" playing />));
    expect(mockClock[mockClock.length - 1]).toBe(true);
    unmount(r);
    mockClock.length = 0;
    r = mount(<AvatarStage config={base} size={200} idle />);
    expect(mockClock[mockClock.length - 1]).toBe(true);
    unmount(r);
  });

  it('trocar aura/fundo só anima com fxPreview (editor); fora dele (folha trocando de pessoa, /me chegando) fica parado', () => {
    const a = { ...base, aura: 'galaxy', auraLevel: 'max', backdrop: 'beach' } as AvatarConfig;
    const b = { ...base, aura: 'flames', auraLevel: 'max', backdrop: 'pride' } as AvatarConfig;
    mockClock.length = 0;
    let r = mount(<AvatarStage config={a} size={200} showBackdrop />);
    act(() => r.update(<AvatarStage config={b} size={200} showBackdrop />));
    expect(mockClock.includes(true)).toBe(false);
    unmount(r);
    mockClock.length = 0;
    r = mount(<AvatarStage config={a} size={200} showBackdrop fxPreview />);
    act(() => r.update(<AvatarStage config={b} size={200} showBackdrop fxPreview />));
    expect(mockClock[mockClock.length - 1]).toBe(true);
    unmount(r);
  });

  it('movimento reduzido, pausado, busto e veículo não quebram', () => {
    const cfgs = [base, { ...base, vehicle: 'wheelchair', pet: 'cat_orange', petPose: 'arms' }, { ...base, vehicle: 'car', aura: 'galaxy', backdrop: 'pride', pronouns: 'elu' }] as AvatarConfig[];
    for (const cfg of cfgs) {
      for (const mode of ['full', 'bust'] as const) {
        const r = mount(<AvatarStage config={cfg} size={200} mode={mode} emote="test_wave" playing reduceMotion paused showBackdrop showPronouns />);
        expect(r.root.findAllByType('Picture' as never).length).toBeGreaterThan(5);
        unmount(r);
      }
    }
  });
});
