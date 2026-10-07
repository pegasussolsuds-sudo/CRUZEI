// Fumaça da tela do editor: monta a tela de verdade (lógica, abas, grade, painéis, rascunho) com palco, SVG,
// navegação, react-query e animações trocados por versões de mentira. Prova o fluxo: experimentar item bloqueado →
// selo "Prévia" → salvar abre o painel → "Salvar sem ele" manda o PATCH limpo; rascunho guardado e restaurado.

import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const host = (name: string) => {
  const R = jest.requireActual('react');
  return function Host(props: Record<string, unknown>) {
    return R.createElement(name, props, props.children as never);
  };
};

let mockReduce = false;
jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const anim = { duration: () => anim };
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: unknown) => R.useRef({ value: v }).current,
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => mockReduce,
    withSpring: (v: unknown) => v,
    cancelAnimation: () => undefined,
    FadeIn: anim,
    FadeOut: anim,
    SlideInDown: anim,
    SlideOutDown: anim,
  };
});
jest.mock('react-native-svg', () => ({ __esModule: true, default: host('Svg'), Path: host('Path') }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: host('LinearGradient') }));
jest.mock('expo-haptics', () => ({
  selectionAsync: async () => undefined,
  impactAsync: async () => undefined,
  notificationAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: 'l', Medium: 'm' },
  NotificationFeedbackType: { Success: 's', Warning: 'w', Error: 'e' },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
jest.mock('@expo/vector-icons', () => {
  const Ionicons = host('Ionicons') as unknown as { glyphMap: Record<string, number> };
  Ionicons.glyphMap = {};
  return { Ionicons };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: host('SafeAreaView'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../components/animated', () => {
  const R = jest.requireActual('react');
  const { Pressable, View } = jest.requireActual('react-native');
  const pass = (p: Record<string, unknown>) => R.createElement(View, { style: p.style }, p.children as never);
  return {
    BlobBackground: () => null,
    FadeInView: pass,
    Glow: pass,
    ScaleOnPress: (p: Record<string, unknown>) => R.createElement(Pressable, p, p.children as never),
  };
});
jest.mock('../../../components/avatar/CruzeiAvatar', () => ({ CruzeiAvatar: host('CruzeiAvatar') }));
jest.mock('../../../components/avatar/stage', () => {
  const R = jest.requireActual('react');
  return {
    AvatarStage: host('AvatarStage'),
    useEmotePlayer: () => {
      const [playing, setPlaying] = R.useState(false);
      const [replayToken, setTok] = R.useState(0);
      const onEmoteEnd = R.useCallback(() => setPlaying(false), []);
      return {
        playing,
        replayToken,
        play: R.useCallback(() => setPlaying(true), []),
        pause: R.useCallback(() => setPlaying(false), []),
        replay: R.useCallback(() => {
          setTok((t: number) => t + 1);
          setPlaying(true);
        }, []),
        toggle: () => setPlaying((p: boolean) => !p),
        stageProps: { playing, replayToken, onEmoteEnd, progress: { value: 0 } },
      };
    },
  };
});

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), canGoBack: () => true };
let mockParams: { fromOnboarding?: boolean } = {};
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav, useRoute: () => ({ params: mockParams }), useIsFocused: () => true }));

const mockPatch = jest.fn(async () => ({ data: {} }));
jest.mock('../../../services/api', () => ({ api: { patch: (...a: unknown[]) => mockPatch(...(a as [])) }, toApiError: () => ({ status: 500, message: 'x' }) }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: () => undefined }),
  useMutation: (o: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess: (r: unknown) => void }) => ({
    isPending: false,
    mutate: (v: unknown) => {
      void o.mutationFn(v).then(o.onSuccess);
    },
  }),
}));

const mockAuth = {
  user: { id: 'user-1', gender: null, premiumTier: 'free', avatar: null as AvatarConfig | null },
  setUser: jest.fn(),
  setOnboardingStep: jest.fn(),
};
jest.mock('../../../stores/auth', () => {
  const useAuthStore = (sel: (s: unknown) => unknown) => sel(mockAuth);
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => mockAuth;
  return { useAuthStore };
});

import { peekAvatarDraft, setAvatarDraftStorage } from '../../../stores/avatarDraft';
import { AvatarCustomizerScreen } from '../AvatarCustomizerScreen';

const saved = normalizeAvatarConfig({ ...DEFAULT_AVATAR, top: 'tee' });

function mount(): ReactTestRenderer {
  let r: ReactTestRenderer | null = null;
  act(() => {
    r = create(<AvatarCustomizerScreen />);
  });
  return r as unknown as ReactTestRenderer;
}

/** primeiro elemento com onPress cujo rótulo começa com `label` */
function byLabel(r: ReactTestRenderer, label: string): ReactTestInstance {
  const hit = r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(label) && typeof n.props.onPress === 'function');
  if (!hit.length) throw new Error(`sem elemento "${label}"`);
  return hit[0];
}
function has(r: ReactTestRenderer, label: string): boolean {
  return r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(label)).length > 0;
}
function hasText(r: ReactTestRenderer, text: string): boolean {
  return r.root.findAll((n) => (n.type as unknown) === 'Text' || (n.props.children === text && typeof n.type !== 'string')).some((n) => n.props.children === text);
}
async function press(r: ReactTestRenderer, label: string) {
  await act(async () => {
    byLabel(r, label).props.onPress();
  });
}
function stage(r: ReactTestRenderer) {
  return r.root.findByType('AvatarStage' as never).props as Record<string, unknown>;
}

beforeEach(() => {
  const data: Record<string, string> = {};
  setAvatarDraftStorage({
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
    del: async (k) => {
      delete data[k];
    },
  });
  mockAuth.user = { id: 'user-1', gender: null, premiumTier: 'free', avatar: saved };
  mockParams = {};
  mockReduce = false;
  mockPatch.mockClear();
  mockNav.navigate.mockClear();
  mockNav.goBack.mockClear();
});

describe('AvatarCustomizerScreen', () => {
  it('monta com as 11 categorias e a prévia animada (fundo, pronomes, respiração)', async () => {
    const r = mount();
    await act(async () => undefined);
    for (const c of ['Looks', 'Visual', 'Cabelo', 'Roupas', 'Acessórios', 'Orgulho', 'Efeitos', 'Animações', 'Pets', 'Veículos', 'Na mão']) expect(has(r, `Categoria ${c}`)).toBe(true);
    const s = stage(r);
    expect(s.showBackdrop).toBe(true);
    expect(s.showPronouns).toBe(true);
    // parado = zero quadros: a prévia não respira (só anima tocando animação ou na janela curta da aura/fundo)
    expect(s.idle ?? false).toBe(false);
    act(() => r.unmount());
  });

  it('experimentar item bloqueado → selo Prévia → salvar abre o painel → "Salvar sem ele" manda o PATCH sem o item', async () => {
    const r = mount();
    await act(async () => undefined);
    await press(r, 'Categoria Roupas');
    await press(r, 'Smoking.');
    expect((stage(r).config as AvatarConfig).top).toBe('tux');
    expect(has(r, 'Prévia: 1 item bloqueado')).toBe(true);
    await press(r, 'Salvar avatar');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(has(r, 'Ver Premium')).toBe(true);
    await press(r, 'Salvar sem ele');
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const body = (mockPatch.mock.calls[0] as unknown as [string, { avatar: AvatarConfig }])[1];
    expect(body.avatar.top).not.toBe('tux');
    expect(mockNav.goBack).toHaveBeenCalled();
    expect(peekAvatarDraft('user-1')).toBeNull();
    act(() => r.unmount());
  });

  it('filtro "Premium" mostra só itens pagos; ficha do item com "Ver Premium" guarda o rascunho e vai pro Paywall', async () => {
    const r = mount();
    await act(async () => undefined);
    await press(r, 'Categoria Roupas');
    await press(r, 'Mostrar: Premium');
    expect(has(r, 'Camiseta.')).toBe(false);
    expect(has(r, 'Smoking.')).toBe(true);
    await press(r, 'Smoking.');
    await act(async () => {
      byLabel(r, 'Smoking.').props.onLongPress();
    });
    expect(has(r, 'Detalhes de Smoking')).toBe(true);
    await press(r, 'Ver Premium');
    expect(mockNav.navigate).toHaveBeenCalledWith('Main', { screen: 'Paywall' }, { pop: true });
    expect(peekAvatarDraft('user-1')?.config.top).toBe('tux');
    act(() => r.unmount());
  });

  it('rascunho: sai sem salvar, volta com "Rascunho restaurado" e "Descartar" volta pro salvo', async () => {
    const r = mount();
    await act(async () => undefined);
    await press(r, 'Categoria Cabelo');
    await press(r, 'Black power.');
    act(() => r.unmount());
    expect(peekAvatarDraft('user-1')?.config.hair).toBe('afro');

    const r2 = mount();
    await act(async () => undefined);
    expect((stage(r2).config as AvatarConfig).hair).toBe('afro');
    expect(has(r2, 'Descartar rascunho')).toBe(true);
    await press(r2, 'Descartar rascunho');
    expect((stage(r2).config as AvatarConfig).hair).toBe(saved.hair);
    expect(peekAvatarDraft('user-1')).toBeNull();
    act(() => r2.unmount());
  });

  it('cadastro: "Pular por agora" segue pras fotos sem salvar e sem rascunho', async () => {
    mockParams = { fromOnboarding: true };
    const r = mount();
    await act(async () => undefined);
    await press(r, 'Categoria Cabelo');
    await press(r, 'Black power.');
    await press(r, 'Pular por agora');
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockNav.replace).toHaveBeenCalledWith('PhotoUpload', { fromOnboarding: true });
    act(() => r.unmount());
    expect(peekAvatarDraft('user-1')).toBeNull();
  });

  it('movimento reduzido: animação escolhida fica parada no melhor quadro; "Reproduzir" toca de verdade', async () => {
    mockReduce = true;
    const r = mount();
    await act(async () => undefined);
    await press(r, 'Categoria Animações');
    await press(r, 'Samba no pé.');
    let s = stage(r);
    expect(s.emote).toBe('dance_samba');
    expect(s.reduceMotion).toBe(true);
    expect(s.playing).toBe(true);
    expect(s.loop).toBe(true);
    expect(s.idle ?? false).toBe(false);
    await press(r, 'Reproduzir animação');
    s = stage(r);
    expect(s.reduceMotion).toBe(false);
    expect(s.playing).toBe(true);
    await press(r, 'Pausar animação');
    s = stage(r);
    expect(s.reduceMotion).toBe(true);
    act(() => r.unmount());
  });

  it('sem movimento reduzido: tocar a animação já toca a prévia', async () => {
    const r = mount();
    await act(async () => undefined);
    await press(r, 'Categoria Animações');
    await press(r, 'Samba no pé.');
    const s = stage(r);
    expect(s.reduceMotion).toBe(false);
    expect(s.playing).toBe(true);
    expect(s.replayToken).toBe(1);
    act(() => r.unmount());
  });

  it('pets: posição só aparece com pet e só as aceitas; looks aplicam como prévia', async () => {
    const r = mount();
    await act(async () => undefined);
    await press(r, 'Categoria Pets');
    expect(has(r, 'Posição:')).toBe(false);
    await press(r, 'Gato laranja.');
    expect(has(r, 'Posição: No ombro')).toBe(true);
    expect(has(r, 'Posição: Flutuando')).toBe(false);
    await press(r, 'Categoria Looks');
    await press(r, 'Look Casual de domingo');
    expect((stage(r).config as AvatarConfig).top).toBe('striped');
    expect((stage(r).config as AvatarConfig).pet).toBe('cat_orange'); // look que não fala de pet mantém o pet
    expect(hasText(r, 'Experimentando')).toBe(true);
    expect(hasText(r, 'Look Casual de domingo')).toBe(true);
    act(() => r.unmount());
  });
});
