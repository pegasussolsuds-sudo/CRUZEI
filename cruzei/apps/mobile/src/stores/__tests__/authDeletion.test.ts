// Exclusão de conta no store: login de conta com exclusão no prazo (409) vira a pergunta "quer voltar?", o cancelamento
// abre a sessão com `restored` e o pedido de exclusão encerra a sessão local sem chamar /auth/logout.

jest.mock('../../services/notifications', () => ({ unregisterPushDevice: jest.fn(() => Promise.resolve()) }));
jest.mock('../../services/analytics', () => ({
  getInstallId: jest.fn(() => Promise.resolve(null)),
  linkInstallToUser: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  clearSession: jest.fn(() => Promise.resolve()),
  getToken: jest.fn(() => Promise.resolve(null)),
  setToken: jest.fn(() => Promise.resolve()),
  setRefreshToken: jest.fn(() => Promise.resolve()),
  setUnauthorizedHandler: jest.fn(),
}));

import * as apiModule from '../../services/api';
import { useAuthStore } from '../auth';

const apiMock = apiModule as unknown as {
  api: { get: jest.Mock; post: jest.Mock };
  clearSession: jest.Mock;
  setToken: jest.Mock;
};

const ME = { id: 'u1', name: 'Ana', premiumTier: 'free', settings: { visibilityMode: 'visible' } };
const PENDING = {
  error: 'account_deletion_pending',
  message: 'Tua conta tá marcada pra exclusão…',
  challengeId: '6f1c2a54-7a0e-4a52-9b1c-3c1d2e3f4a5b',
  requestedAt: '2026-10-01T12:00:00.000Z',
  scheduledFor: '2026-10-31T12:00:00.000Z',
  expiresIn: 600,
};
const httpErr = (status: number, data: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

beforeEach(() => {
  apiMock.api.get.mockReset();
  apiMock.api.post.mockReset();
  apiMock.clearSession.mockClear();
  apiMock.setToken.mockClear();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, onboardingStep: null });
});

describe('verifyCode com exclusão pendente', () => {
  it('409 account_deletion_pending vira deletionPending, sem sessão', async () => {
    apiMock.api.post.mockRejectedValueOnce(httpErr(409, PENDING));
    const out = await useAuthStore.getState().verifyCode('+5534999990000', '123456', { deferAuth: true });
    expect(out).toEqual({ isNew: false, deletionPending: PENDING });
    expect(apiMock.setToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('outro 409 (ou corpo sem desafio) continua sendo erro', async () => {
    apiMock.api.post.mockRejectedValueOnce(httpErr(409, { error: 'conflict', message: 'x' }));
    await expect(useAuthStore.getState().verifyCode('+5534999990000', '123456')).rejects.toThrow('HTTP 409');
    apiMock.api.post.mockRejectedValueOnce(httpErr(401, PENDING));
    await expect(useAuthStore.getState().verifyCode('+5534999990000', '123456')).rejects.toThrow('HTTP 401');
  });
});

describe('cancelDeletion', () => {
  it('abre a sessão e devolve restored (deferAuth segura o isAuthenticated)', async () => {
    const restored = { requestedAt: PENDING.requestedAt, scheduledFor: PENDING.scheduledFor };
    apiMock.api.post.mockResolvedValueOnce({
      data: { user: { id: 'u1', isNew: false }, token: 'a', refreshToken: 'r', restored },
    });
    apiMock.api.get.mockResolvedValueOnce({ data: ME });
    const out = await useAuthStore.getState().cancelDeletion(PENDING.challengeId, { deferAuth: true });
    expect(apiMock.api.post).toHaveBeenCalledWith('/auth/deletion/cancel', { challengeId: PENDING.challengeId });
    expect(out).toEqual({ isNew: false, restored });
    expect(apiMock.setToken).toHaveBeenCalledWith('a');
    expect(useAuthStore.getState()).toMatchObject({ user: ME, isAuthenticated: false });
    useAuthStore.getState().commitAuth();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('desafio vencido: 401 sobe pra tela', async () => {
    apiMock.api.post.mockRejectedValueOnce(httpErr(401, { error: 'deletion_challenge_expired', message: 'venceu' }));
    await expect(useAuthStore.getState().cancelDeletion(PENDING.challengeId)).rejects.toThrow('HTTP 401');
  });
});

describe('deleteAccount', () => {
  it('pede a exclusão, limpa a sessão local e não chama /auth/logout', async () => {
    useAuthStore.setState({ user: ME as never, isAuthenticated: true });
    const resp = { requestedAt: PENDING.requestedAt, scheduledFor: PENDING.scheduledFor, graceDays: 30 };
    apiMock.api.post.mockResolvedValueOnce({ data: resp });
    const out = await useAuthStore.getState().deleteAccount({ confirm: 'EXCLUIR', reason: 'privacy' });
    expect(out).toEqual(resp);
    expect(apiMock.api.post).toHaveBeenCalledTimes(1);
    expect(apiMock.api.post).toHaveBeenCalledWith('/me/deletion', { confirm: 'EXCLUIR', reason: 'privacy' });
    expect(apiMock.clearSession).toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false });
  });

  it('servidor recusou: a sessão continua', async () => {
    useAuthStore.setState({ user: ME as never, isAuthenticated: true });
    apiMock.api.post.mockRejectedValueOnce(httpErr(409, { error: 'staff_account', message: 'equipe' }));
    await expect(useAuthStore.getState().deleteAccount({ confirm: 'EXCLUIR' })).rejects.toThrow('HTTP 409');
    expect(apiMock.clearSession).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
