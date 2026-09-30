// Tour do mapa: aparece UMA vez por conta neste aparelho (armado no cadastro, visto ao aparecer), dá pra rever pela
// Ajuda, e nunca começa junto de splash, Termos, cadastro ou comemoração do match.

import { create } from 'zustand';
import {
  bindTourToAuth,
  canBeginTour,
  isTourBusy,
  setTourStorage,
  tourLocationReady,
  tourStorageKey,
  useTourStore,
  type TourGate,
} from '../tour';
import type { TourStepId } from '../../components/tour/steps';

const mem = new Map<string, string>();
/** leitura do aparelho segurada (pra testar o arme chegando no meio) */
let readGate: Promise<void> | null = null;

setTourStorage({
  get: async (k) => {
    if (readGate) await readGate;
    return mem.get(k) ?? null;
  },
  set: async (k, v) => {
    mem.set(k, v);
  },
});

const store = () => useTourStore.getState();
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  mem.clear();
  readGate = null;
  useTourStore.setState({
    userId: null,
    loaded: false,
    armed: false,
    seen: false,
    phase: 'idle',
    source: null,
    steps: [],
    index: 0,
    startedAt: 0,
    splashing: false,
  });
});

describe('quando mostrar sozinho', () => {
  it('conta criada agora (armada no cadastro) entra na fila automática', async () => {
    await store().setUser('u1');
    expect(store()).toMatchObject({ loaded: true, phase: 'idle' });
    await store().arm('u1');
    expect(store()).toMatchObject({ phase: 'queued', source: 'auto', armed: true });
    expect(mem.get(tourStorageKey('u1'))).toBe('armed');
  });

  it('o arme que chega durante a leitura do aparelho não se perde', async () => {
    let release: () => void = () => undefined;
    readGate = new Promise<void>((r) => {
      release = r;
    });
    const reading = store().setUser('u1');
    await store().arm('u1');
    // ainda lendo: não entra na fila antes de saber se já viu
    expect(store().phase).toBe('idle');
    release();
    await reading;
    expect(store()).toMatchObject({ loaded: true, armed: true, phase: 'queued', source: 'auto' });
  });

  it('arme gravado (app fechado no meio do avatar/fotos) mostra na próxima abertura', async () => {
    mem.set(tourStorageKey('u1'), 'armed');
    await store().setUser('u1');
    expect(store()).toMatchObject({ phase: 'queued', source: 'auto' });
  });

  it('conta que já existia (sem cadastro neste aparelho) não vê sozinha', async () => {
    await store().setUser('u1');
    expect(store().phase).toBe('idle');
    expect(mem.has(tourStorageKey('u1'))).toBe(false);
  });

  it('quem já viu não arma de novo', async () => {
    mem.set(tourStorageKey('u1'), 'done');
    await store().setUser('u1');
    await store().arm('u1');
    expect(store()).toMatchObject({ seen: true, armed: false, phase: 'idle' });
    expect(mem.get(tourStorageKey('u1'))).toBe('done');
  });

  it('é gravado como visto ao APARECER: não volta na próxima abertura', async () => {
    await store().setUser('u1');
    await store().arm('u1');
    expect(store().begin(['welcome', 'vibe'], 1000)).toBe(true);
    expect(store()).toMatchObject({ phase: 'showing', index: 0, startedAt: 1000, seen: true, armed: false });
    expect(mem.get(tourStorageKey('u1'))).toBe('done');
    // app caiu no meio: reabre
    await store().setUser(null);
    await store().setUser('u1');
    expect(store()).toMatchObject({ seen: true, phase: 'idle' });
  });

  it('outra conta no mesmo aparelho não herda o visto', async () => {
    mem.set(tourStorageKey('u1'), 'done');
    await store().setUser('u1');
    await store().setUser('u2');
    expect(store()).toMatchObject({ userId: 'u2', seen: false, phase: 'idle' });
    await store().arm('u2');
    expect(store().phase).toBe('queued');
  });

  it('leitura velha (trocou de conta no meio) é descartada', async () => {
    let release: () => void = () => undefined;
    readGate = new Promise<void>((r) => {
      release = r;
    });
    mem.set(tourStorageKey('u1'), 'armed');
    const first = store().setUser('u1');
    const second = store().setUser('u2');
    release();
    await Promise.all([first, second]);
    expect(store()).toMatchObject({ userId: 'u2', armed: false, phase: 'idle' });
  });
});

describe('rever pela Ajuda', () => {
  it('entra na fila mesmo já visto e mostra de novo', async () => {
    mem.set(tourStorageKey('u1'), 'done');
    await store().setUser('u1');
    store().replay();
    expect(store()).toMatchObject({ phase: 'queued', source: 'replay' });
    expect(store().begin(['welcome', 'locate'])).toBe(true);
    expect(store().phase).toBe('showing');
  });

  it('rever antes do automático conta como visto', async () => {
    await store().setUser('u1');
    await store().arm('u1');
    store().replay();
    expect(store().source).toBe('replay');
    store().begin(['welcome']);
    expect(mem.get(tourStorageKey('u1'))).toBe('done');
  });

  it('sem conta ou já na tela não faz nada', async () => {
    store().replay();
    expect(store().phase).toBe('idle');
    await store().setUser('u1');
    store().replay();
    store().begin(['welcome', 'me']);
    store().next();
    store().replay();
    expect(store()).toMatchObject({ phase: 'showing', index: 1, source: 'replay' });
  });
});

describe('passos, pular e terminar', () => {
  async function showing(steps: readonly TourStepId[] = ['welcome', 'me', 'tabs']) {
    await store().setUser('u1');
    store().replay();
    store().begin([...steps]);
  }

  it('próximo/voltar ficam dentro dos limites e o último fecha', async () => {
    await showing();
    expect(store().next()).toBe('next');
    expect(store().index).toBe(1);
    store().back();
    store().back();
    expect(store().index).toBe(0);
    store().next();
    store().next();
    expect(store().index).toBe(2);
    expect(store().next()).toBe('done');
    expect(store()).toMatchObject({ phase: 'idle', steps: [], index: 0, source: null });
  });

  it('pular fecha na hora', async () => {
    await showing();
    store().next();
    store().close();
    expect(store()).toMatchObject({ phase: 'idle', steps: [] });
  });

  it('começar sem nada na fila (ou sem passos) não mostra', async () => {
    await store().setUser('u1');
    expect(store().begin(['welcome'])).toBe(false);
    store().replay();
    expect(store().begin([])).toBe(false);
    expect(store().phase).toBe('idle');
  });

  it('logout no meio fecha o tour', async () => {
    await showing();
    await store().setUser(null);
    expect(store()).toMatchObject({ userId: null, phase: 'idle', steps: [] });
  });

  it('a posição chegou ainda nas boas-vindas: "Esse é você" e a roda de gente entram', async () => {
    await showing(['welcome', 'vibe', 'tabs']);
    expect(store().refreshSteps(['welcome', 'me', 'people', 'vibe', 'tabs'])).toBe(true);
    expect(store()).toMatchObject({ phase: 'showing', index: 0, steps: ['welcome', 'me', 'people', 'vibe', 'tabs'] });
    // mesmos passos: nada muda
    expect(store().refreshSteps(['welcome', 'me', 'people', 'vibe', 'tabs'])).toBe(false);
  });

  it('depois das boas-vindas (ou fora da tela) os passos não mudam', async () => {
    await showing(['welcome', 'vibe', 'tabs']);
    store().next();
    expect(store().refreshSteps(['welcome', 'me', 'vibe', 'tabs'])).toBe(false);
    expect(store().steps).toEqual(['welcome', 'vibe', 'tabs']);
    store().close();
    expect(store().refreshSteps(['welcome', 'me'])).toBe(false);
    expect(store()).toMatchObject({ phase: 'idle', steps: [] });
  });

  it('re-resolver nunca troca o passo da tela nem esvazia o tour', async () => {
    await showing(['welcome', 'vibe']);
    expect(store().refreshSteps([])).toBe(false);
    expect(store().refreshSteps(['vibe', 'welcome'])).toBe(false);
    expect(store().steps).toEqual(['welcome', 'vibe']);
  });
});

describe('portão: nunca junto de outro modal', () => {
  const free: TourGate = {
    phase: 'queued',
    splashing: false,
    screenReady: true,
    termsPending: false,
    onboarding: false,
    celebrationBusy: false,
    locationReady: true,
  };

  it('com a tela livre, começa', () => {
    expect(canBeginTour(free)).toBe(true);
  });

  it.each([
    ['nada na fila', { phase: 'idle' as const }],
    ['já na tela', { phase: 'showing' as const }],
    ['splash', { splashing: true }],
    ['mapa não pronto / busca ou match por cima', { screenReady: false }],
    ['Termos pendentes', { termsPending: true }],
    ['avatar/fotos do cadastro', { onboarding: true }],
    ['comemoração do match', { celebrationBusy: true }],
    ['posição ainda chegando / diálogo de permissão', { locationReady: false }],
  ])('espera: %s', (_label, patch) => {
    expect(canBeginTour({ ...free, ...patch })).toBe(false);
  });

  it('localização: espera a posição resolvida, com teto, e nunca com o diálogo de permissão na tela', () => {
    // posição chegando (GPS): espera
    expect(tourLocationReady({ settled: false, asking: false, waitedOut: false })).toBe(false);
    // tenho posição, ou negada/indisponível: vai
    expect(tourLocationReady({ settled: true, asking: false, waitedOut: false })).toBe(true);
    // cansou de esperar o GPS: vai sem "Esse é você" (entra depois, se chegar nas boas-vindas)
    expect(tourLocationReady({ settled: false, asking: false, waitedOut: true })).toBe(true);
    // diálogo de permissão na tela: nunca, nem depois do teto
    expect(tourLocationReady({ settled: false, asking: true, waitedOut: true })).toBe(false);
    expect(tourLocationReady({ settled: true, asking: true, waitedOut: false })).toBe(false);
  });

  it('na fila ou na tela segura o pedido do push', () => {
    expect(isTourBusy({ phase: 'idle' })).toBe(false);
    expect(isTourBusy({ phase: 'queued' })).toBe(true);
    expect(isTourBusy({ phase: 'showing' })).toBe(true);
  });
});

describe('ligação com a sessão', () => {
  interface FakeAuth {
    user: { id: string } | null;
    onboardingStep: string | null;
  }
  let unbind: () => void = () => undefined;
  afterEach(() => unbind());

  it('cadastro (onboardingStep sai de null) arma a conta nova', async () => {
    const auth = create<FakeAuth>(() => ({ user: null, onboardingStep: null }));
    unbind = bindTourToAuth(auth);
    auth.setState({ user: { id: 'new' }, onboardingStep: 'avatar' });
    await tick();
    await tick();
    expect(store()).toMatchObject({ userId: 'new', armed: true, phase: 'queued', source: 'auto' });
    expect(mem.get(tourStorageKey('new'))).toBe('armed');
  });

  it('login de conta existente só carrega (não arma)', async () => {
    const auth = create<FakeAuth>(() => ({ user: null, onboardingStep: null }));
    unbind = bindTourToAuth(auth);
    auth.setState({ user: { id: 'old' } });
    await tick();
    expect(store()).toMatchObject({ userId: 'old', loaded: true, armed: false, phase: 'idle' });
  });

  it('ligar com o cadastro já em andamento (Fast Refresh) não arma sozinho', async () => {
    const auth = create<FakeAuth>(() => ({ user: { id: 'mid' }, onboardingStep: 'photo' }));
    unbind = bindTourToAuth(auth);
    await tick();
    expect(store()).toMatchObject({ userId: 'mid', armed: false, phase: 'idle' });
    // avatar → foto → mapa não é cadastro novo
    auth.setState({ onboardingStep: null });
    await tick();
    expect(store().armed).toBe(false);
  });

  it('logout limpa a conta', async () => {
    const auth = create<FakeAuth>(() => ({ user: { id: 'u1' }, onboardingStep: null }));
    unbind = bindTourToAuth(auth);
    await tick();
    auth.setState({ user: null });
    await tick();
    expect(store().userId).toBeNull();
  });
});
