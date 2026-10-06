// Fumaça do SVG estático: react-native-svg trocado por componentes vazios; confere que o modelo (defs, grupos com
// transformação, paths) chega inteiro nos componentes e que a pose e a cena entram.

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

// o PNG das listas (Skia de CPU + cache em disco) não existe no jest: o store "falha" e o componente cai no SVG,
// que é o que esta fumaça confere
jest.mock('../../../screens/map/native/images/draw', () => ({ avatarPng: () => null }));
jest.mock('../../../screens/map/native/images/store', () => ({
  mapImages: { get: () => undefined, request: () => Promise.resolve(null) },
}));

import { bustBoxFor } from '../../../avatar';
import { zero } from '../../../avatar/pose';
import { CruzeiAvatar } from '../CruzeiAvatar';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;

/** grupos com transformação (os de recorte/efeito usam <G clipPath> sem transform) */
const posedGroups = (r: ReactTestRenderer) => r.root.findAllByType('G' as never).filter((g) => g.props.transform != null);

async function mount(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r: ReactTestRenderer | null = null;
  // assíncrono: o pedido do PNG resolve (null no jest) numa microtarefa e aí o corpo SVG aparece
  await act(async () => {
    r = create(el);
  });
  return r as unknown as ReactTestRenderer;
}

describe('CruzeiAvatar', () => {
  it('repouso: paths sem grupo de transformação, viewBox do modo', async () => {
    const r = await mount(<CruzeiAvatar config={base} mode="full" size={140} groundShadow />);
    expect(r.root.findByType('Svg' as never).props.viewBox).toBe('0 0 100 140');
    expect(r.root.findAllByType('Path' as never).length).toBeGreaterThan(15);
    expect(posedGroups(r)).toHaveLength(0);
    act(() => r.unmount());
  });

  it('pose parada: grupos com matrix(...) só nos grupos que mexem', async () => {
    const p = zero();
    p.armR.r = -120;
    p.foreR = { r: -30 };
    const r = await mount(<CruzeiAvatar config={base} mode="full" size={140} pose={p} />);
    const gs = posedGroups(r);
    expect(gs.length).toBeGreaterThan(0);
    expect(gs.every((g) => typeof g.props.transform === 'string' && g.props.transform.startsWith('matrix('))).toBe(true);
    act(() => r.unmount());
  });

  it('cena entra sem pose (cadeira de rodas desce o tronco) e o busto ignora o veículo', async () => {
    const cfg = { ...base, vehicle: 'wheelchair' } as AvatarConfig;
    const full = await mount(<CruzeiAvatar config={cfg} mode="full" size={140} />);
    expect(posedGroups(full).length).toBeGreaterThan(0);
    act(() => full.unmount());
    const bust = await mount(<CruzeiAvatar config={cfg} mode="bust" size={56} />);
    expect(posedGroups(bust)).toHaveLength(0);
    const vb = bustBoxFor(cfg);
    expect(bust.root.findByType('Svg' as never).props.viewBox).toBe(`${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    act(() => bust.unmount());
  });

  it('ids únicos por instância (duas instâncias com aura não colidem)', async () => {
    const cfg = { ...base, aura: 'lime' } as AvatarConfig;
    const r = await mount(
      <>
        <CruzeiAvatar config={cfg} />
        <CruzeiAvatar config={cfg} />
      </>,
    );
    const ids = r.root
      .findAllByType('RadialGradient' as never)
      .map((g) => g.props.id as string)
      .filter((id) => id.endsWith('_aura'));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    act(() => r.unmount());
  });
});
