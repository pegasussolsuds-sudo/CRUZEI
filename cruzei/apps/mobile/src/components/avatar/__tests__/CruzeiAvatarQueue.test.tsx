// Fila das miniaturas do <CruzeiAvatar/>: a fila de desenho é a do mapa, então a miniatura entra com prioridade de
// figura distante e no máximo THUMB_INFLIGHT por vez; quem desmonta antes da vez nem chega à fila do mapa; enquanto o PNG
// não chega aparece a silhueta parada (sem SVG pesado montado à toa).

import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('react-native-svg', () => {
  const R = jest.requireActual('react');
  const host = (name: string) =>
    function Host(props: Record<string, unknown>) {
      return R.createElement(name, props, props.children as never);
    };
  const names = ['Svg', 'ClipPath', 'Defs', 'Ellipse', 'FeGaussianBlur', 'Filter', 'G', 'LinearGradient', 'Path', 'RadialGradient', 'Stop'];
  const out: Record<string, unknown> = { __esModule: true, default: host('Svg') };
  for (const n of names) out[n] = host(n);
  return out;
});

const mockCalls: { key: string; pri: number; done: (v: { path: string; scale: number } | null) => void }[] = [];
const mockCancelled: string[] = [];
let mockReady = false;
const mockBuild = { n: 0 };
jest.mock('../../../avatar', () => {
  const real = jest.requireActual('../../../avatar');
  return {
    ...real,
    buildAvatarLayers: (...a: unknown[]) => {
      mockBuild.n++;
      return real.buildAvatarLayers(...a);
    },
  };
});
jest.mock('../../../screens/map/native/images/draw', () => ({ avatarPng: () => new Uint8Array([1]) }));
jest.mock('../../../screens/map/native/images/store', () => ({
  mapImages: {
    get: (key: string) => (mockReady ? { path: '/disco/' + key, scale: 2 } : undefined),
    request: (key: string, pri: number) =>
      new Promise((done) => {
        mockCalls.push({ key, pri, done: done as never });
      }),
    cancel: (key: string) => {
      mockCancelled.push(key);
      const i = mockCalls.findIndex((c) => c.key === key);
      if (i >= 0) mockCalls.splice(i, 1)[0].done(null);
    },
  },
}));

import { CruzeiAvatar, THUMB_INFLIGHT, THUMB_PRIORITY } from '../CruzeiAvatar';

const cfg = (hair: string) => normalizeAvatarConfig({ ...DEFAULT_AVATAR, hair }) as AvatarConfig;
const HAIRS = ['short', 'long', 'afro', 'buzz', 'bun', 'long_curly'];

describe('CruzeiAvatar: fila das miniaturas', () => {
  it('teto na fila do mapa, prioridade de figura distante, desmontado não desenha, silhueta enquanto espera', async () => {
    const roots: ReactTestRenderer[] = [];
    await act(async () => {
      for (const h of HAIRS) roots.push(create(<CruzeiAvatar config={cfg(h)} size={56} />));
    });
    expect(mockCalls.length).toBe(THUMB_INFLIGHT);
    expect(mockCalls.every((c) => c.pri === THUMB_PRIORITY)).toBe(true);
    // esperando: silhueta (Views), nada de SVG do corpo
    expect(roots[0].root.findAllByType('Path' as never)).toHaveLength(0);
    // dois que ainda esperam a vez desmontam: nunca vão pra fila do mapa
    const requested = new Set(mockCalls.map((c) => c.key));
    act(() => {
      roots[2].unmount();
      roots[3].unmount();
    });
    // termina o que estava desenhando: entram os últimos montados (os que estão na tela ao rolar), sem passar do teto
    await act(async () => {
      mockCalls.splice(0).forEach((c) => c.done({ path: '/x/' + c.key, scale: 2 }));
    });
    expect(mockCalls.length).toBe(THUMB_INFLIGHT);
    for (const c of mockCalls) requested.add(c.key);
    await act(async () => {
      mockCalls.splice(0).forEach((c) => c.done({ path: '/y/' + c.key, scale: 2 }));
    });
    // 6 miniaturas: 4 desenhadas, 2 desmontadas sem desenhar → nada mais na fila
    expect(mockCalls.length).toBe(0);
    expect(requested.size).toBe(4);
    // a que recebeu o PNG mostra a imagem (e a silhueta some)
    expect(roots[5].root.findAllByType('Image' as never).length).toBe(1);
    for (const r of [roots[0], roots[1], roots[4], roots[5]]) act(() => r.unmount());
  });

  it('desmontou com o pedido já na fila do mapa: cancela lá e libera a vaga', async () => {
    mockCancelled.length = 0;
    const roots: ReactTestRenderer[] = [];
    await act(async () => {
      for (const h of ['short', 'long', 'afro']) roots.push(create(<CruzeiAvatar config={cfg(h)} size={48} />));
    });
    expect(mockCalls.length).toBe(THUMB_INFLIGHT);
    const sentKey = mockCalls[0].key;
    // desmonta todos: os que estavam na fila do mapa são cancelados lá, o que esperava a vez nem chega
    await act(async () => {
      roots.forEach((r) => r.unmount());
    });
    expect(mockCancelled.length).toBe(THUMB_INFLIGHT);
    expect(mockCancelled).toContain(sentKey);
    expect(mockCalls.length).toBe(0);
  });

  it('PNG já pronto (rolar a grade de volta): nenhuma camada montada, só a imagem', async () => {
    mockReady = true;
    mockBuild.n = 0;
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <>
          {HAIRS.map((h) => (
            <CruzeiAvatar key={h} config={cfg(h + '')} size={76} mode="full" />
          ))}
        </>,
      );
    });
    expect(mockBuild.n).toBe(0);
    expect(r.root.findAllByType('Image' as never).length).toBe(HAIRS.length);
    expect(r.root.findAllByType('Path' as never)).toHaveLength(0);
    act(() => r.unmount());
    // controle: o caminho SVG (hq) monta camadas, então o contador de cima pega de verdade
    await act(async () => {
      r = create(<CruzeiAvatar config={cfg('afro')} size={140} mode="full" hq />);
    });
    expect(mockBuild.n).toBeGreaterThan(0);
    act(() => r.unmount());
    mockReady = false;
  });
});
