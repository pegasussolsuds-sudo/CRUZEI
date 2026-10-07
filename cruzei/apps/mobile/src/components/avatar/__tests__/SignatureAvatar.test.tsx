// <SignatureAvatar/>: o palco recebe a animação assinatura, toca uma vez ao abrir (autoplay, sem movimento reduzido,
// sem pausa) e a cada toque. O palco é trocado por um host que só guarda as props (o palco tem a fumaça dele).

import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

let mockReduce = false;
jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual('react');
  return {
    useSharedValue: (v: unknown) => R.useRef({ value: v }).current,
    useReducedMotion: () => mockReduce,
  };
});
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('../stage', () => {
  const R = jest.requireActual('react');
  return {
    AvatarStage: (props: Record<string, unknown>) => R.createElement('AvatarStage', props),
    useEmotePlayer: jest.requireActual('../stage/useEmotePlayer').useEmotePlayer,
  };
});

import { SignatureAvatar } from '../SignatureAvatar';

const cfgOf = (p: Partial<AvatarConfig> = {}) => normalizeAvatarConfig({ ...DEFAULT_AVATAR, ...p }) as AvatarConfig;

function stageProps(r: ReactTestRenderer): Record<string, unknown> {
  return r.root.find((n) => (n.type as unknown) === 'AvatarStage').props as Record<string, unknown>;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockReduce = false;
});
afterEach(() => jest.useRealTimers());

describe('SignatureAvatar', () => {
  it('passa a assinatura pro palco e toca uma vez ao abrir', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<SignatureAvatar config={cfgOf({ emote: 'dance_samba' })} size={144} autoplay autoplayDelay={300} label="Avatar de Ana" />);
    });
    expect(stageProps(r).emote).toBe('dance_samba');
    // dança (loop: true no registro) toca um ciclo só: em loop o palco animava pra sempre na folha do mapa e no Match
    expect(stageProps(r).loop).toBe(false);
    expect(stageProps(r).playing).toBe(false);
    act(() => {
      jest.advanceTimersByTime(320);
    });
    expect(stageProps(r).playing).toBe(true);
    expect(stageProps(r).replayToken).toBe(1);
    expect(stageProps(r).showBackdrop).toBe(true);
    expect(stageProps(r).showPronouns).toBe(true);
  });

  it('sem escolha acena; o toque recomeça a animação', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<SignatureAvatar config={cfgOf({ emote: 'none' })} size={120} label="Seu avatar" />);
    });
    expect(stageProps(r).emote).toBe('wave');
    expect(stageProps(r).playing).toBe(false);
    const btn = r.root.find((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function');
    expect(btn.props.accessibilityLabel).toBe('Seu avatar');
    act(() => btn.props.onPress());
    expect(stageProps(r).playing).toBe(true);
    expect(stageProps(r).replayToken).toBe(1);
    act(() => btn.props.onPress());
    expect(stageProps(r).replayToken).toBe(2);
  });

  it('movimento reduzido ou tela pausada: nada toca sozinho', () => {
    mockReduce = true;
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<SignatureAvatar config={cfgOf({ emote: 'wave' })} size={120} autoplay autoplayDelay={10} label="x" />);
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(stageProps(r).playing).toBe(false);
    mockReduce = false;
    let r2!: ReactTestRenderer;
    act(() => {
      r2 = create(<SignatureAvatar config={cfgOf({ emote: 'wave' })} size={120} autoplay autoplayDelay={10} paused label="x" />);
    });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(stageProps(r2).playing).toBe(false);
    expect(stageProps(r2).paused).toBe(true);
  });

  it('pausou antes do autoplay disparar: toca quando volta (o timer cancelado não conta como feito)', () => {
    const el = (paused: boolean) => <SignatureAvatar config={cfgOf({ emote: 'wave' })} size={120} autoplay autoplayDelay={100} paused={paused} label="x" />;
    let r!: ReactTestRenderer;
    act(() => {
      r = create(el(false));
    });
    act(() => {
      jest.advanceTimersByTime(40);
      r.update(el(true));
    });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(stageProps(r).playing).toBe(false);
    act(() => r.update(el(false)));
    act(() => {
      jest.advanceTimersByTime(150);
    });
    expect(stageProps(r).playing).toBe(true);
    // e só uma vez por montagem
    const token = stageProps(r).replayToken;
    act(() => r.update(el(true)));
    act(() => r.update(el(false)));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(stageProps(r).replayToken).toBe(token);
  });

  it('o palco dentro do botão some do leitor de tela (sem foco dobrado)', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<SignatureAvatar config={cfgOf({ emote: 'wave' })} size={120} label="Avatar de Ana" />);
    });
    expect(stageProps(r).decorative).toBe(true);
  });
});
