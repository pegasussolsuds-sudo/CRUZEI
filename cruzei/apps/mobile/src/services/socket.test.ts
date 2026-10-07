// coalesce: rajada de eventos do socket (ex.: 30 curtidas em 2 s) vira 2 chamadas, não 30.

jest.mock('socket.io-client', () => ({ io: jest.fn(() => ({ connected: true, active: true, on: jest.fn() })) }));
jest.mock('./api', () => ({ getToken: jest.fn(() => Promise.resolve('tok')), refreshAccessToken: jest.fn(), reportAccountBlocked: jest.fn() }));

import { coalesce, connectSocket, inboxPollMs } from './socket';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('coalesce', () => {
  it('1ª na hora, a rajada vira UMA no fim da janela; depois do silêncio, na hora de novo', () => {
    const fn = jest.fn();
    const fire = coalesce(fn, 5_000);

    fire();
    expect(fn).toHaveBeenCalledTimes(1); // a 1ª curtida atualiza o contador na hora

    for (let i = 0; i < 29; i++) {
      jest.advanceTimersByTime(60);
      fire();
    }
    expect(fn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5_000);
    expect(fn).toHaveBeenCalledTimes(2); // o resto da rajada: uma só, com o estado final

    jest.advanceTimersByTime(10_000); // janela sem evento não chama de novo
    expect(fn).toHaveBeenCalledTimes(2);
    fire();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('rajada contínua: no máx. uma chamada por janela', () => {
    const fn = jest.fn();
    const fire = coalesce(fn, 1_000);
    for (let t = 0; t < 10_000; t += 100) {
      fire();
      jest.advanceTimersByTime(100);
    }
    // 10 s de evento a cada 100 ms (100 eventos): 1 na hora + 1 por janela de 1 s
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(11);
  });
});

describe('polling de segurança das Mensagens', () => {
  it('sem socket 30 s; com o socket conectado 5 min (era 2 min; GETs medidos em hooks/polling.test.tsx)', async () => {
    expect(inboxPollMs()).toBe(30_000);
    jest.useRealTimers();
    await connectSocket();
    expect(inboxPollMs()).toBe(300_000);
  });
});
