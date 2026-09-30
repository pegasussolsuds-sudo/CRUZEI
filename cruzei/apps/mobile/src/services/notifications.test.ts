import type * as NotificationsModule from './notifications';

// SecureStore em memória: sobrevive ao "processo novo" (jest.isolateModules), como o armazenamento do aparelho
const mockStore = new Map<string, string>();
const mockNative = {
  /** o que o getLastNotificationResponseAsync devolve (o intent que abriu a tela) */
  last: null as unknown,
  listener: null as ((res: unknown) => unknown) | null,
  storeBroken: false,
};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => {
    if (mockNative.storeBroken) throw new Error('keystore');
    return mockStore.get(k) ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (mockNative.storeBroken) throw new Error('keystore');
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn((fn: (res: unknown) => unknown) => {
    mockNative.listener = fn;
    return { remove: jest.fn() };
  }),
  getLastNotificationResponseAsync: jest.fn(async () => mockNative.last),
  // limpa só a memória do processo, como no nativo
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null } }));
jest.mock('./api', () => ({ api: { post: jest.fn(), delete: jest.fn() }, getToken: jest.fn(async () => null) }));

type Mod = typeof NotificationsModule;
type Route = Parameters<Parameters<Mod['listenNotificationTaps']>[0]>;

/** sobe o módulo do zero, como um processo novo do app (o SecureStore em memória continua) */
function boot(): Mod {
  let mod: Mod | null = null;
  jest.isolateModules(() => {
    mod = jest.requireActual<Mod>('./notifications');
  });
  if (!mod) throw new Error('módulo não carregou');
  return mod;
}

/** toque na notificação do FCM (o identifier é o google.message_id) */
function tap(identifier: string, notificationId = 'n1') {
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: 0,
      request: {
        identifier,
        content: { title: 'Show perto', body: null, data: { notificationId, type: 'event', target: '{"kind":"place","poiId":"7"}' } },
        trigger: null,
      },
    },
  };
}

const settle = () => new Promise<void>((r) => setTimeout(() => r(), 0));

/** liga os toques num processo e espera a "última resposta" do app frio */
async function listen(mod: Mod): Promise<Route[]> {
  const routes: Route[] = [];
  mod.listenNotificationTaps((...args) => routes.push(args));
  await settle();
  return routes;
}

beforeEach(() => {
  mockStore.clear();
  mockNative.last = null;
  mockNative.listener = null;
  mockNative.storeBroken = false;
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('rememberTap / parseHandledTaps: a lista de toques tratados', () => {
  const { rememberTap, parseHandledTaps, HANDLED_MAX } = boot();

  it('toque novo entra no fim; repetido devolve null', () => {
    expect(rememberTap([], 'a')).toEqual(['a']);
    expect(rememberTap(['a'], 'b')).toEqual(['a', 'b']);
    expect(rememberTap(['a', 'b'], 'a')).toBeNull();
  });

  it('guarda só os últimos (o mais velho sai)', () => {
    const full = Array.from({ length: HANDLED_MAX }, (_, i) => `id${i}`);
    const next = rememberTap(full, 'novo');
    expect(next).toHaveLength(HANDLED_MAX);
    expect(next?.[0]).toBe('id1');
    expect(next?.[HANDLED_MAX - 1]).toBe('novo');
    expect(rememberTap(['a', 'b', 'c'], 'd', 2)).toEqual(['c', 'd']);
  });

  it('gravado estranho vira lista vazia; itens inválidos saem', () => {
    expect(parseHandledTaps(null)).toEqual([]);
    expect(parseHandledTaps('')).toEqual([]);
    expect(parseHandledTaps('{quebrado')).toEqual([]);
    expect(parseHandledTaps('{"a":1}')).toEqual([]);
    expect(parseHandledTaps('["a",2,"",null,"b"]')).toEqual(['a', 'b']);
    const many = JSON.stringify(Array.from({ length: HANDLED_MAX + 5 }, (_, i) => `id${i}`));
    expect(parseHandledTaps(many)).toHaveLength(HANDLED_MAX);
  });
});

describe('listenNotificationTaps: o mesmo toque não abre duas vezes', () => {
  it('app frio: listener e "última resposta" com o mesmo toque → uma navegação só', async () => {
    mockNative.last = tap('0:111%abc');
    const mod = boot();
    const routes: Route[] = [];
    mod.listenNotificationTaps((...args) => routes.push(args));
    mockNative.listener?.(tap('0:111%abc'));
    await settle();
    expect(routes).toEqual([[{ screen: 'Map', focusPoiId: 7 }, 'n1']]);
  });

  it('o sistema matou o processo: o intent antigo volta e é ignorado; toque novo passa', async () => {
    mockNative.last = tap('0:222%abc');
    expect(await listen(boot())).toHaveLength(1);

    // processo novo, a tela é recriada com o mesmo intent: o expo-notifications entrega o toque velho de novo
    mockNative.last = tap('0:222%abc');
    const mod = boot();
    const routes = await listen(mod);
    expect(routes).toEqual([]);

    mockNative.listener?.(tap('0:333%abc', 'n2'));
    await settle();
    expect(routes).toEqual([[{ screen: 'Map', focusPoiId: 7 }, 'n2']]);
  });

  it('grava só os últimos 20 toques', async () => {
    const mod = boot();
    const routes = await listen(mod);
    for (let i = 0; i < 25; i += 1) mockNative.listener?.(tap(`0:${i}%x`, `n${i}`));
    await settle();
    expect(routes).toHaveLength(25);
    const saved = mod.parseHandledTaps(mockStore.get('metch.pushHandled.v1'));
    expect(saved).toHaveLength(mod.HANDLED_MAX);
    expect(saved[0]).toBe('0:5%x');
    expect(saved[saved.length - 1]).toBe('0:24%x');
  });

  it('armazenamento quebrado: navega e ainda ignora o repetido na mesma sessão', async () => {
    mockNative.storeBroken = true;
    const mod = boot();
    const routes = await listen(mod);
    mockNative.listener?.(tap('0:444%abc'));
    mockNative.listener?.(tap('0:444%abc'));
    await settle();
    expect(routes).toHaveLength(1);
  });

  it('botão de ação (não o toque no corpo) não navega nem gasta o id', async () => {
    const mod = boot();
    const routes = await listen(mod);
    mockNative.listener?.({ ...tap('0:555%abc'), actionIdentifier: 'reply' });
    await settle();
    expect(routes).toEqual([]);
    expect(mockStore.get('metch.pushHandled.v1')).toBeUndefined();
  });
});
