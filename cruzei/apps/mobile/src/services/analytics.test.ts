import type * as AnalyticsModule from './analytics';

// SecureStore em memória: sobrevive ao "processo novo" (jest.isolateModules), como o armazenamento do aparelho
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.9.9' } } }));

type Post = jest.Mock<Promise<unknown>, [string, unknown, unknown?]>;
const mockApi = { post: jest.fn() as Post };
jest.mock('./api', () => ({ api: mockApi }));

type Mod = typeof AnalyticsModule;
type Body = { installId: string; events: { name: string; step?: string; props?: Record<string, unknown>; at?: string }[] };

/** sobe o módulo do zero, como um processo novo do app (o SecureStore em memória continua) */
function boot(): Mod {
  let mod: Mod | null = null;
  jest.isolateModules(() => {
    mod = jest.requireActual<Mod>('./analytics');
  });
  if (!mod) throw new Error('módulo não carregou');
  return mod;
}

const eventsCalls = () => mockApi.post.mock.calls.filter((c) => c[0] === '/analytics/events').map((c) => c[1] as Body);
const httpError = (status?: number) =>
  Object.assign(new Error('http'), { isAxiosError: true, response: status ? { status } : undefined });

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear();
  mockApi.post.mockReset();
  mockApi.post.mockResolvedValue({ data: { accepted: 1 } });
});

afterEach(() => {
  jest.useRealTimers();
});

/** deixa as promessas pendentes andarem (SecureStore/axios falsos são async) */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('métricas do app', () => {
  it('installId: uuid v4 aleatório, guardado e reaproveitado entre aberturas', async () => {
    const a = boot();
    const id = await a.getInstallId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await a.getInstallId()).toBe(id);
    expect(await boot().getInstallId()).toBe(id);
    expect(a.newInstallId()).not.toBe(a.newInstallId());
  });

  it('junta num lote só, com plataforma e versão, sem posição', async () => {
    const a = boot();
    a.trackOnboardingStep('welcome', 'view');
    a.trackOnboardingStep('welcome', 'view'); // re-render: não repete
    a.trackOnboardingStep('welcome', 'done');
    a.track('map_tour_skipped', { stepIndex: 2 }, 'vibe_search');
    expect(mockApi.post).not.toHaveBeenCalled();
    jest.advanceTimersByTime(a.FLUSH_DELAY_MS);
    await settle();
    const [body] = eventsCalls();
    expect(body.installId).toBe(await a.getInstallId());
    expect(body.events.map((e) => [e.name, e.step])).toEqual([
      ['onboarding_step_view', 'welcome'],
      ['onboarding_step_done', 'welcome'],
      ['map_tour_skipped', 'vibe_search'],
    ]);
    expect(body.events[0].props).toEqual({ platform: 'ios', appVersion: '9.9.9', stepIndex: 0 });
    expect(JSON.stringify(body)).not.toMatch(/"(lat|lng|latitude|longitude|coords?)"/);
    expect(a.__analyticsState().queued).toBe(0);
  });

  it('lotes de até 50', async () => {
    const a = boot();
    for (let i = 0; i < 70; i++) a.track('map_tour_done');
    await a.flush();
    await settle();
    const sizes = eventsCalls().map((b) => b.events.length);
    expect(sizes).toEqual([50, 20]);
  });

  it('sem rede / servidor fora: guarda e tenta de novo depois; lote recusado (400) é descartado', async () => {
    const a = boot();
    mockApi.post.mockRejectedValueOnce(httpError());
    a.track('map_tour_done');
    await a.flush();
    await settle();
    expect(a.__analyticsState()).toMatchObject({ queued: 1, failures: 1, hasTimer: true });
    // reenvio depois da espera
    jest.advanceTimersByTime(30_000);
    await settle();
    expect(eventsCalls()).toHaveLength(2);
    expect(a.__analyticsState()).toMatchObject({ queued: 0, failures: 0 });

    mockApi.post.mockRejectedValueOnce(httpError(400));
    a.track('map_tour_done');
    await a.flush();
    await settle();
    expect(a.__analyticsState()).toMatchObject({ queued: 0, failures: 0 });
  });

  it('app_open: uma vez por dia de São Paulo, mesmo abrindo o app de novo', async () => {
    const a = boot();
    const day1 = new Date('2026-09-30T12:00:00Z');
    expect(await a.trackAppOpen(day1)).toBe(true);
    expect(await a.trackAppOpen(day1)).toBe(false);
    // processo novo no mesmo dia
    const b = boot();
    expect(await b.trackAppOpen(new Date('2026-09-30T20:00:00Z'))).toBe(false);
    // 01:00 UTC do dia 1º ainda é dia 30 em São Paulo
    expect(await b.trackAppOpen(new Date('2026-10-01T01:00:00Z'))).toBe(false);
    expect(await b.trackAppOpen(new Date('2026-10-01T04:00:00Z'))).toBe(true);
    await a.flush();
    await b.flush();
    await settle();
    expect(eventsCalls().flatMap((x) => x.events.map((e) => e.name))).toEqual(['app_open', 'app_open']);
  });

  it('funil pela rota (antes da conta) e pela fase (depois): chegar na próxima = concluiu a anterior', async () => {
    const a = boot();
    for (const r of ['Onboarding', 'Legal', 'Onboarding', 'Login', 'Code', 'Login', 'Code', 'Register']) a.trackOnboardingRoute(r);
    a.trackOnboardingPhase('avatar', false);
    a.trackOnboardingPhase('photo', false);
    a.trackOnboardingPhase(null, false); // terminou; mapa ainda carregando
    a.trackOnboardingPhase(null, true); // primeiro mapa pronto
    a.trackOnboardingPhase(null, true);
    await a.flush();
    await settle();
    const got = eventsCalls().flatMap((b) => b.events.map((e) => `${e.name === 'onboarding_step_view' ? 'v' : 'd'}:${e.step}`));
    expect(got).toEqual([
      'v:welcome',
      'd:welcome',
      'v:phone',
      'd:phone',
      'v:code',
      'd:code',
      'v:avatar',
      'd:avatar',
      'v:photo',
      'd:photo',
      'v:map_ready',
      'd:map_ready',
    ]);
  });

  it('login de conta existente não gera avatar/fotos/primeiro mapa', async () => {
    const a = boot();
    a.trackOnboardingPhase(null, false);
    a.trackOnboardingPhase(null, true);
    await a.flush();
    await settle();
    expect(eventsCalls()).toHaveLength(0);
  });

  it('link com a conta: uma vez por conta, de novo se a conta mudar ou se falhar', async () => {
    const a = boot();
    const linkCalls = () => mockApi.post.mock.calls.filter((c) => c[0] === '/analytics/link');
    await a.linkInstallToUser('u1');
    await a.linkInstallToUser('u1');
    expect(linkCalls()).toHaveLength(1);
    expect(linkCalls()[0][1]).toEqual({ installId: await a.getInstallId() });
    mockApi.post.mockRejectedValueOnce(httpError(404));
    await a.linkInstallToUser('u2');
    await a.linkInstallToUser('u2');
    expect(linkCalls()).toHaveLength(3);
  });
});
