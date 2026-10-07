// Nada anima pra sempre: um loop eterno deixa a tela parada redesenhando a 60 fps (perfil, editor e mapa no S23).
// Monta Pulse, Glow, AnimatedGradient, BlobBackground e LiveDot com Reanimated/Skia de mentira e confere que toda
// repetição tem fim e que movimento reduzido desliga.

import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { act, create } from 'react-test-renderer';

declare const __dirname: string;

const mockReps: number[] = [];
let mockReduce = false;
jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual('react');
  const anim = (v: unknown) => ({ to: v });
  return {
    __esModule: true,
    default: { View: (p: { children?: unknown }) => R.createElement('AView', p, p.children) },
    Easing: { inOut: () => () => 0, out: () => () => 0, linear: () => 0, ease: () => 0, sin: () => 0, cubic: () => 0 },
    useSharedValue: (v: unknown) => R.useRef({ value: v }).current,
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => mockReduce,
    cancelAnimation: () => {},
    withTiming: anim,
    withDelay: (_d: number, a: unknown) => a,
    withSequence: (...a: unknown[]) => a,
    withRepeat: (a: unknown, reps: number) => {
      mockReps.push(reps);
      return a;
    },
  };
});
jest.mock('@shopify/react-native-skia', () => {
  const R = jest.requireActual('react');
  const host = (name: string) => (p: { children?: unknown }) => R.createElement(name, p, p.children);
  return {
    Canvas: host('Canvas'),
    Group: host('Group'),
    Circle: host('Circle'),
    Fill: host('Fill'),
    Rect: host('Rect'),
    RoundedRect: host('RoundedRect'),
    BlurMask: host('BlurMask'),
    LinearGradient: host('LinearGradient'),
    RadialGradient: host('RadialGradient'),
    Skia: { Color: () => Float32Array.of(1, 0, 0, 1) },
    vec: (x: number, y: number) => ({ x, y }),
  };
});

// eslint-disable-next-line import/first
import { AnimatedGradient } from '../AnimatedGradient';
// eslint-disable-next-line import/first
import { BlobBackground } from '../BlobBackground';
// eslint-disable-next-line import/first
import { Glow } from '../Glow';
// eslint-disable-next-line import/first
import { LiveDot } from '../LiveDot';
// eslint-disable-next-line import/first
import { Pulse } from '../Pulse';

beforeEach(() => {
  mockReps.length = 0;
  mockReduce = false;
});

function mount(el: React.ReactElement) {
  let r: ReturnType<typeof create> | null = null;
  act(() => {
    r = create(el);
  });
  return r as unknown as ReturnType<typeof create>;
}

describe('animações com fim', () => {
  it('Pulse, Glow e AnimatedGradient repetem um número finito de vezes', () => {
    mount(<Pulse />);
    mount(<Pulse cycles={5} />);
    mount(<Glow />);
    mount(<AnimatedGradient width={100} height={40} />);
    expect(mockReps.length).toBe(4);
    for (const n of mockReps) expect(n).toBeGreaterThan(0); // -1 = infinito
    expect(mockReps[1]).toBe(10); // 5 respirações = 10 idas e voltas
  });

  it('Glow para no brilho cheio (número ímpar de idas e voltas a partir de 0)', () => {
    mount(<Glow cycles={2} />);
    expect(mockReps[0] % 2).toBe(1);
  });

  it('movimento reduzido: nada repete', () => {
    mockReduce = true;
    mount(<Pulse />);
    mount(<Glow />);
    mount(<AnimatedGradient width={100} height={40} />);
    mount(<BlobBackground />);
    expect(mockReps.length).toBe(0);
  });

  it('BlobBackground dá uma volta (sem withRepeat) e sem desfoque por quadro', () => {
    const r = mount(<BlobBackground />);
    expect(mockReps.length).toBe(0);
    expect(r.root.findAll((n) => (n.type as unknown) === 'BlurMask').length).toBe(0);
    expect(r.root.findAll((n) => (n.type as unknown) === 'RadialGradient').length).toBe(3);
  });

  it('Boost e Paywall: nenhum loop eterno (withRepeat -1) e todos respeitam movimento reduzido', () => {
    // (o tsconfig do app não traz os tipos do node: só o que o teste usa)
    const fs = jest.requireActual<{ readFileSync(p: string, enc: string): string }>('fs');
    for (const f of ['../../../screens/boost/BoostScreen.tsx', '../../../screens/paywall/PaywallScreen.tsx']) {
      const src = fs.readFileSync(`${__dirname}/${f}`, 'utf8');
      expect({ f, infinite: /,\s*-1\s*,\s*(true|false)\s*\)/.test(src) }).toEqual({ f, infinite: false });
      expect({ f, reduce: src.includes('useReducedMotion()') }).toEqual({ f, reduce: true });
    }
  });

  it('LiveDot: um relógio só, com fim', () => {
    const loop = jest.spyOn(Animated, 'loop');
    const r = mount(
      <>
        <LiveDot />
        <LiveDot halo />
      </>,
    );
    expect(loop).toHaveBeenCalledTimes(1);
    const cfg = loop.mock.calls[0][1] as { iterations?: number } | undefined;
    expect(cfg?.iterations).toBeGreaterThan(0);
    act(() => r.unmount()); // o último ponto desmontado para o relógio
    loop.mockRestore();
  });

  it('LiveDot: movimento reduzido ligado com o app aberto para o relógio e volta ao repouso; ponto novo não religa', () => {
    // o LiveDot assina o evento ao carregar o módulo (o addEventListener do preset é um jest.fn)
    const calls = ((AccessibilityInfo.addEventListener as unknown as jest.Mock).mock?.calls ?? []) as [string, (v: boolean) => void][];
    const onChange = calls.find((c) => c[0] === 'reduceMotionChanged')?.[1];
    expect(typeof onChange).toBe('function');
    const loop = jest.spyOn(Animated, 'loop');
    const r2 = mount(<LiveDot />);
    expect(loop).toHaveBeenCalledTimes(1); // montou antes de saber do movimento reduzido: respira
    const stop = jest.spyOn(loop.mock.results[0].value as { stop: () => void }, 'stop');
    act(() => onChange!(true));
    expect(stop).toHaveBeenCalled();
    loop.mockClear();
    mount(<LiveDot halo />);
    expect(loop).not.toHaveBeenCalled(); // com movimento reduzido nenhum ponto novo liga o relógio
    act(() => onChange!(false));
    act(() => r2.unmount());
    loop.mockRestore();
  });
});
