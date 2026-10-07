// Sessão salva + servidor fora no boot: o store fica "logado sem perfil" e precisa buscar o /me de novo sozinho.

jest.mock('../../services/notifications', () => ({ unregisterPushDevice: jest.fn(() => Promise.resolve()) }));
// métricas: id anônimo da instalação + ligar os eventos à conta (o serviço de verdade é testado à parte)
jest.mock('../../services/analytics', () => ({
  getInstallId: jest.fn(() => Promise.resolve(null)),
  linkInstallToUser: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(() => Promise.resolve({ data: {} })) },
  clearSession: jest.fn(() => Promise.resolve()),
  getToken: jest.fn(() => Promise.resolve('tok')),
  setToken: jest.fn(() => Promise.resolve()),
  setRefreshToken: jest.fn(() => Promise.resolve()),
  setUnauthorizedHandler: jest.fn(),
}));

import { AppState } from 'react-native';
import * as analytics from '../../services/analytics';
import * as apiModule from '../../services/api';
import { useAuthStore } from '../auth';

const analyticsMock = analytics as unknown as { getInstallId: jest.Mock; linkInstallToUser: jest.Mock };

// o mock do AppState do preset é objeto simples: dá pra trocar o estado na mão
const appState = AppState as { currentState: string };

const apiMock = apiModule as unknown as {
  api: { get: jest.Mock; post: jest.Mock };
  clearSession: jest.Mock;
  setUnauthorizedHandler: jest.Mock;
};
// registrado uma vez, quando o store nasce
const onUnauthorized = apiMock.setUnauthorizedHandler.mock.calls[0][0] as () => void;

const ME = { id: 'u1', name: 'Ana', premiumTier: 'free', settings: { visibilityMode: 'visible' } };
const offline = () => Object.assign(new Error('Network Error'), { response: undefined });
const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

beforeEach(() => {
  jest.useFakeTimers();
  appState.currentState = 'active';
  apiMock.api.get.mockReset();
  apiMock.api.post.mockClear();
  apiMock.clearSession.mockClear();
});

afterEach(() => {
  // desloga antes de limpar os timers: o subscribe do store zera o retry pendente
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: true, onboardingStep: null });
  jest.clearAllTimers();
  jest.useRealTimers();
});

/** boot com o servidor fora: hydrate() termina logado e sem perfil */
async function bootOffline(): Promise<void> {
  apiMock.api.get.mockRejectedValueOnce(offline());
  await useAuthStore.getState().hydrate();
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user: null, isLoading: false });
}

const meCalls = () => apiMock.api.get.mock.calls.filter(([url]) => url === '/me').length;

describe('retry do /me quando a sessão abriu sem perfil', () => {
  it('tenta de novo com backoff (3 s, 8 s) e para quando o /me vem', async () => {
    await bootOffline();
    expect(meCalls()).toBe(1);

    apiMock.api.get.mockRejectedValueOnce(offline());
    await jest.advanceTimersByTimeAsync(2_999);
    expect(meCalls()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(meCalls()).toBe(2);

    // 5xx também não desloga: segue tentando
    apiMock.api.get.mockRejectedValueOnce(http(503));
    await jest.advanceTimersByTimeAsync(8_000);
    expect(meCalls()).toBe(3);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await jest.advanceTimersByTimeAsync(20_000);
    expect(meCalls()).toBe(4);
    expect(useAuthStore.getState().user).toEqual(ME);

    // perfil chegou: nada mais agendado
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(meCalls()).toBe(4);
    expect(apiMock.clearSession).not.toHaveBeenCalled();
  });

  it('depois do fim da lista repete a cada 90 s', async () => {
    await bootOffline();
    apiMock.api.get.mockRejectedValue(offline());
    await jest.advanceTimersByTimeAsync(3_000 + 8_000 + 20_000 + 45_000 + 90_000);
    expect(meCalls()).toBe(6);
    await jest.advanceTimersByTimeAsync(90_000);
    expect(meCalls()).toBe(7);
  });

  it.each([
    ['401', http(401)],
    ['404 "Usuário não encontrado"', Object.assign(http(404), { response: { status: 404, data: { message: 'Usuário não encontrado' } } })],
  ])('%s no retry encerra a sessão como no hydrate()', async (_label, err) => {
    await bootOffline();
    apiMock.api.get.mockRejectedValueOnce(err);
    await jest.advanceTimersByTimeAsync(3_000);
    expect(apiMock.clearSession).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, user: null });
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(meCalls()).toBe(2);
  });

  it('404 genérico (proxy/túnel sem backend, deploy) não desloga: segue tentando', async () => {
    await bootOffline();
    apiMock.api.get.mockRejectedValueOnce(
      Object.assign(http(404), { response: { status: 404, data: { message: 'Cannot GET /v1/me' } } }),
    );
    await jest.advanceTimersByTimeAsync(3_000);
    expect(apiMock.clearSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await jest.advanceTimersByTimeAsync(8_000);
    expect(useAuthStore.getState().user).toEqual(ME);
  });

  it('hydrate(): 404 genérico no boot mantém a sessão; 404 de conta sumida desloga', async () => {
    apiMock.api.get.mockRejectedValueOnce(Object.assign(http(404), { response: { status: 404, data: {} } }));
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user: null });
    expect(apiMock.clearSession).not.toHaveBeenCalled();

    useAuthStore.setState({ user: null, isAuthenticated: false });
    apiMock.api.get.mockRejectedValueOnce(
      Object.assign(http(404), { response: { status: 404, data: { message: 'Usuário não encontrado' } } }),
    );
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, user: null });
    expect(apiMock.clearSession).toHaveBeenCalledTimes(1);
  });

  it('403 (conta bloqueada) para o retry sem deslogar', async () => {
    await bootOffline();
    apiMock.api.get.mockRejectedValueOnce(http(403));
    await jest.advanceTimersByTimeAsync(3_000);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(apiMock.clearSession).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(meCalls()).toBe(2);
  });

  it('logout cancela o retry e /me atrasado não ressuscita o usuário', async () => {
    await bootOffline();
    let resolveMe: (v: { data: typeof ME }) => void = () => undefined;
    apiMock.api.get.mockReturnValueOnce(new Promise((r) => (resolveMe = r)));
    const pending = useAuthStore.getState().ensureMe();
    await useAuthStore.getState().logout();
    resolveMe({ data: ME });
    await pending;
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, user: null });
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(meCalls()).toBe(2);
  });

  it('sessão derrubada pelo interceptor (refresh recusado) também para o retry', async () => {
    await bootOffline();
    onUnauthorized();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(meCalls()).toBe(1);
  });

  it('em segundo plano o timer não chama a API; a volta pro app (ensureMe) retoma', async () => {
    await bootOffline();
    appState.currentState = 'background';
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(meCalls()).toBe(1);

    appState.currentState = 'active';
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await useAuthStore.getState().ensureMe();
    expect(meCalls()).toBe(2);
    expect(useAuthStore.getState().user).toEqual(ME);
  });
});

describe('ensureMe (reconexão do socket / volta pro app)', () => {
  it('chamadas simultâneas viram um /me só', async () => {
    await bootOffline();
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await Promise.all([useAuthStore.getState().ensureMe(), useAuthStore.getState().ensureMe()]);
    expect(meCalls()).toBe(2);
    expect(useAuthStore.getState().user).toEqual(ME);
  });

  it('não faz nada com o perfil já carregado ou sem sessão', async () => {
    await useAuthStore.getState().ensureMe(); // deslogado
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await useAuthStore.getState().hydrate();
    await useAuthStore.getState().ensureMe(); // perfil já aqui
    expect(meCalls()).toBe(1);
  });

  it('não lança em erro de rede e agenda o próximo retry', async () => {
    await bootOffline();
    apiMock.api.get.mockRejectedValueOnce(offline());
    await expect(useAuthStore.getState().ensureMe()).resolves.toBeUndefined();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await jest.advanceTimersByTimeAsync(3_000);
    expect(useAuthStore.getState().user).toEqual(ME);
  });

  it('login com /me falho (deferAuth + commitAuth) também entra no retry', async () => {
    apiMock.api.post.mockResolvedValueOnce({ data: { token: 't', refreshToken: 'r', user: { isNew: false } } });
    apiMock.api.get.mockRejectedValueOnce(offline());
    await useAuthStore.getState().verifyCode('+5511999999999', '123456', { deferAuth: true });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(meCalls()).toBe(1); // ainda não virou sessão: nada de retry

    useAuthStore.getState().commitAuth();
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await jest.advanceTimersByTimeAsync(3_000);
    expect(meCalls()).toBe(2);
    expect(useAuthStore.getState().user).toEqual(ME);
  });
});

describe('número reciclado: "Essa conta é sua?"', () => {
  const PHONE = '+5511999999999';
  const CLAIM = { challengeId: 'c1', maskedName: 'A••• P•••', createdMonth: null, attemptsLeft: 3, expiresIn: 600 };
  const setToken = apiModule.setToken as unknown as jest.Mock;
  const postCalls = () => apiMock.api.post.mock.calls.map(([url, body]) => [url, body]);

  beforeEach(() => setToken.mockClear());

  it('verifyCode com claim: não grava token (nem null), não busca /me e devolve o desafio', async () => {
    apiMock.api.post.mockResolvedValueOnce({
      data: { user: { id: null, name: '', phone: PHONE, isNew: false }, token: null, refreshToken: null, claim: CLAIM },
    });
    const r = await useAuthStore.getState().verifyCode(PHONE, '123456', { deferAuth: true });
    expect(r).toEqual({ isNew: false, claim: CLAIM });
    expect(setToken).not.toHaveBeenCalled();
    expect(meCalls()).toBe(0);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('confirmClaim com a data certa: grava a sessão e busca o /me (deferAuth até o commitAuth)', async () => {
    apiMock.api.post.mockResolvedValueOnce({
      data: { user: { id: 'u1', name: 'Ana', phone: PHONE, isNew: false }, token: 't', refreshToken: 'r' },
    });
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    const r = await useAuthStore.getState().confirmClaim('c1', '1990-07-21', { deferAuth: true });
    expect(r).toEqual({ isNew: false });
    expect(postCalls()).toContainEqual(['/auth/claim/confirm', { challengeId: 'c1', birthDate: '1990-07-21' }]);
    expect(setToken).toHaveBeenCalledWith('t');
    expect(useAuthStore.getState()).toMatchObject({ user: ME, isAuthenticated: false });
    useAuthStore.getState().commitAuth();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('confirmClaim com a data errada (401 claim_mismatch): lança pra tela e não mexe na sessão', async () => {
    const mismatch = Object.assign(new Error('HTTP 401'), {
      response: { status: 401, data: { error: 'claim_mismatch', message: 'Não bateu', attemptsLeft: 2 } },
    });
    apiMock.api.post.mockRejectedValueOnce(mismatch);
    await expect(useAuthStore.getState().confirmClaim('c1', '1990-01-01')).rejects.toBe(mismatch);
    expect(setToken).not.toHaveBeenCalled();
    expect(apiMock.clearSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('esgotou as tentativas ou "Não é minha": isNew + released, sem sessão', async () => {
    apiMock.api.post.mockResolvedValueOnce({
      data: { user: { id: null, name: '', phone: PHONE, isNew: true }, token: null, refreshToken: null, released: 'birthdate_mismatch' },
    });
    expect(await useAuthStore.getState().confirmClaim('c1', '2000-01-01')).toEqual({
      isNew: true,
      released: 'birthdate_mismatch',
    });
    apiMock.api.post.mockResolvedValueOnce({
      data: { user: { id: null, name: '', phone: PHONE, isNew: true }, token: null, refreshToken: null, released: 'not_mine' },
    });
    expect(await useAuthStore.getState().releaseClaim('c2')).toEqual({ isNew: true, released: 'not_mine' });
    expect(postCalls()).toContainEqual(['/auth/claim/release', { challengeId: 'c2' }]);
    expect(setToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('cadastro: campos do perfil (orientação opcional, "Mostrar")', () => {
  it('manda "Mostrar", a orientação e as duas chaves como vieram da tela e abre a sessão', async () => {
    apiMock.api.post.mockResolvedValueOnce({ data: { token: 't', refreshToken: 'r', user: { id: 'u1' } } });
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await useAuthStore.getState().register({
      phone: '+5534999990000',
      name: 'Ana',
      birthDate: '1995-01-01',
      gender: 'female',
      lookingFor: 'relationship',
      termsVersion: '1.2',
      showMe: 'women',
      orientation: 'lesbian',
      showOrientation: true,
      sameOrientationFirst: false,
    });
    const [url, body] = apiMock.api.post.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(url).toBe('/auth/register');
    expect(body).toMatchObject({ showMe: 'women', orientation: 'lesbian', showOrientation: true, sameOrientationFirst: false });
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, onboardingStep: 'avatar' });
  });

  it('sem orientação (pulou ou "Prefiro não dizer"): nada de orientação nem chaves no corpo', async () => {
    apiMock.api.post.mockResolvedValueOnce({ data: { token: 't', refreshToken: 'r', user: { id: 'u1' } } });
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await useAuthStore.getState().register({
      phone: '+5534999990000',
      name: 'Ana',
      birthDate: '1995-01-01',
      gender: 'other',
      termsVersion: '1.2',
      showMe: 'everyone',
    });
    const [, body] = apiMock.api.post.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('orientation');
    expect(body).not.toHaveProperty('showOrientation');
    expect(body).not.toHaveProperty('sameOrientationFirst');
    expect(body).toMatchObject({ showMe: 'everyone' });
  });
});

describe('cadastro: bio, Instagram, interesses e métricas', () => {
  const input = {
    phone: '+5534999990000',
    name: 'Ana',
    birthDate: '1995-01-01',
    gender: 'female' as const,
    termsVersion: '1.2',
    showMe: 'everyone' as const,
    bio: 'café e praia',
    instagram: 'ana.souza',
    interests: ['Música', 'Praia'],
  };

  it('manda bio, @ e interesses e o installId da instalação; depois liga os eventos à conta', async () => {
    analyticsMock.getInstallId.mockResolvedValueOnce('inst-123');
    apiMock.api.post.mockResolvedValueOnce({ data: { token: 't', refreshToken: 'r', user: { id: 'u1' } } });
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await useAuthStore.getState().register(input);
    const [url, body] = apiMock.api.post.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(url).toBe('/auth/register');
    expect(body).toMatchObject({ bio: 'café e praia', instagram: 'ana.souza', interests: ['Música', 'Praia'], installId: 'inst-123' });
    await Promise.resolve();
    await Promise.resolve();
    expect(analyticsMock.linkInstallToUser).toHaveBeenCalledWith('u1');
  });

  it('sem installId (métrica ainda não pronta ou falhou): o corpo vai sem o campo e o cadastro segue', async () => {
    analyticsMock.getInstallId.mockRejectedValueOnce(new Error('sem storage'));
    analyticsMock.linkInstallToUser.mockRejectedValueOnce(new Error('offline'));
    apiMock.api.post.mockResolvedValueOnce({ data: { token: 't', refreshToken: 'r', user: { id: 'u1' } } });
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    await useAuthStore.getState().register(input);
    const [, body] = apiMock.api.post.mock.calls.at(-1) as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('installId');
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, onboardingStep: 'avatar' });
  });

  it('servidor recusou (text_blocked): lança pro cadastro tratar e não abre sessão', async () => {
    const blocked = Object.assign(new Error('HTTP 400'), {
      response: { status: 400, data: { error: 'text_blocked', field: 'bio', reason: 'hate', message: 'Tira isso da bio' } },
    });
    apiMock.api.post.mockRejectedValueOnce(blocked);
    await expect(useAuthStore.getState().register(input)).rejects.toBe(blocked);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('/me repetido não re-renderiza quem lê s.user', () => {
  const full = () => ({ ...ME, avatarConfig: { body: 'b1', hair: 'afro', aura: 'max' }, photos: [{ id: 'p1', url: 'u' }], likesReceived: 3 });

  it('refreshMe/setUser com o mesmo conteúdo mantêm a referência; o que mudou troca só o que mudou', async () => {
    useAuthStore.setState({ user: full() as never, isAuthenticated: true });
    const first = useAuthStore.getState().user;
    let userChanges = 0;
    const off = useAuthStore.subscribe((s, prev) => {
      if (s.user !== prev.user) userChanges += 1;
    });

    // curtida recebida / match / perfil: o /me volta igual 3 vezes
    for (let i = 0; i < 3; i++) {
      apiMock.api.get.mockResolvedValueOnce({ data: full() });
      await useAuthStore.getState().refreshMe();
    }
    useAuthStore.getState().setUser(full() as never);
    expect(userChanges).toBe(0);
    expect(useAuthStore.getState().user).toBe(first);

    // mudou o contador: user novo, mas avatar e fotos com a mesma referência (memo do avatar não refaz)
    apiMock.api.get.mockResolvedValueOnce({ data: { ...full(), likesReceived: 4 } });
    await useAuthStore.getState().refreshMe();
    const next = useAuthStore.getState().user as unknown as ReturnType<typeof full>;
    expect(userChanges).toBe(1);
    expect(next.likesReceived).toBe(4);
    expect(next.avatarConfig).toBe((first as unknown as ReturnType<typeof full>).avatarConfig);
    expect(next.photos).toBe((first as unknown as ReturnType<typeof full>).photos);
    off();
  });
});
