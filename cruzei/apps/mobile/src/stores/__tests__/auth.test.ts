// Sessão salva + servidor fora no boot: o store fica "logado sem perfil" e precisa buscar o /me de novo sozinho.

jest.mock('../../services/notifications', () => ({ unregisterPushDevice: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(() => Promise.resolve({ data: {} })) },
  clearSession: jest.fn(() => Promise.resolve()),
  getToken: jest.fn(() => Promise.resolve('tok')),
  setToken: jest.fn(() => Promise.resolve()),
  setRefreshToken: jest.fn(() => Promise.resolve()),
  setUnauthorizedHandler: jest.fn(),
}));

import { AppState } from 'react-native';
import * as apiModule from '../../services/api';
import { useAuthStore } from '../auth';

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
